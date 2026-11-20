// Shared logic modelRoutes; change this helper here and update callers if its contract changes.
import type { AIModel, ErrorKind, Provider } from "@/lib/types";

/**
 * A logical model can exist on several gateways. We keep one entry in the model
 * picker and try the routes in order: the user's selected route first, then
 * every other provider that serves an equivalent model. If a route runs out of
 * quota (or dies in another way that a different host can fix) the next route
 * answers with the same model, before any token reaches the UI.
 */
export interface ModelRoute {
  provider: Provider;
  model: AIModel;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(free|latest|preview|experimental|beta)\b/g, " ")
    .replace(/[^a-z0-9]/g, "");
}

function basename(modelId: string): string {
  const parts = modelId.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1]! : modelId;
}

/**
 * Keys that describe "the same model" across gateways. Display names catch
 * `gpt-5.4-nano` vs `GPT-5.4 Nano`; the id basename catches vendors that keep
 * the raw id (`openai/gpt-5.4-nano` vs `gpt-5-4-nano`).
 */
export function modelIdentityKeys(model: AIModel): string[] {
  const keys = new Set<string>();
  const fromName = normalizeText(model.displayName);
  if (fromName) keys.add(fromName);
  const fromId = normalizeText(basename(model.modelId));
  if (fromId) keys.add(fromId);
  return [...keys];
}

export function isSameModel(a: AIModel, b: AIModel): boolean {
  const aKeys = modelIdentityKeys(a);
  if (aKeys.length === 0) return false;
  const bKeys = new Set(modelIdentityKeys(b));
  return aKeys.some((key) => bKeys.has(key));
}

function providerRank(provider: Provider): number {
  return provider.favorite ? 0 : 1;
}

function routeRank(route: ModelRoute): number {
  return providerRank(route.provider) * 1000 + route.provider.order * 10 + (route.model.favorite ? 0 : 1);
}

/** Selected route first, then every equivalent model from an enabled provider. */
export function buildModelRoutes(
  selected: AIModel,
  providers: Provider[],
  models: AIModel[],
): ModelRoute[] {
  const providerById = new Map(providers.filter((provider) => provider.enabled).map((provider) => [provider.id, provider]));
  const primaryProvider = providerById.get(selected.providerId);
  const routes: ModelRoute[] = [];
  if (primaryProvider) routes.push({ provider: primaryProvider, model: selected });

  const seen = new Set([`${selected.providerId}|${selected.modelId}`]);
  const alternates: ModelRoute[] = [];
  for (const model of models) {
    if (!model.enabled) continue;
    if (model === selected || model.id === selected.id) continue;
    const provider = providerById.get(model.providerId);
    if (!provider) continue;
    if (!isSameModel(selected, model)) continue;
    const key = `${provider.id}|${model.modelId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    alternates.push({ provider, model });
  }
  alternates.sort((a, b) => routeRank(a) - routeRank(b));
  routes.push(...alternates);
  return routes;
}

/**
 * Route health is a hint, not user data: only fingerprints of
 * provider+model+error are stored. Cooldowns are shared across reloads so a
 * dead gateway is skipped instead of re-probed on every message.
 */
const STORAGE_KEY = "openharness.routeHealth.v1";
const cooldowns = new Map<string, number>();
let lastGood: string | null = null;

function routeId(route: ModelRoute): string {
  const raw = `${route.provider.id}|${route.model.modelId}`;
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function loadCooldowns(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, number>;
    const now = Date.now();
    for (const [id, until] of Object.entries(parsed)) {
      if (typeof until === "number" && until > now) cooldowns.set(id, until);
    }
  } catch {
    // Storage may be blocked; health is only an optimization.
  }
}

function saveCooldowns(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    const now = Date.now();
    const out: Record<string, number> = {};
    for (const [id, until] of cooldowns) {
      if (until > now) out[id] = until;
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(out));
  } catch {
    // Ignore quota/security errors.
  }
}

loadCooldowns();

const COOLDOWN_MS: Partial<Record<ErrorKind, number>> = {
  "rate-limit": 10 * 60_000,
  auth: 30 * 60_000,
  "not-found": 30 * 60_000,
  http: 2 * 60_000,
  server: 60_000,
};

/** Healthy routes first, the previously working route first among them. */
export function orderRoutes(routes: ModelRoute[]): ModelRoute[] {
  const now = Date.now();
  return routes
    .map((route, index) => {
      const id = routeId(route);
      const until = cooldowns.get(id) ?? 0;
      const rank = until <= now ? (id === lastGood ? 0 : 1) : 2 + (until - now) / 1e9;
      return { route, rank, index };
    })
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((item) => item.route);
}

export function markRouteSuccess(route: ModelRoute): void {
  lastGood = routeId(route);
  cooldowns.delete(lastGood);
  saveCooldowns();
}

export function markRouteFailure(route: ModelRoute, kind: ErrorKind): void {
  const ms = COOLDOWN_MS[kind];
  if (!ms) return;
  const id = routeId(route);
  if (lastGood === id) lastGood = null;
  cooldowns.set(id, Date.now() + ms);
  saveCooldowns();
}

/** Errors where a different gateway can plausibly serve the same model. */
export function canRotateRoute(kind: ErrorKind | undefined): boolean {
  return (
    kind === "rate-limit" ||
    kind === "auth" ||
    kind === "http" ||
    kind === "server" ||
    kind === "not-found" ||
    kind === "cors" ||
    kind === "network" ||
    kind === "timeout"
  );
}

/** Cap the total number of network attempts across every route for one turn. */
export const MAX_ROUTE_ATTEMPTS = 12;

export function resetRouteHealth(): void {
  cooldowns.clear();
  lastGood = null;
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
}
