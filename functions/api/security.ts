/**
 * Shared security helpers for the same-origin API endpoints.
 *
 * Used by both the Cloudflare Pages Functions and the Vite dev middleware, so
 * behaviour cannot drift between development and production.
 */

export interface SecurityEnv {
  ALLOWED_ORIGIN?: string;
}

/** Request headers the browser may send through the same-origin endpoints. */
export const ALLOWED_REQUEST_HEADERS = [
  "accept",
  "authorization",
  "content-type",
  "x-api-key",
  "api-key",
  "x-goog-api-key",
  "anthropic-version",
  "anthropic-beta",
  "anthropic-dangerous-direct-browser-access",
  "openai-organization",
  "openai-project",
  "x-admin-key",
  "x-proxy-token",
].join(", ");

const LOCAL_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173", "http://127.0.0.1:4173"];

function parseOrigins(env: SecurityEnv): string[] {
  return (env.ALLOWED_ORIGIN ?? "")
    .split(",")
    .map((entry) => entry.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

/**
 * CORS is limited to the configured site. With no configuration, the request's
 * own origin (same-origin deployment) plus the two Vite dev origins are
 * allowed. There is no wildcard fallback.
 */
export function allowedOrigin(request: Request, env: SecurityEnv): string | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  const configured = parseOrigins(env);
  if (configured.length > 0) return configured.includes(origin) ? origin : null;
  const requestUrl = new URL(request.url);
  if (origin === requestUrl.origin) return origin;
  // Behind TLS-terminating reverse proxies (e.g. e2b.app, Cloudflare Tunnel,
  // nginx) that forward plain HTTP without X-Forwarded-Proto, the browser's
  // Origin is https://<host> while request.url sees http://<host>. Matching
  // the exact host over https:// is strictly same-origin.
  try {
    const originUrl = new URL(origin);
    if (originUrl.protocol === "https:" && originUrl.host.toLowerCase() === requestUrl.host.toLowerCase()) {
      return origin;
    }
  } catch {
    // Malformed Origin header — reject.
  }
  if (LOCAL_ORIGINS.includes(origin)) return origin;
  return null;
}

export function rejectedOrigin(request: Request, env: SecurityEnv): boolean {
  const origin = request.headers.get("Origin");
  return Boolean(origin && !allowedOrigin(request, env));
}

export function apiHeaders(request: Request, env: SecurityEnv, extra?: Record<string, string>): Headers {
  const headers = new Headers({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    Vary: "Origin",
    ...extra,
  });
  const origin = allowedOrigin(request, env);
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    headers.set(
      "Access-Control-Allow-Headers",
      ALLOWED_REQUEST_HEADERS,
    );
    headers.set(
      "Access-Control-Expose-Headers",
      "X-Billing-Source, X-Credits-Charged, X-Preview-Intent, X-Preview-Category, X-Preview-Source, X-Skill-Id, X-Skill-Source, X-Skill-Search-Count",
    );
    headers.set("Access-Control-Max-Age", "600");
  }
  return headers;
}

export function jsonError(
  request: Request,
  env: SecurityEnv,
  status: number,
  message: string,
  code?: string,
  extraHeaders?: Record<string, string>,
): Response {
  const headers = apiHeaders(request, env, {
    "Content-Type": "application/json; charset=utf-8",
    ...extraHeaders,
  });
  return new Response(JSON.stringify({ error: { message, ...(code ? { code } : {}), status } }), {
    status,
    headers,
  });
}

/**
 * Client address for rate limiting.
 *
 * Cloudflare always sets `cf-connecting-ip` at the edge and strips any
 * client-supplied value, so it is the only header we trust. `x-real-ip` and
 * friends are trivially spoofable by clients and are deliberately ignored.
 * When the header is missing (local dev, non-Cloudflare runtimes) every caller
 * shares a single fixed bucket; the in-memory limiter is only a cheap abuse
 * guard anyway.
 *
 * Production note: isolate memory is per-colo and short lived. For a hard
 * global limit, front the routes with Cloudflare Rate Limiting rules or back
 * `rateLimit` with a Durable Object / KV counter keyed by `clientIp()`.
 */
export function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip")?.trim() || "unknown-client";
}

interface Bucket {
  stamps: number[];
  lastSeen: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

/**
 * Sliding-window limiter kept in isolate memory. It is a cheap abuse guard in
 * front of the upstream quota; the real quota still lives at the provider.
 */
export function rateLimit(scope: string, ip: string, limit: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const id = `${scope}:${ip}`;
  let bucket = buckets.get(id);
  if (!bucket) {
    if (buckets.size >= MAX_BUCKETS) {
      for (const [key, value] of buckets) {
        if (now - value.lastSeen > windowMs * 4) buckets.delete(key);
      }
    }
    bucket = { stamps: [], lastSeen: now };
    buckets.set(id, bucket);
  }
  bucket.lastSeen = now;
  bucket.stamps = bucket.stamps.filter((stamp) => now - stamp < windowMs);
  if (bucket.stamps.length >= limit) {
    const oldest = bucket.stamps[0] ?? now;
    return { ok: false, retryAfter: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)) };
  }
  bucket.stamps.push(now);
  return { ok: true, retryAfter: 0 };
}

/** Cap request bodies before parsing fresh JSON into memory. */
export const MAX_BODY_BYTES = 512 * 1024;

export async function readJsonBody(
  request: Request,
): Promise<{ ok: true; value: unknown } | { ok: false; reason: "too-large" | "invalid" }> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { ok: false, reason: "too-large" };
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return { ok: false, reason: "too-large" };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
