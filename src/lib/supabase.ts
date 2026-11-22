// Shared logic supabase; change this helper here and update callers if its contract changes.
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client.
 *
 * Only the project URL and the *anon* key reach the bundle — both are public by
 * design. Every privileged operation goes through our own `/api/*` functions,
 * which hold the service-role key server-side.
 *
 * `@supabase/supabase-js` (~225 KB) is dynamically imported on demand so local
 * BYOK installs without Supabase env never download or parse it.
 */

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

let client: SupabaseClient | null = null;
let clientPromise: Promise<SupabaseClient | null> | null = null;
let envWarned = false;

export function supabaseConfigured(): boolean {
  return Boolean(url && anonKey);
}

/** Synchronous accessor for an already-initialized client (e.g. pagehide cleanup). */
export function getSupabase(): SupabaseClient | null {
  return client;
}

/** Lazily loads `@supabase/supabase-js` only when Supabase env is configured. */
export async function getSupabaseAsync(): Promise<SupabaseClient | null> {
  if (!supabaseConfigured()) {
    if (!envWarned) {
      envWarned = true;
      console.error(
        "Supabase env missing: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not set.",
      );
    }
    return null;
  }
  if (client) return client;
  if (!clientPromise) {
    clientPromise = import("@supabase/supabase-js")
      .then(({ createClient }) => {
        client = createClient(url!, anonKey!, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            // Needed so the OAuth redirect (?code=… / #access_token=…) is picked up
            // on the way back from Google.
            detectSessionInUrl: true,
            storageKey: "openharness-auth",
          },
        });
        return client;
      })
      .catch((error) => {
        clientPromise = null;
        throw error;
      });
  }
  return clientPromise;
}

export async function currentAccessToken(): Promise<string | null> {
  if (!supabaseConfigured()) return null;
  const supabase = await getSupabaseAsync();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
