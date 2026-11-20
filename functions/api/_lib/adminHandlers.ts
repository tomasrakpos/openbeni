/**
 * Admin API for the standalone `/admin` page.
 *
 * Two independent doors, both verified server-side on every request:
 *   1. the panel password (`ADMIN_PASSWORD`, token in `x-admin-key`), and
 *   2. a Supabase session whose role is admin (`ADMIN_EMAILS` / `profiles.role`).
 *
 * Provider keys are encrypted with the master key and never returned to the
 * browser — only counts and health.
 *
 *   POST   /api/admin/login
 *   GET    /api/admin/diagnostics
 *   GET    /api/admin/providers
 *   POST   /api/admin/providers
 *   PATCH  /api/admin/providers/:id
 *   DELETE /api/admin/providers/:id
 *   POST   /api/admin/providers/:id/keys
 *   DELETE /api/admin/providers/:id/keys/:keyId
 *   POST   /api/admin/providers/:id/test
 *   PATCH  /api/admin/models/:id
 *   GET    /api/admin/users
 *   PATCH  /api/admin/users/:id
 *   GET    /api/admin/usage
 *   GET    /api/admin/settings
 *   PATCH  /api/admin/settings
 */

import { encryptSecret } from "./crypto";
import { getSettings, requireAdmin, type AuthEnv } from "./auth";
import {
  handleAdminLogin,
  verifyAdminToken,
  type AdminAuthEnv,
} from "./adminAuth";
import {
  callWithRotation,
  getProvider,
  listProviderKeys,
  summarizeProvider,
  type ProviderRow,
  type RotationEnv,
} from "./providerKeys";
import { authHeadersFor } from "./upstream";
import { broadcastCatalogChange, eq, sbJson, supabaseConfigured } from "./supabase";
import { validateProviderBaseUrl, normalizeProviderBaseUrl, type ProviderFormat } from "./urlGuard";
import { apiHeaders, jsonError, readJsonBody, rejectedOrigin } from "../security";

export type AdminEnv = AuthEnv &
  AdminAuthEnv &
  RotationEnv & {
    MASTER_ENCRYPTION_KEY?: string;
  };

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, max = 500): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function intOrNull(value: unknown, max = 1_000_000_000): number | null | undefined {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(max, Math.floor(value)));
}

function json(request: Request, env: AdminEnv, data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: apiHeaders(request, env, { "Content-Type": "application/json; charset=utf-8" }),
  });
}

interface CatalogRow {
  id: string;
  provider_id: string;
  upstream_id: string;
  display_name: string;
  context_window: number | null;
  capabilities: string[] | null;
  tier: string | null;
  enabled: boolean;
  upstream_verified: boolean;
  site_paid?: boolean;
  created_at: string;
  updated_at: string;
}

const MAX_DISCOVERED_MODELS = 500;

/**
 * Tier shown in the public model list.
 *
 * A model that answers with the site's own keys is usable by everyone, so it is
 * labelled "free". A model that does not answer is labelled "paid": the site
 * cannot cover it, so using it would require a paid key of the user's own.
 */
function tierForTest(ok: boolean): "free" | "paid" {
  return ok ? "free" : "paid";
}

/* -------------------------------------------------------------------------- */
/* Providers                                                                  */
/* -------------------------------------------------------------------------- */

async function listProviders(request: Request, env: AdminEnv): Promise<Response> {
  const providers = await sbJson<ProviderRow[]>(env, "providers?select=*&order=created_at.asc");
  const summaries = await Promise.all(
    providers.map(async (provider) => {
      try {
        const keys = await listProviderKeys(env, provider.id);
        return summarizeProvider(provider, keys);
      } catch {
        return summarizeProvider(provider, []);
      }
    }),
  );
  return json(request, env, { providers: summaries });
}

