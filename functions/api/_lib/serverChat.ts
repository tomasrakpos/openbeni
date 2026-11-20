// Shared server logic serverChat; update API callers when changing its contract.
import { getSettings, resolveAuth, type AuthEnv, type ProfileRow } from "./auth";
import { listProviderKeys, callWithRotation, getProvider, type ProviderRow, type RotationEnv } from "./providerKeys";
import { buildUpstreamRequest, normalizeJson, normalizeStream, type ChatBody } from "./upstream";
import { checkQuota, estimateMessageTokens, estimateTokens, recordUsage } from "./usage";
import { sbJson } from "./supabase";
import { apiHeaders, clientIp, jsonError, rateLimit, readJsonBody, rejectedOrigin } from "../security";

export type ChatEnv = AuthEnv &
  RotationEnv & {
    MASTER_ENCRYPTION_KEY?: string;
  };

const MAX_MESSAGES = 120;
const MAX_MESSAGE_CHARS = 32_000;
const MAX_TOTAL_CHARS = 160_000;
const MAX_TOKENS = 32_768;
const ALLOWED_ROLES = new Set(["system", "user", "assistant"]);

interface CatalogJoin {
  id: string;
  display_name: string;
  upstream_id: string;
  capabilities: string[] | null;
  site_paid?: boolean;
  providers: ProviderRow | ProviderRow[] | null;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

interface ValidBody {
  ok: true;
  body: ChatBody;
  stream: boolean;
  promptEstimate: number;
}

interface InvalidBody {
  ok: false;
  message: string;
}

export function validateChatRequest(value: unknown, maxTokensCap = MAX_TOKENS): ValidBody | InvalidBody {
  if (!isObject(value)) return { ok: false, message: "The request body must be a JSON object." };
  const model = typeof value.model === "string" ? value.model.trim() : "";
  if (!model || model.length > 100) return { ok: false, message: "Choose a valid model." };
  const messages = value.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, message: "messages must be a non-empty array." };
  }
  if (messages.length > MAX_MESSAGES) return { ok: false, message: `Too many messages (limit ${MAX_MESSAGES}).` };

  let totalChars = 0;
  const clean: ChatBody["messages"] = [];
  for (const entry of messages) {
    if (!isObject(entry)) return { ok: false, message: "Each message must be an object." };
    const role = typeof entry.role === "string" ? entry.role : "";
    if (!ALLOWED_ROLES.has(role)) return { ok: false, message: "Invalid message role." };
    if (typeof entry.content !== "string") return { ok: false, message: "Message content must be text." };
    if (entry.content.length > MAX_MESSAGE_CHARS) return { ok: false, message: "A message is too long." };
    totalChars += entry.content.length;
    if (totalChars > MAX_TOTAL_CHARS) return { ok: false, message: "The conversation is too long." };
    clean.push({ role, content: entry.content });
  }

  const stream = value.stream === true;
  const maxTokens = typeof value.max_tokens === "number" && value.max_tokens > 0
    ? Math.min(Math.floor(value.max_tokens), maxTokensCap)
    : 4096;
  const body: ChatBody = {
    model,
    messages: clean,
    stream,
    max_tokens: maxTokens,
    temperature:
      typeof value.temperature === "number" ? Math.max(0, Math.min(2, value.temperature)) : 0.7,
    top_p: typeof value.top_p === "number" ? Math.max(0, Math.min(1, value.top_p)) : 1,
  };
  return { ok: true, body, stream, promptEstimate: estimateMessageTokens(clean) };
}

function quotaMessage(reason: "blocked" | "daily" | "monthly"): { message: string; code: string } {
  if (reason === "blocked") {
    return {
      message: "Your account is blocked. Please contact the administrator.",
      code: "account_blocked",
    };
  }
  return {
    message:
      reason === "daily"
        ? "You have reached today's usage limit. Please try again tomorrow or contact the administrator."
        : "You have reached this month's usage limit. Please contact the administrator.",
    code: reason === "daily" ? "quota_daily" : "quota_monthly",
  };
}

