// Free Model Routers store — manages public admin routers (live-synced via
// Supabase Realtime / polling with backoff / window focus) and personal user
// routers (persisted in Dexie `db.meta` for local BYOK providers and synced
// with `/api/routers` when signed in).
import { create } from "zustand";
import { db } from "@/db";
import { apiFetch } from "@/lib/api";
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
  providerIds?: string[];
  userProviderId: string | null;
  userProviderIds?: string[];
  providerName?: string;
  providerNames?: string[];
  name: string;
  type: "free";
  enabled: boolean;
  activeMemberCount: number;
  memberModelIds: string[];
  capabilities: string[];
  billingSource: "site" | "byok";
  consumesCredits: boolean;
  source: "server";
  createdAt: string;
  updatedAt?: string;
}

export interface LocalUserRouter {
  id: string;
  /** Primary (first) provider id — kept for backward compatibility with single-provider routers. */
  providerId: string;
  /** All attached provider ids (1 or more) pooled into this free router. */
  providerIds: string[];
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
  source: "server" | "local";
  providerId: string | null;
  providerIds?: string[];
  providerName: string;
  providerNames?: string[];
  name: string;
  type: "free";
  enabled: boolean;
  activeMemberCount: number;
  memberModelIds: string[];
  capabilities: string[];
  billingSource: "site" | "byok";
}

export function localRouterProviderIds(
  router: Pick<LocalUserRouter, "providerId" | "providerIds">,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...(Array.isArray(router.providerIds) ? router.providerIds : []), router.providerId]) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
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

/**
 * Returns strictly free & active models across one or more local providers,
 * preserving each model's owning provider for runtime key/endpoint resolution.
 */
export function eligibleFreeModelsForLocalProviders(
  providers: readonly Provider[],
  models: readonly AIModel[],
): Array<{ provider: Provider; model: AIModel }> {
  const out: Array<{ provider: Provider; model: AIModel }> = [];
  const seenModelIds = new Set<string>();
  for (const provider of providers) {
    if (!provider || !provider.enabled) continue;
    const eligible = eligibleFreeModelsForLocalProvider(provider, models);
    for (const model of eligible) {
      if (seenModelIds.has(model.id)) continue;
      seenModelIds.add(model.id);
      out.push({ provider, model });
    }
  }
  return out;
}

async function loadLocalRouters(): Promise<LocalUserRouter[]> {
  try {
    const row = await db.meta.get(LOCAL_ROUTERS_META_KEY);
    if (!row || typeof row.v !== "string") return [];
    const parsed = JSON.parse(row.v) as unknown;
    if (!Array.isArray(parsed)) return [];
    const normalized: LocalUserRouter[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Partial<LocalUserRouter>;
      if (typeof rec.id !== "string" || typeof rec.name !== "string") continue;
      const pIds = localRouterProviderIds({
        providerId: typeof rec.providerId === "string" ? rec.providerId : "",
        providerIds: Array.isArray(rec.providerIds) ? rec.providerIds : [],
      });
      if (pIds.length === 0) continue;
      normalized.push({
        id: rec.id,
        providerId: pIds[0]!,
        providerIds: pIds,
        name: rec.name,
        type: "free",
        enabled: rec.enabled !== false,
        createdAt: typeof rec.createdAt === "string" ? rec.createdAt : new Date().toISOString(),
        updatedAt: typeof rec.updatedAt === "string" ? rec.updatedAt : new Date().toISOString(),
      });
    }
    return normalized;
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
    provider?: Provider;
    providers?: readonly Provider[];
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

const PUBLIC_ROUTERS_CACHE_KEY = "openharness.routers.v1";
const PUBLIC_ROUTERS_CACHE_TTL = 5 * 60_000;

function readPublicRoutersCache(): PublicRouterItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PUBLIC_ROUTERS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { at?: number; routers?: PublicRouterItem[] };
    if (!Array.isArray(parsed.routers)) return [];
    if (typeof parsed.at !== "number" || Date.now() - parsed.at > PUBLIC_ROUTERS_CACHE_TTL) return [];
    return parsed.routers;
  } catch {
    return [];
  }
}

function writePublicRoutersCache(routers: PublicRouterItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      PUBLIC_ROUTERS_CACHE_KEY,
      JSON.stringify({ at: Date.now(), routers }),
    );
  } catch {
    // Ignore storage quota/private mode errors.
  }
}

const INITIAL_CACHED_ROUTERS = readPublicRoutersCache();

