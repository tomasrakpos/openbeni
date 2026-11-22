/**
 * User-owned (BYOK) provider and model management.
 *
 * Users can register their own AI providers and models under their account:
 *   GET    /api/user-providers                     List signed-in user's providers & models
 *   POST   /api/user-providers                     Add a new provider (API key encrypted at rest)
 *   PATCH  /api/user-providers/:id                 Update provider settings or rotate API key
 *   DELETE /api/user-providers/:id                 Delete a provider and its models
 *   POST   /api/user-providers/:id/models          Add/upsert model(s) under a user provider
 *   DELETE /api/user-providers/:id/models/:modelId Remove a model under a user provider
 *
 * Models belonging to user-owned providers are billed with `billingSource: "byok"`
 * and NEVER deduct website credits in `/api/chat`.
 */

import { resolveAuth, type AuthEnv } from "./auth";
import { encryptSecret } from "./crypto";
import type { ApiFormat, ProviderRow } from "./providerKeys";
import { eq, sbJson, supabaseConfigured, type SupabaseEnv } from "./supabase";
import { validateProviderBaseUrl, type ProviderFormat } from "./urlGuard";
import { apiHeaders, clientIp, jsonError, rateLimit, readJsonBody, rejectedOrigin } from "../security";

export type UserProviderEnv = AuthEnv & {
  MASTER_ENCRYPTION_KEY?: string;
};

export interface UserProviderRow {
  id: string;
  user_id: string;
  name: string;
  base_url: string;
  api_format: ApiFormat;
  auth_header: string | null;
  auth_prefix: string | null;
  extra_headers: Record<string, string> | null;
  api_key_ciphertext: string | null;
  key_hint: string | null;
  icon: string | null;
  color: string | null;
  notes: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserModelRow {
  id: string;
  user_id: string;
  user_provider_id: string;
  upstream_id: string;
  display_name: string;
  context_window: number | null;
  capabilities: string[] | null;
  pricing?: "free" | "paid" | "unknown" | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserModelJoin extends UserModelRow {
  user_providers: UserProviderRow | UserProviderRow[] | null;
}

export interface PublicUserModel {
  id: string;
  userProviderId: string;
  upstreamId: string;
  displayName: string;
  contextWindow?: number;
  capabilities: string[];
  pricing: "free" | "paid" | "unknown";
  enabled: boolean;
  billingSource: "byok";
  consumesCredits: false;
  createdAt: string;
  updatedAt: string;
}

export interface PublicUserProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiFormat: ApiFormat;
  authHeader: string | null;
  authPrefix: string | null;
  extraHeaders: Record<string, string>;
  hasKey: boolean;
  keyHint: string | null;
  icon: string | null;
  color: string | null;
  notes: string | null;
  enabled: boolean;
  billingSource: "byok";
  consumesCredits: false;
  models: PublicUserModel[];
  createdAt: string;
  updatedAt: string;
}

const MAX_PROVIDERS_PER_USER = 25;
const MAX_MODELS_PER_PROVIDER = 200;
const ALLOWED_FORMATS = new Set<ApiFormat>(["openai", "anthropic", "gemini", "custom"]);
const FORBIDDEN_EXTRA_HEADERS = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "cookie",
  "cookie2",
]);

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, max = 500): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function sanitizeExtraHeaders(value: unknown): Record<string, string> {
  if (!isObject(value)) return {};
  const out: Record<string, string> = {};
  let count = 0;
  for (const [rawKey, rawVal] of Object.entries(value)) {
    if (count >= 20) break;
    const key = rawKey.trim().slice(0, 80);
    if (!key || !/^[a-zA-Z0-9-]+$/.test(key)) continue;
    if (FORBIDDEN_EXTRA_HEADERS.has(key.toLowerCase())) continue;
    if (typeof rawVal !== "string") continue;
    out[key] = rawVal.trim().slice(0, 500);
    count += 1;
  }
  return out;
}

export function defaultAuthForFormat(
  format: ApiFormat,
  authHeader: unknown,
  authPrefix: unknown,
): { authHeader: string | null; authPrefix: string | null } {
  let header: string | null;
  if (authHeader === null || authHeader === "") {
    header = null;
  } else if (typeof authHeader === "string" && authHeader.trim()) {
    header = authHeader.trim().slice(0, 80);
  } else {
    header = format === "anthropic" ? "x-api-key" : format === "gemini" ? "x-goog-api-key" : "Authorization";
  }

  let prefix: string | null;
  if (header === null) {
    prefix = null;
  } else if (authPrefix === undefined || authPrefix === null) {
    prefix = format === "anthropic" || format === "gemini" ? "" : "Bearer ";
  } else {
    prefix = str(authPrefix, 40);
  }

  return { authHeader: header, authPrefix: prefix };
}

