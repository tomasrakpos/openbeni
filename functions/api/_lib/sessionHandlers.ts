// Shared server logic sessionHandlers; update API callers when changing its contract.
import { getSettings, resolveAuth, toSessionProfile, type AuthEnv } from "./auth";
import { supabaseConfigured } from "./supabase";
import { apiHeaders, jsonError, rejectedOrigin } from "../security";

export async function handleSession(request: Request, env: AuthEnv = {}): Promise<Response> {
  if (rejectedOrigin(request, env)) return jsonError(request, env, 403, "Origin not allowed.");
  if (!supabaseConfigured(env)) {
    return jsonError(request, env, 503, "User accounts are not configured on this server.");
  }
  const context = await resolveAuth(request, env);
  if (!context) return jsonError(request, env, 401, "Sign in to continue.");
  return new Response(JSON.stringify({ data: toSessionProfile(context.profile, context.isAdmin) }), {
    status: 200,
    headers: apiHeaders(request, env, { "Content-Type": "application/json; charset=utf-8" }),
  });
}

export async function handleConfig(request: Request, env: AuthEnv = {}): Promise<Response> {
  if (rejectedOrigin(request, env)) return jsonError(request, env, 403, "Origin not allowed.");
  let signupOpen = true;
  if (supabaseConfigured(env)) {
    try {
      signupOpen = (await getSettings(env)).signup_open;
    } catch {
      signupOpen = true;
    }
  }
  return new Response(
    JSON.stringify({
      data: {
        accountsEnabled: supabaseConfigured(env),
        signupOpen,
      },
    }),
    { status: 200, headers: apiHeaders(request, env, { "Content-Type": "application/json; charset=utf-8" }) },
  );
}
