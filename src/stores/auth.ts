// App state auth; change state/actions here and keep local persistence in sync.
import { create } from "zustand";
import { apiFetch, ApiError } from "@/lib/api";
import { getSupabaseAsync, supabaseConfigured } from "@/lib/supabase";

export const DEFAULT_SIGNUP_CREDITS = 5;

async function isDevAdminPreview(): Promise<boolean> {
  if (!import.meta.env.DEV || typeof window === "undefined" || !window.location.pathname.startsWith("/admin")) {
    return false;
  }
  const { devAdminPreview } = await import("@/lib/devAdminMock");
  return devAdminPreview();
}

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

interface DevAccountSnapshot {
  user: AuthUser;
  profile: SessionProfile;
  tokens: UserApiToken[];
}

const DEV_ACCOUNT_KEY = "openharneks.devAccount.v1";

function canUseDevInstantAuth(): boolean {
  return import.meta.env.DEV && !supabaseConfigured();
}

function readDevAccount(): DevAccountSnapshot | null {
  if (!canUseDevInstantAuth()) return null;
  try {
    const raw = window.localStorage.getItem(DEV_ACCOUNT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DevAccountSnapshot;
    if (!parsed?.user?.id || !parsed?.profile?.id) return null;
    return {
      user: parsed.user,
      profile: {
        ...parsed.profile,
        credits: typeof parsed.profile.credits === "number" ? parsed.profile.credits : DEFAULT_SIGNUP_CREDITS,
      },
      tokens: Array.isArray(parsed.tokens) ? parsed.tokens : [],
    };
  } catch {
    return null;
  }
}

function writeDevAccount(snapshot: DevAccountSnapshot | null): void {
  if (!import.meta.env.DEV) return;
  try {
    if (snapshot) window.localStorage.setItem(DEV_ACCOUNT_KEY, JSON.stringify(snapshot));
    else window.localStorage.removeItem(DEV_ACCOUNT_KEY);
  } catch {
    // Storage may be unavailable in private browsing.
  }
}

function randomTokenSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const encoded = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `oh_${encoded}`;
}

function createDevAccountSnapshot(): DevAccountSnapshot {
  const now = new Date().toISOString();
  const suffix = Math.random().toString(36).slice(2, 6);
  const id = `dev-user-${suffix}`;
  const email = `user.${suffix}@openharneks.local`;
  const displayName = `Member ${suffix.toUpperCase()}`;
  return {
    user: { id, email, name: displayName, avatarUrl: null },
    profile: {
      id,
      email,
      displayName,
      role: "user",
      status: "active",
      credits: DEFAULT_SIGNUP_CREDITS,
      dailyTokenLimit: null,
      monthlyTokenLimit: null,
      createdAt: now,
      lastSeenAt: now,
      isAdmin: false,
    },
    tokens: [],
  };
}

