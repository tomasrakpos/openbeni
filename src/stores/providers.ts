// App state providers; change state/actions here and keep local persistence in sync.
import { create } from "zustand";
import { addPing, db, deleteProviderCascade, listModels, listProviders, DEFAULT_SETTINGS, loadSettings } from "@/db";
import { getProviderKey, removeProviderKey, saveProviderKey } from "@/db/vault";
import { pingModel, pingProvider } from "@/lib/ping";
import { normalizeBaseUrl } from "@/lib/normalize";
import { suggestedMeta } from "@/lib/registry";
import { runWithConcurrency } from "@/lib/http";
import { uid } from "@/lib/id";
import { useRoutersStore } from "@/stores/routers";
import type { AIModel, ApiFormat, ErrorKind, PingResult, PricingClass, Provider } from "@/lib/types";

export interface ProviderDraft {
  name: string;
  baseUrl: string;
  apiFormat: ApiFormat;
  auth: Provider["auth"];
  extraHeaders: Record<string, string>;
  timeoutMs: number;
  useProxy: boolean;
  icon?: string;
  color?: string;
  notes?: string;
  presetId?: string;
  paths: Provider["paths"];
  custom?: Provider["custom"];
  enabled?: boolean;
  favorite?: boolean;
}

export interface ModelDraft {
  modelId: string;
  displayName?: string;
  contextWindow?: number;
  pricing?: { prompt: number; completion: number };
  pricingTier?: PricingClass;
  capabilities?: AIModel["capabilities"];
  tier?: AIModel["tier"];
  source?: AIModel["source"];
}

interface ProvidersState {
  providers: Provider[];
  models: AIModel[];
  pings: PingResult[];
  loading: boolean;
  working: Record<string, boolean>;
  load: () => Promise<void>;
  createProvider: (draft: ProviderDraft, apiKey?: string) => Promise<Provider>;
  updateProvider: (id: string, draft: Partial<ProviderDraft>, apiKey?: string) => Promise<void>;
  deleteProvider: (id: string) => Promise<void>;
  duplicateProvider: (id: string) => Promise<Provider | null>;
  setProviderEnabled: (id: string, enabled: boolean) => Promise<void>;
  setProviderFavorite: (id: string, favorite: boolean) => Promise<void>;
  reorderProviders: (ids: string[]) => Promise<void>;
  addModels: (providerId: string, entries: ModelDraft[]) => Promise<number>;
  applyModelPricing: (
    providerId: string,
    updates: ReadonlyMap<string, { pricingTier: PricingClass; pricing?: { prompt: number; completion: number } }>,
  ) => Promise<void>;
  updateModel: (id: string, patch: Partial<AIModel>) => Promise<void>;
  deleteModel: (id: string) => Promise<void>;
  duplicateModel: (id: string) => Promise<void>;
  reorderModels: (ids: string[]) => Promise<void>;
  getKey: (providerId: string) => Promise<string | null>;
  pingOne: (providerId: string) => Promise<PingResult>;
  pingAll: () => Promise<void>;
  pingModelById: (modelId: string) => Promise<PingResult | null>;
  refreshPings: () => Promise<void>;
}

function providerOrder(): number {
  const providers = useProvidersStore.getState().providers;
  return providers.reduce((max, p) => Math.max(max, p.order), 0) + 1;
}

