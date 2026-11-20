/**
 * Development-only admin preview.
 *
 * `/admin` is the standalone admin page: it asks for the admin password, which
 * the dev server verifies. While there is no Supabase project configured (or
 * you simply want to click through the UI), this module answers the data calls
 * the panel makes.
 *
 * Hard rules:
 * - It is compiled out of production: every entry point starts with
 *   `if (!import.meta.env.DEV) return false`. `vite build` replaces that with
 *   `false`, so a deployed `/admin` still requires the real admin password.
 * - Every API call goes to the dev server's shared preview store
 *   (`/api/dev-admin/state`, a JSON file), not to the browser. A provider added
 *   in one browser is therefore visible to every other browser on the same
 *   machine, exactly like a real deployment backed by a database.
 * - It answers only while the address is `/admin`; the public site's catalog
 *   reads the same store through `devCatalogModels()`.
 * - "Exit preview" deletes the store.
 */

import type { RequestOptions } from "@/lib/api";
import type { ApiFormat, Provider } from "@/lib/types";

/** Older preview builds kept state in the browser; migrate it once. */
const LEGACY_KEY = "openharness.devAdmin.data.v3";
const STORE_URL = "/api/dev-admin/state";

function canUsePreview(): boolean {
  if (!import.meta.env.DEV) return false;
  if (typeof window === "undefined") return false;
  // Real database configured on the server: exercise it, never sample data.
  if (typeof __SERVER_DB__ !== "undefined" && __SERVER_DB__) return false;
  return true;
}

/** True when the dev preview should answer API calls instead of the server. */
export function devAdminPreview(): boolean {
  if (!canUsePreview()) return false;
  try {
    // The admin page answers its own API calls from the shared dev store. The
    // public site reads the same store through `devCatalogModels()`.
    return window.location.pathname.startsWith("/admin");
  } catch {
    return false;
  }
}

export async function disableDevAdminPreview(): Promise<void> {
  try {
    window.localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Ignore storage failures.
  }
  try {
    await fetch(STORE_URL, { method: "DELETE", cache: "no-store" });
  } catch {
    // The store lives on the dev server; nothing to clean up if it is gone.
  }
}

export interface DevCatalogModel {
  id: string;
  displayName: string;
  capabilities: string[];
  contextWindow?: number;
  tier: "free" | "paid" | "unknown";
  /** Upstream model id used for the actual request. */
  upstreamId: string;
  /** Visible, but reserved: the picker shows a Paid badge and blocks it. */
  paid: boolean;
}

/**
 * Catalog exposed to the public site while the admin panel is running on
 * preview data. Without this, a provider added in local preview could never
 * reach the chat model picker.
 *
 * Returns `null` when preview data does not exist (or when a real Supabase
 * project is configured), so the normal server catalog stays authoritative.
 */
export async function devCatalogModels(): Promise<DevCatalogModel[] | null> {
  if (!import.meta.env.DEV) return null;
  if (serverHasDb()) return null;
  const state = await readStateIfPresent();
  if (!state) return null;

  const models: DevCatalogModel[] = [];
  for (const provider of state.providers) {
    if (!provider.enabled) continue;
    for (const model of state.models[provider.id] ?? []) {
      if (!model.enabled) continue;
      models.push({
        id: `${provider.id}:${model.upstream_id}`,
        displayName: model.display_name,
        capabilities: ["text"],
        ...(model.context_window ? { contextWindow: model.context_window } : {}),
        tier: model.paid ? "paid" : "free",
        upstreamId: model.upstream_id,
        paid: model.paid === true,
      });
    }
  }
  return models;
}

function serverHasDb(): boolean {
  return typeof __SERVER_DB__ !== "undefined" && __SERVER_DB__;
}

function authConfig(format: ApiFormat): { header: string; prefix: string } {
  if (format === "anthropic") return { header: "x-api-key", prefix: "" };
  if (format === "gemini") return { header: "x-goog-api-key", prefix: "" };
  return { header: "Authorization", prefix: "Bearer " };
}

/**
 * Resolve a preview catalog model to a real provider + key so chat works
 * end-to-end on localhost, exactly like server models do in production.
 */
