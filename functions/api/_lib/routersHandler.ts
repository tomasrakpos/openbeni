/**
 * Free Model Routers API — Public/User & Admin handlers.
 *
 * Public / User endpoints (mounted at `/api/routers` and `/api/routers/:id`):
 *   GET    /api/routers        List public admin routers + signed-in user's own routers
 *   POST   /api/routers        Create a free router for one of the user's own providers
 *   PATCH  /api/routers/:id    Rename or toggle one of the user's own routers
 *   DELETE /api/routers/:id    Delete one of the user's own routers
 *
 * Admin endpoints (invoked via `adminHandlers.ts` under `/api/admin/routers`):
 *   GET    /api/admin/routers
 *   POST   /api/admin/routers
 *   PATCH  /api/admin/routers/:id
 *   DELETE /api/admin/routers/:id
 *
 * Security invariants:
 * - Never returns API keys, key hashes, or provider base URLs in any response.
 * - Users can only mutate/delete routers where `owner_user_id === user.id`.
 * - Only models explicitly labeled `pricing === 'free'` and `enabled === true`
 *   (and `upstream_verified === true && !site_paid` for admin catalog models)
 *   are admitted to a free router.
 */

import { resolveAuth, type AuthEnv } from "./auth";
import type { ProviderRow } from "./providerKeys";
import { broadcastCatalogChange, eq, sbJson, supabaseConfigured, type SupabaseEnv } from "./supabase";
import type { UserModelRow, UserProviderRow } from "./userProviders";
import { apiHeaders, clientIp, jsonError, rateLimit, readJsonBody, rejectedOrigin } from "../security";
import {
  filterFreeEligibleModels,
  normalizeModelPricing,
  validateRouterName,
  type ModelPricingClass,
} from "../../../src/lib/routerEngine";

export type RoutersEnv = AuthEnv & SupabaseEnv;

export interface RouterRow {
  id: string;
  owner_user_id: string | null;
  provider_id: string | null;
  provider_ids?: string[] | null;
  user_provider_id: string | null;
  user_provider_ids?: string[] | null;
  name: string;
  type: "free";
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface RouterMemberRow {
  id: string;
  router_id: string;
  catalog_model_id: string | null;
  user_model_id: string | null;
  position: number;
  enabled: boolean;
  created_at?: string;
}

interface CatalogModelMinimal {
  id: string;
  provider_id: string;
  upstream_id: string;
  display_name: string;
  context_window: number | null;
  capabilities: string[] | null;
  tier: string | null;
  pricing?: string | null;
  site_paid?: boolean;
  enabled: boolean;
  upstream_verified: boolean;
  providers?: ProviderRow | ProviderRow[] | null;
}

interface UserModelMinimal {
  id: string;
  user_id: string;
  user_provider_id: string;
  upstream_id: string;
  display_name: string;
  context_window: number | null;
  capabilities: string[] | null;
  pricing?: string | null;
  enabled: boolean;
  user_providers?: UserProviderRow | UserProviderRow[] | null;
}

export interface PublicRouterDto {
  id: string;
  ownerScope: "public" | "user";
  providerId: string | null;
  providerIds: string[];
  userProviderId: string | null;
  userProviderIds: string[];
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
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedRouterMember {
  memberId: string;
  modelId: string;
  upstreamId: string;
  displayName: string;
  providerId: string;
  providerName: string;
  billingSource: "site" | "byok";
  providerRow?: ProviderRow;
  userProviderRow?: UserProviderRow;
  capabilities: string[];
  contextWindow?: number;
}

export interface ResolvedRouterTarget {
  router: RouterRow;
  billingSource: "site" | "byok";
  members: ResolvedRouterMember[];
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, max = 200): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function parseProviderIdsInput(body: Json, arrayKey: string, singleKey: string): string[] {
  const fromArray = Array.isArray(body[arrayKey])
    ? (body[arrayKey] as unknown[]).map((v) => str(v, 80))
    : [];
  const fromSingle = str(body[singleKey], 80);
  return uniqueStrings([...fromArray, fromSingle]);
}

function routerAdminProviderIds(row: Pick<RouterRow, "provider_id" | "provider_ids">): string[] {
  return uniqueStrings([...(Array.isArray(row.provider_ids) ? row.provider_ids : []), row.provider_id]);
}

function routerUserProviderIds(row: Pick<RouterRow, "user_provider_id" | "user_provider_ids">): string[] {
  return uniqueStrings([
    ...(Array.isArray(row.user_provider_ids) ? row.user_provider_ids : []),
    row.user_provider_id,
  ]);
}

function inList(ids: readonly string[]): string {
  return `in.(${ids.map((id) => `"${id.replace(/"/g, "")}"`).join(",")})`;
}

