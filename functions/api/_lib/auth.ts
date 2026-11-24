// Shared server logic auth; update API callers when changing its contract.
import { jsonError } from "../security";
import type { SecurityEnv } from "../security";
import { DEFAULT_SIGNUP_CREDITS, ensureUserCredits, extractCreditPolicy } from "./credits";
import { adminEmails, eq, sbJson, supabaseConfigured, verifyAccessToken, type SupabaseEnv } from "./supabase";

export type Role = "user" | "admin";
export type Status = "active" | "blocked";

export { DEFAULT_SIGNUP_CREDITS };

export interface ProfileRow {
  id: string;
  email: string;
  display_name: string | null;
  role: Role;
  status: Status;
  credits?: number | null;
  daily_token_limit: number | null;
  monthly_token_limit: number | null;
  created_at: string;
  last_seen_at: string;
}

export interface AppSettingsRow {
  id: boolean;
  signup_open: boolean;
  default_signup_credits?: number | null;
  min_credits_per_request?: number | null;
  max_credits_per_request?: number | null;
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
  credits: number;
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
    credits: typeof profile.credits === "number" ? profile.credits : DEFAULT_SIGNUP_CREDITS,
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
    let signupCredits = DEFAULT_SIGNUP_CREDITS;
    try {
      const settings = await getSettings(env);
      signupCredits = extractCreditPolicy(settings).signupCredits;
    } catch {
      // Fall back to default 5 signup credits.
    }
    const baseProfile = {
      id: user.id,
      email: user.email,
      display_name: user.displayName ?? user.email.split("@")[0],
      role: envAdmin ? "admin" : "user",
      status: "active",
      last_seen_at: new Date().toISOString(),
    };
    // Use `resolution=ignore-duplicates` (ON CONFLICT DO NOTHING) so a
    // concurrent first-request race can NEVER overwrite an existing profile or
    // reset credits back to 5.
    try {
      const inserted = await sbJson<ProfileRow[]>(env, "profiles?on_conflict=id", {
        method: "POST",
        headers: { Prefer: "return=representation,resolution=ignore-duplicates" },
        body: JSON.stringify([{ ...baseProfile, credits: signupCredits }]),
      });
      profile = inserted[0];
    } catch {
      // Older deployments without the `credits` column yet.
      const inserted = await sbJson<ProfileRow[]>(env, "profiles?on_conflict=id", {
        method: "POST",
        headers: { Prefer: "return=representation,resolution=ignore-duplicates" },
        body: JSON.stringify([baseProfile]),
      });
      profile = inserted[0];
    }
    if (!profile) {
      // Another concurrent request or the auth.users trigger created the row
      // first; re-read it without touching existing credits.
      const existing = await sbJson<ProfileRow[]>(env, `profiles?id=${eq(user.id)}&limit=1`);
      profile = existing[0];
    }
    if (profile) {
      const ensured = await ensureUserCredits(env, profile.id, signupCredits, profile.credits);
      profile = { ...profile, credits: ensured.balance };
    }
  } else {
    // Touch activity at most once every two minutes so online status in /admin
    // stays crisp without adding DB latency to every token request.
    const lastSeen = Date.parse(profile.last_seen_at);
    const stale = !Number.isFinite(lastSeen) || Date.now() - lastSeen > 2 * 60_000;
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
    // Ensure a one-time signup grant exists in `user_credits` (idempotent on
    // `user_id`) and read the authoritative balance.
    const ensured = await ensureUserCredits(env, profile.id, DEFAULT_SIGNUP_CREDITS, profile.credits);
    profile = { ...profile, credits: ensured.balance };
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

export async function consumeCredit(env: AuthEnv, userId: string, amount = 1): Promise<number | null> {
  try {
    const remaining = await sbJson<number | null>(env, "rpc/consume_user_credit", {
      method: "POST",
      body: JSON.stringify({ p_user: userId, p_amount: amount }),
    });
    return typeof remaining === "number" ? remaining : null;
  } catch {
    return null;
  }
}

function authError(request: Request, env: AuthEnv, status: number, message: string): Response {
  return jsonError(request, env, status, message);
}