async function createProvider(request: Request, env: AdminEnv): Promise<Response> {
  const parsed = await readJsonBody(request);
  if (!parsed.ok || !isObject(parsed.value)) return jsonError(request, env, 400, "Invalid request body.");
  const body = parsed.value;

  const name = str(body.name, 80).trim();
  if (!name) return jsonError(request, env, 400, "Enter a display name.");
  const format = str(body.apiFormat, 20) || "openai";
  if (!["openai", "anthropic", "gemini", "custom"].includes(format)) {
    return jsonError(request, env, 400, "Unsupported API format.");
  }
  const baseCheck = validateProviderBaseUrl(str(body.baseUrl, 500), format as ProviderFormat);
  if (!baseCheck.ok) return jsonError(request, env, 400, baseCheck.message);

  const authHeader =
    str(body.authHeader, 80).trim() ||
    (format === "anthropic" ? "x-api-key" : format === "gemini" ? "x-goog-api-key" : "Authorization");
  const authPrefix =
    body.authPrefix === undefined || body.authPrefix === null
      ? format === "anthropic" || format === "gemini"
        ? ""
        : "Bearer "
      : str(body.authPrefix, 40);

  const rawKeys = Array.isArray(body.keys)
    ? body.keys.map((entry) => (typeof entry === "string" ? entry.trim() : isObject(entry) ? str(entry.key, 500).trim() : ""))
    : [];
  const labels = Array.isArray(body.keys)
    ? body.keys.map((entry) => (isObject(entry) ? str(entry.label, 60) : ""))
    : [];
  const keys = rawKeys.filter(Boolean).slice(0, 50);

  // Check the encryption material *before* inserting the provider row. Otherwise
  // the insert succeeds, key storage throws, and the panel is left with an
  // orphan provider that can never be used (and retries create duplicates).
  if (keys.length > 0 && !(env.MASTER_ENCRYPTION_KEY ?? "").trim()) {
    return jsonError(request, env, 503, "The server is missing MASTER_ENCRYPTION_KEY.");
  }

  const rows = await sbJson<ProviderRow[]>(env, "providers", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([
      {
        name,
        base_url: baseCheck.url.toString().replace(/\/+$/, ""),
        api_format: format,
        auth_header: authHeader,
        auth_prefix: authPrefix,
        extra_headers: isObject(body.extraHeaders) ? body.extraHeaders : {},
        icon: str(body.icon, 60) || null,
        color: str(body.color, 20) || null,
        notes: str(body.notes, 500) || null,
        enabled: bool(body.enabled) ?? true,
      },
    ]),
  });
  const provider = rows[0];
  if (!provider) return jsonError(request, env, 500, "Could not create the provider.");

  if (keys.length > 0) {
    try {
      await insertKeys(env, provider.id, keys, labels);
    } catch {
      // Roll back the half-created provider so a retry starts clean.
      try {
        await sbJson(env, `providers?id=${eq(provider.id)}`, {
          method: "DELETE",
          headers: { Prefer: "return=minimal" },
        });
      } catch {
        // Best effort; the failure below is what the admin needs to see.
      }
      return jsonError(request, env, 500, "Could not store the provider keys; the provider was not created.");
    }
  }
  void broadcastCatalogChange(env);
  return json(request, env, { provider: summarizeProvider(provider, keys.length ? await listProviderKeys(env, provider.id) : []) }, 201);
}

async function insertKeys(env: AdminEnv, providerId: string, keys: string[], labels: string[]): Promise<void> {
  const master = (env.MASTER_ENCRYPTION_KEY ?? "").trim();
  if (!master) throw new Error("MASTER_ENCRYPTION_KEY is not configured.");
  const payload = [];
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index] ?? "";
    if (!key) continue;
    payload.push({
      provider_id: providerId,
      ciphertext: await encryptSecret(master, key),
      label: labels[index]?.trim() || null,
      enabled: true,
    });
  }
  if (payload.length === 0) return;
  await sbJson(env, "provider_keys", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(payload),
  });
}