function json(request: Request, env: RoutersEnv, data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: apiHeaders(request, env, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
    }),
  });
}

function resolveCatalogPricing(row: CatalogModelMinimal): ModelPricingClass {
  if (row.site_paid) return "paid";
  if (row.pricing === "free" || row.pricing === "paid" || row.pricing === "unknown") {
    return row.pricing;
  }
  return normalizeModelPricing(row.tier);
}

/**
 * Admin free routers remain eligible to route across every verified free model
 * of their enabled provider — even when the admin hides (`enabled = false`)
 * individual models from the public catalog list.
 */
function isCatalogModelFreeEligible(row: CatalogModelMinimal, providerEnabled = true): boolean {
  return (
    providerEnabled &&
    row.upstream_verified === true &&
    !row.site_paid &&
    resolveCatalogPricing(row) === "free"
  );
}

function isUserModelFreeEligible(row: UserModelMinimal, providerEnabled = true): boolean {
  return (
    providerEnabled &&
    row.enabled === true &&
    normalizeModelPricing(row.pricing) === "free"
  );
}

async function fetchPublicRoutersWithCounts(
  env: RoutersEnv,
  includeDisabled = false,
): Promise<PublicRouterDto[]> {
  const filter = includeDisabled
    ? "routers?select=*&owner_user_id=is.null&order=created_at.asc"
    : "routers?select=*&owner_user_id=is.null&enabled=eq.true&order=created_at.asc";

  let routers: RouterRow[] = [];
  try {
    routers = await sbJson<RouterRow[]>(env, filter);
  } catch {
    return [];
  }
  if (routers.length === 0) return [];

  const [members, catalogModels, providers] = await Promise.all([
    sbJson<RouterMemberRow[]>(env, "router_members?select=*&order=position.asc").catch(() => []),
    sbJson<CatalogModelMinimal[]>(
      env,
      "catalog_models?select=id,provider_id,upstream_id,display_name,context_window,capabilities,tier,pricing,site_paid,enabled,upstream_verified",
    ).catch(() =>
      sbJson<CatalogModelMinimal[]>(
        env,
        "catalog_models?select=id,provider_id,upstream_id,display_name,context_window,capabilities,tier,site_paid,enabled,upstream_verified",
      ).catch(() => []),
    ),
    sbJson<Array<{ id: string; name: string; enabled: boolean }>>(
      env,
      "providers?select=id,name,enabled",
    ).catch(() => []),
  ]);

  const modelMap = new Map(catalogModels.map((m) => [m.id, m]));
  const providerMap = new Map(providers.map((p) => [p.id, p]));
  const membersByRouter = new Map<string, RouterMemberRow[]>();
  for (const m of members) {
    const list = membersByRouter.get(m.router_id) ?? [];
    list.push(m);
    membersByRouter.set(m.router_id, list);
  }

  return routers.map((router) => {
    const pIds = routerAdminProviderIds(router);
    const pNames = pIds
      .map((pid) => providerMap.get(pid)?.name)
      .filter((name): name is string => Boolean(name));
    const rawMembers = (membersByRouter.get(router.id) ?? []).filter((m) => m.enabled);
    const activeModels: CatalogModelMinimal[] = [];
    for (const m of rawMembers) {
      if (!m.catalog_model_id) continue;
      const model = modelMap.get(m.catalog_model_id);
      if (!model) continue;
      const modelProvider = providerMap.get(model.provider_id);
      const modelProviderEnabled = modelProvider ? modelProvider.enabled : false;
      if (isCatalogModelFreeEligible(model, modelProviderEnabled)) {
        activeModels.push(model);
      }
    }
    const caps = new Set<string>(["text"]);
    for (const m of activeModels) {
      for (const c of m.capabilities ?? []) caps.add(c);
    }
    return {
      id: router.id,
      ownerScope: "public",
      providerId: includeDisabled ? (pIds[0] ?? null) : null,
      providerIds: includeDisabled ? pIds : [],
      userProviderId: null,
      userProviderIds: [],
      providerName: includeDisabled ? (pNames.join(" + ") || undefined) : "OpenHarneks",
      providerNames: includeDisabled ? pNames : [],
      name: router.name,
      type: router.type,
      enabled: router.enabled,
      activeMemberCount: activeModels.length,
      memberModelIds: includeDisabled ? activeModels.map((m) => m.id) : [],
      capabilities: [...caps],
      billingSource: "site",
      consumesCredits: true,
      createdAt: router.created_at,
      updatedAt: router.updated_at,
    };
  });
}

