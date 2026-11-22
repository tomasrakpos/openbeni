// Free Model Routers store — manages public admin routers (live-synced via
// Supabase Realtime / polling with backoff / window focus) and personal user
// routers (persisted in Dexie `db.meta` for local BYOK providers and synced
// with `/api/routers` when signed in).
import { create } from "zustand";
import { db } from "@/db";
import { apiFetch } from "@/lib/api";
import type { DevPublicRouter } from "@/lib/devAdminMock";
import {
  filterFreeEligibleModels,
  normalizeModelPricing,
  validateRouterName,
  type ModelPricingClass,
} from "@/lib/routerEngine";
import type { AIModel, Provider } from "@/lib/types";

export const ROUTER_ID_PREFIX = "router::";

export function toRouterSelectionId(routerId: string): string {
  return `${ROUTER_ID_PREFIX}${routerId}`;
}

export function isRouterSelectionId(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(ROUTER_ID_PREFIX);
}

export function parseRouterSelectionId(value: string): string | null {
  return isRouterSelectionId(value) ? value.slice(ROUTER_ID_PREFIX.length) : null;
}

export interface PublicRouterItem {
  id: string;
  ownerScope: "public" | "user";
  providerId: string | null;
  userProviderId: string | null;
  providerName?: string;
  name: string;
  type: "free";
  enabled: boolean;
  activeMemberCount: number;
  memberModelIds: string[];
  capabilities: string[];
  billingSource: "site" | "byok";
  consumesCredits: boolean;
  source: "server" | "dev";
  createdAt: string;
  updatedAt?: string;
}

export interface LocalUserRouter {
  id: string;
  providerId: string;
  name: string;
  type: "free";
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CombinedRouterItem {
  id: string;
  selectionId: string;
  ownerScope: "public" | "user";
  source: "server" | "dev" | "local";
  providerId: string | null;
  providerName: string;
  name: string;
  type: "free";
  enabled: boolean;
  activeMemberCount: number;
  memberModelIds: string[];
  capabilities: string[];
  billingSource: "site" | "byok";
}

const LOCAL_ROUTERS_META_KEY = "user_routers.v1";
const BASE_POLL_MS = import.meta.env.DEV ? 5_000 : 15_000;
const MAX_POLL_MS = 120_000;

/**
 * Computes the strict pricing classification of a local/BYOK model.
 * NEVER guesses `'free'` for unrecognized models without verified pricing.
 */
export function resolveStrictModelPricing(
  model: Pick<AIModel, "modelId" | "pricing" | "pricingTier" | "tier" | "tierOverride" | "locked">,
  provider?: Pick<Provider, "baseUrl">,
): ModelPricingClass {
  if (model.locked) return "paid";
  if (model.tierOverride === "free" || model.tierOverride === "paid" || model.tierOverride === "unknown") {
    return model.tierOverride;
  }
  if (model.pricingTier === "free" || model.pricingTier === "paid" || model.pricingTier === "unknown") {
    return model.pricingTier;
  }
  if (model.pricing) {
    return model.pricing.prompt === 0 && model.pricing.completion === 0 ? "free" : "paid";
  }
  if (/(?::free|\/free|-free)$/i.test(model.modelId) || model.modelId.toLowerCase().includes(":free")) {
    return "free";
  }
  if (provider?.baseUrl) {
    try {
      const host = new URL(provider.baseUrl).hostname.toLowerCase();
      if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host.endsWith(".local")) {
        return "free";
      }
      if (
        host === "api.groq.com" ||
        host === "api.cerebras.ai" ||
        host === "models.github.ai" ||
        host === "models.inference.ai.azure.com" ||
        host === "generativelanguage.googleapis.com"
      ) {
        return "free";
      }
      if (
        host === "api.openai.com" ||
        host === "api.anthropic.com" ||
        host === "api.deepseek.com" ||
        host === "api.x.ai" ||
        host === "api.perplexity.ai" ||
        host === "api.cohere.com" ||
        host === "api.mistral.ai" ||
        host === "api.together.xyz" ||
        host === "api.fireworks.ai"
      ) {
        return "paid";
      }
    } catch {
      // ignore malformed URL
    }
  }
  return normalizeModelPricing(model.tier);
}

/**
 * Returns strictly free & active models belonging to a local provider.
 * Models labeled `paid` or `unknown`, or disabled models, are ALWAYS excluded.
 */
export function eligibleFreeModelsForLocalProvider(
  provider: Provider | undefined,
  models: readonly AIModel[],
): AIModel[] {
  if (!provider || !provider.enabled) return [];
  const providerModels = models.filter((m) => m.providerId === provider.id);
  const eligible = filterFreeEligibleModels(
    providerModels.map((m, idx) => ({
      id: m.id,
      modelId: m.modelId,
      displayName: m.displayName,
      pricing: resolveStrictModelPricing(m, provider),
      enabled: m.enabled,
      locked: m.locked,
      providerEnabled: provider.enabled,
      position: m.order ?? idx,
      raw: m,
    })),
  );
  return eligible.map((entry) => entry.raw);
}

