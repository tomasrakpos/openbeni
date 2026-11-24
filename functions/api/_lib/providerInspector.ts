/**
 * Smart Provider, API-Key Health & Free/Paid Model Diagnostic Engine.
 *
 * Shared across:
 * - User ProviderWizard (`POST /api/provider-inspect`)
 * - Production Admin Panel (`functions/api/_lib/adminHandlers.ts`)
 *
 * Pipeline:
 * 1. Format detection + `/models` discovery (captures pricing metadata, context
 *    windows, display names, and capabilities across OpenAI/Anthropic/Gemini).
 * 2. Live 1-token chat completion verification probe (`max_tokens: 1`) so an
 *    invalid, expired, or zero-balance key is NEVER falsely marked healthy just
 *    because a gateway's public `/models` list returned HTTP 200.
 * 3. Multi-signal Free vs Paid classifier per model + exact summary counts
 *    (`freeCount`, `paidCount`, `unknownCount`, `totalModels`).
 */
import type { ApiFormat, ProviderRow } from "./providerKeys";
import { authHeadersFor, buildUpstreamRequest } from "./upstream";
import { isPrivateHost, normalizeProviderBaseUrl, safeFetch, validateProviderBaseUrl } from "./urlGuard";

export type KeyHealthStatus =
  | "healthy"
  | "free_only"
  | "invalid_key"
  | "insufficient_balance"
  | "forbidden"
  | "rate_limited"
  | "unreachable"
  | "model_error"
  | "no_key";

export type ModelTier = "free" | "paid" | "unknown";

export type TierSource =
  | "pricing_metadata"
  | "live_probe"
  | "model_tag"
  | "provider_policy"
  | "curated_registry"
  | "unknown";

export interface InspectedModel {
  id: string;
  displayName: string;
  contextWindow?: number;
  capabilities: string[];
  tier: ModelTier;
  tierSource: TierSource;
  /** Explicit pricing classification ('free' | 'paid' | 'unknown'); never guessed. */
  pricingClass?: ModelTier;
  pricing?: {
    prompt: number;
    completion: number;
  };
}

export interface KeyProbeResult {
  status: KeyHealthStatus;
  ok: boolean;
  httpStatus?: number;
  latencyMs: number | null;
  testedModel?: string;
  /** True when the key has 0 balance for paid models, yet free models on this provider still answer. */
  freeModelsUsable?: boolean;
  message: string;
}

export interface ProviderInspectSummary {
  totalModels: number;
  freeCount: number;
  paidCount: number;
  unknownCount: number;
  modelsLatencyMs: number | null;
  chatLatencyMs: number | null;
}

export interface ProviderInspectResult {
  ok: boolean;
  format: ApiFormat;
  baseUrl: string;
  keyHealth: KeyProbeResult;
  summary: ProviderInspectSummary;
  models: InspectedModel[];
  error?: string;
}

export interface InspectProviderOptions {
  baseUrl: string;
  apiKey: string;
  format?: ApiFormat | "auto";
  authHeader?: string;
  authPrefix?: string;
  extraHeaders?: Record<string, string>;
  /** Set false to skip the live 1-token chat probe (not recommended except unit tests). */
  verifyKeyLive?: boolean;
  /** Maximum models to return (default 500). */
  maxModels?: number;
}

const PROBE_TIMEOUT_MS = 7_000;
const MODELS_TIMEOUT_MS = 10_000;

const PAID_ONLY_HOSTS = new Set([
  "api.openai.com",
  "api.anthropic.com",
  "api.x.ai",
  "api.deepseek.com",
  "api.cohere.ai",
  "api.cohere.com",
  "api.perplexity.ai",
  "api.moonshot.cn",
  "api.moonshot.ai",
  "api.minimax.chat",
  "api.z.ai",
]);

const FREE_TIER_HOSTS = new Set([
  "api.groq.com",
  "api.cerebras.ai",
  "models.inference.ai.azure.com",
  "models.github.ai",
  "api.sambanova.ai",
  "gen.pollinations.ai",
]);

