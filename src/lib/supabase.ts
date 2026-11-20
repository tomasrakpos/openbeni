// Shared logic supabase; change this helper here and update callers if its contract changes.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client.
 *
 * Only the project URL and the *anon* key reach the bundle — both are public by
 * design. Every privileged operation goes through our own `/api/*` functions,
 * which hold the service-role key server-side.
 */

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

let client: SupabaseClient | null = null;
let envWarned = false;

export function supabaseConfigured(): boolean {
  return Boolean(url && anonKey);
}

export function getSupabase(): SupabaseClient | null {
  if (!supabaseConfigured()) {
    // Keep the button enabled (see signInWithGoogle) but make the cause
    // obvious in the console instead of failing silently.
    if (!envWarned) {
      envWarned = true;
      console.error(
        "Supabase env missing: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not set.",
      );
    }
    return null;
  }
  if (!client) {
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
  }
  return client;
}

export async function currentAccessToken(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
