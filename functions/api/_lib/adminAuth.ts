/**
 * Password gate for the admin panel.
 *
 * `/admin` is a separate page with its own credentials, independent of the
 * visitor-facing accounts:
 *
 *   POST /api/admin/login   { password } -> short-lived signed token
 *   every other /api/admin/* call sends it as `x-admin-key`
 *
 * The password lives in `ADMIN_PASSWORD` (server env only). Tokens are
 * HMAC-SHA256 signed and stateless, so no session table is needed. If
 * `ADMIN_SESSION_SECRET` is set it is used as the signing key; otherwise the
 * password itself is, which means rotating the password also revokes every
 * outstanding token.
 *
 * A Supabase administrator session is still accepted in parallel (see
 * `adminGate` in `adminHandlers.ts`), so the same panel works with either
 * mechanism.
 */

import { apiHeaders, clientIp, jsonError, rateLimit, readJsonBody, type SecurityEnv } from "../security";

export interface AdminAuthEnv extends SecurityEnv {
  ADMIN_PASSWORD?: string;
  ADMIN_SESSION_SECRET?: string;
}

const TOKEN_VERSION = "v1";
const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;
const LOGIN_LIMIT = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

const encoder = new TextEncoder();

function configuredPassword(env: AdminAuthEnv): string {
  return (env.ADMIN_PASSWORD ?? "").trim();
}

function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toHex(new Uint8Array(digest));
}

async function expectedPasswordHash(env: AdminAuthEnv): Promise<string> {
  return sha256Hex(configuredPassword(env));
}

export function adminPasswordConfigured(env: AdminAuthEnv): boolean {
  return configuredPassword(env).length >= 8;
}

function signingSecret(env: AdminAuthEnv): string {
  return (env.ADMIN_SESSION_SECRET ?? "").trim() || configuredPassword(env);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return new Uint8Array(signature);
}

/** Length-independent comparison of two strings. */
async function safeEqual(left: string, right: string): Promise<boolean> {
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let index = 0; index < x.length; index += 1) diff |= (x[index] ?? 0) ^ (y[index] ?? 0);
  return diff === 0;
}

export interface AdminToken {
  token: string;
  expiresAt: string;
}

export async function createAdminToken(env: AdminAuthEnv, ttlMs = DEFAULT_TTL_MS): Promise<AdminToken> {
  const exp = Date.now() + ttlMs;
  const payload = toBase64Url(encoder.encode(JSON.stringify({ exp, v: TOKEN_VERSION })));
  const signed = `${TOKEN_VERSION}.${payload}`;
  const signature = toBase64Url(await hmac(signingSecret(env), signed));
  return { token: `${signed}.${signature}`, expiresAt: new Date(exp).toISOString() };
}

export async function verifyAdminToken(env: AdminAuthEnv, token: string | null): Promise<boolean> {
  if (!token || !adminPasswordConfigured(env)) return false;
  const parts = token.trim().split(".");
  if (parts.length !== 3) return false;
  const [version, payload, signature] = parts as [string, string, string];
  if (version !== TOKEN_VERSION) return false;

  let parsed: { exp?: unknown; v?: unknown };
  try {
    parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as { exp?: unknown; v?: unknown };
  } catch {
    return false;
  }
  if (parsed.v !== TOKEN_VERSION || typeof parsed.exp !== "number" || parsed.exp <= Date.now()) return false;

  const expected = toBase64Url(await hmac(signingSecret(env), `${version}.${payload}`));
  return safeEqual(expected, signature);
}

/**
 * POST /api/admin/login — compares the password server-side and returns a
 * signed token. Rate-limited per IP so the panel cannot be brute forced.
 */
export async function handleAdminLogin(request: Request, env: AdminAuthEnv): Promise<Response> {
  const headers = apiHeaders(request, env, { "Content-Type": "application/json; charset=utf-8" });

  if (!adminPasswordConfigured(env)) {
    return jsonError(
      request,
      env,
      503,
      "Admin access is not configured on this server. Set ADMIN_PASSWORD and redeploy.",
      "admin_not_configured",
    );
  }

  const limit = rateLimit("admin-login", clientIp(request), LOGIN_LIMIT, LOGIN_WINDOW_MS);
  if (!limit.ok) {
    return jsonError(request, env, 429, `Too many attempts. Try again in ${limit.retryAfter}s.`, "rate_limited", {
      "Retry-After": String(limit.retryAfter),
    });
  }

  const parsed = await readJsonBody(request);
  if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) {
    return jsonError(request, env, 400, "Invalid request body.");
  }
  const password = (parsed.value as { password?: unknown }).password;
  if (typeof password !== "string" || password.length === 0 || password.length > 200) {
    return jsonError(request, env, 400, "Enter the admin password.");
  }

  const providedHash = await sha256Hex(password);
  const ok = await safeEqual(providedHash, await expectedPasswordHash(env));
  if (!ok) {
    // No detail about length or proximity, and no echo of the attempt.
    return jsonError(request, env, 401, "Wrong password.", "invalid_password");
  }

  const token = await createAdminToken(env);
  return new Response(JSON.stringify({ data: token }), { status: 200, headers });
}
