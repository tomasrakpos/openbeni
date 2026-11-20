// Shared server logic authHandlers; update API callers when changing its contract.
import { getSettings, type AuthEnv } from "./auth";
import { supabaseUrl } from "./supabase";
import { clientIp, jsonError, rateLimit, readJsonBody, rejectedOrigin, apiHeaders } from "../security";

export type AuthRouteEnv = AuthEnv & { SUPABASE_ANON_KEY?: string };

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= 254;
}

function validPassword(value: string): boolean {
  return value.length >= 8 && value.length <= 72;
}

async function callAuth(env: AuthRouteEnv, path: string, body: unknown): Promise<Response> {
  const anon = (env.SUPABASE_ANON_KEY ?? "").trim();
  return fetch(`${supabaseUrl(env)}/auth/v1/${path}`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

interface AuthResponse {
  access_token?: string;
  refresh_token?: string;
  user?: { id?: string; email?: string; user_metadata?: { display_name?: string } };
  msg?: string;
  error_description?: string;
  message?: string;
  error?: string;
}

function authPayload(payload: AuthResponse) {
  if (payload.access_token && payload.refresh_token) {
    return {
      session: {
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token,
        user: {
          id: payload.user?.id,
          email: payload.user?.email,
          displayName: payload.user?.user_metadata?.display_name,
        },
      },
      message: null,
    };
  }
  return {
    session: null,
    message:
      payload.msg ??
      payload.message ??
      payload.error_description ??
      payload.error ??
      "Check your inbox to confirm your email, then sign in.",
  };
}

async function handleSignup(request: Request, env: AuthRouteEnv): Promise<Response> {
  const limit = rateLimit("auth-signup", clientIp(request), 5, 60 * 60_000);
  if (!limit.ok) {
    return jsonError(request, env, 429, "Too many sign-up attempts. Please wait and try again.", "rate_limited", {
      "Retry-After": String(limit.retryAfter),
    });
  }
  const settings = await getSettings(env);
  if (!settings.signup_open) {
    return jsonError(request, env, 403, "Registration is currently closed.");
  }
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return jsonError(request, env, 400, "Invalid request body.");
  const value = parsed.value as { email?: unknown; password?: unknown; displayName?: unknown };
  const email = typeof value.email === "string" ? value.email.trim().toLowerCase() : "";
  const password = typeof value.password === "string" ? value.password : "";
  const displayName = typeof value.displayName === "string" ? value.displayName.trim().slice(0, 80) : email.split("@")[0];
  if (!validEmail(email)) return jsonError(request, env, 400, "Enter a valid email address.");
  if (!validPassword(password)) return jsonError(request, env, 400, "The password must be 8–72 characters.");

  const upstream = await callAuth(env, "signup", { email, password, data: { display_name: displayName } });
  const payload = (await upstream.json().catch(() => ({}))) as AuthResponse;
  if (!upstream.ok) {
    return jsonError(request, env, upstream.status === 422 ? 409 : upstream.status, "Could not create the account. Try a different email or sign in.");
  }
  return new Response(JSON.stringify({ data: authPayload(payload) }), {
    status: 200,
    headers: apiHeaders(request, env, { "Content-Type": "application/json; charset=utf-8" }),
  });
}

async function handleLogin(request: Request, env: AuthRouteEnv): Promise<Response> {
  const limit = rateLimit("auth-login", clientIp(request), 10, 15 * 60_000);
  if (!limit.ok) {
    return jsonError(request, env, 429, "Too many sign-in attempts. Please wait a few minutes.", "rate_limited", {
      "Retry-After": String(limit.retryAfter),
    });
  }
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return jsonError(request, env, 400, "Invalid request body.");
  const value = parsed.value as { email?: unknown; password?: unknown };
  const email = typeof value.email === "string" ? value.email.trim().toLowerCase() : "";
  const password = typeof value.password === "string" ? value.password : "";
  if (!validEmail(email) || !password) return jsonError(request, env, 400, "Enter your email and password.");

  const upstream = await callAuth(env, "token?grant_type=password", { email, password });
  const payload = (await upstream.json().catch(() => ({}))) as AuthResponse;
  if (!upstream.ok) {
    return jsonError(request, env, 401, "Wrong email or password.");
  }
  return new Response(JSON.stringify({ data: authPayload(payload) }), {
    status: 200,
    headers: apiHeaders(request, env, { "Content-Type": "application/json; charset=utf-8" }),
  });
}

export async function handleAuth(request: Request, env: AuthRouteEnv = {}): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/auth\/?/, "").replace(/\/+$/, "");
  if (request.method === "OPTIONS") {
    if (rejectedOrigin(request, env)) return jsonError(request, env, 403, "Origin not allowed.");
    return new Response(null, { status: 204, headers: apiHeaders(request, env) });
  }
  if (rejectedOrigin(request, env)) return jsonError(request, env, 403, "Origin not allowed.");
  if (path === "signup" && request.method === "POST") return handleSignup(request, env);
  if (path === "login" && request.method === "POST") return handleLogin(request, env);
  return jsonError(request, env, 404, "Not found.");
}