async function fetchUserRoutersWithCounts(
  env: RoutersEnv,
  userId: string,
): Promise<PublicRouterDto[]> {
  let routers: RouterRow[] = [];
  try {
    routers = await sbJson<RouterRow[]>(
      env,
      `routers?select=*&owner_user_id=${eq(userId)}&order=created_at.asc`,
    );
  } catch {
    return [];
  }
  if (routers.length === 0) return [];

  const [members, userModels, userProviders] = await Promise.all([
    sbJson<RouterMemberRow[]>(env, "router_members?select=*&order=position.asc").catch(() => []),
    sbJson<UserModelMinimal[]>(
      env,
      `user_models?select=id,user_id,user_provider_id,upstream_id,display_name,context_window,capabilities,pricing,enabled&user_id=${eq(userId)}`,
    ).catch(() => []),
    sbJson<Array<{ id: string; name: string; enabled: boolean }>>(
      env,
      `user_providers?select=id,name,enabled&user_id=${eq(userId)}`,
    ).catch(() => []),
  ]);

  const modelMap = new Map(userModels.map((m) => [m.id, m]));
  const providerMap = new Map(userProviders.map((p) => [p.id, p]));
  const membersByRouter = new Map<string, RouterMemberRow[]>();
  for (const m of members) {
    const list = membersByRouter.get(m.router_id) ?? [];
    list.push(m);
    membersByRouter.set(m.router_id, list);
  }

  return routers.map((router) => {
    const upIds = routerUserProviderIds(router);
    const upNames = upIds
      .map((pid) => providerMap.get(pid)?.name)
      .filter((name): name is string => Boolean(name));
    const rawMembers = (membersByRouter.get(router.id) ?? []).filter((m) => m.enabled);
    const activeModels: UserModelMinimal[] = [];
    for (const m of rawMembers) {
      if (!m.user_model_id) continue;
      const model = modelMap.get(m.user_model_id);
      if (!model) continue;
      const modelProvider = providerMap.get(model.user_provider_id);
      const modelProviderEnabled = modelProvider ? modelProvider.enabled : false;
      if (isUserModelFreeEligible(model, modelProviderEnabled)) {
        activeModels.push(model);
      }
    }
    const caps = new Set<string>(["text"]);
    for (const m of activeModels) {
      for (const c of m.capabilities ?? []) caps.add(c);
    }
    return {
      id: router.id,
      ownerScope: "user",
      providerId: null,
      providerIds: [],
      userProviderId: upIds[0] ?? null,
      userProviderIds: upIds,
      providerName: upNames.join(" + ") || undefined,
      providerNames: upNames,
      name: router.name,
      type: router.type,
      enabled: router.enabled,
      activeMemberCount: activeModels.length,
      memberModelIds: activeModels.map((m) => m.id),
      capabilities: [...caps],
      billingSource: "byok",
      consumesCredits: false,
      createdAt: router.created_at,
      updatedAt: router.updated_at,
    };
  });
}

/**
 * Synchronizes every free router that includes `providerId` (single- or
 * multi-provider) so verified free models across ALL attached providers stay
 * active in `router_members` (even when hidden from the public catalog), while
 * paid/unverified/deleted models are removed.
 */