export async function devChatTarget(
  upstreamId: string,
): Promise<{ provider: Provider; apiKey: string } | null> {
  if (!import.meta.env.DEV || serverHasDb()) return null;
  const state = await readStateIfPresent();
  if (!state) return null;
  for (const row of state.providers) {
    if (!row.enabled) continue;
    const model = (state.models[row.id] ?? []).find(
      (entry) => entry.upstream_id === upstreamId && entry.enabled && !entry.paid,
    );
    if (!model) continue;
    const key = row.keys.find((entry) => entry.enabled && entry.secret)?.secret;
    if (!key) return null;
    const format = (row.api_format as ApiFormat) || "openai";
    return {
      apiKey: key,
      provider: {
        id: row.id,
        name: row.name,
        baseUrl: row.base_url,
        apiFormat: format,
        auth: {
          header: row.auth_header || authConfig(format).header,
          prefix: row.auth_prefix ?? authConfig(format).prefix,
        },
        extraHeaders: {},
        timeoutMs: 120_000,
        useProxy: true,
        enabled: true,
        favorite: false,
        order: 0,
        paths: {},
        hasKey: true,
        createdAt: 0,
        updatedAt: 0,
      },
    };
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Sample data                                                                */
/* -------------------------------------------------------------------------- */

interface MockKey {
  id: string;
  label: string | null;
  enabled: boolean;
  status: "ok" | "cooling" | "disabled";
  cooldownUntil: string | null;
  failCount: number;
  lastError: string | null;
  /** Preview-only: used to call the real upstream from localhost. */
  secret?: string;
}

interface MockProvider {
  id: string;
  name: string;
  base_url: string;
  api_format: string;
  auth_header?: string;
  auth_prefix?: string;
  enabled: boolean;
  keyCount: number;
  healthyKeys: number;
  keys: MockKey[];
}

interface MockModel {
  id: string;
  display_name: string;
  upstream_id: string;
  enabled: boolean;
  upstream_verified: boolean;
  context_window: number | null;
  /** Show a Paid badge in the public picker; users cannot run it. */
  paid: boolean;
}

interface MockUser {
  id: string;
  email: string;
  display_name: string | null;
  role: "user" | "admin";
  status: "active" | "blocked";
  daily_token_limit: number | null;
  monthly_token_limit: number | null;
  created_at: string;
  last_seen_at: string;
  totalTokens: number;
  requests: number;
}

interface MockState {
  providers: MockProvider[];
  models: Record<string, MockModel[]>;
  users: MockUser[];
  settings: {
    signup_open: boolean;
    default_daily_token_limit: number | null;
    default_monthly_token_limit: number | null;
  };
}

function iso(daysAgo: number, hour = 12): string {
  return new Date(Date.now() - daysAgo * 86_400_000 - hour * 3_600_000).toISOString();
}

function sampleState(): MockState {
  return {
    // No providers: the panel preview starts from the same empty state as a
    // real fresh install.
    providers: [],
    models: {},
    users: [
      {
        id: "mock-u1",
        email: "admin@example.com",
        display_name: "Site Admin",
        role: "admin",
        status: "active",
        daily_token_limit: null,
        monthly_token_limit: null,
        created_at: iso(120),
        last_seen_at: new Date().toISOString(),
        totalTokens: 184_320,
        requests: 412,
      },
      {
        id: "mock-u2",
        email: "sara@example.com",
        display_name: "Sara",
        role: "user",
        status: "active",
        daily_token_limit: 50_000,
        monthly_token_limit: 600_000,
        created_at: iso(64),
        last_seen_at: iso(1),
        totalTokens: 92_140,
        requests: 208,
      },
      {
        id: "mock-u3",
        email: "reza@example.com",
        display_name: "Reza",
        role: "user",
        status: "active",
        daily_token_limit: null,
        monthly_token_limit: null,
        created_at: iso(31),
        last_seen_at: iso(3),
        totalTokens: 41_880,
        requests: 96,
      },
      {
        id: "mock-u4",
        email: "abuse@example.com",
        display_name: "Abuse Test",
        role: "user",
        status: "blocked",
        daily_token_limit: 5000,
        monthly_token_limit: 50_000,
        created_at: iso(12),
        last_seen_at: iso(9),
        totalTokens: 61_200,
        requests: 130,
      },
      {
        id: "mock-u5",
        email: "nima@example.com",
        display_name: "Nima",
        role: "user",
        status: "active",
        daily_token_limit: null,
        monthly_token_limit: null,
        created_at: iso(4),
        last_seen_at: iso(0, 2),
        totalTokens: 8_640,
        requests: 21,
      },
    ],
    settings: { signup_open: true, default_daily_token_limit: 100_000, default_monthly_token_limit: 1_500_000 },
  };
}

/**
 * Preview state lives on the dev server, so every browser sees the same
 * providers. There is no client-side copy: every read asks the store, which
 * keeps two open browsers in sync without a reload.
 */
function normalizeState(value: unknown): MockState | null {
  const parsed = value as MockState | null;
  if (!parsed || !Array.isArray(parsed.providers) || !Array.isArray(parsed.users)) return null;
  for (const provider of parsed.providers) {
    for (const model of parsed.models?.[provider.id] ?? []) {
      if (typeof model.paid !== "boolean") model.paid = false;
    }
  }
  return parsed;
}

async function fetchState(): Promise<MockState | null> {
  try {
    const response = await fetch(STORE_URL, { cache: "no-store" });
    if (!response.ok) return null;
    const payload = (await response.json().catch(() => null)) as { state?: unknown } | null;
    return normalizeState(payload?.state ?? null);
  } catch {
    return null;
  }
}

async function persist(state: MockState): Promise<void> {
  try {
    await fetch(STORE_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
      cache: "no-store",
    });
  } catch {
    // The panel keeps working for the current request even if the store fails.
  }
}

async function readStateIfPresent(): Promise<MockState | null> {
  const stored = await fetchState();
  if (stored) return stored;
  // One-time migration: providers created before the shared store existed are
  // still in this browser's localStorage.
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    if (raw) {
      window.localStorage.removeItem(LEGACY_KEY);
      const migrated = normalizeState(JSON.parse(raw) as unknown);
      if (migrated) {
        await persist(migrated);
        return migrated;
      }
    }
  } catch {
    // Ignore unreadable legacy state.
  }
  return null;
}