async function updateProvider(request: Request, env: AdminEnv, id: string): Promise<Response> {
  const existing = await getProvider(env, id);
  if (!existing) return jsonError(request, env, 404, "Provider not found.");
  const parsed = await readJsonBody(request);
  if (!parsed.ok || !isObject(parsed.value)) return jsonError(request, env, 400, "Invalid request body.");
  const body = parsed.value;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.name === "string") {
    const name = str(body.name, 80).trim();
    if (!name) return jsonError(request, env, 400, "Enter a display name.");
    patch.name = name;
  }
  if (typeof body.baseUrl === "string") {
    const format = (typeof body.apiFormat === "string" ? body.apiFormat : existing.api_format) as ProviderFormat;
    const check = validateProviderBaseUrl(body.baseUrl, format);
    if (!check.ok) return jsonError(request, env, 400, check.message);
    patch.base_url = check.url.toString().replace(/\/+$/, "");
  }
  if (typeof body.apiFormat === "string" && ["openai", "anthropic", "gemini", "custom"].includes(body.apiFormat)) {
    patch.api_format = body.apiFormat;
  }
  if (typeof body.authHeader === "string") patch.auth_header = str(body.authHeader, 80).trim();
  if (typeof body.authPrefix === "string") patch.auth_prefix = str(body.authPrefix, 40);
  if (isObject(body.extraHeaders)) patch.extra_headers = body.extraHeaders;
  if (typeof body.icon === "string") patch.icon = str(body.icon, 60) || null;
  if (typeof body.color === "string") patch.color = str(body.color, 20) || null;
  if (typeof body.notes === "string") patch.notes = str(body.notes, 500) || null;
  const enabled = bool(body.enabled);
  if (enabled !== undefined) patch.enabled = enabled;

  const rows = await sbJson<ProviderRow[]>(env, `providers?id=${eq(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  const provider = rows[0];
  if (!provider) return jsonError(request, env, 500, "Could not update the provider.");
  void broadcastCatalogChange(env);
  return json(request, env, { provider: summarizeProvider(provider, await listProviderKeys(env, id)) });
}

async function deleteProvider(request: Request, env: AdminEnv, id: string): Promise<Response> {
  const existing = await getProvider(env, id);
  if (!existing) return jsonError(request, env, 404, "Provider not found.");
  await sbJson(env, `providers?id=${eq(id)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  void broadcastCatalogChange(env);
  return json(request, env, { deleted: true });
}

async function deleteAllProviders(request: Request, env: AdminEnv): Promise<Response> {
  await sbJson(env, "providers?id=not.is.null", {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  void broadcastCatalogChange(env);
  return json(request, env, { deleted: true });
}

async function addKeys(request: Request, env: AdminEnv, providerId: string): Promise<Response> {
  const provider = await getProvider(env, providerId);
  if (!provider) return jsonError(request, env, 404, "Provider not found.");
  if (!(env.MASTER_ENCRYPTION_KEY ?? "").trim()) {
    return jsonError(request, env, 503, "The server is missing MASTER_ENCRYPTION_KEY.");
  }
  const parsed = await readJsonBody(request);
  if (!parsed.ok || !isObject(parsed.value)) return jsonError(request, env, 400, "Invalid request body.");
  const raw = Array.isArray(parsed.value.keys) ? parsed.value.keys : [];
  const labels = Array.isArray(parsed.value.labels) ? parsed.value.labels : [];
  const keys = raw.map((entry) => str(entry, 500).trim()).filter(Boolean).slice(0, 50);
  if (keys.length === 0) return jsonError(request, env, 400, "Paste at least one key.");
  await insertKeys(
    env,
    providerId,
    keys,
    keys.map((_, index) => str(labels[index], 60)),
  );
  void broadcastCatalogChange(env);
  const rows = await listProviderKeys(env, providerId);
  return json(request, env, { provider: summarizeProvider(provider, rows) });
}

async function removeKey(request: Request, env: AdminEnv, providerId: string, keyId: string): Promise<Response> {
  const provider = await getProvider(env, providerId);
  if (!provider) return jsonError(request, env, 404, "Provider not found.");
  await sbJson(env, `provider_keys?id=${eq(keyId)}&provider_id=${eq(providerId)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  void broadcastCatalogChange(env);
  const rows = await listProviderKeys(env, providerId);
  return json(request, env, { provider: summarizeProvider(provider, rows) });
}

/* -------------------------------------------------------------------------- */
/* Connection + model tests                                                  */
/* -------------------------------------------------------------------------- */

interface UpstreamModel {
  id: string;
  displayName?: string;
  contextWindow?: number;
}

async function fetchUpstreamModels(
  env: AdminEnv,
  provider: ProviderRow,
  keys: Awaited<ReturnType<typeof listProviderKeys>>,
): Promise<{ ok: true; models: UpstreamModel[] } | { ok: false; message: string }> {
  const format = provider.api_format ?? "openai";
  const base = normalizeProviderBaseUrl(provider.base_url, format);
  const url = `${base}/models`;
  const outcome = await callWithRotation(
    env,
    provider,
    keys,
    (apiKey) => Promise.resolve({
      url,
      init: {
        method: "GET",
        headers: {
          ...authHeadersFor(provider, apiKey),
          ...(format === "anthropic" ? { "anthropic-version": "2023-06-01" } : {}),
        },
      },
    }),
    (line) => console.warn(`[admin-test] ${line}`),
  );
  if (!outcome.response) return { ok: false, message: outcome.failure?.message ?? "The provider did not respond." };

  const payload = await outcome.response.json().catch(() => null);
  const root = (payload ?? {}) as Json;
  const list = Array.isArray(root.data)
    ? root.data
    : Array.isArray(root.models)
      ? root.models
      : Array.isArray(payload)
        ? (payload as unknown[])
        : [];
  const models: UpstreamModel[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Json;
    const id = str(row.id, 200) || str(row.name, 200);
    if (!id) continue;
    const cleanId = format === "gemini" ? id.replace(/^models\//, "") : id;
    models.push({
      id: cleanId,
      displayName: str(row.display_name, 120) || str(row.displayName, 120) || undefined,
      contextWindow:
        typeof row.context_length === "number"
          ? row.context_length
          : typeof row.input_token_limit === "number"
            ? row.input_token_limit
            : undefined,
    });
  }
  if (models.length === 0) return { ok: false, message: "The provider returned no models." };
  return { ok: true, models };
}

async function runProviderTest(request: Request, env: AdminEnv, providerId: string): Promise<Response> {
  const provider = await getProvider(env, providerId);
  if (!provider) return jsonError(request, env, 404, "Provider not found.");
  const keys = await listProviderKeys(env, providerId);
  const usable = keys.filter((key) => key.enabled);
  if (usable.length === 0) return jsonError(request, env, 400, "Add at least one key before testing.");

  // One /models call imports every model the provider exposes. Probing each
  // model with a chat completion made this slow and silently dropped anything
  // past the old 40-model cap.
  const listing = await fetchUpstreamModels(env, provider, usable);
  if (!listing.ok) return jsonError(request, env, 502, listing.message, "test_failed");

  const discovered = listing.models.slice(0, MAX_DISCOVERED_MODELS);

  let existing: CatalogRow[] = [];
  try {
    existing = await sbJson<CatalogRow[]>(
      env,
      `catalog_models?select=*&provider_id=${eq(providerId)}&limit=1000`,
    );
  } catch {
    existing = [];
  }
  const previous = new Map(existing.map((row) => [row.upstream_id, row]));

  const rows = discovered.map((entry) => {
    const old = previous.get(entry.id);
    return {
      provider_id: providerId,
      upstream_id: entry.id,
      display_name: entry.displayName ?? entry.id,
      context_window: entry.contextWindow ?? old?.context_window ?? null,
      capabilities: ["text"],
      // Preserve the admin's visibility / paid choice when re-testing.
      tier: old?.tier ?? tierForTest(true),
      enabled: old ? old.enabled : true,
      site_paid: old?.site_paid ?? false,
      upstream_verified: true,
    };
  });

  if (rows.length > 0) {
    try {
      await sbJson(env, "catalog_models?on_conflict=provider_id,upstream_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(rows),
      });
    } catch {
      // A partial failure still returns the test results.
    }
    void broadcastCatalogChange(env);
  }

  const catalog = await sbJson<CatalogRow[]>(
    env,
    `catalog_models?select=*&provider_id=${eq(providerId)}&order=display_name.asc`,
  );
  return json(request, env, {
    tested: discovered.length,
    healthy: discovered.length,
    results: discovered.map((entry) => ({ id: entry.id, ok: true })),
    models: catalog,
  });
}

async function updateModel(request: Request, env: AdminEnv, modelId: string): Promise<Response> {  const parsed = await readJsonBody(request);
  if (!parsed.ok || !isObject(parsed.value)) return jsonError(request, env, 400, "Invalid request body.");
  const body = parsed.value;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.displayName === "string") {
    const displayName = str(body.displayName, 120).trim();
    if (!displayName) return jsonError(request, env, 400, "Enter a display name.");
    patch.display_name = displayName;
  }
  const enabled = bool(body.enabled);
  if (enabled !== undefined) patch.enabled = enabled;
  const paid = bool(body.paid);
  if (paid !== undefined) patch.site_paid = paid;

  const rows = await sbJson<CatalogRow[]>(env, `catalog_models?id=${eq(modelId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!rows[0]) return jsonError(request, env, 404, "Model not found.");
  void broadcastCatalogChange(env);
  return json(request, env, { model: rows[0] });
}

/* -------------------------------------------------------------------------- */
/* Users                                                                      */
/* -------------------------------------------------------------------------- */

interface UsageSummaryRow {
  user_id: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  requests: number | null;
}

async function listUsers(request: Request, env: AdminEnv): Promise<Response> {
  const profiles = await sbJson<Record<string, unknown>[]>(env, "profiles?select=*&order=created_at.desc&limit=1000");
  let summaries: UsageSummaryRow[] = [];
  try {
    summaries = await sbJson<UsageSummaryRow[]>(env, "user_usage_summary?select=*");
  } catch {
    summaries = [];
  }
  const byUser = new Map(summaries.map((row) => [row.user_id, row]));
  const data = profiles.map((profile) => {
    const usage = byUser.get(String(profile.id));
    const input = Number(usage?.prompt_tokens ?? 0);
    const output = Number(usage?.completion_tokens ?? 0);
    return {
      ...profile,
      inputTokens: input,
      outputTokens: output,
      totalTokens: input + output,
      requests: Number(usage?.requests ?? 0),
    };
  });
  return json(request, env, { users: data });
}

async function updateUser(request: Request, env: AdminEnv, userId: string): Promise<Response> {
  const parsed = await readJsonBody(request);
  if (!parsed.ok || !isObject(parsed.value)) return jsonError(request, env, 400, "Invalid request body.");
  const body = parsed.value;
  const patch: Record<string, unknown> = {};
  if (typeof body.status === "string") {
    if (body.status !== "active" && body.status !== "blocked") {
      return jsonError(request, env, 400, "Invalid status.");
    }
    patch.status = body.status;
  }
  if (body.displayName !== undefined) patch.display_name = str(body.displayName, 80) || null;
  const daily = intOrNull(body.dailyTokenLimit);
  if (daily !== undefined) patch.daily_token_limit = daily;
  const monthly = intOrNull(body.monthlyTokenLimit);
  if (monthly !== undefined) patch.monthly_token_limit = monthly;
  if (Object.keys(patch).length === 0) return jsonError(request, env, 400, "Nothing to update.");

  const rows = await sbJson<Record<string, unknown>[]>(env, `profiles?id=${eq(userId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!rows[0]) return jsonError(request, env, 404, "User not found.");
  return json(request, env, { user: rows[0] });
}

/* -------------------------------------------------------------------------- */
/* Usage stats                                                                */
/* -------------------------------------------------------------------------- */

interface UsageRow {
  user_id: string;
  model_name: string | null;
  provider_name: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  status: string | null;
  created_at: string;
}

async function usageStats(request: Request, env: AdminEnv): Promise<Response> {
  const days = Math.max(1, Math.min(90, Number(new URL(request.url).searchParams.get("days") ?? 30) || 30));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = await sbJson<UsageRow[]>(
    env,
    `usage_events?select=user_id,model_name,provider_name,prompt_tokens,completion_tokens,status,created_at&created_at=gte.${encodeURIComponent(
      since,
    )}&order=created_at.asc&limit=50000`,
  );

  const daily = new Map<string, { date: string; input: number; output: number }>();
  const byModel = new Map<string, { model: string; tokens: number; requests: number }>();
  const byProvider = new Map<string, { provider: string; tokens: number; requests: number }>();
  const byUser = new Map<string, { userId: string; tokens: number; requests: number }>();
  let errors = 0;

  for (const row of rows) {
    const input = Number(row.prompt_tokens ?? 0);
    const output = Number(row.completion_tokens ?? 0);
    const tokens = input + output;
    const date = row.created_at.slice(0, 10);
    const day = daily.get(date) ?? { date, input: 0, output: 0 };
    day.input += input;
    day.output += output;
    daily.set(date, day);

    const modelKey = row.model_name ?? "unknown";
    const model = byModel.get(modelKey) ?? { model: modelKey, tokens: 0, requests: 0 };
    model.tokens += tokens;
    model.requests += 1;
    byModel.set(modelKey, model);

    const providerKey = row.provider_name ?? "unknown";
    const provider = byProvider.get(providerKey) ?? { provider: providerKey, tokens: 0, requests: 0 };
    provider.tokens += tokens;
    provider.requests += 1;
    byProvider.set(providerKey, provider);

    const user = byUser.get(row.user_id) ?? { userId: row.user_id, tokens: 0, requests: 0 };
    user.tokens += tokens;
    user.requests += 1;
    byUser.set(row.user_id, user);

    if (row.status && row.status !== "ok") errors += 1;
  }

  return json(request, env, {
    days,
    totals: {
      requests: rows.length,
      tokens: rows.reduce((sum, row) => sum + Number(row.prompt_tokens ?? 0) + Number(row.completion_tokens ?? 0), 0),
      errors,
    },
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    byModel: [...byModel.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 12),
    byProvider: [...byProvider.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 12),
    topUsers: [...byUser.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 10),
  });
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

async function readSettings(request: Request, env: AdminEnv): Promise<Response> {
  return json(request, env, { settings: await getSettings(env) });
}

async function writeSettings(request: Request, env: AdminEnv): Promise<Response> {
  const parsed = await readJsonBody(request);
  if (!parsed.ok || !isObject(parsed.value)) return jsonError(request, env, 400, "Invalid request body.");
  const body = parsed.value;
  const patch: Record<string, unknown> = { id: true, updated_at: new Date().toISOString() };
  const signupOpen = bool(body.signupOpen);
  if (signupOpen !== undefined) patch.signup_open = signupOpen;
  const daily = intOrNull(body.defaultDailyTokenLimit);
  if (daily !== undefined) patch.default_daily_token_limit = daily;
  const monthly = intOrNull(body.defaultMonthlyTokenLimit);
  if (monthly !== undefined) patch.default_monthly_token_limit = monthly;

  const rows = await sbJson<Record<string, unknown>[]>(env, "app_settings?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify([patch]),
  });
  return json(request, env, { settings: rows[0] ?? (await getSettings(env)) });
}

/* -------------------------------------------------------------------------- */
/* Diagnostics                                                                */
/* -------------------------------------------------------------------------- */

interface CheckResult {
  ok: boolean;
  detail: string;
  latencyMs?: number;
}

async function pingTable(env: AdminEnv, table: string): Promise<CheckResult> {
  const started = Date.now();
  try {
    await sbJson<unknown[]>(env, `${table}?select=id&limit=1`);
    return { ok: true, detail: "reachable", latencyMs: Date.now() - started };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unreachable";
    return { ok: false, detail: message.slice(0, 160), latencyMs: Date.now() - started };
  }
}

/**
 * Small end-to-end health check for the admin panel: proves the browser reached
 * this handler, the handler reached Postgres, and the key material needed to
 * store provider keys is present.
 */
async function diagnostics(request: Request, env: AdminEnv, authMode: string): Promise<Response> {
  const configured = supabaseConfigured(env);
  let database: CheckResult & { tables?: Record<string, CheckResult> } = {
    ok: false,
    detail: configured ? "not checked" : "SUPABASE_* is not configured",
  };

  if (configured) {
    const [providers, models, settings, usage] = await Promise.all([
      pingTable(env, "providers"),
      pingTable(env, "catalog_models"),
      pingTable(env, "app_settings"),
      pingTable(env, "usage_events"),
    ]);
    database = {
      ok: providers.ok && models.ok && settings.ok && usage.ok,
      detail: providers.ok && models.ok ? "connected" : (providers.detail || models.detail),
      latencyMs: providers.latencyMs,
      tables: { providers, catalog_models: models, app_settings: settings, usage_events: usage },
    };
  }

  let counts: { providers?: number; models?: number; enabledModels?: number } = {};
  if (database.ok) {
    try {
      const [providerRows, modelRows] = await Promise.all([
        sbJson<{ id: string }[]>(env, "providers?select=id"),
        sbJson<{ enabled: boolean }[]>(env, "catalog_models?select=enabled"),
      ]);
      counts = {
        providers: providerRows.length,
        models: modelRows.length,
        enabledModels: modelRows.filter((row) => row.enabled).length,
      };
    } catch {
      // Counts are informative only.
    }
  }

  return json(request, env, {
    ok: database.ok,
    authMode,
    checks: {
      adminAuth: { ok: true, detail: authMode },
      database,
      encryption: {
        ok: Boolean((env.MASTER_ENCRYPTION_KEY ?? "").trim()),
        detail: (env.MASTER_ENCRYPTION_KEY ?? "").trim()
          ? "MASTER_ENCRYPTION_KEY is set"
          : "MASTER_ENCRYPTION_KEY is missing: provider keys cannot be stored",
      },
    },
    counts,
    checkedAt: new Date().toISOString(),
  });
}

/* -------------------------------------------------------------------------- */
/* Router                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Accepts either the panel password token or a Supabase admin session.
 * Returns the auth mode on success, or the response to send as-is.
 */
async function adminGate(
  request: Request,
  env: AdminEnv,
): Promise<{ authMode: string } | { response: Response }> {
  const token = request.headers.get("x-admin-key");
  if (token) {
    if (await verifyAdminToken(env, token)) return { authMode: "password" };
    return { response: jsonError(request, env, 401, "The admin session expired. Sign in again.", "admin_token_invalid") };
  }

  const gate = await requireAdmin(request, env);
  if ("response" in gate) {
    // With no Supabase project, explain the password door instead of a bare 401.
    if (!supabaseConfigured(env) && (env.ADMIN_PASSWORD ?? "").trim()) {
      return {
        response: jsonError(request, env, 401, "Sign in with the admin password.", "admin_password_required"),
      };
    }
    return { response: gate.response };
  }
  return { authMode: "session" };
}

export async function handleAdmin(request: Request, env: AdminEnv = {}): Promise<Response> {
  if (request.method === "OPTIONS") {
    if (rejectedOrigin(request, env)) return jsonError(request, env, 403, "Origin not allowed.");
    return new Response(null, { status: 204, headers: apiHeaders(request, env) });
  }
  if (rejectedOrigin(request, env)) return jsonError(request, env, 403, "Origin not allowed.");

  const url = new URL(request.url);
  const parts = url.pathname
    .replace(/^\/api\/admin\/?/, "")
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean);
  const method = request.method;

  // The password door itself must stay open (it is rate-limited inside).
  if (parts.length === 1 && parts[0] === "login" && method === "POST") {
    return handleAdminLogin(request, env);
  }

  const gate = await adminGate(request, env);
  if ("response" in gate) return gate.response;

  try {
    const [first, id, third, fourth] = parts;

    if (first === "diagnostics" && method === "GET") {
      return await diagnostics(request, env, gate.authMode);
    }

    if (first === "providers") {
      if (!id) {
        if (method === "GET") return await listProviders(request, env);
        if (method === "POST") return await createProvider(request, env);
        if (method === "DELETE") return await deleteAllProviders(request, env);
      }
      if (id && !third) {
        if (method === "PATCH") return await updateProvider(request, env, id);
        if (method === "DELETE") return await deleteProvider(request, env, id);
      }
      if (id && third === "keys" && !fourth) {
        if (method === "POST") return await addKeys(request, env, id);
      }
      if (id && third === "keys" && fourth) {
        if (method === "DELETE") return await removeKey(request, env, id, fourth);
      }
      if (id && third === "test" && method === "POST") {
        return await runProviderTest(request, env, id);
      }
      if (id && third === "models" && method === "GET") {
        const models = await sbJson<CatalogRow[]>(
          env,
          `catalog_models?select=*&provider_id=${eq(id)}&order=display_name.asc`,
        );
        return json(request, env, { models });
      }
    }

    if (first === "models" && id && method === "PATCH") {
      return await updateModel(request, env, id);
    }

    if (first === "users") {
      if (!id && method === "GET") return await listUsers(request, env);
      if (id && method === "PATCH") return await updateUser(request, env, id);
    }

    if (first === "usage" && method === "GET") return await usageStats(request, env);
    if (first === "settings") {
      if (method === "GET") return await readSettings(request, env);
      if (method === "PATCH" || method === "POST") return await writeSettings(request, env);
    }

    return jsonError(request, env, 404, "Not found.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "The admin request failed.";
    console.error(`[admin] ${message.slice(0, 300)}`);
    return jsonError(request, env, 500, "The admin request failed. Check the server logs.");
  }
}

