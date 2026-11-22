// App state catalog; change state/actions here and keep local persistence in sync.
import { create } from "zustand";
import * as React from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { apiFetch } from "@/lib/api";
import { APP_NAME } from "@/lib/bundled";
import { getSupabase, getSupabaseAsync, supabaseConfigured } from "@/lib/supabase";
import type { AIModel, Capability, Provider, Tier } from "@/lib/types";
import { useAuthStore } from "@/stores/auth";
import { useProvidersStore } from "@/stores/providers";

/** Synthetic provider id for the site's own (server-run) models. */
export const SERVER_PROVIDER_ID = "prov_server";

/** Dev-only local mock provider so credits & streaming UX can be tested without any AI API key. */
export const DEMO_PROVIDER_ID = "prov_demo";
export const DEMO_MODEL_ID = "demo:preview-chat";
export const DEMO_WEB_DESIGN_MODEL_ID = "demo:web-design";

export interface PublicServerModel {
  id: string;
  displayName: string;
  capabilities: string[];
  contextWindow?: number;
  tier: "free" | "paid" | "unknown";
  /** Shown with a Paid badge; never run with the site's keys. */
  paid?: boolean;
  /** Local preview only: the real upstream id to send to the provider. */
  upstreamId?: string;
}

interface CatalogCache {
  at: number;
  models: PublicServerModel[];
}

const CACHE_KEY = "openharness.catalog.v1";
const CACHE_TTL = 5 * 60_000;
/** Fast refresh window so admin panel edits reflect on the public site quickly. */
const POLL_MS = import.meta.env.DEV ? 5_000 : 15_000;
const MAX_POLL_MS = 120_000;

const CAPABILITIES: Capability[] = ["text", "vision", "video", "audio", "tools", "reasoning"];

function readCache(): CatalogCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CatalogCache;
    if (!Array.isArray(parsed.models)) return null;
    if (typeof parsed.at !== "number" || Date.now() - parsed.at > CACHE_TTL) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(models: PublicServerModel[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), models } satisfies CatalogCache));
  } catch {
    // Storage may be disabled; the in-memory list still works.
  }
}

/**
 * Local admin preview keeps its providers/models in the dev server's shared
 * store. Read them through a dynamic import so the mock (and this bridge) never
 * ships in a production build.
 */
async function readDevCatalog(): Promise<PublicServerModel[] | null> {
  if (!import.meta.env.DEV) return null;
  const { devCatalogModels } = await import("@/lib/devAdminMock");
  const models = await devCatalogModels();
  return models as PublicServerModel[] | null;
}

export function serverProvider(): Provider {
  return {
    id: SERVER_PROVIDER_ID,
    name: APP_NAME,
    baseUrl: "",
    apiFormat: "openai",
    auth: { header: "", prefix: "" },
    extraHeaders: {},
    timeoutMs: 120_000,
    useProxy: false,
    enabled: true,
    favorite: false,
    order: -1_000,
    bundled: true,
    managed: true,
    paths: {},
    hasKey: true,
    createdAt: 0,
    updatedAt: 0,
  };
}

export function toServerModel(model: PublicServerModel, index: number): AIModel {
  const capabilities = model.capabilities.filter((entry): entry is Capability =>
    (CAPABILITIES as string[]).includes(entry),
  );
  return {
    id: `srv:${model.id}`,
    providerId: SERVER_PROVIDER_ID,
    modelId: model.upstreamId ?? model.id,
    displayName: model.displayName,
    contextWindow: model.contextWindow,
    capabilities: capabilities.length > 0 ? capabilities : ["text"],
    tier: model.tier as Tier,
    ...(model.paid ? { locked: true } : {}),
    enabled: true,
    favorite: false,
    order: index,
    source: "api",
    createdAt: 0,
    updatedAt: 0,
  };
}

interface CatalogState {
  models: PublicServerModel[];
  providerModels: AIModel[];
  status: "idle" | "ready" | "error";
  lastUpdated: number;
  init: () => void;
  refresh: () => Promise<void>;
  clear: () => void;
}

let started = false;
let pollTimer: number | undefined;
let channel: RealtimeChannel | null = null;
let authUnsub: (() => void) | null = null;

function setModels(models: PublicServerModel[]): void {
  useCatalogStore.setState({
    models,
    providerModels: models.map((model, index) => toServerModel(model, index)),
    status: "ready",
    lastUpdated: Date.now(),
  });
}