export function maskKeyHint(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) return "••••";
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

export function toPublicUserModel(row: UserModelRow): PublicUserModel {
  const pricing: "free" | "paid" | "unknown" =
    row.pricing === "free" || row.pricing === "paid" || row.pricing === "unknown"
      ? row.pricing
      : "unknown";
  return {
    id: row.id,
    userProviderId: row.user_provider_id,
    upstreamId: row.upstream_id,
    displayName: row.display_name,
    ...(typeof row.context_window === "number" && row.context_window > 0
      ? { contextWindow: row.context_window }
      : {}),
    capabilities: Array.isArray(row.capabilities) && row.capabilities.length > 0 ? row.capabilities : ["text"],
    pricing,
    enabled: row.enabled,
    billingSource: "byok",
    consumesCredits: false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toPublicUserProvider(row: UserProviderRow, models: UserModelRow[] = []): PublicUserProvider {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    apiFormat: row.api_format,
    authHeader: row.auth_header,
    authPrefix: row.auth_prefix,
    extraHeaders: row.extra_headers ?? {},
    hasKey: Boolean(row.api_key_ciphertext),
    keyHint: row.key_hint,
    icon: row.icon,
    color: row.color,
    notes: row.notes,
    enabled: row.enabled,
    billingSource: "byok",
    consumesCredits: false,
    models: models.map(toPublicUserModel),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Adapt a user-owned provider row to the ProviderRow shape used by upstream builders. */
export function userProviderToProviderRow(row: UserProviderRow): ProviderRow {
  return {
    id: row.id,
    name: row.name,
    base_url: row.base_url,
    api_format: row.api_format,
    auth_header: row.auth_header,
    auth_prefix: row.auth_prefix,
    extra_headers: row.extra_headers ?? {},
    icon: row.icon,
    color: row.color,
    notes: row.notes,
    enabled: row.enabled,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Fetch a single user-owned provider strictly scoped to `userId`. */
export async function getUserProvider(
  env: SupabaseEnv,
  userId: string,
  providerId: string,
): Promise<UserProviderRow | null> {
  try {
    const rows = await sbJson<UserProviderRow[]>(
      env,
      `user_providers?select=*&id=${eq(providerId)}&user_id=${eq(userId)}&limit=1`,
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/** Fetch a single enabled user model + its owning provider strictly scoped to `userId`. */
export async function getUserModelWithProvider(
  env: SupabaseEnv,
  userId: string,
  modelId: string,
): Promise<{ model: UserModelRow; provider: UserProviderRow } | null> {
  try {
    const rows = await sbJson<UserModelJoin[]>(
      env,
      `user_models?select=*,user_providers!inner(*)&id=${eq(modelId)}&user_id=${eq(
        userId,
      )}&enabled=eq.true&user_providers.enabled=eq.true&limit=1`,
    );
    const match = rows[0];
    if (!match) return null;
    const provider = one(match.user_providers);
    if (!provider || provider.user_id !== userId) return null;
    return { model: match, provider };
  } catch {
    return null;
  }
}

/** Look up a user model under a specific user provider by either its UUID or upstream_id. */
export async function getUserModelForProvider(
  env: SupabaseEnv,
  userId: string,
  providerId: string,
  modelIdOrUpstream: string,
): Promise<UserModelRow | null> {
  try {
    const byId = await sbJson<UserModelRow[]>(
      env,
      `user_models?select=*&id=${eq(modelIdOrUpstream)}&user_id=${eq(userId)}&user_provider_id=${eq(
        providerId,
      )}&enabled=eq.true&limit=1`,
    );
    if (byId[0]) return byId[0];
  } catch {
    // Non-UUID upstream_id will reject on a uuid column in Postgres; fall through to upstream_id lookup.
  }
  try {
    const byUpstream = await sbJson<UserModelRow[]>(
      env,
      `user_models?select=*&upstream_id=${eq(modelIdOrUpstream)}&user_id=${eq(userId)}&user_provider_id=${eq(
        providerId,
      )}&enabled=eq.true&limit=1`,
    );
    return byUpstream[0] ?? null;
  } catch {
    return null;
  }
}

interface ParsedModelEntry {
  upstream_id: string;
  display_name: string;
  context_window: number | null;
  capabilities: string[];
  pricing: "free" | "paid" | "unknown";
  enabled: boolean;
}

function parseModelEntries(raw: unknown): ParsedModelEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ParsedModelEntry[] = [];
  for (const item of raw) {
    if (out.length >= MAX_MODELS_PER_PROVIDER) break;
    if (typeof item === "string") {
      const upstream = item.trim().slice(0, 160);
      if (!upstream || seen.has(upstream.toLowerCase())) continue;
      seen.add(upstream.toLowerCase());
      out.push({
        upstream_id: upstream,
        display_name: upstream,
        context_window: null,
        capabilities: ["text"],
        pricing: "unknown",
        enabled: true,
      });
      continue;
    }
    if (!isObject(item)) continue;
    const upstream = str(item.upstreamId ?? item.modelId ?? item.id, 160).trim();
    if (!upstream || seen.has(upstream.toLowerCase())) continue;
    seen.add(upstream.toLowerCase());
    const displayName = str(item.displayName, 160).trim() || upstream;
    const ctx =
      typeof item.contextWindow === "number" && Number.isFinite(item.contextWindow) && item.contextWindow > 0
        ? Math.min(Math.floor(item.contextWindow), 10_000_000)
        : null;
    const capabilities = Array.isArray(item.capabilities)
      ? item.capabilities
          .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
          .map((entry) => entry.trim().slice(0, 32))
          .slice(0, 12)
      : ["text"];
    const rawPricing = item.pricing ?? item.pricingTier ?? item.tier;
    const pricing: "free" | "paid" | "unknown" =
      rawPricing === "free" || rawPricing === "paid" || rawPricing === "unknown"
        ? rawPricing
        : "unknown";
    out.push({
      upstream_id: upstream,
      display_name: displayName,
      context_window: ctx,
      capabilities: capabilities.length > 0 ? capabilities : ["text"],
      pricing,
      enabled: typeof item.enabled === "boolean" ? item.enabled : true,
    });
  }
  return out;
}

function json(request: Request, env: UserProviderEnv, data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: apiHeaders(request, env, { "Content-Type": "application/json; charset=utf-8" }),
  });
}

export async function handleUserProviders(request: Request, env: UserProviderEnv = {}): Promise<Response> {
  if (request.method === "OPTIONS") {
    if (rejectedOrigin(request, env)) return jsonError(request, env, 403, "Origin not allowed.");
    return new Response(null, { status: 204, headers: apiHeaders(request, env) });
  }
  if (rejectedOrigin(request, env)) return jsonError(request, env, 403, "Origin not allowed.");
  if (!supabaseConfigured(env)) {
    return jsonError(request, env, 503, "User accounts are not configured on this server.");
  }

  const limit = rateLimit("user-providers", clientIp(request), 90, 60_000);
  if (!limit.ok) {
    return jsonError(request, env, 429, "Too many requests. Please wait a moment.", "rate_limited", {
      "Retry-After": String(limit.retryAfter),
    });
  }

  const auth = await resolveAuth(request, env);
  if (!auth) return jsonError(request, env, 401, "Sign in to manage providers.");
  if (auth.profile.status !== "active") {
    return jsonError(request, env, 403, "This account is blocked.", "account_blocked");
  }

  const userId = auth.profile.id;
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/api\/user-providers\/?/, "").split("/").filter(Boolean);
  const providerId = parts[0];
  const subResource = parts[1];
  const subId = parts[2];
  const method = request.method.toUpperCase();

  // GET /api/user-providers
  if (!providerId && method === "GET") {
    const [providers, models] = await Promise.all([
      sbJson<UserProviderRow[]>(
        env,
        `user_providers?select=*&user_id=${eq(userId)}&order=created_at.asc`,
      ).catch(() => []),
      sbJson<UserModelRow[]>(
        env,
        `user_models?select=*&user_id=${eq(userId)}&order=display_name.asc`,
      ).catch(() => []),
    ]);
    const byProvider = new Map<string, UserModelRow[]>();
    for (const model of models) {
      const list = byProvider.get(model.user_provider_id) ?? [];
      list.push(model);
      byProvider.set(model.user_provider_id, list);
    }
    return json(request, env, {
      providers: providers.map((provider) => toPublicUserProvider(provider, byProvider.get(provider.id) ?? [])),
    });
  }

  // POST /api/user-providers
  if (!providerId && method === "POST") {
    const parsed = await readJsonBody(request);
    if (!parsed.ok || !isObject(parsed.value)) {
      return jsonError(request, env, parsed.ok ? 400 : parsed.reason === "too-large" ? 413 : 400, "Invalid request body.");
    }
    const body = parsed.value;

    const name = str(body.name, 80).trim();
    if (!name) return jsonError(request, env, 400, "Enter a display name.");

    const rawFormat = str(body.apiFormat, 20) || "openai";
    if (!ALLOWED_FORMATS.has(rawFormat as ApiFormat)) {
      return jsonError(request, env, 400, "Unsupported API format.");
    }
    const format = rawFormat as ApiFormat;

    const baseCheck = validateProviderBaseUrl(str(body.baseUrl, 500), format as ProviderFormat);
    if (!baseCheck.ok) return jsonError(request, env, 400, baseCheck.message);

    const apiKey = str(body.apiKey, 1000).trim();
    if (apiKey && !(env.MASTER_ENCRYPTION_KEY ?? "").trim()) {
      return jsonError(request, env, 503, "The server is missing MASTER_ENCRYPTION_KEY.");
    }

    const existing = await sbJson<{ id: string }[]>(
      env,
      `user_providers?select=id&user_id=${eq(userId)}`,
    ).catch(() => []);
    if (existing.length >= MAX_PROVIDERS_PER_USER) {
      return jsonError(request, env, 400, `You can add up to ${MAX_PROVIDERS_PER_USER} custom providers.`);
    }

    const { authHeader, authPrefix } = defaultAuthForFormat(format, body.authHeader, body.authPrefix);
    const ciphertext = apiKey ? await encryptSecret(env.MASTER_ENCRYPTION_KEY ?? "", apiKey) : null;
    const keyHint = apiKey ? maskKeyHint(apiKey) : null;

    const createdRows = await sbJson<UserProviderRow[]>(env, "user_providers", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify([
        {
          user_id: userId,
          name,
          base_url: baseCheck.url.toString().replace(/\/+$/, ""),
          api_format: format,
          auth_header: authHeader,
          auth_prefix: authPrefix,
          extra_headers: sanitizeExtraHeaders(body.extraHeaders),
          api_key_ciphertext: ciphertext,
          key_hint: keyHint,
          icon: str(body.icon, 60).trim() || null,
          color: str(body.color, 20).trim() || null,
          notes: str(body.notes, 500).trim() || null,
          enabled: typeof body.enabled === "boolean" ? body.enabled : true,
        },
      ]),
    });
    const created = createdRows[0];
    if (!created) return jsonError(request, env, 500, "Could not create provider.");

    let createdModels: UserModelRow[] = [];
    const initialModels = parseModelEntries(body.models);
    if (initialModels.length > 0) {
      createdModels = await sbJson<UserModelRow[]>(env, "user_models", {
        method: "POST",
        headers: { Prefer: "return=representation,resolution=merge-duplicates" },
        body: JSON.stringify(
          initialModels.map((entry) => ({
            user_id: userId,
            user_provider_id: created.id,
            ...entry,
          })),
        ),
      }).catch(() => []);
    }

    return json(request, env, { provider: toPublicUserProvider(created, createdModels) }, 201);
  }

  // PATCH /api/user-providers/:id
  if (providerId && !subResource && method === "PATCH") {
    const existing = await getUserProvider(env, userId, providerId);
    if (!existing) return jsonError(request, env, 404, "Provider not found.");

    const parsed = await readJsonBody(request);
    if (!parsed.ok || !isObject(parsed.value)) {
      return jsonError(request, env, parsed.ok ? 400 : parsed.reason === "too-large" ? 413 : 400, "Invalid request body.");
    }
    const body = parsed.value;
    const patch: Record<string, unknown> = {};

    let nextFormat: ApiFormat = existing.api_format;
    if (body.apiFormat !== undefined) {
      const rawFormat = str(body.apiFormat, 20);
      if (!ALLOWED_FORMATS.has(rawFormat as ApiFormat)) {
        return jsonError(request, env, 400, "Unsupported API format.");
      }
      nextFormat = rawFormat as ApiFormat;
      patch.api_format = nextFormat;
    }

    if (body.name !== undefined) {
      const name = str(body.name, 80).trim();
      if (!name) return jsonError(request, env, 400, "Display name cannot be empty.");
      patch.name = name;
    }

    if (body.baseUrl !== undefined) {
      const baseCheck = validateProviderBaseUrl(str(body.baseUrl, 500), nextFormat as ProviderFormat);
      if (!baseCheck.ok) return jsonError(request, env, 400, baseCheck.message);
      patch.base_url = baseCheck.url.toString().replace(/\/+$/, "");
    }

    if (body.authHeader !== undefined) {
      patch.auth_header = body.authHeader === null || body.authHeader === "" ? null : str(body.authHeader, 80).trim();
    }
    if (body.authPrefix !== undefined) {
      patch.auth_prefix = body.authPrefix === null ? null : str(body.authPrefix, 40);
    }
    if (body.extraHeaders !== undefined) {
      patch.extra_headers = sanitizeExtraHeaders(body.extraHeaders);
    }
    if (body.icon !== undefined) patch.icon = body.icon === null ? null : str(body.icon, 60).trim() || null;
    if (body.color !== undefined) patch.color = body.color === null ? null : str(body.color, 20).trim() || null;
    if (body.notes !== undefined) patch.notes = body.notes === null ? null : str(body.notes, 500).trim() || null;
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;

    if (body.clearApiKey === true) {
      patch.api_key_ciphertext = null;
      patch.key_hint = null;
    } else if (typeof body.apiKey === "string" && body.apiKey.trim()) {
      const apiKey = body.apiKey.trim().slice(0, 1000);
      if (!(env.MASTER_ENCRYPTION_KEY ?? "").trim()) {
        return jsonError(request, env, 503, "The server is missing MASTER_ENCRYPTION_KEY.");
      }
      patch.api_key_ciphertext = await encryptSecret(env.MASTER_ENCRYPTION_KEY ?? "", apiKey);
      patch.key_hint = maskKeyHint(apiKey);
    }

    if (Object.keys(patch).length === 0) {
      const models = await sbJson<UserModelRow[]>(
        env,
        `user_models?select=*&user_id=${eq(userId)}&user_provider_id=${eq(providerId)}&order=display_name.asc`,
      ).catch(() => []);
      return json(request, env, { provider: toPublicUserProvider(existing, models) });
    }

    const updatedRows = await sbJson<UserProviderRow[]>(
      env,
      `user_providers?id=${eq(providerId)}&user_id=${eq(userId)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(patch),
      },
    );
    const updated = updatedRows[0] ?? existing;
    const models = await sbJson<UserModelRow[]>(
      env,
      `user_models?select=*&user_id=${eq(userId)}&user_provider_id=${eq(providerId)}&order=display_name.asc`,
    ).catch(() => []);
    return json(request, env, { provider: toPublicUserProvider(updated, models) });
  }

  // DELETE /api/user-providers/:id
  if (providerId && !subResource && method === "DELETE") {
    const existing = await getUserProvider(env, userId, providerId);
    if (!existing) return jsonError(request, env, 404, "Provider not found.");
    await sbJson(env, `user_providers?id=${eq(providerId)}&user_id=${eq(userId)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    return json(request, env, { deleted: true });
  }

  // POST /api/user-providers/:id/models
  if (providerId && subResource === "models" && !subId && method === "POST") {
    const existing = await getUserProvider(env, userId, providerId);
    if (!existing) return jsonError(request, env, 404, "Provider not found.");

    const parsed = await readJsonBody(request);
    if (!parsed.ok || !isObject(parsed.value)) {
      return jsonError(request, env, parsed.ok ? 400 : parsed.reason === "too-large" ? 413 : 400, "Invalid request body.");
    }
    const entries = Array.isArray(parsed.value.models)
      ? parseModelEntries(parsed.value.models)
      : parseModelEntries([parsed.value]);
    if (entries.length === 0) {
      return jsonError(request, env, 400, "Provide at least one valid model with upstreamId or modelId.");
    }

    const saved = await sbJson<UserModelRow[]>(
      env,
      "user_models?on_conflict=user_provider_id,upstream_id",
      {
        method: "POST",
        headers: { Prefer: "return=representation,resolution=merge-duplicates" },
        body: JSON.stringify(
          entries.map((entry) => ({
            user_id: userId,
            user_provider_id: providerId,
            ...entry,
          })),
        ),
      },
    );
    return json(request, env, { models: saved.map(toPublicUserModel) }, 201);
  }

  // DELETE /api/user-providers/:id/models/:modelId
  if (providerId && subResource === "models" && subId && method === "DELETE") {
    const existing = await getUserProvider(env, userId, providerId);
    if (!existing) return jsonError(request, env, 404, "Provider not found.");
    await sbJson(
      env,
      `user_models?id=${eq(subId)}&user_provider_id=${eq(providerId)}&user_id=${eq(userId)}`,
      {
        method: "DELETE",
        headers: { Prefer: "return=minimal" },
      },
    );
    return json(request, env, { deleted: true });
  }

  return jsonError(request, env, 405, "Method not allowed.");
}