async function readState(): Promise<MockState> {
  const existing = await readStateIfPresent();
  if (existing) return existing;
  const fresh = sampleState();
  await persist(fresh);
  return fresh;
}

/* -------------------------------------------------------------------------- */
/* Fake usage series                                                          */
/* -------------------------------------------------------------------------- */

function usageStats(days: number, state: MockState) {
  const activeUsers = state.users.filter((user) => user.status === "active");
  const daily: { date: string; input: number; output: number }[] = [];
  const models = Object.values(state.models).flat();
  const perModel = new Map<string, { model: string; tokens: number; requests: number }>();
  const perProvider = new Map<string, { provider: string; tokens: number; requests: number }>();
  const perUser = new Map<string, { userId: string; tokens: number; requests: number }>();

  let totalRequests = 0;
  let totalTokens = 0;

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
    // Deterministic-ish wave so the chart looks plausible without randomness
    // across reloads of the same day.
    const wave = 0.6 + 0.4 * Math.sin((days - offset) / 3.1);
    const input = Math.round(9_000 * wave) + (offset % 5) * 400;
    const output = Math.round(input * 1.7);
    daily.push({ date, input, output });
    totalRequests += Math.round(28 * wave) + 4;
    totalTokens += input + output;

    for (const [index, model] of models.entries()) {
      if (!model.enabled) continue;
      const share = (index + 1) / (models.length + 1);
      const tokens = Math.round((input + output) * share * 0.5);
      const entry = perModel.get(model.display_name) ?? { model: model.display_name, tokens: 0, requests: 0 };
      entry.tokens += tokens;
      entry.requests += Math.round(6 * wave) + 1;
      perModel.set(model.display_name, entry);
    }

    for (const provider of state.providers) {
      if (!provider.enabled) continue;
      const entry = perProvider.get(provider.name) ?? { provider: provider.name, tokens: 0, requests: 0 };
      entry.tokens += Math.round((input + output) * 0.6);
      entry.requests += Math.round(14 * wave) + 2;
      perProvider.set(provider.name, entry);
    }

    for (const [index, user] of activeUsers.entries()) {
      const entry = perUser.get(user.id) ?? { userId: user.id, tokens: 0, requests: 0 };
      entry.tokens += Math.round(((input + output) / (index + 2)) * 0.4);
      entry.requests += Math.max(1, Math.round((6 * wave) / (index + 1)));
      perUser.set(user.id, entry);
    }
  }

  return {
    days,
    totals: {
      requests: totalRequests,
      tokens: state.users.reduce((sum, user) => sum + user.totalTokens, 0) + totalTokens,
      errors: Math.round(totalRequests * 0.03),
    },
    daily,
    byModel: [...perModel.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 12),
    byProvider: [...perProvider.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 12),
    topUsers: [...perUser.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 10),
  };
}