export async function syncAdminProviderRouters(env: RoutersEnv, providerId: string): Promise<void> {
  if (!supabaseConfigured(env)) return;
  try {
    const allAdminRouters = await sbJson<RouterRow[]>(
      env,
      "routers?select=*&owner_user_id=is.null&type=eq.free",
    );
    const routers = allAdminRouters.filter((r) => routerAdminProviderIds(r).includes(providerId));
    if (routers.length === 0) return;

    const neededProviderIds = uniqueStrings(routers.flatMap((r) => routerAdminProviderIds(r)));
    const allModels = await sbJson<CatalogModelMinimal[]>(
      env,
      `catalog_models?select=id,provider_id,upstream_id,display_name,context_window,capabilities,tier,pricing,site_paid,enabled,upstream_verified&provider_id=${inList(neededProviderIds)}&order=display_name.asc`,
    ).catch(() => []);

    for (const router of routers) {
      const pIdSet = new Set(routerAdminProviderIds(router));
      const routerModels = allModels.filter((m) => pIdSet.has(m.provider_id));
      const eligible = filterFreeEligibleModels(
        routerModels.map((m, idx) => ({
          id: m.id,
          modelId: m.upstream_id,
          displayName: m.display_name,
          pricing: resolveCatalogPricing(m),
          enabled: m.upstream_verified,
          locked: Boolean(m.site_paid),
          position: idx,
        })),
      );
      const eligibleIds = new Set(eligible.map((m) => m.id));

      const existing = await sbJson<RouterMemberRow[]>(
        env,
        `router_members?select=*&router_id=${eq(router.id)}&order=position.asc`,
      ).catch(() => []);

      for (const member of existing) {
        if (!member.catalog_model_id || !eligibleIds.has(member.catalog_model_id)) {
          await sbJson(env, `router_members?id=${eq(member.id)}`, {
            method: "DELETE",
            headers: { Prefer: "return=minimal" },
          }).catch(() => {});
        }
      }

      const existingModelIds = new Set(existing.map((m) => m.catalog_model_id).filter(Boolean));
      let nextPos = existing.reduce((max, m) => Math.max(max, m.position), -1) + 1;
      const toInsert = eligible
        .filter((m) => !existingModelIds.has(m.id))
        .map((m) => ({
          router_id: router.id,
          catalog_model_id: m.id,
          position: nextPos++,
          enabled: true,
        }));
      if (toInsert.length > 0) {
        await sbJson(env, "router_members", {
          method: "POST",
          headers: { Prefer: "return=minimal,resolution=merge-duplicates" },
          body: JSON.stringify(toInsert),
        }).catch(() => {});
      }
    }
  } catch {
    // Migration may not be applied yet; ignore cleanly.
  }
}

/* -------------------------------------------------------------------------- */
/* Admin Router Handlers                                                      */
/* -------------------------------------------------------------------------- */

export async function listAdminRouters(request: Request, env: RoutersEnv): Promise<Response> {
  const routers = await fetchPublicRoutersWithCounts(env, true);
  return json(request, env, { routers });
}

export async function createAdminRouter(request: Request, env: RoutersEnv): Promise<Response> {
  const parsed = await readJsonBody(request);
  if (!parsed.ok || !isObject(parsed.value)) {
    return jsonError(request, env, 400, "Invalid request body.");
  }
  const providerIds = parseProviderIdsInput(parsed.value, "providerIds", "providerId");
  const rawName = str(parsed.value.name, 80);
  if (providerIds.length === 0) return jsonError(request, env, 400, "At least one provider is required.");

  const [existingRouters, allCatalogModels, providerModels] = await Promise.all([
    sbJson<RouterRow[]>(env, "routers?select=id,name&owner_user_id=is.null").catch(() => []),
    sbJson<Array<{ upstream_id: string; display_name: string }>>(
      env,
      "catalog_models?select=upstream_id,display_name&limit=2000",
    ).catch(() => []),
    sbJson<CatalogModelMinimal[]>(
      env,
      `catalog_models?select=id,provider_id,upstream_id,display_name,context_window,capabilities,tier,pricing,site_paid,enabled,upstream_verified&provider_id=${inList(providerIds)}&order=display_name.asc`,
    ).catch(() => []),
  ]);

  const modelNames: string[] = [];
  for (const m of allCatalogModels) {
    if (m.upstream_id) modelNames.push(m.upstream_id);
    if (m.display_name) modelNames.push(m.display_name);
  }

  const check = validateRouterName(rawName, {
    existingRouterNames: existingRouters.map((r) => r.name),
    existingModelNames: modelNames,
  });
  if (!check.ok) {
    return jsonError(request, env, 400, check.message ?? "Invalid router name.", check.code);
  }

  const eligible = filterFreeEligibleModels(
    providerModels.map((m, idx) => ({
      id: m.id,
      modelId: m.upstream_id,
      displayName: m.display_name,
      pricing: resolveCatalogPricing(m),
      enabled: m.upstream_verified,
      locked: Boolean(m.site_paid),
      position: idx,
    })),
  );
  if (eligible.length === 0) {
    return jsonError(
      request,
      env,
      400,
      "The selected provider(s) have no verified free models available for a free router.",
      "no_free_models",
    );
  }

  let createdRows: RouterRow[];
  try {
    createdRows = await sbJson<RouterRow[]>(env, "routers", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify([
        {
          owner_user_id: null,
          provider_id: providerIds[0],
          provider_ids: providerIds,
          user_provider_id: null,
          name: check.normalized,
          type: "free",
          enabled: true,
        },
      ]),
    });
  } catch (err) {
    // Graceful fallback if DB hasn't applied 0008_multi_provider_routers.sql yet
    // (router_members still links all eligible models across every selected provider).
    createdRows = await sbJson<RouterRow[]>(env, "routers", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify([
        {
          owner_user_id: null,
          provider_id: providerIds[0],
          user_provider_id: null,
          name: check.normalized,
          type: "free",
          enabled: true,
        },
      ]),
    }).catch(() => {
      throw err;
    });
  }
  const created = createdRows[0];
  if (!created) return jsonError(request, env, 500, "Could not create router.");

  await sbJson(env, "router_members", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(
      eligible.map((m, idx) => ({
        router_id: created.id,
        catalog_model_id: m.id,
        position: idx,
        enabled: true,
      })),
    ),
  });

  await broadcastCatalogChange(env);
  const all = await fetchPublicRoutersWithCounts(env, true);
  const router = all.find((r) => r.id === created.id) ?? null;
  return json(request, env, { router }, 201);
}

