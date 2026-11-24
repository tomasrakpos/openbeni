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

export interface PublicServerModel {
  id: string;
  displayName: string;
  capabilities: string[];
  contextWindow?: number;
  tier: "free" | "paid" | "unknown";
  /** Shown with a Paid badge; never run with the site's keys. */
  paid?: boolean;
  /** Optional upstream id override used when calling the provider. */
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

    // Realtime: defer connecting `@supabase/supabase-js` (~225 KB + WebSocket)
    // until after the page settles so first load stays blazing fast. Initial
    // `/api/models` fetch runs immediately below.
    let realtimeTimer: number | null = null;
    if (supabaseConfigured()) {
      const startRealtime = () => {
        realtimeTimer = window.setTimeout(() => {
          void subscribeRealtime();
        }, 3500);
      };
      if (document.readyState === "complete") startRealtime();
      else window.addEventListener("load", startRealtime, { once: true });
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
      if (realtimeTimer) window.clearTimeout(realtimeTimer);
      if (pollTimer) window.clearTimeout(pollTimer);
      authUnsub?.();
      if (channel) void getSupabase()?.removeChannel(channel);
      channel = null;
    });
  },

  refresh: async () => {
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

/** Merged provider list for chat surfaces: user BYOK first, then server models. */
export function withServerProvider(providers: Provider[], serverModels: AIModel[]): Provider[] {
  return serverModels.length > 0 ? [...providers, serverProvider()] : [...providers];
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

/** React hook: local BYOK models plus the site's enabled models. */
export function useAllModels(): AIModel[] {
  const local = useProvidersStore((state) => state.models);
  const serverModels = useCatalogStore((state) => state.providerModels);
  return React.useMemo(
    () => (serverModels.length > 0 ? [...local, ...serverModels] : [...local]),
    [local, serverModels],
  );
}
