/**
 * Minimal Supabase REST/Auth client for Cloudflare Pages Functions.
 *
 * We deliberately avoid bundling a full client in the worker: these helpers
 * only need `fetch`, and using the service-role key here means RLS is bypassed
 * intentionally. The browser gets a separate anon-key client.
 */

export interface SupabaseEnv {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

export function supabaseUrl(env: SupabaseEnv): string {
  return (env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
}

export function supabaseConfigured(env: SupabaseEnv): boolean {
  return Boolean(supabaseUrl(env) && (env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim());
}

function serviceHeaders(env: SupabaseEnv): Headers {
  const key = (env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  return new Headers({
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  });
}

const SB_REST_TIMEOUT_MS = 10_000;
const SB_AUTH_TIMEOUT_MS = 8_000;
const SB_BROADCAST_TIMEOUT_MS = 2_500;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const callerSignal = init.signal;
  const onAbort = () => controller.abort();
  callerSignal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onAbort);
  }
}

/** Service-role REST call. Never expose the response of a secrets table. */
export async function sbFetch(
  env: SupabaseEnv,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = `${supabaseUrl(env)}/rest/v1/${path.replace(/^\/+/, "")}`;
  const headers = serviceHeaders(env);
  if (init.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  return fetchWithTimeout(url, { ...init, headers, cache: "no-store" }, SB_REST_TIMEOUT_MS);
}

export async function sbJson<T>(
  env: SupabaseEnv,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await sbFetch(env, path, init);
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && typeof (payload as { message?: unknown }).message === "string"
        ? (payload as { message: string }).message
        : `Supabase request failed (${response.status}).`;
    throw new Error(message);
  }
  return payload as T;
}

export function eq(value: string | number | boolean): string {
  return `eq.${encodeURIComponent(String(value))}`;
}

/** Authenticate a browser bearer token against Supabase Auth. */
export async function verifyAccessToken(
  request: Request,
  env: SupabaseEnv,
): Promise<{ id: string; email: string; displayName?: string } | null> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token || !supabaseUrl(env)) return null;
  const anon = (env.SUPABASE_ANON_KEY ?? "").trim();
  if (!anon) return null;
  try {
    const response = await fetchWithTimeout(
      `${supabaseUrl(env)}/auth/v1/user`,
      {
        headers: { apikey: anon, Authorization: `Bearer ${token}` },
        cache: "no-store",
      },
      SB_AUTH_TIMEOUT_MS,
    );
    if (!response.ok) return null;
    const user = (await response.json()) as {
      id?: string;
      email?: string;
      user_metadata?: { display_name?: string; full_name?: string };
    };
    if (!user.id || !user.email) return null;
    return {
      id: user.id,
      email: user.email.toLowerCase(),
      displayName: user.user_metadata?.display_name ?? user.user_metadata?.full_name,
    };
  } catch {
    return null;
  }
}

export function adminEmails(env: SupabaseEnv & { ADMIN_EMAILS?: string }): string[] {
  return (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Broadcast catalog change to connected clients via Supabase Realtime.
 * Bounded to 2.5s and swallows errors so handlers can safely `await` it
 * before returning (Cloudflare Workers cancels un-awaited floating fetches).
 */
export async function broadcastCatalogChange(env: SupabaseEnv): Promise<void> {
  if (!supabaseConfigured(env)) return;
  try {
    await fetchWithTimeout(
      `${supabaseUrl(env)}/realtime/v1/api/broadcast`,
      {
        method: "POST",
        headers: serviceHeaders(env),
        body: JSON.stringify({
          messages: [{ topic: "catalog", event: "catalog-changed", payload: { at: Date.now() } }],
        }),
        cache: "no-store",
      },
      SB_BROADCAST_TIMEOUT_MS,
    );
  } catch {
    // Realtime is best-effort; clients also poll on focus.
  }
}