export async function updateAdminRouter(
  request: Request,
  env: RoutersEnv,
  routerId: string,
): Promise<Response> {
  const parsed = await readJsonBody(request);
  if (!parsed.ok || !isObject(parsed.value)) {
    return jsonError(request, env, 400, "Invalid request body.");
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof parsed.value.name === "string") {
    const [existingRouters, allCatalogModels] = await Promise.all([
      sbJson<RouterRow[]>(env, "routers?select=id,name&owner_user_id=is.null").catch(() => []),
      sbJson<Array<{ upstream_id: string; display_name: string }>>(
        env,
        "catalog_models?select=upstream_id,display_name&limit=2000",
      ).catch(() => []),
    ]);
    const check = validateRouterName(parsed.value.name, {
      existingRouterNames: existingRouters.filter((r) => r.id !== routerId).map((r) => r.name),
      existingModelNames: allCatalogModels.flatMap((m) => [m.upstream_id, m.display_name]),
    });
    if (!check.ok) {
      return jsonError(request, env, 400, check.message ?? "Invalid router name.", check.code);
    }
    patch.name = check.normalized;
  }
  if (typeof parsed.value.enabled === "boolean") {
    patch.enabled = parsed.value.enabled;
  }

  const rows = await sbJson<RouterRow[]>(
    env,
    `routers?id=${eq(routerId)}&owner_user_id=is.null`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(patch),
    },
  );
  if (!rows[0]) return jsonError(request, env, 404, "Router not found.");
  await broadcastCatalogChange(env);
  const all = await fetchPublicRoutersWithCounts(env, true);
  return json(request, env, { router: all.find((r) => r.id === routerId) ?? null });
}