export const useCatalogStore = create<CatalogState>()((set, get) => ({
  models: [],
  providerModels: [],
  status: "idle",
  lastUpdated: 0,

  init: () => {
    if (started) return;
    started = true;

    const cached = readCache();
    if (cached) {
      set({
        models: cached.models,
        providerModels: cached.models.map((model, index) => toServerModel(model, index)),
        status: "ready",
        lastUpdated: cached.at,
      });
    }

    // Realtime: the admin panel broadcasts a tiny "catalog-changed" event after
    // every mutation, so every connected picker refetches within seconds.
    if (supabaseConfigured()) {
      void subscribeRealtime();
    }

    authUnsub = useAuthStore.subscribe((state, previous) => {
      // The catalog is public, so a sign-in/sign-out only refetches: it never
      // empties the picker for a visitor who is not signed in.
      if (state.signedIn !== previous.signedIn) void get().refresh();
    });

    void get().refresh();

    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void get().refresh();
    });

    window.addEventListener("focus", () => {
      void get().refresh();
    });

    if (import.meta.env.DEV) {
      // Another tab owns the admin preview; pick up provider/model changes
      // without waiting for the poll.
      window.addEventListener("storage", () => {
        void get().refresh();
      });
    }

    let pollDelay = POLL_MS;
    const scheduleNextPoll = () => {
      if (pollTimer) window.clearTimeout(pollTimer);
      pollTimer = window.setTimeout(async () => {
        if (document.visibilityState === "visible") {
          const ok = await refreshWithStatus();
          pollDelay = ok ? POLL_MS : Math.min(pollDelay * 2, MAX_POLL_MS);
        }
        scheduleNextPoll();
      }, pollDelay);
    };

    const refreshWithStatus = async (): Promise<boolean> => {
      const before = get().lastUpdated;
      await get().refresh();
      return get().status === "ready" || get().lastUpdated > before;
    };

    scheduleNextPoll();

    window.addEventListener("pagehide", () => {
      if (pollTimer) window.clearTimeout(pollTimer);
      authUnsub?.();
      if (channel) void getSupabase()?.removeChannel(channel);
      channel = null;
    });
  },

  refresh: async () => {
    const dev = await readDevCatalog();
    if (dev) {
      writeCache(dev);
      setModels(dev);
      return;
    }
    try {
      const data = await apiFetch<PublicServerModel[]>("/api/models");
      const models = Array.isArray(data) ? data : [];
      writeCache(models);
      setModels(models);
    } catch {
      set({ status: get().models.length > 0 ? "ready" : "error" });
    }
  },

  clear: () => {
    set({ models: [], providerModels: [], status: "idle", lastUpdated: 0 });
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch {
      // Ignore.
    }
  },
}));

async function subscribeRealtime(): Promise<void> {
  const supabase = await getSupabaseAsync();
  if (!supabase) return;
  const refreshSoon = () => {
    void useCatalogStore.getState().refresh();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("openharneks:catalog-changed"));
    }
  };

  channel = supabase
    .channel("catalog")
    .on("broadcast", { event: "catalog-changed" }, refreshSoon)
    .subscribe((status) => {
      // After a reconnect, refetch the whole list: broadcast events that fired
      // while we were offline are gone.
      if (status === "SUBSCRIBED") refreshSoon();
    });
}

export function demoProvider(): Provider {
  return {
    id: DEMO_PROVIDER_ID,
    name: "Demo Preview",
    baseUrl: "",
    apiFormat: "openai",
    auth: { header: "", prefix: "" },
    extraHeaders: {},
    timeoutMs: 30_000,
    useProxy: false,
    enabled: true,
    favorite: false,
    order: 9_999,
    bundled: true,
    managed: true,
    paths: {},
    hasKey: true,
    createdAt: 0,
    updatedAt: 0,
  };
}

export function demoModel(): AIModel {
  return {
    id: DEMO_MODEL_ID,
    providerId: DEMO_PROVIDER_ID,
    modelId: "demo-preview-chat",
    displayName: "Demo Chat (Mock Test)",
    contextWindow: 16_000,
    capabilities: ["text"],
    tier: "free",
    enabled: true,
    favorite: false,
    order: 9_999,
    source: "manual",
    createdAt: 0,
    updatedAt: 0,
  };
}

export function demoWebDesignModel(): AIModel {
  return {
    id: DEMO_WEB_DESIGN_MODEL_ID,
    providerId: DEMO_PROVIDER_ID,
    modelId: "demo-web-design",
    displayName: "Web Design (Mock Test)",
    contextWindow: 16_000,
    capabilities: ["text"],
    tier: "free",
    enabled: true,
    favorite: false,
    order: 10_000,
    source: "manual",
    createdAt: 0,
    updatedAt: 0,
  };
}

/** Merged provider list for chat surfaces: user BYOK first, then server models (+ dev demo mock). */
export function withServerProvider(providers: Provider[], serverModels: AIModel[]): Provider[] {
  const next = serverModels.length > 0 ? [...providers, serverProvider()] : [...providers];
  if (import.meta.env.DEV) next.push(demoProvider());
  return next;
}

/** React hook: local BYOK providers plus the synthetic site provider. */
export function useAllProviders(): Provider[] {
  const local = useProvidersStore((state) => state.providers);
  const serverModels = useCatalogStore((state) => state.providerModels);
  return React.useMemo(
    () => withServerProvider(local, serverModels),
    [local, serverModels],
  );
}

/** React hook: local BYOK models plus the site's enabled models (+ dev demo mock). */
export function useAllModels(): AIModel[] {
  const local = useProvidersStore((state) => state.models);
  const serverModels = useCatalogStore((state) => state.providerModels);
  return React.useMemo(() => {
    const base = serverModels.length > 0 ? [...local, ...serverModels] : [...local];
    if (import.meta.env.DEV) base.push(demoModel(), demoWebDesignModel());
    return base;
  }, [local, serverModels]);
}