const COMMERCIAL_PAID_PATTERNS: RegExp[] = [
  /^(gpt-4|gpt-5|o1|o3|o4|chatgpt-)/i,
  /^claude-(3|4|sonnet|opus|haiku)/i,
  /^grok-/i,
  /^deepseek-(chat|reasoner|v3|r1)$/i,
  /^sonar(-pro|-reasoning)?/i,
  /^(mistral-large|codestral|pixtral-large)/i,
  /^(command-r-plus|command-a)/i,
  /^(qwen-max|qwen-plus|qwen3-max)/i,
  /^gemini-.*-(ultra|pro-exp-paid)/i,
];

const GEMINI_FREE_TIER_PATTERN =
  /^(gemini-(1\.5|2\.0|2\.5|3\.0)?-?(flash|flash-lite|pro-exp|exp)|gemma-)/i;

const VISION_RE = /(gpt-4o|gpt-4\.1|gpt-5|claude|gemini|llava|vision|qwen[\d.]*-?vl|gemma-?3|pixtral|internvl|grok-.*vision|o3|o4)/i;
const REASONING_RE = /(^|[-_.])(o1|o3|o4)([-_.]|$)|reason|thinking|qwq|r1|deepseek-r/i;
const TOOLS_RE = /(gpt|claude|gemini|qwen|llama-?3|llama-?4|mistral|mixtral|deepseek|grok|command|phi-?4|glm|kimi|minimax)/i;
const AUDIO_RE = /(audio|realtime|speech|whisper|tts)/i;

function inferCapabilities(modelId: string): string[] {
  const caps = new Set<string>(["text"]);
  if (VISION_RE.test(modelId)) caps.add("vision");
  if (REASONING_RE.test(modelId)) caps.add("reasoning");
  if (TOOLS_RE.test(modelId)) caps.add("tools");
  if (AUDIO_RE.test(modelId)) caps.add("audio");
  return [...caps];
}

function defaultAuthFor(format: ApiFormat): { auth_header: string; auth_prefix: string } {
  if (format === "anthropic") return { auth_header: "x-api-key", auth_prefix: "" };
  if (format === "gemini") return { auth_header: "x-goog-api-key", auth_prefix: "" };
  return { auth_header: "Authorization", auth_prefix: "Bearer " };
}

function parseNumericPrice(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/^\$/, "");
    if (!cleaned) return null;
    const n = Number(cleaned);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

interface RawUpstreamModel {
  id: string;
  displayName: string;
  contextWindow?: number;
  pricing?: { prompt: number; completion: number };
  explicitFreeFlag?: boolean;
  explicitPaidFlag?: boolean;
}

function extractPricingFromRow(row: Record<string, unknown>): {
  pricing?: { prompt: number; completion: number };
  explicitFreeFlag?: boolean;
  explicitPaidFlag?: boolean;
} {
  if (row.is_free === true || row.free === true || row.free_tier === true) {
    return { explicitFreeFlag: true, pricing: { prompt: 0, completion: 0 } };
  }
  if (typeof row.tier === "string") {
    const t = row.tier.toLowerCase().trim();
    if (t === "free") return { explicitFreeFlag: true };
    if (t === "paid" || t === "pro" || t === "enterprise") return { explicitPaidFlag: true };
  }

  const pricingObj =
    (row.pricing && typeof row.pricing === "object" ? (row.pricing as Record<string, unknown>) : null) ??
    (row.price && typeof row.price === "object" ? (row.price as Record<string, unknown>) : null) ??
    (row.cost && typeof row.cost === "object" ? (row.cost as Record<string, unknown>) : null);

  if (pricingObj) {
    const prompt =
      parseNumericPrice(pricingObj.prompt) ??
      parseNumericPrice(pricingObj.input) ??
      parseNumericPrice(pricingObj.prompt_tokens) ??
      parseNumericPrice(pricingObj.input_cost_per_token);
    const completion =
      parseNumericPrice(pricingObj.completion) ??
      parseNumericPrice(pricingObj.output) ??
      parseNumericPrice(pricingObj.completion_tokens) ??
      parseNumericPrice(pricingObj.output_cost_per_token);
    if (prompt !== null || completion !== null) {
      return {
        pricing: {
          prompt: prompt ?? 0,
          completion: completion ?? prompt ?? 0,
        },
      };
    }
  }

  const scalarPrice = parseNumericPrice(row.price);
  if (scalarPrice !== null) {
    return { pricing: { prompt: scalarPrice, completion: scalarPrice } };
  }

  return {};
}