export const useRoutersStore = create<RoutersState>((set, get) => ({
  publicRouters: INITIAL_CACHED_ROUTERS,
  localRouters: [],
  loaded: INITIAL_CACHED_ROUTERS.length > 0,
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
      const res = await apiFetch<{ routers?: Omit<PublicRouterItem, "source">[] }>("/api/routers");
      const list: PublicRouterItem[] = (res?.routers ?? []).map((r) => ({
        ...r,
        source: "server",
      }));
      writePublicRoutersCache(list);
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

  createLocalRouter: async ({ provider, providers: inputProviders, name, allModels, extraModelNames = [] }) => {
    const selectedProviders: Provider[] = [];
    const seenPid = new Set<string>();
    for (const p of [...(inputProviders ?? []), ...(provider ? [provider] : [])]) {
      if (!p || seenPid.has(p.id)) continue;
      seenPid.add(p.id);
      selectedProviders.push(p);
    }
    if (selectedProviders.length === 0) {
      return { ok: false, error: "Select at least one provider." };
    }

    const eligible = eligibleFreeModelsForLocalProviders(selectedProviders, allModels);
    if (eligible.length === 0) {
      return {
        ok: false,
        error: "No verified free models are available for the selected provider(s).",
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
    const providerIds = selectedProviders.map((p) => p.id);
    const created: LocalUserRouter = {
      id: `local-router-${crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)}`,
      providerId: providerIds[0]!,
      providerIds,
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
    let changed = false;
    const next: LocalUserRouter[] = [];
    for (const r of current) {
      const pIds = localRouterProviderIds(r);
      if (!pIds.includes(providerId)) {
        next.push(r);
        continue;
      }
      changed = true;
      const remaining = pIds.filter((pid) => pid !== providerId);
      if (remaining.length === 0) continue;
      next.push({
        ...r,
        providerId: remaining[0]!,
        providerIds: remaining,
        updatedAt: new Date().toISOString(),
      });
    }
    if (changed) {
      set({ localRouters: next });
      await saveLocalRouters(next);
    }
  },
}));

/**
 * True when a router was created from the Admin Panel for the public site.
 * Admin public routers render on the public site as native OpenHarneks models
 * (without router icon/badge and without exposing underlying provider/models),
 * whereas personal user routers (`ownerScope === "user"`) keep standard router UI.
 */
export function isAdminPublicRouter(
  router:
    | Pick<CombinedRouterItem, "ownerScope">
    | Pick<PublicRouterItem, "ownerScope">
    | null
    | undefined,
): boolean {
  return router?.ownerScope === "public";
}

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
    const isAdminNative = isAdminPublicRouter(r);
    const attachedIds = isAdminNative
      ? []
      : [
          ...new Set(
            [
              ...(r.userProviderIds ?? []),
              ...(r.providerIds ?? []),
              r.userProviderId,
              r.providerId,
            ].filter((id): id is string => Boolean(id)),
          ),
        ];
    out.push({
      id: r.id,
      selectionId: toRouterSelectionId(r.id),
      ownerScope: r.ownerScope,
      source: r.source,
      providerId: isAdminNative ? null : (attachedIds[0] ?? null),
      providerIds: attachedIds,
      providerName: isAdminNative ? "OpenHarneks" : (r.providerName || "OpenHarneks"),
      providerNames: isAdminNative ? [] : (r.providerNames ?? (r.providerName ? [r.providerName] : [])),
      name: r.name,
      type: r.type,
      enabled: r.enabled,
      activeMemberCount: r.activeMemberCount,
      memberModelIds: isAdminNative ? [] : r.memberModelIds,
      capabilities: r.capabilities,
      billingSource: r.billingSource,
    });
  }

  for (const r of localRouters) {
    if (!r.enabled) continue;
    const pIds = localRouterProviderIds(r);
    const attachedProviders = pIds
      .map((pid) => providerById.get(pid))
      .filter((p): p is Provider => Boolean(p));
    // If every attached provider was deleted, omit dangling router immediately
    if (attachedProviders.length === 0) continue;
    const eligibleEntries = eligibleFreeModelsForLocalProviders(attachedProviders, models);
    const caps = new Set<string>(["text"]);
    for (const { model: m } of eligibleEntries) {
      for (const c of m.capabilities ?? []) caps.add(c);
    }
    const attachedNames = attachedProviders.map((p) => p.name);
    out.push({
      id: r.id,
      selectionId: toRouterSelectionId(r.id),
      ownerScope: "user",
      source: "local",
      providerId: attachedProviders[0]!.id,
      providerIds: attachedProviders.map((p) => p.id),
      providerName: attachedNames.join(" + "),
      providerNames: attachedNames,
      name: r.name,
      type: r.type,
      enabled: r.enabled,
      activeMemberCount: eligibleEntries.length,
      memberModelIds: eligibleEntries.map(({ model: m }) => m.id),
      capabilities: [...caps],
      billingSource: "byok",
    });
  }

  return out;
}
