// Shared server logic auth; update API callers when changing its contract.
import { jsonError } from "../security";
import type { SecurityEnv } from "../security";
import { adminEmails, eq, sbJson, supabaseConfigured, verifyAccessToken, type SupabaseEnv } from "./supabase";

export type Role = "user" | "admin";
export type Status = "active" | "blocked";

export interface ProfileRow {
  id: string;
  email: string;
  display_name: string | null;
  role: Role;
  status: Status;
  daily_token_limit: number | null;
  monthly_token_limit: number | null;
  created_at: string;
  last_seen_at: string;
}

export interface AppSettingsRow {
  id: boolean;
  signup_open: boolean;
  default_daily_token_limit: number | null;
  default_monthly_token_limit: number | null;
  updated_at: string;
}

export interface SessionProfile {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: Status;
  dailyTokenLimit: number | null;
  monthlyTokenLimit: number | null;
  createdAt: string;
  lastSeenAt: string;
  isAdmin: boolean;
}

export type AuthEnv = SupabaseEnv & SecurityEnv & { ADMIN_EMAILS?: string };

export interface AuthContext {
  profile: ProfileRow;
  isAdmin: boolean;
}

export function toSessionProfile(profile: ProfileRow, isAdmin: boolean): SessionProfile {
  return {
    id: profile.id,
    email: profile.email,
    displayName: profile.display_name ?? profile.email.split("@")[0] ?? "User",
    role: profile.role,
    status: profile.status,
    dailyTokenLimit: profile.daily_token_limit,
    monthlyTokenLimit: profile.monthly_token_limit,
    createdAt: profile.created_at,
    lastSeenAt: profile.last_seen_at,
    isAdmin,
  };
}

/**
 * Authenticate the bearer token, create/refresh the profile, and resolve the
 * admin flag on the server. The browser never supplies its own role.
 */
export async function resolveAuth(request: Request, env: AuthEnv): Promise<AuthContext | null> {
  if (!supabaseConfigured(env)) return null;
  const user = await verifyAccessToken(request, env);
  if (!user) return null;

  const emails = adminEmails(env);
  const envAdmin = emails.includes(user.email);
  const rows = await sbJson<ProfileRow[]>(env, `profiles?select=*&id=${eq(user.id)}&limit=1`);
  let profile = rows[0];

  if (!profile) {
    const inserted = await sbJson<ProfileRow[]>(env, "profiles", {
      method: "POST",
      headers: { Prefer: "return=representation,resolution=merge-duplicates" },
      body: JSON.stringify([
        {
          id: user.id,
          email: user.email,
          display_name: user.displayName ?? user.email.split("@")[0],
          role: envAdmin ? "admin" : "user",
          status: "active",
          last_seen_at: new Date().toISOString(),
        },
      ]),
    });
    profile = inserted[0];
  } else {
    // Touch activity at most once every five minutes. Writing on every chat
    // request added a full database round trip to the first token latency.
    const lastSeen = Date.parse(profile.last_seen_at);
    const stale = !Number.isFinite(lastSeen) || Date.now() - lastSeen > 5 * 60_000;
    const needsRole = envAdmin && profile.role !== "admin";
    if (stale || needsRole) {
      const patch: Record<string, unknown> = {};
      if (stale) patch.last_seen_at = new Date().toISOString();
      if (needsRole) patch.role = "admin";
      try {
        const updated = await sbJson<ProfileRow[]>(env, `profiles?id=${eq(user.id)}`, {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify(patch),
        });
        profile = updated[0] ?? profile;
      } catch {
        // A failed activity touch must not block the request.
      }
    }
  }

  if (!profile) return null;
  return { profile, isAdmin: envAdmin || profile.role === "admin" };
}

export async function requireAdmin(
  request: Request,
  env: AuthEnv,
): Promise<{ context: AuthContext } | { response: Response }> {
  const context = await resolveAuth(request, env);
  if (!context) return { response: authError(request, env, 401, "Sign in to continue.") };
  if (!context.isAdmin) return { response: authError(request, env, 403, "Admin access required.") };
  if (context.profile.status !== "active") {
    return { response: authError(request, env, 403, "This account is blocked.") };
  }
  return { context };
}

export async function getSettings(env: AuthEnv): Promise<AppSettingsRow> {
  const rows = await sbJson<AppSettingsRow[]>(env, "app_settings?select=*&limit=1");
  if (rows[0]) return rows[0];
  return {
    id: true,
    signup_open: true,
    default_daily_token_limit: null,
    default_monthly_token_limit: null,
    updated_at: new Date().toISOString(),
  };
}

function authError(request: Request, env: AuthEnv, status: number, message: string): Response {
  return jsonError(request, env, status, message);
}
