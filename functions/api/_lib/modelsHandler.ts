// Shared server logic modelsHandler; update API callers when changing its contract.
import { sbJson, supabaseConfigured, type SupabaseEnv } from "./supabase";
import { apiHeaders, jsonError, rateLimit, clientIp, rejectedOrigin, type SecurityEnv } from "../security";

export type ModelsEnv = SupabaseEnv & SecurityEnv;

interface CatalogRow {
  id: string;
  display_name: string;
  context_window: number | null;
  capabilities: string[] | null;
  tier: string | null;
  pricing?: string | null;
  upstream_verified: boolean;
  site_paid?: boolean;
  providers: { enabled: boolean } | null;
}

export interface PublicModel {
  id: string;
  displayName: string;
  providerName: "OpenHarneks";
  capabilities: string[];
  contextWindow?: number;
  tier: "free" | "paid" | "unknown";
  pricing: "free" | "paid" | "unknown";
  paid?: boolean;
  billingSource: "site";
  consumesCredits: true;
}

export async function handleModels(request: Request, env: ModelsEnv = {}): Promise<Response> {
  if (request.method === "OPTIONS") {
    if (rejectedOrigin(request, env)) return jsonError(request, env, 403, "Origin not allowed.");
    return new Response(null, { status: 204, headers: apiHeaders(request, env) });
  }
  if (rejectedOrigin(request, env)) return jsonError(request, env, 403, "Origin not allowed.");

  const limit = rateLimit("models", clientIp(request), 120, 60_000);
  if (!limit.ok) {
    return jsonError(request, env, 429, "Too many requests.", "rate_limited", {
      "Retry-After": String(limit.retryAfter),
    });
  }

  let rows: CatalogRow[] = [];
  if (!supabaseConfigured(env)) {
    // The server holds no service-role key, so there is no database to read.
    // Answer with an empty catalog instead of a 500: the site stays usable and
    // `/api/admin/diagnostics` explains what is missing.
    return new Response(JSON.stringify({ data: [], meta: { at: Date.now(), version: 1, configured: false } }), {
      status: 200,
      headers: apiHeaders(request, env, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      }),
    });
  }
  try {
    rows = await sbJson<CatalogRow[]>(
      env,
      "catalog_models?select=id,display_name,context_window,capabilities,tier,pricing,upstream_verified,site_paid,providers!inner(enabled)&enabled=eq.true&upstream_verified=eq.true&providers.enabled=eq.true&order=display_name.asc",
    );
  } catch {
    try {
      rows = await sbJson<CatalogRow[]>(
        env,
        "catalog_models?select=id,display_name,context_window,capabilities,tier,upstream_verified,site_paid,providers!inner(enabled)&enabled=eq.true&upstream_verified=eq.true&providers.enabled=eq.true&order=display_name.asc",
      );
    } catch {
      rows = await sbJson<CatalogRow[]>(
        env,
        "catalog_models?select=id,display_name,context_window,capabilities,tier,upstream_verified,providers!inner(enabled)&enabled=eq.true&upstream_verified=eq.true&providers.enabled=eq.true&order=display_name.asc",
      );
    }
  }

  const data: PublicModel[] = rows.map((row) => {
    const resolvedPricing: "free" | "paid" | "unknown" = row.site_paid
      ? "paid"
      : row.pricing === "free" || row.pricing === "paid" || row.pricing === "unknown"
        ? row.pricing
        : row.tier === "free" || row.tier === "paid"
          ? row.tier
          : "unknown";
    return {
      id: row.id,
      displayName: row.display_name,
      providerName: "OpenHarneks",
      capabilities: Array.isArray(row.capabilities) ? row.capabilities : ["text"],
      ...(row.context_window ? { contextWindow: row.context_window } : {}),
      tier: resolvedPricing,
      pricing: resolvedPricing,
      ...(row.site_paid ? { paid: true } : {}),
      billingSource: "site",
      consumesCredits: true,
    };
  });

  return new Response(JSON.stringify({ data, meta: { at: Date.now(), version: 1 } }), {
    status: 200,
    headers: apiHeaders(request, env, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
    }),
  });
}