export async function handleServerChat(request: Request, env: ChatEnv = {}): Promise<Response> {
  if (request.method === "OPTIONS") {
    if (rejectedOrigin(request, env)) return jsonError(request, env, 403, "Origin not allowed.");
    return new Response(null, { status: 204, headers: apiHeaders(request, env) });
  }
  if (rejectedOrigin(request, env)) return jsonError(request, env, 403, "Origin not allowed.");
  if (request.method !== "POST") return jsonError(request, env, 405, "Method not allowed.");

  const ipLimit = rateLimit("server-chat", clientIp(request), 30, 60_000);
  if (!ipLimit.ok) {
    return jsonError(request, env, 429, "Too many requests. Please wait a moment.", "rate_limited", {
      "Retry-After": String(ipLimit.retryAfter),
    });
  }

  const auth = await resolveAuth(request, env);
  if (!auth) return jsonError(request, env, 401, "Sign in to use this model.");
  const userLimit = rateLimit("server-chat-user", auth.profile.id, 60, 60_000);
  if (!userLimit.ok) {
    return jsonError(request, env, 429, "Too many requests. Please wait a moment.", "rate_limited", {
      "Retry-After": String(userLimit.retryAfter),
    });
  }

  const parsed = await readJsonBody(request);
  if (!parsed.ok) {
    return jsonError(request, env, parsed.reason === "too-large" ? 413 : 400, "Invalid request body.");
  }
  const valid = validateChatRequest(parsed.value);
  if (!valid.ok) return jsonError(request, env, 400, valid.message);

  const catalogQuery = (withPaid: boolean) =>
    `catalog_models?select=id,display_name,upstream_id,capabilities${withPaid ? ",site_paid" : ""},providers!inner(*)&id=eq.${encodeURIComponent(
      valid.body.model,
    )}&enabled=eq.true&upstream_verified=eq.true&providers.enabled=eq.true&limit=1`;
  const lookupCatalog = async (): Promise<CatalogJoin | null> => {
    try {
      const rows = await sbJson<CatalogJoin[]>(env, catalogQuery(true));
      return rows[0] ?? null;
    } catch {
      try {
        const rows = await sbJson<CatalogJoin[]>(env, catalogQuery(false));
        return rows[0] ?? null;
      } catch {
        return null;
      }
    }
  };

  // Settings and the catalog are independent: fetch them together so the
  // first token does not wait on two sequential round trips.
  const [settings, catalog] = await Promise.all([
    getSettings(env).catch(() => ({
      id: true,
      signup_open: true,
      default_daily_token_limit: null,
      default_monthly_token_limit: null,
      updated_at: new Date().toISOString(),
    })),
    lookupCatalog(),
  ]);

  const quota = await checkQuota(env, auth.profile, settings);
  if (!quota.allowed && quota.reason) {
    const info = quotaMessage(quota.reason);
    return jsonError(request, env, quota.reason === "blocked" ? 403 : 429, info.message, info.code);
  }

  if (!catalog) {
    return jsonError(request, env, 404, "This model is not available.", "model_unavailable");
  }
  if (catalog.site_paid) {
    return jsonError(request, env, 403, "This model is reserved for paid plans.", "model_paid");
  }
  const provider = one(catalog.providers);
  if (!provider) {
    return jsonError(request, env, 404, "This model is not available.", "model_unavailable");
  }

  let keys;
  try {
    keys = await listProviderKeys(env, provider.id);
  } catch {
    return jsonError(request, env, 503, "Models are temporarily unavailable. Please try again shortly.");
  }

  const started = Date.now();
  const build = (apiKey: string) => {
    const request = buildUpstreamRequest(
      provider,
      apiKey,
      { ...valid.body, model: catalog.upstream_id },
      valid.stream,
    );
    return Promise.resolve(request);
  };

  const outcome = await callWithRotation(env, provider, keys, build, (line) => {
    console.warn(`[server-chat] ${line}`);
  });

  const baseRecord = {
    user_id: auth.profile.id,
    provider_id: provider.id,
    model_id: catalog.id,
    model_name: catalog.display_name,
    provider_name: provider.name,
    prompt_tokens: valid.promptEstimate,
  };

  if (!outcome.response) {
    const failure = outcome.failure ?? { status: 503, message: "This model is temporarily unavailable." };
    void recordUsage(env, {
      ...baseRecord,
      completion_tokens: 0,
      status: failure.status >= 500 ? "error" : "rejected",
      latency_ms: Date.now() - started,
    });
    return jsonError(request, env, failure.status, failure.message, "model_unavailable");
  }

  const upstream = outcome.response;
  const contentType = upstream.headers.get("content-type") ?? "";

  if (valid.stream && contentType.includes("event-stream") && upstream.body) {
    const stream = upstream.body.pipeThrough(
      normalizeStream(provider.api_format, upstream.body, (stats) => {
        void recordUsage(env, {
          ...baseRecord,
          prompt_tokens: stats.promptTokens ?? valid.promptEstimate,
          completion_tokens: stats.completionTokens ?? estimateTokens("x".repeat(Math.max(0, stats.textChars))),
          status: "ok",
          latency_ms: Date.now() - started,
        });
      }),
    );
    return new Response(stream, {
      status: 200,
      headers: apiHeaders(request, env, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      }),
    });
  }

  const payload = await upstream.json().catch(() => null);
  const normalized = normalizeJson(provider.api_format, payload);
  const text = normalized.choices[0]?.message.content ?? "";
  void recordUsage(env, {
    ...baseRecord,
    prompt_tokens: normalized.usage?.prompt_tokens ?? valid.promptEstimate,
    completion_tokens: normalized.usage?.completion_tokens ?? estimateTokens(text),
    status: text ? "ok" : "empty",
    latency_ms: Date.now() - started,
  });

  return new Response(JSON.stringify(normalized), {
    status: 200,
    headers: apiHeaders(request, env, { "Content-Type": "application/json; charset=utf-8" }),
  });
}

export function profileDisplay(profile: ProfileRow): string {
  return profile.display_name ?? profile.email;
}
