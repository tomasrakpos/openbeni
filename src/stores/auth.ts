// App state auth; change state/actions here and keep local persistence in sync.
import { create } from "zustand";
import { apiFetch, ApiError } from "@/lib/api";
import { devAdminPreview, disableDevAdminPreview } from "@/lib/devAdminMock";
import { getSupabase, supabaseConfigured } from "@/lib/supabase";

/** The signed-in Supabase user, as shown in the corner menu. */
export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}

type SupabaseSession = {
  user?: {
    id?: string;
    email?: string | null;
    user_metadata?: Record<string, unknown> | null;
  } | null;
} | null;

/** Reads `full_name`/`name` and `avatar_url`/`picture` out of the provider metadata. */
function sessionUser(session: SupabaseSession): AuthUser | null {
  const user = session?.user;
  if (!user?.id) return null;
  const meta = user.user_metadata ?? {};
  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = meta[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
  };
  return {
    id: user.id,
    email: user.email ?? null,
    name: pick("full_name", "name"),
    avatarUrl: pick("avatar_url", "picture"),
  };
}

export interface SessionProfile {
  id: string;
  email: string;
  displayName: string;
  role: "user" | "admin";
  status: "active" | "blocked";
  dailyTokenLimit: number | null;
  monthlyTokenLimit: number | null;
  createdAt: string;
  lastSeenAt: string;
  isAdmin: boolean;
}

interface AuthResponse {
  session: {
    accessToken: string;
    refreshToken: string;
    user: { id?: string; email?: string; displayName?: string };
  } | null;
  message: string | null;
}

interface AuthState {
  ready: boolean;
  accountsEnabled: boolean;
  signupOpen: boolean;
  signedIn: boolean;
  /** Supabase user (name/avatar come from the provider metadata). */
  user: AuthUser | null;
  /** The visitor chose "continue without signing in" on the login page. */
  guest: boolean;
  profile: SessionProfile | null;
  error: string | null;
  init: () => Promise<void>;
  refresh: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<{ needsConfirmation: boolean; message: string | null }>;
  signInWithGoogle: () => Promise<void>;
  continueAsGuest: () => void;
  exitGuest: () => void;
  signOut: () => Promise<void>;
}

const GUEST_KEY = "openharneks.guest.v1";

function readGuest(): boolean {
  try {
    return window.localStorage.getItem(GUEST_KEY) === "1";
  } catch {
    return false;
  }
}

function setGuestFlag(value: boolean) {
  try {
    if (value) window.localStorage.setItem(GUEST_KEY, "1");
    else window.localStorage.removeItem(GUEST_KEY);
  } catch {
    // Private mode can block storage; the in-memory flag still works.
  }
}

async function fetchConfig(): Promise<{ accountsEnabled: boolean; signupOpen: boolean }> {
  try {
    return await apiFetch<{ accountsEnabled: boolean; signupOpen: boolean }>("/api/config", { auth: false });
  } catch {
    return { accountsEnabled: false, signupOpen: false };
  }
}

async function loadProfile(): Promise<SessionProfile | null> {
  try {
    return await apiFetch<SessionProfile>("/api/session");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

let subscribed = false;

export const useAuthStore = create<AuthState>()((set, get) => ({
  ready: false,
  accountsEnabled: false,
  signupOpen: false,
  signedIn: false,
  user: null,
  guest: readGuest(),
  profile: null,
  error: null,

  init: async () => {
    const config = await fetchConfig();
    const preview = devAdminPreview();
    set({
      accountsEnabled: preview || (config.accountsEnabled && supabaseConfigured()),
      signupOpen: config.signupOpen,
      guest: readGuest(),
    });

    // Restore the Supabase session before anything else, so a page refresh keeps
    // the visitor signed in. Without a session the visitor stays a guest.
    const supabase = preview ? null : getSupabase();
    if (supabase) {
      const { data } = await supabase.auth.getSession();
      const restored = sessionUser(data.session);
      set({ user: restored, signedIn: Boolean(restored) });
    }

    // Keep the store in sync with Supabase's own sign-in / token refresh / sign-out.
    // Preview mode has no Supabase session, so it skips this entirely.
    if (!subscribed && supabase) {
      subscribed = true;
      supabase.auth.onAuthStateChange((event, session) => {
        const user = sessionUser(session);
        set({
          user,
          signedIn: Boolean(user),
          ...(user ? {} : { profile: null }),
        });
        if (event === "SIGNED_OUT") setGuestFlag(false);
        if (user && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED")) {
          void get().refresh();
        }
      });
    }

    if (!get().accountsEnabled) {
      set({ ready: true });
      return;
    }

    await get().refresh();
    set({ ready: true });
  },

  refresh: async () => {
    if (!get().accountsEnabled) return;
    try {
      const profile = await loadProfile();
      if (profile) setGuestFlag(false);
      set({
        profile,
        signedIn: Boolean(profile) || Boolean(get().user),
        guest: profile ? false : get().guest,
        error: null,
      });
    } catch {
      set({ profile: null, signedIn: Boolean(get().user) });
    }
  },

  signIn: async (email, password) => {
    const result = await apiFetch<AuthResponse>("/api/auth/login", {
      method: "POST",
      body: { email, password },
      auth: false,
    });
    const supabase = getSupabase();
    if (!supabase || !result.session) throw new Error("Sign-in is not available on this server.");
    const { error } = await supabase.auth.setSession({
      access_token: result.session.accessToken,
      refresh_token: result.session.refreshToken,
    });
    if (error) throw new Error(error.message);
    await get().refresh();
  },

  signUp: async (email, password, displayName) => {
    const result = await apiFetch<AuthResponse>("/api/auth/signup", {
      method: "POST",
      body: { email, password, displayName },
      auth: false,
    });
    if (!result.session) {
      return { needsConfirmation: true, message: result.message };
    }
    const supabase = getSupabase();
    if (!supabase) throw new Error("Sign-up is not available on this server.");
    const { error } = await supabase.auth.setSession({
      access_token: result.session.accessToken,
      refresh_token: result.session.refreshToken,
    });
    if (error) throw new Error(error.message);
    await get().refresh();
    return { needsConfirmation: false, message: null };
  },

  signInWithGoogle: async () => {
    const supabase = getSupabase();
    if (!supabase) {
      // Expected when the build has no Supabase project: the button stays
      // clickable, but there is nowhere to redirect to.
      console.error(
        "Supabase env missing: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable Google sign-in.",
      );
      return;
    }
    const redirectTo = `${window.location.origin}/`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) throw new Error(error.message);
  },

  continueAsGuest: () => {
    setGuestFlag(true);
    set({ guest: true });
  },

  exitGuest: () => {
    setGuestFlag(false);
    set({ guest: false });
  },

  signOut: async () => {
    if (devAdminPreview()) {
      await disableDevAdminPreview();
      setGuestFlag(false);
      set({ signedIn: false, user: null, profile: null, guest: false });
      window.location.assign("/");
      return;
    }
    await getSupabase()?.auth.signOut();
    setGuestFlag(false);
    set({ signedIn: false, user: null, profile: null, guest: false });
  },
}));