/* -------------------------------------------------------------------------- */
/* Router                                                                     */
/* -------------------------------------------------------------------------- */

function fail(status: number, message: string): never {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  throw error;
}

function str(value: unknown, max = 500): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function summarise(provider: MockProvider): MockProvider {
  const healthy = provider.keys.filter((key) => key.status === "ok").length;
  const keys = provider.keys.map(({ secret: _secret, ...rest }) => rest);
  return { ...provider, keys, keyCount: provider.keys.length, healthyKeys: healthy };
}

function makeKey(providerId: string, index: number, secret: string): MockKey {
  return {
    id: `${providerId}-k${Date.now().toString(36)}${index}`,
    label: null,
    enabled: true,
    status: "ok",
    cooldownUntil: null,
    failCount: 0,
    lastError: null,
    secret,
  };
}

/* -------------------------------------------------------------------------- */
/* Real upstream discovery (dev only)                                         */
/* -------------------------------------------------------------------------- */

interface DiscoveredModel {
  id: string;
  displayName?: string;
  contextWindow?: number;
}

interface UpstreamErrorBody {
  error?: { message?: string };
  message?: string;
}

/** Headers that the same-origin dev proxy forwards to the provider. */
function upstreamHeaders(provider: MockProvider, apiKey: string): Record<string, string> {
  const format = (provider.api_format as ApiFormat) || "openai";
  const config = {
    header: provider.auth_header || authConfig(format).header,
    prefix: provider.auth_prefix ?? authConfig(format).prefix,
  };
  const headers: Record<string, string> = {};
  if (config.header) headers[config.header] = `${config.prefix}${apiKey}`;
  if (format === "anthropic") headers["anthropic-version"] = "2023-06-01";
  return headers;
}

/**
 * Ask the provider for its real model list through `/api/proxy`.
 *
 * Local preview has no server database, so the browser performs the request
 * (via the same-origin proxy to avoid CORS). The result replaces the old fake
 * "Fast Chat"/"Reasoning" placeholders with the provider's actual models.
 */