export const useProvidersStore = create<ProvidersState>()((set, get) => ({
  providers: [],
  models: [],
  pings: [],
  loading: false,
  working: {},

      load: async () => {
    set({ loading: true });
    const [rawProviders, models, pings] = await Promise.all([
      listProviders(),
      listModels(),
      db.pings.orderBy("at").reverse().limit(600).toArray(),
    ]);
    // Scrub legacy technical preset notes that may have been persisted in IndexedDB earlier.
    const staleIds: string[] = [];
    const providers = rawProviders.map((p) => {
      if (!p.notes) return p;
      staleIds.push(p.id);
      return { ...p, notes: undefined };
    });
    if (staleIds.length > 0) {
      void Promise.all(staleIds.map((id) => db.providers.update(id, { notes: undefined }))).catch(() => undefined);
    }
    set({ providers, models, pings, loading: false });
  },

  createProvider: async (draft, apiKey) => {
    const now = Date.now();
    const { baseUrl } = normalizeBaseUrl(draft.baseUrl, draft.apiFormat);
    const provider: Provider = {
      id: uid("prov"),
      name: draft.name.trim() || "Untitled provider",
      baseUrl,
      apiFormat: draft.apiFormat,
      auth: draft.auth,
      extraHeaders: draft.extraHeaders ?? {},
      timeoutMs: draft.timeoutMs || 45_000,
      useProxy: draft.useProxy ?? false,
      enabled: draft.enabled ?? true,
      favorite: draft.favorite ?? false,
      order: providerOrder(),
      icon: draft.icon,
      color: draft.color,
      notes: draft.notes,
      presetId: draft.presetId,
      paths: draft.paths ?? {},
      custom: draft.custom,
      hasKey: false,
      createdAt: now,
      updatedAt: now,
    };
    if (apiKey) {
      await saveProviderKey(provider.id, apiKey);
      provider.hasKey = true;
    }
    await db.providers.put(provider);
    set((state) => ({ providers: [...state.providers, provider] }));
    return provider;
  },

  updateProvider: async (id, draft, apiKey) => {
    const existing = get().providers.find((p) => p.id === id);
    if (!existing) return;
    const apiFormat = draft.apiFormat ?? existing.apiFormat;
    const baseUrl = draft.baseUrl ? normalizeBaseUrl(draft.baseUrl, apiFormat).baseUrl : existing.baseUrl;
    const next: Provider = {
      ...existing,
      ...draft,
      baseUrl,
      apiFormat,
      auth: draft.auth ?? existing.auth,
      paths: draft.paths ?? existing.paths,
      extraHeaders: draft.extraHeaders ?? existing.extraHeaders,
      custom: draft.custom ?? existing.custom,
      updatedAt: Date.now(),
    };
    if (apiKey) {
      await saveProviderKey(id, apiKey);
      next.hasKey = true;
    }
    await db.providers.put(next);
    set((state) => ({ providers: state.providers.map((p) => (p.id === id ? next : p)) }));
  },

  deleteProvider: async (id) => {
    await deleteProviderCascade(id);
    await removeProviderKey(id);
    set((state) => ({
      providers: state.providers.filter((p) => p.id !== id),
      models: state.models.filter((m) => m.providerId !== id),
      pings: state.pings.filter((p) => p.providerId !== id),
    }));
    void useRoutersStore.getState().syncProviderDeleted(id);
  },

  duplicateProvider: async (id) => {
    const source = get().providers.find((p) => p.id === id);
    if (!source) return null;
    const now = Date.now();
    const copy: Provider = {
      ...source,
      id: uid("prov"),
      name: `${source.name} copy`,
      order: providerOrder(),
      createdAt: now,
      updatedAt: now,
      hasKey: false,
      presetId: undefined,
      bundled: undefined,
    };
    // Never duplicate a managed provider's identity: the copy becomes BYOK.
    delete copy.managed;
    try {
      const key = await getProviderKey(source.id);
      if (key) {
        await saveProviderKey(copy.id, key);
        copy.hasKey = true;
      }
    } catch {
      // vault locked — duplicate config only
    }
    await db.providers.put(copy);
    const sourceModels = get().models.filter((m) => m.providerId === id);
    const clones: AIModel[] = sourceModels.map((model) => ({
      ...model,
      id: uid("model"),
      providerId: copy.id,
      createdAt: now,
      updatedAt: now,
    }));
    if (clones.length) await db.models.bulkPut(clones);
    set((state) => ({
      providers: [...state.providers, copy],
      models: [...state.models, ...clones],
    }));
    return copy;
  },

  setProviderEnabled: async (id, enabled) => {
    const provider = get().providers.find((p) => p.id === id);
    if (!provider) return;
    const next = { ...provider, enabled, updatedAt: Date.now() };
    await db.providers.put(next);
    set((state) => ({ providers: state.providers.map((p) => (p.id === id ? next : p)) }));
  },

  setProviderFavorite: async (id, favorite) => {
    const provider = get().providers.find((p) => p.id === id);
    if (!provider) return;
    const next = { ...provider, favorite };
    await db.providers.put(next);
    set((state) => ({ providers: state.providers.map((p) => (p.id === id ? next : p)) }));
  },

  reorderProviders: async (ids) => {
    const now = Date.now();
    const updates: Provider[] = [];
    const providers = get().providers.map((provider) => {
      const index = ids.indexOf(provider.id);
      if (index === -1) return provider;
      const next = { ...provider, order: index };
      updates.push(next);
      return next;
    });
    await db.providers.bulkPut(updates);
    set({ providers });
  },

  addModels: async (providerId, entries) => {
    const provider = get().providers.find((p) => p.id === providerId);
    if (!provider) return 0;
    const existing = new Set(
      get().models.filter((m) => m.providerId === providerId).map((m) => m.modelId.toLowerCase()),
    );
    let order = get().models.reduce((max, m) => Math.max(max, m.order), 0);
    const now = Date.now();
    const created: AIModel[] = [];
    for (const entry of entries) {
      const modelId = entry.modelId.trim();
      if (!modelId || existing.has(modelId.toLowerCase())) continue;
      existing.add(modelId.toLowerCase());
      const meta = suggestedMeta(modelId, provider);
      order += 1;
      created.push({
        id: uid("model"),
        providerId,
        modelId,
        displayName: entry.displayName?.trim() || prettyModelName(modelId),
        contextWindow: entry.contextWindow ?? meta.contextWindow,
        capabilities: entry.capabilities ?? meta.capabilities,
        tier: entry.tier ?? meta.tier,
        pricing: entry.pricing ?? meta.pricing,
        pricingTier: entry.pricingTier ?? entry.tier ?? "unknown",
        enabled: true,
        favorite: false,
        order,
        source: entry.source ?? "api",
        createdAt: now,
        updatedAt: now,
      });
    }
    if (created.length === 0) return 0;
    await db.models.bulkPut(created);
    set((state) => ({ models: [...state.models, ...created] }));
    return created.length;
  },

  applyModelPricing: async (providerId, updates) => {
    if (updates.size === 0) return;
    const now = Date.now();
    const changed: AIModel[] = [];
    const nextModels = get().models.map((m) => {
      if (m.providerId !== providerId) return m;
      const hit = updates.get(m.modelId) ?? updates.get(m.modelId.toLowerCase());
      if (!hit) return m;
      const updated: AIModel = {
        ...m,
        pricingTier: hit.pricingTier,
        tier: hit.pricingTier,
        ...(hit.pricing ? { pricing: hit.pricing } : {}),
        updatedAt: now,
      };
      changed.push(updated);
      return updated;
    });
    if (changed.length === 0) return;
    await db.models.bulkPut(changed);
    set({ models: nextModels });
  },

  updateModel: async (id, patch) => {
    const existing = get().models.find((m) => m.id === id);
    if (!existing) return;
    const next = { ...existing, ...patch, updatedAt: Date.now() };
    await db.models.put(next);
    set((state) => ({ models: state.models.map((m) => (m.id === id ? next : m)) }));
  },

  deleteModel: async (id) => {
    await db.models.delete(id);
    set((state) => ({ models: state.models.filter((m) => m.id !== id) }));
  },

  duplicateModel: async (id) => {
    const existing = get().models.find((m) => m.id === id);
    if (!existing) return;
    const copy: AIModel = {
      ...existing,
      id: uid("model"),
      displayName: `${existing.displayName} copy`,
      order: get().models.reduce((max, m) => Math.max(max, m.order), 0) + 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.models.put(copy);
    set((state) => ({ models: [...state.models, copy] }));
  },

  reorderModels: async (ids) => {
    const updates: AIModel[] = [];
    const models = get().models.map((model) => {
      const index = ids.indexOf(model.id);
      if (index === -1) return model;
      const next = { ...model, order: index, updatedAt: Date.now() };
      updates.push(next);
      return next;
    });
    await db.models.bulkPut(updates);
    set({ models });
  },

  getKey: (providerId) => getProviderKey(providerId),

  pingOne: async (providerId) => {
    const provider = get().providers.find((p) => p.id === providerId);
    if (!provider) {
      return { id: uid("ping"), providerId, at: Date.now(), latencyMs: 0, ok: false, kind: "unknown", message: "Provider not found" };
    }
    const settings = await loadSettings();
    set((state) => ({ working: { ...state.working, [providerId]: true } }));
    let key = "";
    try {
      key = (await getProviderKey(providerId)) ?? "";
    } catch {
      key = "";
    }
    let result: PingResult;
    if (provider.auth.header && !key) {
      result = {
        id: uid("ping"),
        providerId,
        at: Date.now(),
        latencyMs: 0,
        ok: false,
        kind: "auth",
        message: "No API key stored for this provider.",
      };
    } else {
      result = await pingProvider({
        provider,
        apiKey: key,
        proxyUrl: settings.proxyUrl || DEFAULT_SETTINGS.proxyUrl,
      });
    }
    await addPing(result);
    set((state) => ({
      pings: [...state.pings, result],
      working: { ...state.working, [providerId]: false },
    }));
    return result;
  },

  pingAll: async () => {
    const providers = get().providers.filter((p) => p.enabled);
    const tasks = providers.map((provider) => async () => get().pingOne(provider.id));
    await runWithConcurrency(tasks, 3);
  },

  pingModelById: async (modelId) => {
    const model = get().models.find((m) => m.id === modelId);
    if (!model) return null;
    const provider = get().providers.find((p) => p.id === model.providerId);
    if (!provider) return null;
    const settings = await loadSettings();
    set((state) => ({ working: { ...state.working, [modelId]: true } }));
    let key = "";
    try {
      key = (await getProviderKey(provider.id)) ?? "";
    } catch {
      key = "";
    }
    const result = await pingModel(
      { provider, apiKey: key, proxyUrl: settings.proxyUrl || undefined },
      model,
    );
    await addPing(result);
    set((state) => ({
      pings: [...state.pings, result],
      working: { ...state.working, [modelId]: false },
    }));
    return result;
  },

  refreshPings: async () => {
    const pings = await db.pings.orderBy("at").reverse().limit(600).toArray();
    set({ pings });
  },
}));

export function prettyModelName(modelId: string): string {
  return modelId
    .replace(/^models\//, "")
    .split("/")
    .pop()!
    .replace(/[-_]/g, " ")
    .replace(/\b(\w)/g, (m) => m.toUpperCase());
}

export function pingKindMessage(kind: ErrorKind): string {
  return kind;
}