export async function deleteAdminRouter(
  request: Request,
  env: RoutersEnv,
  routerId: string,
): Promise<Response> {
  await sbJson(env, `routers?id=${eq(routerId)}&owner_user_id=is.null`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  await broadcastCatalogChange(env);
  return json(request, env, { deleted: true });
}

/* -------------------------------------------------------------------------- */
/* Public & User Router Endpoint (`/api/routers` & `/api/routers/:id`)        */
/* -------------------------------------------------------------------------- */

export async function handleRouters(request: Request, env: RoutersEnv = {}): Promise<Response> {
  if (request.method === "OPTIONS") {
    if (rejectedOrigin(request, env)) return jsonError(request, env, 403, "Origin not allowed.");
    return new Response(null, { status: 204, headers: apiHeaders(request, env) });
  }
  if (rejectedOrigin(request, env)) return jsonError(request, env, 403, "Origin not allowed.");

  const limit = rateLimit("routers", clientIp(request), 120, 60_000);
  if (!limit.ok) {
    return jsonError(request, env, 429, "Too many requests.", "rate_limited", {
      "Retry-After": String(limit.retryAfter),
    });
  }

  const url = new URL(request.url);
  const parts = url.pathname
    .replace(/^\/api\/routers\/?/, "")
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean);
  const routerId = parts[0];
  const method = request.method;

  if (!supabaseConfigured(env)) {
    if (method === "GET" && !routerId) {
      return json(request, env, { routers: [] });
    }
    return jsonError(request, env, 503, "Routers require server database configuration.");
  }

  const auth = await resolveAuth(request, env);

  // GET /api/routers -> public routers + authenticated user's own routers
  if (method === "GET" && !routerId) {
    const [publicRouters, userRouters] = await Promise.all([
      fetchPublicRoutersWithCounts(env, false),
      auth?.profile?.id
        ? fetchUserRoutersWithCounts(env, auth.profile.id)
        : Promise.resolve([] as PublicRouterDto[]),
    ]);
    return json(request, env, { routers: [...publicRouters, ...userRouters] });
  }

  // Mutations require a signed-in user and strictly affect owner_user_id === user.id
  if (!auth?.profile?.id) {
    return jsonError(request, env, 401, "Sign in to manage personal routers.", "auth_required");
  }
  const userId = auth.profile.id;

  // POST /api/routers -> create a user free router (single or multi-provider)
  if (method === "POST" && !routerId) {
    const parsed = await readJsonBody(request);
    if (!parsed.ok || !isObject(parsed.value)) {
      return jsonError(request, env, 400, "Invalid request body.");
    }
    const userProviderIds = parseProviderIdsInput(parsed.value, "userProviderIds", "userProviderId");
    const rawName = str(parsed.value.name, 80);
    if (userProviderIds.length === 0) {
      return jsonError(request, env, 400, "At least one provider is required.");
    }

    // Verify ownership of every selected userProviderId
    const providers = await sbJson<UserProviderRow[]>(
      env,
      `user_providers?select=id,name,enabled&id=${inList(userProviderIds)}&user_id=${eq(userId)}`,
    );
    const ownedSet = new Set(providers.map((p) => p.id));
    const validProviderIds = userProviderIds.filter((pid) => ownedSet.has(pid));
    if (validProviderIds.length === 0) {
      return jsonError(request, env, 404, "Provider not found.");
    }

    const [existingUserRouters, publicRouters, userModels, catalogModels] = await Promise.all([
      sbJson<RouterRow[]>(env, `routers?select=id,name&owner_user_id=${eq(userId)}`).catch(() => []),
      sbJson<RouterRow[]>(env, "routers?select=id,name&owner_user_id=is.null").catch(() => []),
      sbJson<UserModelMinimal[]>(
        env,
        `user_models?select=id,user_id,user_provider_id,upstream_id,display_name,context_window,capabilities,pricing,enabled&user_id=${eq(userId)}`,
      ).catch(() => []),
      sbJson<Array<{ upstream_id: string; display_name: string }>>(
        env,
        "catalog_models?select=upstream_id,display_name&enabled=eq.true&limit=2000",
      ).catch(() => []),
    ]);

    const modelNames: string[] = [];
    for (const m of userModels) {
      modelNames.push(m.upstream_id, m.display_name);
    }
    for (const m of catalogModels) {
      modelNames.push(m.upstream_id, m.display_name);
    }

    const check = validateRouterName(rawName, {
      existingRouterNames: [
        ...existingUserRouters.map((r) => r.name),
        ...publicRouters.map((r) => r.name),
      ],
      existingModelNames: modelNames,
    });
    if (!check.ok) {
      return jsonError(request, env, 400, check.message ?? "Invalid router name.", check.code);
    }

    const validSet = new Set(validProviderIds);
    const providerModels = userModels.filter((m) => validSet.has(m.user_provider_id));
    const eligible = filterFreeEligibleModels(
      providerModels.map((m, idx) => ({
        id: m.id,
        modelId: m.upstream_id,
        displayName: m.display_name,
        pricing: normalizeModelPricing(m.pricing),
        enabled: m.enabled,
        position: idx,
      })),
    );
    if (eligible.length === 0) {
      return jsonError(
        request,
        env,
        400,
        "The selected provider(s) have no verified free models available for a free router.",
        "no_free_models",
      );
    }

    let createdRows: RouterRow[];
    try {
      createdRows = await sbJson<RouterRow[]>(env, "routers", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify([
          {
            owner_user_id: userId,
            provider_id: null,
            user_provider_id: validProviderIds[0],
            user_provider_ids: validProviderIds,
            name: check.normalized,
            type: "free",
            enabled: true,
          },
        ]),
      });
    } catch (err) {
      createdRows = await sbJson<RouterRow[]>(env, "routers", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify([
          {
            owner_user_id: userId,
            provider_id: null,
            user_provider_id: validProviderIds[0],
            name: check.normalized,
            type: "free",
            enabled: true,
          },
        ]),
      }).catch(() => {
        throw err;
      });
    }
    const created = createdRows[0];
    if (!created) return jsonError(request, env, 500, "Could not create router.");

    await sbJson(env, "router_members", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(
        eligible.map((m, idx) => ({
          router_id: created.id,
          user_model_id: m.id,
          position: idx,
          enabled: true,
        })),
      ),
    });

    const userRouters = await fetchUserRoutersWithCounts(env, userId);
    return json(request, env, { router: userRouters.find((r) => r.id === created.id) ?? null }, 201);
  }

  // PATCH /api/routers/:id -> strictly own router
  if (method === "PATCH" && routerId) {
    const existing = await sbJson<RouterRow[]>(
      env,
      `routers?select=*&id=${eq(routerId)}&owner_user_id=${eq(userId)}&limit=1`,
    );
    if (!existing[0]) return jsonError(request, env, 404, "Router not found.");

    const parsed = await readJsonBody(request);
    if (!parsed.ok || !isObject(parsed.value)) {
      return jsonError(request, env, 400, "Invalid request body.");
    }
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof parsed.value.name === "string") {
      const [existingUserRouters, publicRouters, userModels, catalogModels] = await Promise.all([
        sbJson<RouterRow[]>(env, `routers?select=id,name&owner_user_id=${eq(userId)}`).catch(() => []),
        sbJson<RouterRow[]>(env, "routers?select=id,name&owner_user_id=is.null").catch(() => []),
        sbJson<UserModelRow[]>(
          env,
          `user_models?select=upstream_id,display_name&user_id=${eq(userId)}`,
        ).catch(() => []),
        sbJson<Array<{ upstream_id: string; display_name: string }>>(
          env,
          "catalog_models?select=upstream_id,display_name&enabled=eq.true&limit=2000",
        ).catch(() => []),
      ]);
      const check = validateRouterName(parsed.value.name, {
        existingRouterNames: [
          ...existingUserRouters.filter((r) => r.id !== routerId).map((r) => r.name),
          ...publicRouters.map((r) => r.name),
        ],
        existingModelNames: [
          ...userModels.flatMap((m) => [m.upstream_id, m.display_name]),
          ...catalogModels.flatMap((m) => [m.upstream_id, m.display_name]),
        ],
      });
      if (!check.ok) {
        return jsonError(request, env, 400, check.message ?? "Invalid router name.", check.code);
      }
      patch.name = check.normalized;
    }
    if (typeof parsed.value.enabled === "boolean") {
      patch.enabled = parsed.value.enabled;
    }

    await sbJson(env, `routers?id=${eq(routerId)}&owner_user_id=${eq(userId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(patch),
    });
    const userRouters = await fetchUserRoutersWithCounts(env, userId);
    return json(request, env, { router: userRouters.find((r) => r.id === routerId) ?? null });
  }

  // DELETE /api/routers/:id -> strictly own router
  if (method === "DELETE" && routerId) {
    const existing = await sbJson<RouterRow[]>(
      env,
      `routers?select=id&id=${eq(routerId)}&owner_user_id=${eq(userId)}&limit=1`,
    );
    if (!existing[0]) return jsonError(request, env, 404, "Router not found.");
    await sbJson(env, `routers?id=${eq(routerId)}&owner_user_id=${eq(userId)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    return json(request, env, { deleted: true });
  }

  return jsonError(request, env, 405, "Method not allowed.");
}

