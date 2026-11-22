// Client helper for POST /api/provider-inspect — shared by ProviderWizard and AdminPage.
import type { ApiFormat } from "@/lib/types";

export type ModelTier = "free" | "paid" | "unknown";

export type KeyHealthStatus =
  | "healthy"
  | "free_only"
  | "rate_limited"
  | "invalid_key"
  | "insufficient_balance"
  | "forbidden"
  | "unreachable"
  | "model_error"
  | "no_key";

export interface KeyHealthReport {
  status: KeyHealthStatus;
  ok: boolean;
  httpStatus?: number;
  latencyMs: number | null;
  testedModel?: string;
  freeModelsUsable?: boolean;
  message: string;
}

export interface InspectedModelInfo {
  id: string;
  displayName: string;
  contextWindow?: number;
  capabilities: string[];
  tier: ModelTier;
  tierSource: string;
  pricingClass?: ModelTier;
  pricing?: {
    prompt: number;
    completion: number;
  };
}

export interface ProviderInspectSummary {
  totalModels: number;
  freeCount: number;
  paidCount: number;
  unknownCount: number;
  modelsLatencyMs: number | null;
  chatLatencyMs: number | null;
}

export interface ProviderInspectReport {
  ok: boolean;
  format: ApiFormat | null;
  baseUrl: string;
  keyHealth: KeyHealthReport;
  summary: ProviderInspectSummary;
  models: InspectedModelInfo[];
  error?: string;
}

export async function inspectProviderEndpoint(input: {
  baseUrl: string;
  apiKey: string;
  format?: ApiFormat | "auto";
  authHeader?: string;
  authPrefix?: string;
  extraHeaders?: Record<string, string>;
  verifyKeyLive?: boolean;
  signal?: AbortSignal;
}): Promise<ProviderInspectReport | null> {
  try {
    const response = await fetch("/api/provider-inspect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        format: input.format ?? "auto",
        authHeader: input.authHeader,
        authPrefix: input.authPrefix,
        extraHeaders: input.extraHeaders,
        verifyKeyLive: input.verifyKeyLive !== false,
      }),
      signal: input.signal,
      cache: "no-store",
    });
    const text = await response.text();
    if (!text) return null;
    const data = JSON.parse(text) as Partial<ProviderInspectReport> & { error?: string };
    if (!data || typeof data !== "object") return null;
    if (!data.keyHealth || !data.summary || !Array.isArray(data.models)) {
      if (!response.ok) {
        return {
          ok: false,
          format: null,
          baseUrl: input.baseUrl,
          keyHealth: {
            status: response.status === 401 ? "invalid_key" : response.status === 403 ? "forbidden" : "unreachable",
            ok: false,
            httpStatus: response.status,
            latencyMs: null,
            message: data.error || `Request failed (${response.status}).`,
          },
          summary: {
            totalModels: 0,
            freeCount: 0,
            paidCount: 0,
            unknownCount: 0,
            modelsLatencyMs: null,
            chatLatencyMs: null,
          },
          models: [],
          error: data.error || `Request failed (${response.status}).`,
        };
      }
      return null;
    }
    return data as ProviderInspectReport;
  } catch {
    return null;
  }
}

export function keyHealthTone(status: KeyHealthStatus): "ok" | "warn" | "bad" {
  if (status === "healthy") return "ok";
  if (status === "free_only" || status === "rate_limited") return "warn";
  return "bad";
}
