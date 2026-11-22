/**
 * Personal user API token endpoints:
 *   GET    /api/tokens      List the signed-in user's tokens (prefix + metadata only)
 *   POST   /api/tokens      Create a new token (full secret returned once)
 *   DELETE /api/tokens/:id  Revoke/delete a token owned by the signed-in user
 */
import { resolveAuth, type AuthEnv } from "./auth";
import { eq, sbJson, supabaseConfigured } from "./supabase";
import { apiHeaders, clientIp, jsonError, rateLimit, readJsonBody, rejectedOrigin } from "../security";

interface UserTokenRow {
  id: string;
  user_id: string;
  name: string;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface PublicUserToken {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

const MAX_TOKENS_PER_USER = 10;

function toPublic(row: UserTokenRow): PublicUserToken {
  return {
    id: row.id,
    name: row.name,
    prefix: row.token_prefix,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

function randomBase64Url(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let binary = "";
  for (const byte of buf) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(request: Request, env: AuthEnv, data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: apiHeaders(request, env, { "Content-Type": "application/json; charset=utf-8" }),
  });
}

export async function handleTokens(request: Request, env: AuthEnv = {}): Promise<Response> {
  if (request.method === "OPTIONS") {
    if (rejectedOrigin(request, env)) return jsonError(request, env, 403, "Origin not allowed.");
    return new Response(null, { status: 204, headers: apiHeaders(request, env) });
  }
  if (rejectedOrigin(request, env)) return jsonError(request, env, 403, "Origin not allowed.");
  if (!supabaseConfigured(env)) {
    return jsonError(request, env, 503, "User accounts are not configured on this server.");
  }

  const limit = rateLimit("user-tokens", clientIp(request), 60, 60_000);
  if (!limit.ok) {
    return jsonError(request, env, 429, "Too many requests. Please wait a moment.", "rate_limited", {
      "Retry-After": String(limit.retryAfter),
    });
  }

  const auth = await resolveAuth(request, env);
  if (!auth) return jsonError(request, env, 401, "Sign in to manage tokens.");
  if (auth.profile.status !== "active") return jsonError(request, env, 403, "This account is blocked.");

  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/api\/tokens\/?/, "").split("/").filter(Boolean);
  const tokenId = parts[0];
  const method = request.method.toUpperCase();

  if (!tokenId && method === "GET") {
    try {
      const rows = await sbJson<UserTokenRow[]>(
        env,
        `user_tokens?select=id,user_id,name,token_prefix,created_at,last_used_at,revoked_at&user_id=${eq(
          auth.profile.id,
        )}&revoked_at=is.null&order=created_at.desc`,
      );
      return json(request, env, { tokens: rows.map(toPublic) });
    } catch {
      return json(request, env, { tokens: [] });
    }
  }

  if (!tokenId && method === "POST") {
    const parsed = await readJsonBody(request);
    if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) {
      return jsonError(request, env, 400, "Invalid request body.");
    }
    const rawName = (parsed.value as { name?: unknown }).name;
    const name = typeof rawName === "string" ? rawName.trim().slice(0, 64) : "";
    if (!name) return jsonError(request, env, 400, "Enter a name for the token.");

    const existing = await sbJson<UserTokenRow[]>(
      env,
      `user_tokens?select=id&user_id=${eq(auth.profile.id)}&revoked_at=is.null`,
    ).catch(() => []);
    if (existing.length >= MAX_TOKENS_PER_USER) {
      return jsonError(request, env, 400, `You can have up to ${MAX_TOKENS_PER_USER} active tokens.`);
    }

    const secret = `oh_${randomBase64Url(24)}`;
    const prefix = `${secret.slice(0, 10)}…${secret.slice(-4)}`;
    const hash = await sha256Hex(secret);

    const rows = await sbJson<UserTokenRow[]>(env, "user_tokens", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify([
        {
          user_id: auth.profile.id,
          name,
          token_prefix: prefix,
          token_hash: hash,
        },
      ]),
    });
    const created = rows[0];
    if (!created) return jsonError(request, env, 500, "Could not create token.");
    return json(request, env, { token: toPublic(created), secret }, 201);
  }

  if (tokenId && method === "DELETE") {
    await sbJson(env, `user_tokens?id=${eq(tokenId)}&user_id=${eq(auth.profile.id)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    return json(request, env, { deleted: true });
  }

  return jsonError(request, env, 405, "Method not allowed.");
}