function parseModelsPayload(payload: unknown, format: ApiFormat): RawUpstreamModel[] {
  const root = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const list = Array.isArray(root.data)
    ? root.data
    : Array.isArray(root.models)
      ? root.models
      : Array.isArray(payload)
        ? payload
        : [];

  const seen = new Set<string>();
  const out: RawUpstreamModel[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const rawId =
      typeof row.id === "string" && row.id.trim()
        ? row.id.trim()
        : typeof row.name === "string" && row.name.trim()
          ? row.name.trim()
          : "";
    if (!rawId) continue;
    const cleanId = format === "gemini" ? rawId.replace(/^models\//, "") : rawId;
    if (seen.has(cleanId)) continue;
    // Skip obvious non-chat models (embeddings, moderation, tts, whisper, dall-e) from counts if desired?
    // Keep all models returned by the provider so the user/admin has full visibility.
    seen.add(cleanId);

    const displayName =
      (typeof row.display_name === "string" && row.display_name.trim()) ||
      (typeof row.displayName === "string" && row.displayName.trim()) ||
      (typeof row.name === "string" && format !== "gemini" && row.name.trim() !== cleanId ? row.name.trim() : "") ||
      cleanId;

    const contextWindow =
      typeof row.context_length === "number"
        ? row.context_length
        : typeof row.context_window === "number"
          ? row.context_window
          : typeof row.input_token_limit === "number"
            ? row.input_token_limit
            : typeof row.inputTokenLimit === "number"
              ? row.inputTokenLimit
              : undefined;

    const priceInfo = extractPricingFromRow(row);
    out.push({
      id: cleanId,
      displayName: displayName.slice(0, 120),
      ...(contextWindow ? { contextWindow } : {}),
      ...priceInfo,
    });
  }
  return out;
}

export function classifyModelTier(
  model: RawUpstreamModel,
  baseUrl: string,
): { tier: ModelTier; tierSource: TierSource } {
  // 1. Explicit pricing metadata from the upstream API (strongest source of truth).
  if (model.explicitFreeFlag) {
    return { tier: "free", tierSource: "pricing_metadata" };
  }
  if (model.explicitPaidFlag) {
    return { tier: "paid", tierSource: "pricing_metadata" };
  }
  if (model.pricing) {
    return model.pricing.prompt === 0 && model.pricing.completion === 0
      ? { tier: "free", tierSource: "pricing_metadata" }
      : { tier: "paid", tierSource: "pricing_metadata" };
  }

  // 2. Explicit model id free tags (`:free`, `/free`, `-free`).
  const lowerId = model.id.toLowerCase();
  if (/(?::free|\/free|-free)$/i.test(lowerId) || lowerId.includes(":free")) {
    return { tier: "free", tierSource: "model_tag" };
  }

  // 3. Host / provider policy intelligence.
  let host = "";
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    host = "";
  }

  if (host && isPrivateHost(host)) {
    return { tier: "free", tierSource: "provider_policy" };
  }
  if (FREE_TIER_HOSTS.has(host)) {
    return { tier: "free", tierSource: "provider_policy" };
  }
  if (host === "generativelanguage.googleapis.com") {
    if (GEMINI_FREE_TIER_PATTERN.test(lowerId)) {
      return { tier: "free", tierSource: "provider_policy" };
    }
    return { tier: "paid", tierSource: "provider_policy" };
  }
  if (PAID_ONLY_HOSTS.has(host)) {
    return { tier: "paid", tierSource: "provider_policy" };
  }
  if (host === "openrouter.ai" || host === "www.openrouter.ai") {
    // OpenRouter returns pricing on almost every model; if missing, non-:free models are paid.
    return { tier: "paid", tierSource: "provider_policy" };
  }

  // 4. Curated commercial flagship model patterns.
  const bare = lowerId.includes("/") ? lowerId.split("/").pop() ?? lowerId : lowerId;
  if (COMMERCIAL_PAID_PATTERNS.some((re) => re.test(bare))) {
    return { tier: "paid", tierSource: "curated_registry" };
  }

  return { tier: "unknown", tierSource: "unknown" };
}