interface AuthState {
  ready: boolean;
  accountsEnabled: boolean;
  signupOpen: boolean;
  signedIn: boolean;
  /** True only in DEV when Supabase is not configured and instant preview login was used. */
  devMockSession: boolean;
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
  resetDevCredits: () => void;
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

const INITIAL_DEV_ACCOUNT = typeof window !== "undefined" ? readDevAccount() : null;

export const useAuthStore = create<AuthState>()((set, get) => ({
  ready: canUseDevInstantAuth(),
  accountsEnabled: false,
  signupOpen: false,
  signedIn: Boolean(INITIAL_DEV_ACCOUNT),
  devMockSession: Boolean(INITIAL_DEV_ACCOUNT),
  user: INITIAL_DEV_ACCOUNT?.user ?? null,
  guest: typeof window !== "undefined" ? readGuest() : false,
  profile: INITIAL_DEV_ACCOUNT?.profile ?? null,
  tokens: INITIAL_DEV_ACCOUNT?.tokens ?? [],
  tokensLoading: false,
  error: null,

  init: async () => {
    const [config, preview] = await Promise.all([fetchConfig(), isDevAdminPreview()]);
    set({
      accountsEnabled: preview || (config.accountsEnabled && supabaseConfigured()),
      signupOpen: config.signupOpen,
      guest: readGuest(),
    });

    // DEV without Supabase: restore local preview account if previously signed in,
    // and sync live online presence + blocked status with the shared admin store.
    if (!preview && canUseDevInstantAuth()) {
      const saved = readDevAccount();
      if (saved) {
        set({
          signedIn: true,
          devMockSession: true,
          user: saved.user,
          profile: saved.profile,
          tokens: saved.tokens,
          guest: false,
          ready: true,
        });
        const syncPresence = () => {
          const cur = get().profile;
          if (!cur) return;
          void import("@/lib/devAdminMock").then(({ syncDevUserPresence }) =>
            syncDevUserPresence({
              id: cur.id,
              email: cur.email,
              displayName: cur.displayName,
            }).then(({ blocked }) => {
              const latest = get().profile;
              if (!latest) return;
              const nextStatus = blocked ? "blocked" : "active";
              if (latest.status !== nextStatus) {
                const updated = { ...latest, status: nextStatus as "active" | "blocked", lastSeenAt: new Date().toISOString() };
                set({ profile: updated });
                const snap = readDevAccount();
                if (snap) writeDevAccount({ ...snap, profile: updated });
              }
            }),
          );
        };
        syncPresence();
        window.setInterval(() => {
          if (document.visibilityState === "visible") syncPresence();
        }, 60_000);
        return;
      }
      set({ ready: true });
      return;
    }

    // Restore the Supabase session before anything else, so a page refresh keeps
    // the visitor signed in. Without a session the visitor stays signed out.
    const supabase = preview || !supabaseConfigured() ? null : await getSupabaseAsync();
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
    if (get().devMockSession) {
      const saved = readDevAccount();
      if (saved) {
        const { syncDevUserPresence } = await import("@/lib/devAdminMock");
        const { blocked } = await syncDevUserPresence({
          id: saved.profile.id,
          email: saved.profile.email,
          displayName: saved.profile.displayName,
        });
        const updatedProfile = {
          ...saved.profile,
          status: (blocked ? "blocked" : "active") as "active" | "blocked",
          lastSeenAt: new Date().toISOString(),
        };
        writeDevAccount({ ...saved, profile: updatedProfile });
        set({
          signedIn: true,
          user: saved.user,
          profile: updatedProfile,
          tokens: saved.tokens,
          error: null,
        });
      }
      return;
    }
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
      // In local DEV preview without Supabase env vars, create an instant demo
      // account with 5 starter credits so the full post-signup flow can be tested.
      // Production builds compile this branch out completely (`import.meta.env.DEV` -> false).
      if (canUseDevInstantAuth()) {
        const snapshot = readDevAccount() ?? createDevAccountSnapshot();
        writeDevAccount(snapshot);
        setGuestFlag(false);
        set({
          signedIn: true,
          devMockSession: true,
          user: snapshot.user,
          profile: snapshot.profile,
          tokens: snapshot.tokens,
          guest: false,
          error: null,
        });
        return;
      }
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
    const { profile, user, tokens, devMockSession } = get();
    if (!profile) return;
    const nextCredits = Math.max(0, profile.credits - Math.max(1, amount));
    const nextProfile: SessionProfile = { ...profile, credits: nextCredits };
    set({ profile: nextProfile });
    if (devMockSession && user) {
      writeDevAccount({ user, profile: nextProfile, tokens });
    }
  },

  loadTokens: async () => {
    const { signedIn, devMockSession, accountsEnabled } = get();
    if (!signedIn) {
      set({ tokens: [] });
      return;
    }
    if (devMockSession || !accountsEnabled) {
      const saved = readDevAccount();
      set({ tokens: saved?.tokens ?? get().tokens });
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
    const { signedIn, devMockSession, accountsEnabled, user, profile, tokens } = get();
    if (!signedIn) throw new Error("Sign in to create a token.");

    if (devMockSession || !accountsEnabled) {
      if (tokens.length >= 10) throw new Error("You can have up to 10 active tokens.");
      const secret = randomTokenSecret();
      const token: UserApiToken = {
        id: `tok_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        name,
        prefix: `${secret.slice(0, 10)}…${secret.slice(-4)}`,
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
      };
      const nextTokens = [token, ...tokens];
      set({ tokens: nextTokens });
      if (devMockSession && user && profile) {
        writeDevAccount({ user, profile, tokens: nextTokens });
      }
      return { token, secret };
    }

    const res = await apiFetch<{ token: UserApiToken; secret: string }>("/api/tokens", {
      method: "POST",
      body: { name },
    });
    set((state) => ({ tokens: [res.token, ...state.tokens] }));
    return res;
  },

  revokeToken: async (id: string) => {
    const { devMockSession, accountsEnabled, user, profile, tokens } = get();
    if (devMockSession || !accountsEnabled) {
      const nextTokens = tokens.filter((t) => t.id !== id);
      set({ tokens: nextTokens });
      if (devMockSession && user && profile) {
        writeDevAccount({ user, profile, tokens: nextTokens });
      }
      return;
    }
    await apiFetch(`/api/tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
    set((state) => ({ tokens: state.tokens.filter((t) => t.id !== id) }));
  },

  resetDevCredits: () => {
    if (!import.meta.env.DEV) return;
    const { devMockSession, user, profile, tokens } = get();
    if (!devMockSession || !profile) return;
    const nextProfile = { ...profile, credits: DEFAULT_SIGNUP_CREDITS };
    set({ profile: nextProfile });
    if (user) {
      writeDevAccount({ user, profile: nextProfile, tokens });
    }
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
    if (await isDevAdminPreview()) {
      const { disableDevAdminPreview } = await import("@/lib/devAdminMock");
      await disableDevAdminPreview();
      setGuestFlag(false);
      set({ signedIn: false, devMockSession: false, user: null, profile: null, tokens: [], guest: false });
      window.location.assign("/");
      return;
    }
    if (get().devMockSession) {
      writeDevAccount(null);
      setGuestFlag(false);
      set({ signedIn: false, devMockSession: false, user: null, profile: null, tokens: [], guest: false });
      return;
    }
    const supabase = await getSupabaseAsync();
    await supabase?.auth.signOut();
    setGuestFlag(false);
    set({ signedIn: false, devMockSession: false, user: null, profile: null, tokens: [], guest: false });
  },
}));
