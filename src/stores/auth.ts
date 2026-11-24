// App state auth; change state/actions here and keep local persistence in sync.
import { create } from "zustand";
import { apiFetch, ApiError } from "@/lib/api";
import { getSupabaseAsync, supabaseConfigured } from "@/lib/supabase";

export const DEFAULT_SIGNUP_CREDITS = 5;

/** The signed-in Supabase user, as shown in the corner menu. */
export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}

export interface UserApiToken {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
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
  credits: number;
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
  tokens: UserApiToken[];
  tokensLoading: boolean;
  error: string | null;
  init: () => Promise<void>;
  refresh: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<{ needsConfirmation: boolean; message: string | null }>;
  signInWithGoogle: () => Promise<void>;
  consumeLocalCredit: (amount?: number) => void;
  loadTokens: () => Promise<void>;
  createToken: (name: string) => Promise<{ token: UserApiToken; secret: string }>;
  revokeToken: (id: string) => Promise<void>;
  continueAsGuest: () => void;
  exitGuest: () => void;
  signOut: () => Promise<void>;
}

function hasStoredSupabaseSessionOrCallback(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem("openharness-auth");
    if (raw && raw.length > 20) return true;
  } catch {
    // Storage unavailable; fall through to URL callback check.
  }
  try {
    const search = window.location.search;
    const hash = window.location.hash;
    if (/[?&](code|token_hash|type=recovery)=/.test(search)) return true;
    if (/(?:^|[#&])(access_token|refresh_token)=/.test(hash)) return true;
  } catch {
    // Ignore URL inspection errors.
  }
  return false;
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
    const profile = await apiFetch<SessionProfile>("/api/session");
    return {
      ...profile,
      credits: typeof profile.credits === "number" ? profile.credits : DEFAULT_SIGNUP_CREDITS,
    };
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
  guest: typeof window !== "undefined" ? readGuest() : false,
  profile: null,
  tokens: [],
  tokensLoading: false,
  error: null,

  init: async () => {
    const config = await fetchConfig();
    set({
      accountsEnabled: config.accountsEnabled && supabaseConfigured(),
      signupOpen: config.signupOpen,
      guest: readGuest(),
    });

    // Restore the Supabase session only when a stored session or OAuth callback
    // is actually present. First-time guests skip downloading ~225 KB of
    // `@supabase/supabase-js` on initial page load; signing in loads it on demand.
    const needsSupabaseNow = supabaseConfigured() && hasStoredSupabaseSessionOrCallback();
    const supabase = needsSupabaseNow ? await getSupabaseAsync() : null;
    if (supabase) {
      const { data } = await supabase.auth.getSession();
      const restored = sessionUser(data.session);
      set({ user: restored, signedIn: Boolean(restored) });
      // Clean OAuth PKCE `?code=` or implicit `#access_token=` fragments from the
      // address bar once Supabase has consumed the callback parameters.
      if (restored && typeof window !== "undefined") {
        const url = new URL(window.location.href);
        const hasOAuthQuery = url.searchParams.has("code") || url.searchParams.has("state");
        const hasOAuthHash = /(?:^|[#&])(access_token|refresh_token)=/.test(url.hash);
        if (hasOAuthQuery || hasOAuthHash) {
          url.searchParams.delete("code");
          url.searchParams.delete("state");
          const clean = `${url.pathname}${url.search}${hasOAuthHash ? "" : url.hash}`;
          window.history.replaceState({}, document.title, clean || "/");
        }
      }
      // If `/api/config` transiently failed on slow mobile networks while a real
      // Supabase session already exists, keep accounts enabled so profile sync works.
      if (restored && !get().accountsEnabled) {
        set({ accountsEnabled: true });
      }
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
          ...(user ? {} : { profile: null, tokens: [] }),
        });
        if (event === "SIGNED_OUT") setGuestFlag(false);
        if (user && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION")) {
          if (!get().accountsEnabled) set({ accountsEnabled: true });
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
      if (profile) {
        setGuestFlag(false);
        set({
          profile,
          signedIn: true,
          guest: false,
          error: null,
        });
        return;
      }
      // Server returned 401 for `/api/session`: verify with Supabase Auth whether
      // the session was revoked or expired so we never leave stale `signedIn: true`.
      const supabase = supabaseConfigured() ? await getSupabaseAsync() : null;
      if (supabase && get().user) {
        const { data, error } = await supabase.auth.getUser();
        if (error || !data.user) {
          await supabase.auth.signOut().catch(() => undefined);
          set({ profile: null, user: null, signedIn: false, tokens: [], error: null });
          return;
        }
      }
      set({
        profile: null,
        signedIn: Boolean(get().user),
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
    const supabase = await getSupabaseAsync();
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
    const supabase = await getSupabaseAsync();
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
    const supabase = await getSupabaseAsync();
    if (!supabase) {
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

  consumeLocalCredit: (amount = 1) => {
    const { profile } = get();
    if (!profile) return;
    const nextCredits = Math.max(0, profile.credits - Math.max(1, amount));
    set({ profile: { ...profile, credits: nextCredits } });
  },

  loadTokens: async () => {
    const { signedIn, accountsEnabled } = get();
    if (!signedIn) {
      set({ tokens: [] });
      return;
    }
    if (!accountsEnabled) {
      set({ tokens: [] });
      return;
    }
    set({ tokensLoading: true });
    try {
      const data = await apiFetch<{ tokens: UserApiToken[] }>("/api/tokens");
      set({ tokens: Array.isArray(data.tokens) ? data.tokens : [] });
    } catch {
      // Keep previous list on transient failures.
    } finally {
      set({ tokensLoading: false });
    }
  },

  createToken: async (rawName: string) => {
    const name = rawName.trim().slice(0, 64);
    if (!name) throw new Error("Enter a token name.");
    const { signedIn } = get();
    if (!signedIn) throw new Error("Sign in to create a token.");

    const res = await apiFetch<{ token: UserApiToken; secret: string }>("/api/tokens", {
      method: "POST",
      body: { name },
    });
    set((state) => ({ tokens: [res.token, ...state.tokens] }));
    return res;
  },

  revokeToken: async (id: string) => {
    await apiFetch(`/api/tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
    set((state) => ({ tokens: state.tokens.filter((t) => t.id !== id) }));
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
    const supabase = await getSupabaseAsync();
    await supabase?.auth.signOut();
    setGuestFlag(false);
    set({ signedIn: false, user: null, profile: null, tokens: [], guest: false });
  },
}));