function classifyHttpBounce(status: number, bodyText: string): { status: KeyHealthStatus; message: string } {
  const lower = bodyText.toLowerCase();
  if (
    status === 402 ||
    /insufficient[_\s-]*(quota|balance|credit|funds)|credit balance is too low|billing|payment required|exceeded your current quota|out of credits/i.test(
      lower,
    )
  ) {
    return {
      status: "insufficient_balance",
      message: `API key is valid, but account balance/quota is exhausted (HTTP ${status}).`,
    };
  }
  if (
    status === 401 ||
    /invalid[_\s-]*api[_\s-]*key|incorrect api key|unauthorized|authentication failed|expired.*key|invalid token/i.test(
      lower,
    )
  ) {
    return {
      status: "invalid_key",
      message: `API key was rejected by the provider (HTTP ${status}).`,
    };
  }
  if (status === 403) {
    return {
      status: "forbidden",
      message: "Access forbidden by the provider (region restriction or missing permission, HTTP 403).",
    };
  }
  if (status === 429) {
    return {
      status: "rate_limited",
      message: "API key is valid, but currently rate-limited (HTTP 429).",
    };
  }
  return {
    status: "model_error",
    message: `Provider returned HTTP ${status} during live verification.`,
  };
}

function pickProbeCandidate(models: InspectedModel[], preferTier: "free" | "paid" | "any"): InspectedModel | null {
  const chatLike = models.filter(
    (m) => !/(embed|embedding|whisper|tts|dall-e|moderation|rerank|imagen|veo)/i.test(m.id),
  );
  const pool = chatLike.length > 0 ? chatLike : models;
  if (pool.length === 0) return null;

  const preferred =
    preferTier === "free"
      ? pool.filter((m) => m.tier === "free")
      : preferTier === "paid"
        ? pool.filter((m) => m.tier === "paid")
        : pool;
  const list = preferred.length > 0 ? preferred : pool;

  // Prefer fast, lightweight chat models for a sub-second probe.
  const fast = list.find((m) =>
    /(mini|flash|haiku|nano|instant|8b|7b|3b|small|lite|fast)/i.test(m.id),
  );
  return fast ?? list[0] ?? null;
}

async function runSingleChatProbe(
  provider: ProviderRow,
  apiKey: string,
  modelId: string,
): Promise<{ ok: boolean; httpStatus?: number; latencyMs: number; bodyText: string; networkError?: boolean }> {
  const started = Date.now();
  try {
    const req = buildUpstreamRequest(
      provider,
      apiKey,
      {
        model: modelId,
        messages: [{ role: "user", content: "ok" }],
        max_tokens: 1,
        temperature: 0,
      },
      false,
    );
    const res = await safeFetch(new URL(req.url), req.init, { timeoutMs: PROBE_TIMEOUT_MS });
    const latencyMs = Date.now() - started;
    const bodyText = await res.text().catch(() => "");
    return { ok: res.ok, httpStatus: res.status, latencyMs, bodyText: bodyText.slice(0, 600) };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      bodyText: err instanceof Error ? err.message : "Network error",
      networkError: true,
    };
  }
}