async function loadLocalRouters(): Promise<LocalUserRouter[]> {
  try {
    const row = await db.meta.get(LOCAL_ROUTERS_META_KEY);
    if (!row || typeof row.v !== "string") return [];
    const parsed = JSON.parse(row.v) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is LocalUserRouter =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as LocalUserRouter).id === "string" &&
        typeof (item as LocalUserRouter).providerId === "string" &&
        typeof (item as LocalUserRouter).name === "string",
    );
  } catch {
    return [];
  }
}

async function saveLocalRouters(routers: LocalUserRouter[]): Promise<void> {
  try {
    await db.meta.put({
      k: LOCAL_ROUTERS_META_KEY,
      v: JSON.stringify(routers),
    });
  } catch {
    // Ignore IndexedDB quota/private mode failures gracefully
  }
}

interface RoutersState {
  publicRouters: PublicRouterItem[];
  localRouters: LocalUserRouter[];
  loaded: boolean;
  loading: boolean;
  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
  createLocalRouter: (args: {
    provider: Provider;
    name: string;
    allModels: readonly AIModel[];
    extraModelNames?: readonly string[];
  }) => Promise<{ ok: true; router: LocalUserRouter } | { ok: false; error: string }>;
  renameLocalRouter: (args: {
    id: string;
    name: string;
    allModels: readonly AIModel[];
    extraModelNames?: readonly string[];
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  toggleLocalRouter: (id: string, enabled: boolean) => Promise<void>;
  deleteLocalRouter: (id: string) => Promise<void>;
  syncProviderDeleted: (providerId: string) => Promise<void>;
}

let pollTimer: number | null = null;
let pollDelayMs = BASE_POLL_MS;
let realtimeBound = false;
let focusBound = false;

function schedulePoll(refresh: () => Promise<void>) {
  if (typeof window === "undefined") return;
  if (pollTimer !== null) window.clearTimeout(pollTimer);
  pollTimer = window.setTimeout(() => {
    if (document.visibilityState === "visible") {
      void refresh();
    } else {
      schedulePoll(refresh);
    }
  }, pollDelayMs);
}

export const useRoutersStore = create<RoutersState>((set, get) => ({
  publicRouters: [],
  localRouters: [],
  loaded: false,
  loading: false,

  hydrate: async () => {
    const local = await loadLocalRouters();
    set({ localRouters: local });

    if (typeof window !== "undefined" && !focusBound) {
      focusBound = true;
      window.addEventListener("focus", () => {
        void get().refresh();
      });
    }

    if (!realtimeBound && typeof window !== "undefined") {
      realtimeBound = true;
      // Listen to the shared single-channel "catalog" Realtime event dispatched
      // by `useCatalogStore`, avoiding duplicate Supabase Realtime channels.
      window.addEventListener("openharneks:catalog-changed", () => {
        void get().refresh();
      });
    }

    await get().refresh();
  },

  refresh: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      let devRouters: DevPublicRouter[] | null = null;
      if (import.meta.env.DEV) {
        const { devPublicRouters } = await import("@/lib/devAdminMock");
        devRouters = await devPublicRouters();
      }
      if (devRouters !== null) {
        const mapped: PublicRouterItem[] = devRouters.map((r) => ({
          id: r.id,
          ownerScope: "public",
          providerId: r.providerId,
          userProviderId: null,
          providerName: "OpenHarneks",
          name: r.name,
          type: "free",
          enabled: r.enabled,
          activeMemberCount: r.activeMemberCount,
          memberModelIds: r.memberModelIds,
          capabilities: r.capabilities,
          billingSource: "site",
          consumesCredits: true,
          source: "dev",
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        }));
        pollDelayMs = BASE_POLL_MS;
        set({ publicRouters: mapped, loaded: true, loading: false });
        schedulePoll(get().refresh);
        return;
      }

      const res = await apiFetch<{ routers?: Omit<PublicRouterItem, "source">[] }>("/api/routers");
      const list: PublicRouterItem[] = (res?.routers ?? []).map((r) => ({
        ...r,
        source: "server",
      }));
      pollDelayMs = BASE_POLL_MS;
      set({ publicRouters: list, loaded: true, loading: false });
      schedulePoll(get().refresh);
    } catch {
      // Exponential backoff on transient errors
      pollDelayMs = Math.min(MAX_POLL_MS, Math.round(pollDelayMs * 1.8));
      set({ loaded: true, loading: false });
      schedulePoll(get().refresh);
    }
  },

  createLocalRouter: async ({ provider, name, allModels, extraModelNames = [] }) => {
    const eligible = eligibleFreeModelsForLocalProvider(provider, allModels);
    if (eligible.length === 0) {
      return {
        ok: false,
        error: "No verified free models are available for this provider.",
      };
    }

    const existingNames = [
      ...get().localRouters.map((r) => r.name),
      ...get().publicRouters.map((r) => r.name),
    ];
    const modelNames = [
      ...allModels.flatMap((m) => [m.modelId, m.displayName]),
      ...extraModelNames,
    ];
    const check = validateRouterName(name, {
      existingRouterNames: existingNames,
      existingModelNames: modelNames,
    });
    if (!check.ok) {
      return { ok: false, error: check.message ?? "Invalid router name." };
    }

    const now = new Date().toISOString();
    const created: LocalUserRouter = {
      id: `local-router-${crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)}`,
      providerId: provider.id,
      name: check.normalized,
      type: "free",
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    const next = [...get().localRouters, created];
    set({ localRouters: next });
    await saveLocalRouters(next);
    return { ok: true, router: created };
  },

  renameLocalRouter: async ({ id, name, allModels, extraModelNames = [] }) => {
    const existingNames = [
      ...get().localRouters.filter((r) => r.id !== id).map((r) => r.name),
      ...get().publicRouters.map((r) => r.name),
    ];
    const modelNames = [
      ...allModels.flatMap((m) => [m.modelId, m.displayName]),
      ...extraModelNames,
    ];
    const check = validateRouterName(name, {
      existingRouterNames: existingNames,
      existingModelNames: modelNames,
    });
    if (!check.ok) {
      return { ok: false, error: check.message ?? "Invalid router name." };
    }
    const next = get().localRouters.map((r) =>
      r.id === id ? { ...r, name: check.normalized, updatedAt: new Date().toISOString() } : r,
    );
    set({ localRouters: next });
    await saveLocalRouters(next);
    return { ok: true };
  },

  toggleLocalRouter: async (id, enabled) => {
    const next = get().localRouters.map((r) =>
      r.id === id ? { ...r, enabled, updatedAt: new Date().toISOString() } : r,
    );
    set({ localRouters: next });
    await saveLocalRouters(next);
  },

  deleteLocalRouter: async (id) => {
    const next = get().localRouters.filter((r) => r.id !== id);
    set({ localRouters: next });
    await saveLocalRouters(next);
  },

  syncProviderDeleted: async (providerId) => {
    const current = get().localRouters;
    const next = current.filter((r) => r.providerId !== providerId);
    if (next.length !== current.length) {
      set({ localRouters: next });
      await saveLocalRouters(next);
    }
  },
}));

/**
 * Combines public admin routers + local user routers with live member counts.
 * Any model disable/delete/re-pricing in `providers`/`models` immediately updates
 * the returned `activeMemberCount` and `memberModelIds` without page reload.
 */
export function buildCombinedRouters(
  publicRouters: readonly PublicRouterItem[],
  localRouters: readonly LocalUserRouter[],
  providers: readonly Provider[],
  models: readonly AIModel[],
): CombinedRouterItem[] {
  const providerById = new Map(providers.map((p) => [p.id, p]));
  const out: CombinedRouterItem[] = [];

  for (const r of publicRouters) {
    if (!r.enabled) continue;
    out.push({
      id: r.id,
      selectionId: toRouterSelectionId(r.id),
      ownerScope: r.ownerScope,
      source: r.source,
      providerId: r.providerId ?? r.userProviderId,
      providerName: r.providerName || "OpenHarneks",
      name: r.name,
      type: r.type,
      enabled: r.enabled,
      activeMemberCount: r.activeMemberCount,
      memberModelIds: r.memberModelIds,
      capabilities: r.capabilities,
      billingSource: r.billingSource,
    });
  }

  for (const r of localRouters) {
    if (!r.enabled) continue;
    const provider = providerById.get(r.providerId);
    // If provider was deleted, omit dangling router immediately
    if (!provider) continue;
    const eligible = eligibleFreeModelsForLocalProvider(provider, models);
    const caps = new Set<string>(["text"]);
    for (const m of eligible) {
      for (const c of m.capabilities ?? []) caps.add(c);
    }
    out.push({
      id: r.id,
      selectionId: toRouterSelectionId(r.id),
      ownerScope: "user",
      source: "local",
      providerId: r.providerId,
      providerName: provider.name,
      name: r.name,
      type: r.type,
      enabled: r.enabled,
      activeMemberCount: eligible.length,
      memberModelIds: eligible.map((m) => m.id),
      capabilities: [...caps],
      billingSource: "byok",
    });
  }

  return out;
}