async function discoverModels(
  provider: MockProvider,
): Promise<{ ok: true; models: DiscoveredModel[] } | { ok: false; message: string }> {
  const key = provider.keys.find((entry) => entry.enabled && entry.secret)?.secret;
  if (!key) return { ok: false, message: "Add at least one key before testing." };
  const base = provider.base_url.replace(/\/+$/, "");
  const url = `${base}/models`;
  let response: Response;
  try {
    response = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`, {
      headers: upstreamHeaders(provider, key),
      cache: "no-store",
    });
  } catch {
    return { ok: false, message: "Could not reach the provider. Check the Base URL." };
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as UpstreamErrorBody | null;
    const detail = payload?.error?.message ?? payload?.message ?? "";
    return {
      ok: false,
      message: `The provider returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
    };
  }
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const list = Array.isArray(payload?.data)
    ? (payload.data as unknown[])
    : Array.isArray(payload?.models)
      ? (payload.models as unknown[])
      : Array.isArray(payload)
        ? (payload as unknown[])
        : [];
  const format = (provider.api_format as ApiFormat) || "openai";
  const models: DiscoveredModel[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const id = str(row.id, 200) || str(row.name, 200);
    if (!id) continue;
    models.push({
      id: format === "gemini" ? id.replace(/^models\//, "") : id,
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
  models.sort((a, b) => a.id.localeCompare(b.id));
  return { ok: true, models };
}

function modelIdFor(providerId: string, upstreamId: string): string {
  return `${providerId}-${upstreamId.replace(/[^a-zA-Z0-9._-]/g, "_")}`.slice(0, 120);
}

/**
 * Answers a mocked request, or returns `undefined` so the caller falls through
 * to the real network path.
 */
export async function devAdminMock<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T | undefined> {
  if (!devAdminPreview()) return undefined;
  if (!path.startsWith("/api/")) return undefined;

  const method = (options.method ?? (options.body === undefined ? "GET" : "POST")).toUpperCase();
  const url = new URL(path, window.location.origin);
  const segments = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const body = asRecord(options.body);
  const state = await readState();

  /* Session + config are read at boot, before the panel mounts. */
  if (segments[0] === "config") {
    return {
      accountsEnabled: true,
      signupOpen: state.settings.signup_open,
      devPreview: true,
    } as T;
  }

  if (segments[0] === "session") {
    return {
      id: "mock-u1",
      email: "admin@example.com",
      displayName: "Site Admin",
      role: "admin",
      status: "active",
      dailyTokenLimit: null,
      monthlyTokenLimit: null,
      createdAt: iso(120),
      lastSeenAt: new Date().toISOString(),
      isAdmin: true,
    } as T;
  }

  // The chat picker reads the real catalog through `devCatalogModels()`.
  if (segments[0] === "models") return [] as T;
  if (segments[0] === "auth") return { session: null, message: null } as T;
  if (segments[0] === "chat") return undefined;

  if (segments[0] !== "admin") return undefined;

  const [, area, id, third, fourth] = segments;
  const save = () => persist(state);

  if (area === "diagnostics") {
    const models = Object.values(state.models).flat();
    return {
      ok: true,
      authMode: "preview",
      checks: {
        adminAuth: { ok: true, detail: "Local preview" },
        database: { ok: true, detail: "Shared dev store (.dev-admin)", latencyMs: 0 },
        encryption: { ok: true, detail: "Not used in preview" },
      },
      counts: {
        providers: state.providers.length,
        models: models.length,
        enabledModels: models.filter((model) => model.enabled).length,
      },
      checkedAt: new Date().toISOString(),
    } as T;
  }

  if (area === "providers") {
    if (!id) {
      if (method === "GET") return { providers: state.providers.map(summarise) } as T;
      if (method === "POST") {
        const name = str(body.name, 80).trim() || "Untitled provider";
        const format = str(body.apiFormat, 20) || "openai";
        const provider: MockProvider = {
          id: `mock-${Date.now().toString(36)}`,
          name,
          base_url: str(body.baseUrl, 500) || "https://example.com/v1",
          api_format: format,
          auth_header: str(body.authHeader, 80) || authConfig(format as ApiFormat).header,
          auth_prefix:
            typeof body.authPrefix === "string" ? str(body.authPrefix, 40) : authConfig(format as ApiFormat).prefix,
          enabled: true,
          keyCount: 0,
          healthyKeys: 0,
          keys: [],
        };
        const rawKeys = Array.isArray(body.keys) ? (body.keys as unknown[]) : [];
        rawKeys
          .map((entry) => (typeof entry === "string" ? entry : asRecord(entry).key))
          .map((entry) => str(entry, 500).trim())
          .filter(Boolean)
          .slice(0, 50)
          .forEach((secret, index) => provider.keys.push(makeKey(provider.id, index, secret)));
        state.providers.push(provider);
        state.models[provider.id] = [];
        await save();
        return { provider: summarise(provider) } as T;
      }
    }

    const provider = state.providers.find((row) => row.id === id);
    if (!provider) fail(404, "Provider not found.");

    if (!third) {
      if (method === "PATCH") {
        if (typeof body.name === "string" && body.name.trim()) provider.name = str(body.name, 80).trim();
        if (typeof body.baseUrl === "string" && body.baseUrl.trim()) provider.base_url = str(body.baseUrl, 500);
        if (typeof body.apiFormat === "string") provider.api_format = body.apiFormat;
        if (typeof body.enabled === "boolean") provider.enabled = body.enabled;
        await save();
        return { provider: summarise(provider) } as T;
      }
      if (method === "DELETE") {
        state.providers = state.providers.filter((row) => row.id !== id);
        delete state.models[id!];
        await save();
        return { deleted: true } as T;
      }
    }

    if (third === "models" && method === "GET") {
      return { models: state.models[id] ?? [] } as T;
    }

    if (third === "keys") {
      if (!fourth && method === "POST") {
        const raw = Array.isArray(body.keys) ? (body.keys as unknown[]) : [];
        raw
          .map((entry) => str(entry, 500).trim())
          .filter(Boolean)
          .slice(0, 50)
          .forEach((secret, index) => provider.keys.push(makeKey(provider.id, index, secret)));
        await save();
        return { provider: summarise(provider) } as T;
      }
      if (fourth && method === "DELETE") {
        provider.keys = provider.keys.filter((key) => key.id !== fourth);
        await save();
        return { provider: summarise(provider) } as T;
      }
    }

    if (third === "test" && method === "POST") {
      // Discover the provider's real models through the same-origin dev proxy.
      // No fabricated placeholder models: the list below is exactly what the
      // upstream returned, so every model in the provider reaches the site.
      const listing = await discoverModels(provider);
      if (!listing.ok) fail(502, listing.message);
      const existing = new Map((state.models[id] ?? []).map((model) => [model.upstream_id, model]));
      const models: MockModel[] = listing.models.map((entry) => {
        const previous = existing.get(entry.id);
        return {
          id: previous?.id ?? modelIdFor(id!, entry.id),
          display_name: entry.displayName || previous?.display_name || entry.id,
          upstream_id: entry.id,
          enabled: previous?.enabled ?? true,
          upstream_verified: true,
          context_window: entry.contextWindow ?? previous?.context_window ?? null,
          paid: previous?.paid ?? false,
        };
      });
      state.models[id!] = models;
      await save();
      return {
        tested: models.length,
        healthy: models.length,
        results: models.map((model) => ({ id: model.upstream_id, ok: true })),
        models,
      } as T;
    }

    fail(404, "Not found.");
  }

  if (area === "models" && id && method === "PATCH") {
    for (const list of Object.values(state.models)) {
      const model = list.find((row) => row.id === id);
      if (!model) continue;
      if (typeof body.enabled === "boolean") model.enabled = body.enabled;
      if (typeof body.paid === "boolean") model.paid = body.paid;
      if (typeof body.displayName === "string" && body.displayName.trim()) {
        model.display_name = str(body.displayName, 120).trim();
      }
      await save();
      return { model } as T;
    }
    fail(404, "Model not found.");
  }

  if (area === "users") {
    if (!id && method === "GET") return { users: state.users } as T;
    const user = state.users.find((row) => row.id === id);
    if (!user) fail(404, "User not found.");
    if (method === "PATCH") {
      if (body.status === "active" || body.status === "blocked") user.status = body.status;
      if (body.dailyTokenLimit === null || typeof body.dailyTokenLimit === "number") {
        user.daily_token_limit = body.dailyTokenLimit as number | null;
      }
      if (body.monthlyTokenLimit === null || typeof body.monthlyTokenLimit === "number") {
        user.monthly_token_limit = body.monthlyTokenLimit as number | null;
      }
      if (typeof body.displayName === "string") user.display_name = str(body.displayName, 80) || null;
      await save();
      return { user } as T;
    }
  }

  if (area === "usage" && method === "GET") {
    const days = Math.max(1, Math.min(90, Number(url.searchParams.get("days") ?? 30) || 30));
    return usageStats(days, state) as T;
  }

  if (area === "settings") {
    if (method === "GET") return { settings: state.settings } as T;
    if (method === "PATCH" || method === "POST") {
      if (typeof body.signupOpen === "boolean") state.settings.signup_open = body.signupOpen;
      if (body.defaultDailyTokenLimit === null || typeof body.defaultDailyTokenLimit === "number") {
        state.settings.default_daily_token_limit = body.defaultDailyTokenLimit as number | null;
      }
      if (body.defaultMonthlyTokenLimit === null || typeof body.defaultMonthlyTokenLimit === "number") {
        state.settings.default_monthly_token_limit = body.defaultMonthlyTokenLimit as number | null;
      }
      await save();
      return { settings: state.settings } as T;
    }
  }

  return undefined;
}