async function fetchModelsForFormat(
  baseUrl: string,
  format: ApiFormat,
  apiKey: string,
  authHeader: string,
  authPrefix: string,
  extraHeaders: Record<string, string>,
): Promise<{
  ok: boolean;
  httpStatus?: number;
  latencyMs: number;
  normalizedBase: string;
  models: RawUpstreamModel[];
  bodyText: string;
  networkError?: boolean;
}> {
  const normalizedBase = normalizeProviderBaseUrl(baseUrl, format);
  const url = `${normalizedBase}/models`;
  const tempProvider: ProviderRow = {
    id: "inspect",
    name: "Inspect",
    base_url: normalizedBase,
    api_format: format,
    auth_header: authHeader,
    auth_prefix: authPrefix,
    extra_headers: extraHeaders,
    icon: null,
    color: null,
    notes: null,
    enabled: true,
    created_at: "",
    updated_at: "",
  };
  const headers: Record<string, string> = {
    ...authHeadersFor(tempProvider, apiKey),
    ...(format === "anthropic" ? { "anthropic-version": "2023-06-01" } : {}),
  };
  if (!apiKey && authHeader) {
    delete headers[authHeader];
  }

  const started = Date.now();
  try {
    const res = await safeFetch(
      new URL(url),
      { method: "GET", headers },
      { timeoutMs: MODELS_TIMEOUT_MS },
    );
    const latencyMs = Date.now() - started;
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      return {
        ok: false,
        httpStatus: res.status,
        latencyMs,
        normalizedBase,
        models: [],
        bodyText: text.slice(0, 600),
      };
    }
    let payload: unknown = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
    const models = parseModelsPayload(payload, format);
    return {
      ok: true,
      httpStatus: res.status,
      latencyMs,
      normalizedBase,
      models,
      bodyText: "",
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      normalizedBase,
      models: [],
      bodyText: err instanceof Error ? err.message : "Network error",
      networkError: true,
    };
  }
}

/**
 * Main smart provider + API key + Free/Paid model inspection entry point.
 */