/* -------------------------------------------------------------------------- */
/* Server-side Router Resolution for `/api/chat`                              */
/* -------------------------------------------------------------------------- */

export async function resolveRouterForChat(
  env: RoutersEnv,
  routerId: string,
  userId: string | null,
): Promise<ResolvedRouterTarget | null> {
  if (!supabaseConfigured(env)) return null;
  let routers: RouterRow[] = [];
  try {
    routers = await sbJson<RouterRow[]>(env, `routers?select=*&id=${eq(routerId)}&limit=1`);
  } catch {
    return null;
  }
  const router = routers[0];
  if (!router || !router.enabled) return null;

  // Ownership check: public admin router (owner_user_id === null) is usable by anyone;
  // private user router is strictly usable only by its owner.
  if (router.owner_user_id !== null && router.owner_user_id !== userId) {
    return null;
  }

  const rawMembers = await sbJson<RouterMemberRow[]>(
    env,
    `router_members?select=*&router_id=${eq(router.id)}&enabled=eq.true&order=position.asc`,
  ).catch(() => []);
  if (rawMembers.length === 0) {
    return {
      router,
      billingSource: router.owner_user_id === null ? "site" : "byok",
      members: [],
    };
  }

  if (router.owner_user_id === null) {
    // Admin public router -> resolve catalog_models + provider rows across all attached providers
    const catalogIds = rawMembers
      .map((m) => m.catalog_model_id)
      .filter((id): id is string => Boolean(id));
    if (catalogIds.length === 0) {
      return { router, billingSource: "site", members: [] };
    }
    const pIds = routerAdminProviderIds(router);
    const modelsQuery =
      pIds.length > 0 && catalogIds.length > 80
        ? `catalog_models?select=*,providers(*)&provider_id=${inList(pIds)}`
        : `catalog_models?select=*,providers(*)&id=${inList(catalogIds)}`;
    const models = await sbJson<CatalogModelMinimal[]>(env, modelsQuery).catch(() => []);
    const byId = new Map(models.map((m) => [m.id, m]));
    const resolved: ResolvedRouterMember[] = [];
    for (const member of rawMembers) {
      if (!member.catalog_model_id) continue;
      const model = byId.get(member.catalog_model_id);
      if (!model) continue;
      const provider = one(model.providers);
      if (!provider || !isCatalogModelFreeEligible(model, provider.enabled)) continue;
      resolved.push({
        memberId: member.id,
        modelId: model.id,
        upstreamId: model.upstream_id,
        displayName: model.display_name,
        providerId: provider.id,
        providerName: provider.name,
        billingSource: "site",
        providerRow: provider,
        capabilities: Array.isArray(model.capabilities) ? model.capabilities : ["text"],
        ...(model.context_window ? { contextWindow: model.context_window } : {}),
      });
    }
    return { router, billingSource: "site", members: resolved };
  }

  // User personal router -> resolve user_models + user_providers across all attached providers
  const userModelIds = rawMembers
    .map((m) => m.user_model_id)
    .filter((id): id is string => Boolean(id));
  if (userModelIds.length === 0) {
    return { router, billingSource: "byok", members: [] };
  }
  const upIds = routerUserProviderIds(router);
  const userModelsQuery =
    upIds.length > 0 && userModelIds.length > 80
      ? `user_models?select=*,user_providers(*)&user_id=${eq(router.owner_user_id)}&user_provider_id=${inList(upIds)}`
      : `user_models?select=*,user_providers(*)&user_id=${eq(router.owner_user_id)}&id=${inList(userModelIds)}`;
  const models = await sbJson<UserModelMinimal[]>(env, userModelsQuery).catch(() => []);
  const byId = new Map(models.map((m) => [m.id, m]));
  const resolved: ResolvedRouterMember[] = [];
  for (const member of rawMembers) {
    if (!member.user_model_id) continue;
    const model = byId.get(member.user_model_id);
    if (!model) continue;
    const provider = one(model.user_providers);
    if (!provider || !isUserModelFreeEligible(model, provider.enabled)) continue;
    resolved.push({
      memberId: member.id,
      modelId: model.id,
      upstreamId: model.upstream_id,
      displayName: model.display_name,
      providerId: provider.id,
      providerName: provider.name,
      billingSource: "byok",
      userProviderRow: provider,
      capabilities: Array.isArray(model.capabilities) ? model.capabilities : ["text"],
      ...(model.context_window ? { contextWindow: model.context_window } : {}),
    });
  }
  return { router, billingSource: "byok", members: resolved };
}