export async function inspectProvider(options: InspectProviderOptions): Promise<ProviderInspectResult> {
  const rawUrl = options.baseUrl.trim();
  const apiKey = options.apiKey.trim();
  const maxModels = Math.max(1, Math.min(options.maxModels ?? 500, 1000));
  const extraHeaders = options.extraHeaders ?? {};

  const requestedFormat = options.format ?? "auto";
  const initialFormat: ApiFormat = requestedFormat === "auto" ? "openai" : requestedFormat;

  const urlCheck = validateProviderBaseUrl(rawUrl, initialFormat);
  if (!urlCheck.ok) {
    return {
      ok: false,
      format: initialFormat,
      baseUrl: rawUrl,
      keyHealth: {
        status: "unreachable",
        ok: false,
        latencyMs: null,
        message: urlCheck.message,
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
      error: urlCheck.message,
    };
  }

  const formatsToTry: ApiFormat[] =
    requestedFormat === "auto" ? ["openai", "anthropic", "gemini"] : [requestedFormat];

  let chosenFormat: ApiFormat = initialFormat;
  let chosenBase = normalizeProviderBaseUrl(rawUrl, initialFormat);
  let chosenAuth = {
    header: options.authHeader ?? defaultAuthFor(initialFormat).auth_header,
    prefix: options.authPrefix ?? defaultAuthFor(initialFormat).auth_prefix,
  };
  let rawModels: RawUpstreamModel[] = [];
  let modelsLatencyMs: number | null = null;
  let lastFailure: { httpStatus?: number; bodyText: string; networkError?: boolean } | null = null;

  for (const fmt of formatsToTry) {
    const defaults = defaultAuthFor(fmt);
    const header = requestedFormat === "auto" ? defaults.auth_header : (options.authHeader ?? defaults.auth_header);
    const prefix = requestedFormat === "auto" ? defaults.auth_prefix : (options.authPrefix ?? defaults.auth_prefix);
    const attempt = await fetchModelsForFormat(rawUrl, fmt, apiKey, header, prefix, extraHeaders);

    if (attempt.ok && attempt.models.length > 0) {
      chosenFormat = fmt;
      chosenBase = attempt.normalizedBase;
      chosenAuth = { header, prefix };
      rawModels = attempt.models.slice(0, maxModels);
      modelsLatencyMs = attempt.latencyMs;
      break;
    }

    lastFailure = attempt;
    // If a format answered with 401/402/403, we KNOW this endpoint speaks that format
    // and rejected the key — stop guessing other formats immediately!
    if (attempt.httpStatus === 401 || attempt.httpStatus === 402 || attempt.httpStatus === 403) {
      chosenFormat = fmt;
      chosenBase = attempt.normalizedBase;
      chosenAuth = { header, prefix };
      modelsLatencyMs = attempt.latencyMs;
      break;
    }
  }

  // If `/models` failed completely, return an exact diagnostic bounce reason.
  if (rawModels.length === 0) {
    const bounce = lastFailure?.networkError
      ? {
          status: "unreachable" as KeyHealthStatus,
          message: `Could not reach provider (${lastFailure.bodyText || "network timeout"}).`,
        }
      : lastFailure?.httpStatus
        ? classifyHttpBounce(lastFailure.httpStatus, lastFailure.bodyText)
        : {
            status: "unreachable" as KeyHealthStatus,
            message: "Provider returned no models.",
          };

    return {
      ok: false,
      format: chosenFormat,
      baseUrl: chosenBase,
      keyHealth: {
        status: bounce.status,
        ok: false,
        httpStatus: lastFailure?.httpStatus,
        latencyMs: modelsLatencyMs,
        message: bounce.message,
      },
      summary: {
        totalModels: 0,
        freeCount: 0,
        paidCount: 0,
        unknownCount: 0,
        modelsLatencyMs,
        chatLatencyMs: null,
      },
      models: [],
      error: bounce.message,
    };
  }

  // Classify every discovered model (Free vs Paid vs Unknown).
  const classified: InspectedModel[] = rawModels.map((entry) => {
    const { tier, tierSource } = classifyModelTier(entry, chosenBase);
    return {
      id: entry.id,
      displayName: entry.displayName,
      ...(entry.contextWindow ? { contextWindow: entry.contextWindow } : {}),
      capabilities: inferCapabilities(entry.id),
      tier,
      tierSource,
      pricingClass: tier,
      ...(entry.pricing ? { pricing: entry.pricing } : {}),
    };
  });

  // Stage 2: Live 1-token chat completion verification probe to prove the API key
  // genuinely works and doesn't bounce on real chat calls.
  let keyHealth: KeyProbeResult;
  if (!apiKey) {
    keyHealth = {
      status: "no_key",
      ok: false,
      latencyMs: null,
      message: "Models listed, but no API key was provided to verify chat access.",
    };
  } else if (options.verifyKeyLive === false) {
    keyHealth = {
      status: "healthy",
      ok: true,
      latencyMs: modelsLatencyMs,
      message: "Models discovered (live chat probe skipped).",
    };
  } else {
    const probeProvider: ProviderRow = {
      id: "inspect-probe",
      name: "Inspect",
      base_url: chosenBase,
      api_format: chosenFormat,
      auth_header: chosenAuth.header,
      auth_prefix: chosenAuth.prefix,
      extra_headers: extraHeaders,
      icon: null,
      color: null,
      notes: null,
      enabled: true,
      created_at: "",
      updated_at: "",
    };

    const hasFree = classified.some((m) => m.tier === "free");
    const hasPaid = classified.some((m) => m.tier === "paid");
    // On mixed Free+Paid providers (like OpenRouter), probe a lightweight paid model
    // first (max_tokens: 1) so we detect zero-balance `free_only` keys accurately;
    // on 402 we automatically verify a free model immediately!
    const primaryCandidate =
      hasPaid && hasFree
        ? (pickProbeCandidate(classified, "paid") ?? pickProbeCandidate(classified, "any"))
        : (pickProbeCandidate(classified, "free") ?? pickProbeCandidate(classified, "any"));
    if (!primaryCandidate) {
      keyHealth = {
        status: "healthy",
        ok: true,
        latencyMs: modelsLatencyMs,
        message: "Provider responded with models.",
      };
    } else {
      const probe = await runSingleChatProbe(probeProvider, apiKey, primaryCandidate.id);
      if (probe.ok) {
        // Live success confirms the key is genuinely healthy!
        keyHealth = {
          status: "healthy",
          ok: true,
          httpStatus: probe.httpStatus,
          latencyMs: probe.latencyMs,
          testedModel: primaryCandidate.id,
          message: `API key verified live (${probe.latencyMs}ms via ${primaryCandidate.id}).`,
        };
      } else if (probe.networkError) {
        keyHealth = {
          status: "unreachable",
          ok: false,
          latencyMs: probe.latencyMs,
          testedModel: primaryCandidate.id,
          message: `Chat endpoint unreachable (${probe.bodyText}).`,
        };
      } else {
        const bounce = classifyHttpBounce(probe.httpStatus ?? 500, probe.bodyText);
        // If a non-free model bounced with 402 (insufficient balance), check if a free model works!
        let freeModelsUsable = false;
        if (bounce.status === "insufficient_balance") {
          // Mark the probed model as definitively paid via live probe evidence.
          if (primaryCandidate.tier === "unknown") {
            primaryCandidate.tier = "paid";
            primaryCandidate.pricingClass = "paid";
            primaryCandidate.tierSource = "live_probe";
          }
          const freeAlt = classified.find(
            (m) => m.tier === "free" && m.id !== primaryCandidate.id,
          );
          if (freeAlt) {
            const freeProbe = await runSingleChatProbe(probeProvider, apiKey, freeAlt.id);
            if (freeProbe.ok) {
              freeModelsUsable = true;
            }
          }
        } else if (bounce.status === "model_error") {
          // Try one backup model in case the first model ID is deprecated/restricted.
          const backup = classified.find(
            (m) =>
              m.id !== primaryCandidate.id &&
              !/(embed|whisper|tts|dall-e|moderation)/i.test(m.id),
          );
          if (backup) {
            const retry = await runSingleChatProbe(probeProvider, apiKey, backup.id);
            if (retry.ok) {
              keyHealth = {
                status: "healthy",
                ok: true,
                httpStatus: retry.httpStatus,
                latencyMs: retry.latencyMs,
                testedModel: backup.id,
                message: `API key verified live (${retry.latencyMs}ms via ${backup.id}).`,
              };
            } else {
              const retryBounce = retry.networkError
                ? { status: "unreachable" as KeyHealthStatus, message: retry.bodyText }
                : classifyHttpBounce(retry.httpStatus ?? 500, retry.bodyText);
              keyHealth = {
                status: retryBounce.status,
                ok: retryBounce.status === "rate_limited",
                httpStatus: retry.httpStatus,
                latencyMs: retry.latencyMs,
                testedModel: backup.id,
                message: retryBounce.message,
              };
            }
          } else {
            keyHealth = {
              status: bounce.status,
              ok: false,
              httpStatus: probe.httpStatus,
              latencyMs: probe.latencyMs,
              testedModel: primaryCandidate.id,
              message: bounce.message,
            };
          }
        }

        // Set keyHealth if not already set by the model_error fallback branch above.
        keyHealth ??= {
          status: freeModelsUsable ? "free_only" : bounce.status,
          ok: bounce.status === "rate_limited" || freeModelsUsable,
          httpStatus: probe.httpStatus,
          latencyMs: probe.latencyMs,
          testedModel: primaryCandidate.id,
          ...(freeModelsUsable ? { freeModelsUsable: true } : {}),
          message: freeModelsUsable
            ? `Key valid for free models only (paid balance exhausted, HTTP ${probe.httpStatus}).`
            : bounce.message,
        };
      }
    }
  }

  let freeCount = 0;
  let paidCount = 0;
  let unknownCount = 0;
  for (const m of classified) {
    if (m.tier === "free") freeCount += 1;
    else if (m.tier === "paid") paidCount += 1;
    else unknownCount += 1;
  }

  return {
    ok: keyHealth.ok || keyHealth.status === "insufficient_balance" || keyHealth.status === "rate_limited",
    format: chosenFormat,
    baseUrl: chosenBase,
    keyHealth,
    summary: {
      totalModels: classified.length,
      freeCount,
      paidCount,
      unknownCount,
      modelsLatencyMs,
      chatLatencyMs: keyHealth.latencyMs,
    },
    models: classified,
    ...(keyHealth.ok ? {} : { error: keyHealth.message }),
  };
}
