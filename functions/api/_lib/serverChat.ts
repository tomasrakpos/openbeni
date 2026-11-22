// Shared server logic serverChat; update API callers when changing its contract.
import { consumeCredit, getSettings, resolveAuth, type AuthEnv, type ProfileRow } from "./auth";
import { decryptSecret } from "./crypto";
import {
  type PreviewAiJudge,
  type PreviewIntentMessage,
} from "./previewIntent";
import { injectSkillSystemPrompt } from "./skills/definitions";
import { resolveSkillExecution, skillResponseHeaders } from "./skills/router";
import {
  normalizeSkillMode,
  type SkillEnv,
  type SkillMessage,
  type SkillMode,
} from "./skills/types";
import { listProviderKeys, callWithRotation, type ApiFormat, type ProviderRow, type RotationEnv } from "./providerKeys";
import { resolveRouterForChat, type ResolvedRouterMember } from "./routersHandler";
import { buildUpstreamRequest, normalizeJson, normalizeStream, type ChatBody } from "./upstream";
import { checkQuota, estimateMessageTokens, estimateTokens, recordUsage } from "./usage";
import {
  defaultAuthForFormat,
  getUserModelForProvider,
  getUserModelWithProvider,
  getUserProvider,
  sanitizeExtraHeaders,
  userProviderToProviderRow,
} from "./userProviders";
import { sbJson } from "./supabase";
import { safeFetch, validateProviderBaseUrl, type ProviderFormat } from "./urlGuard";
import { apiHeaders, clientIp, jsonError, rateLimit, readJsonBody, rejectedOrigin } from "../security";
import {
  executeWithRouterFailover,
  ROUTER_MAX_FAILOVER_ATTEMPTS,
  RouterScheduler,
} from "../../../src/lib/routerEngine";

const serverRouterScheduler = new RouterScheduler();

export type ChatEnv = AuthEnv &
  RotationEnv &
  SkillEnv & {
    MASTER_ENCRYPTION_KEY?: string;
  };

export type BillingSource = "site" | "byok";

/**
 * Authoritative server-side billing rule:
 * - Default website catalog models (`"site"`) deduct user credits.
 * - User-added providers / BYOK models (`"byok"`) NEVER deduct user credits.
 */
export function shouldChargeCredits(source: BillingSource): boolean {
  return source === "site";
}

export interface InlineUserProvider {
  name: string;
  baseUrl: string;
  apiFormat: ApiFormat;
  apiKey: string;
  authHeader: string | null;
  authPrefix: string | null;
  extraHeaders: Record<string, string>;
}

const MAX_MESSAGES = 120;
const MAX_MESSAGE_CHARS = 32_000;
const MAX_TOTAL_CHARS = 160_000;
const MAX_TOKENS = 32_768;
const ALLOWED_ROLES = new Set(["system", "user", "assistant"]);
const ALLOWED_FORMATS = new Set<ApiFormat>(["openai", "anthropic", "gemini", "custom"]);

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

function extractUpstreamError(text: string): string {
  if (!text) return "";
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    if (typeof parsed.error === "string") return parsed.error.slice(0, 300);
    if (parsed.error && typeof parsed.error.message === "string") return parsed.error.message.slice(0, 300);
    if (typeof parsed.message === "string") return parsed.message.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
  return text.slice(0, 300);
}

interface ValidBody {
  ok: true;
  body: ChatBody;
  stream: boolean;
  promptEstimate: number;
  skillMode: SkillMode;
  routerId?: string;
  userProviderId?: string;
  userModelId?: string;
  customProvider?: InlineUserProvider;
}

interface InvalidBody {
  ok: false;
  message: string;
}

function validateInlineProvider(value: unknown): { ok: true; provider: InlineUserProvider } | InvalidBody {
  if (!isObject(value)) return { ok: false, message: "customProvider must be an object." };
  const rawFormat = typeof value.apiFormat === "string" && value.apiFormat.trim() ? value.apiFormat.trim() : "openai";
  if (!ALLOWED_FORMATS.has(rawFormat as ApiFormat)) {
    return { ok: false, message: "Unsupported customProvider apiFormat." };
  }
  const apiFormat = rawFormat as ApiFormat;
  const rawBaseUrl = typeof value.baseUrl === "string" ? value.baseUrl.trim() : "";
  if (!rawBaseUrl) return { ok: false, message: "customProvider.baseUrl is required." };
  const baseCheck = validateProviderBaseUrl(rawBaseUrl, apiFormat as ProviderFormat);
  if (!baseCheck.ok) return { ok: false, message: baseCheck.message };

  const apiKey = typeof value.apiKey === "string" ? value.apiKey.trim().slice(0, 1000) : "";
  const { authHeader, authPrefix } = defaultAuthForFormat(apiFormat, value.authHeader, value.authPrefix);
  const name =
    typeof value.name === "string" && value.name.trim()
      ? value.name.trim().slice(0, 80)
      : "Custom provider";

  return {
    ok: true,
    provider: {
      name,
      baseUrl: baseCheck.url.toString().replace(/\/+$/, ""),
      apiFormat,
      apiKey,
      authHeader,
      authPrefix,
      extraHeaders: sanitizeExtraHeaders(value.extraHeaders),
    },
  };
}

export function validateChatRequest(value: unknown, maxTokensCap = MAX_TOKENS): ValidBody | InvalidBody {
  if (!isObject(value)) return { ok: false, message: "The request body must be a JSON object." };

  const routerId =
    typeof value.routerId === "string" && value.routerId.trim()
      ? value.routerId.trim().slice(0, 100)
      : undefined;
  const userProviderId =
    typeof value.userProviderId === "string" && value.userProviderId.trim()
      ? value.userProviderId.trim().slice(0, 100)
      : undefined;
  const userModelId =
    typeof value.userModelId === "string" && value.userModelId.trim()
      ? value.userModelId.trim().slice(0, 100)
      : undefined;

  let customProvider: InlineUserProvider | undefined;
  if (value.customProvider !== undefined) {
    const checked = validateInlineProvider(value.customProvider);
    if (!checked.ok) return checked;
    customProvider = checked.provider;
  }

  const rawModel = typeof value.model === "string" ? value.model.trim() : "";
  const model = rawModel || userModelId || routerId || "";
  if (!model || model.length > 160) return { ok: false, message: "Choose a valid model." };

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

    if (typeof entry.content === "string") {
      if (entry.content.length > MAX_MESSAGE_CHARS) return { ok: false, message: "A message is too long." };
      totalChars += entry.content.length;
      if (totalChars > MAX_TOTAL_CHARS) return { ok: false, message: "The conversation is too long." };
      clean.push({ role, content: entry.content });
    } else if (Array.isArray(entry.content)) {
      // Support multimodal OpenAI content parts (e.g. text + screenshot image_url)
      const parts: Array<Record<string, unknown>> = [];
      for (const part of entry.content) {
        if (!isObject(part)) continue;
        if (part.type === "text" && typeof part.text === "string") {
          if (part.text.length > MAX_MESSAGE_CHARS) return { ok: false, message: "A message is too long." };
          totalChars += part.text.length;
          if (totalChars > MAX_TOTAL_CHARS) return { ok: false, message: "The conversation is too long." };
          parts.push({ type: "text", text: part.text });
        } else if (part.type === "image_url" && isObject(part.image_url) && typeof part.image_url.url === "string") {
          // Allow bounded data URLs or https image URLs (max 6MB per image)
          if (part.image_url.url.length > 8_000_000) {
            return { ok: false, message: "An attached image is too large." };
          }
          parts.push({
            type: "image_url",
            image_url: {
              url: part.image_url.url,
              ...(typeof part.image_url.detail === "string" ? { detail: part.image_url.detail } : {}),
            },
          });
        }
      }
      if (parts.length === 0) return { ok: false, message: "Message content must be text or valid media parts." };
      clean.push({ role, content: parts as unknown as string });
    } else {
      return { ok: false, message: "Message content must be text." };
    }
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
  return {
    ok: true,
    body,
    stream,
    promptEstimate: estimateMessageTokens(clean),
    skillMode: normalizeSkillMode(value.skillMode),
    ...(routerId ? { routerId } : {}),
    ...(userProviderId ? { userProviderId } : {}),
    ...(userModelId ? { userModelId } : {}),
    ...(customProvider ? { customProvider } : {}),
  };
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

interface ByokTarget {
  provider: ProviderRow;
  apiKey: string;
  upstreamModelId: string;
  modelDisplayName: string;
  userProviderId: string | null;
}

/**
 * Lightweight, bounded-latency AI intent judge used when the fast heuristic
 * encounters an ambiguous prompt. Runs concurrently with the main completion
 * so it adds zero latency on clear prompts and never blocks slow upstreams.
 */
function makeDirectAiJudge(
  provider: ProviderRow,
  apiKey: string,
  upstreamModelId: string,
): PreviewAiJudge {
  return async (promptMessages: PreviewIntentMessage[]) => {
    const req = buildUpstreamRequest(
      provider,
      apiKey,
      {
        model: upstreamModelId,
        messages: promptMessages.map((m) => ({
          role: m.role as "system" | "user" | "assistant",
          content: m.content,
        })),
        temperature: 0,
        max_tokens: 48,
      },
      false,
    );
    const res = await safeFetch(new URL(req.url), req.init, { timeoutMs: 2500 });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const normalized = normalizeJson(provider.api_format, json);
    return normalized.choices[0]?.message.content ?? null;
  };
}

function toSkillMessages(messages: ChatBody["messages"]): SkillMessage[] {
  return messages.map((m) => {
    if (typeof m.content === "string") return { role: m.role, content: m.content };
    if (Array.isArray(m.content)) {
      let hasImages = false;
      const text = m.content
        .map((part) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object") {
            const p = part as { type?: unknown; text?: unknown; image_url?: unknown };
            if (p.type === "image_url" || p.type === "image" || p.image_url) {
              hasImages = true;
            }
            if (typeof p.text === "string") return p.text;
          }
          return "";
        })
        .filter(Boolean)
        .join("\n");
      return { role: m.role, content: text, ...(hasImages ? { hasImages: true } : {}) };
    }
    return { role: m.role, content: "" };
  });
}

/**
 * Execute a chat completion against a user-added (BYOK) provider.
 *
 * BYOK calls use the user's own upstream endpoint and API key, so they NEVER
 * deduct website credits and NEVER consume site daily/monthly token quotas.
 */
async function executeByokChat(
  request: Request,
  env: ChatEnv,
  userId: string,
  valid: ValidBody,
  target: ByokTarget,
): Promise<Response> {
  const started = Date.now();
  const skillMessages = toSkillMessages(valid.body.messages);
  const skillCtx = await resolveSkillExecution({
    messages: skillMessages,
    skillMode: valid.skillMode,
    env,
    aiJudge: makeDirectAiJudge(target.provider, target.apiKey, target.upstreamModelId),
  });
  const effectiveMessages = injectSkillSystemPrompt(valid.body.messages, skillCtx.systemPrompt);
  const effectiveBody = { ...valid.body, messages: effectiveMessages };
  const baseRecord = {
    user_id: userId,
    provider_id: null,
    model_id: null,
    user_provider_id: target.userProviderId,
    model_name: target.modelDisplayName,
    provider_name: target.provider.name,
    prompt_tokens: valid.promptEstimate,
    billing_source: "byok" as const,
    credits_charged: 0,
  };

  let upstreamReq: { url: string; init: RequestInit };
  try {
    upstreamReq = buildUpstreamRequest(
      target.provider,
      target.apiKey,
      { ...effectiveBody, model: target.upstreamModelId },
      valid.stream,
    );
  } catch {
    return jsonError(request, env, 400, "The custom provider configuration is invalid.");
  }

  let upstream: Response;
  try {
    upstream = await safeFetch(new URL(upstreamReq.url), upstreamReq.init, { timeoutMs: 45_000 });
  } catch {
    void recordUsage(env, {
      ...baseRecord,
      completion_tokens: 0,
      status: "error",
      latency_ms: Date.now() - started,
    });
    return jsonError(request, env, 502, "Could not reach your custom provider. Please retry.", "provider_unreachable");
  }

  if (!upstream.ok && (upstream.status === 400 || upstream.status === 422) && valid.stream && typeof upstreamReq.init.body === "string") {
    const errPreview = await upstream.clone().text().catch(() => "");
    if (/stream_options|extra_forbidden|unrecognized|unknown field|additional properties/i.test(errPreview)) {
      try {
        const parsedBody = JSON.parse(upstreamReq.init.body) as Record<string, unknown>;
        if ("stream_options" in parsedBody) {
          delete parsedBody.stream_options;
          await upstream.body?.cancel().catch(() => undefined);
          upstream = await safeFetch(
            new URL(upstreamReq.url),
            { ...upstreamReq.init, body: JSON.stringify(parsedBody) },
            { timeoutMs: 45_000 },
          );
        }
      } catch {
        // Fall through to normal error handling below.
      }
    }
  }

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => "");
    const message = extractUpstreamError(errText) || `Upstream returned HTTP ${upstream.status}.`;
    void recordUsage(env, {
      ...baseRecord,
      completion_tokens: 0,
      status: upstream.status >= 500 ? "error" : "rejected",
      latency_ms: Date.now() - started,
    });
    return jsonError(request, env, upstream.status, message, "provider_error");
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  const billingHeaders = {
    "X-Billing-Source": "byok",
    "X-Credits-Charged": "0",
    ...skillResponseHeaders(skillCtx),
  };

  if (valid.stream && contentType.includes("event-stream") && upstream.body) {
    const stream = upstream.body.pipeThrough(
      normalizeStream(target.provider.api_format, upstream.body, async (stats) => {
        await recordUsage(env, {
          ...baseRecord,
          prompt_tokens: stats.promptTokens ?? valid.promptEstimate,
          completion_tokens: stats.completionTokens ?? estimateTokens("x".repeat(Math.max(0, stats.textChars))),
          status: stats.streamError ? "error" : "ok",
          latency_ms: Date.now() - started,
        });
      }),
    );
    return new Response(stream, {
      status: 200,
      headers: apiHeaders(request, env, {
        ...billingHeaders,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      }),
    });
  }

  const payload = await upstream.json().catch(() => null);
  const normalized = normalizeJson(target.provider.api_format, payload);
  const text = normalized.choices[0]?.message.content ?? "";
  await recordUsage(env, {
    ...baseRecord,
    prompt_tokens: normalized.usage?.prompt_tokens ?? valid.promptEstimate,
    completion_tokens: normalized.usage?.completion_tokens ?? estimateTokens(text),
    status: text ? "ok" : "empty",
    latency_ms: Date.now() - started,
  });

  return new Response(JSON.stringify(normalized), {
    status: 200,
    headers: apiHeaders(request, env, {
      ...billingHeaders,
      "Content-Type": "application/json; charset=utf-8",
    }),
  });
}

async function decryptUserProviderKey(
  env: ChatEnv,
  ciphertext: string | null,
): Promise<{ ok: true; apiKey: string } | { ok: false }> {
  if (!ciphertext) return { ok: true, apiKey: "" };
  try {
    const apiKey = await decryptSecret(env.MASTER_ENCRYPTION_KEY ?? "", ciphertext);
    return { ok: true, apiKey };
  } catch {
    return { ok: false };
  }
}

async function executeRouterChat(
  request: Request,
  env: ChatEnv,
  profile: ProfileRow,
  valid: ValidBody,
  routerId: string,
): Promise<Response> {
  const resolved = await resolveRouterForChat(env, routerId, profile.id);
  if (!resolved) {
    return jsonError(request, env, 404, "This router is not available.", "router_unavailable");
  }
  if (resolved.members.length === 0) {
    return jsonError(
      request,
      env,
      503,
      "No active free models are available in this router.",
      "router_empty",
    );
  }

  const billingSource: BillingSource = resolved.billingSource;

  // Enforce the exact same credit and usage-limit rules as regular models.
  if (billingSource === "site") {
    if (shouldChargeCredits(billingSource) && typeof profile.credits === "number" && profile.credits <= 0) {
      return jsonError(
        request,
        env,
        402,
        "You have used all your credits. Contact the administrator or add more credits to continue.",
        "credits_exhausted",
      );
    }
    const settings = await getSettings(env).catch(() => ({
      id: true,
      signup_open: true,
      default_daily_token_limit: null,
      default_monthly_token_limit: null,
      updated_at: new Date().toISOString(),
    }));
    const quota = await checkQuota(env, profile, settings);
    if (!quota.allowed && quota.reason) {
      const info = quotaMessage(quota.reason);
      return jsonError(request, env, quota.reason === "blocked" ? 403 : 429, info.message, info.code);
    }
  }

  const started = Date.now();
  const skillMessages = toSkillMessages(valid.body.messages);
  const skillCtx = await resolveSkillExecution({
    messages: skillMessages,
    skillMode: valid.skillMode,
    env,
  });
  const effectiveMessages = injectSkillSystemPrompt(valid.body.messages, skillCtx.systemPrompt);
  const effectiveBody = { ...valid.body, messages: effectiveMessages };
  const previewHeaders = skillResponseHeaders(skillCtx);

  type SuccessPayload = {
    response: Response;
    member: ResolvedRouterMember;
    apiFormat: ApiFormat;
  };

  const candidates = resolved.members.map((m) => ({ ...m, id: m.memberId }));
  const providerKeysCache = new Map<string, Awaited<ReturnType<typeof listProviderKeys>>>();

  const failover = await executeWithRouterFailover<typeof candidates[number], SuccessPayload>({
    routerId: resolved.router.id,
    members: candidates,
    scheduler: serverRouterScheduler,
    maxAttempts: ROUTER_MAX_FAILOVER_ATTEMPTS,
    execute: async (member, { markStreamStarted }) => {
      if (member.billingSource === "site" && member.providerRow) {
        const provider = member.providerRow;
        let keys = providerKeysCache.get(provider.id);
        if (!keys) {
          keys = await listProviderKeys(env, provider.id).catch(() => []);
          providerKeysCache.set(provider.id, keys);
        }
        const build = (apiKey: string) =>
          Promise.resolve(
            buildUpstreamRequest(
              provider,
              apiKey,
              { ...effectiveBody, model: member.upstreamId },
              valid.stream,
            ),
          );
        const outcome = await callWithRotation(env, provider, keys, build, (line) => {
          console.warn(`[server-chat:router] ${line}`);
        });
        if (!outcome.response) {
          const failure = outcome.failure ?? { status: 503, message: "Upstream model unavailable." };
          return {
            ok: false,
            error: {
              status: failure.status,
              message: failure.message,
              timeout: failure.status === 504,
            },
          };
        }
        markStreamStarted();
        return {
          ok: true,
          value: { response: outcome.response, member, apiFormat: provider.api_format },
        };
      }

      if (member.billingSource === "byok" && member.userProviderRow) {
        const providerRow = userProviderToProviderRow(member.userProviderRow);
        const decrypted = await decryptUserProviderKey(env, member.userProviderRow.api_key_ciphertext);
        if (!decrypted.ok) {
          return {
            ok: false,
            error: { status: 503, message: "Could not read provider credentials." },
          };
        }
        const upstreamReq = buildUpstreamRequest(
          providerRow,
          decrypted.apiKey,
          { ...effectiveBody, model: member.upstreamId },
          valid.stream,
        );
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30_000);
        try {
          const resp = await safeFetch(
            new URL(upstreamReq.url),
            {
              ...upstreamReq.init,
              signal: controller.signal,
            },
            { timeoutMs: 30_000 },
          );
          clearTimeout(timer);
          if (!resp.ok) {
            const text = await resp.text().catch(() => "");
            return {
              ok: false,
              error: {
                status: resp.status,
                message: extractUpstreamError(text) || `HTTP ${resp.status}`,
              },
            };
          }
          markStreamStarted();
          return {
            ok: true,
            value: { response: resp, member, apiFormat: providerRow.api_format },
          };
        } catch (err) {
          clearTimeout(timer);
          const timedOut = err instanceof Error && err.name === "AbortError";
          return {
            ok: false,
            error: {
              status: timedOut ? 504 : 502,
              message: timedOut ? "Upstream model timed out." : "Upstream model unreachable.",
              timeout: timedOut,
              network: !timedOut,
            },
          };
        }
      }

      return {
        ok: false,
        error: { status: 503, message: "Router member is misconfigured." },
      };
    },
  });

  if (!failover.ok || !failover.value) {
    const firstMember = resolved.members[0];
    void recordUsage(env, {
      user_id: profile.id,
      provider_id: billingSource === "site" ? (firstMember?.providerId ?? null) : null,
      model_id: billingSource === "site" ? (firstMember?.modelId ?? null) : null,
      model_name: resolved.router.name,
      provider_name: firstMember?.providerName ?? "Router",
      prompt_tokens: valid.promptEstimate,
      completion_tokens: 0,
      credits_charged: 0,
      billing_source: billingSource,
      status: (failover.status ?? 502) >= 500 ? "error" : "rejected",
      latency_ms: Date.now() - started,
    });
    return jsonError(
      request,
      env,
      failover.status ?? 503,
      failover.error ?? "All router attempts failed. Please try again shortly.",
      "router_failover_exhausted",
    );
  }

  const { response: upstream, member, apiFormat } = failover.value;
  const contentType = upstream.headers.get("content-type") ?? "";
  const baseRecord = {
    user_id: profile.id,
    provider_id: billingSource === "site" ? member.providerId : null,
    model_id: billingSource === "site" ? member.modelId : null,
    model_name: member.displayName,
    provider_name: member.providerName,
    prompt_tokens: valid.promptEstimate,
    billing_source: billingSource,
  };
  const routerHeaders = {
    "X-Router-Id": resolved.router.id,
    "X-Router-Model": member.displayName,
    "X-Router-Attempts": String(failover.attempts.length),
  };

  if (valid.stream && contentType.includes("event-stream") && upstream.body) {
    const charge = shouldChargeCredits(billingSource) ? 1 : 0;
    if (charge > 0) await consumeCredit(env, profile.id, charge);
    const stream = upstream.body.pipeThrough(
      normalizeStream(apiFormat, upstream.body, async (stats) => {
        await recordUsage(env, {
          ...baseRecord,
          prompt_tokens: stats.promptTokens ?? valid.promptEstimate,
          completion_tokens: stats.completionTokens ?? estimateTokens("x".repeat(Math.max(0, stats.textChars))),
          credits_charged: charge,
          status: stats.streamError ? "error" : "ok",
          latency_ms: Date.now() - started,
        });
      }),
    );
    return new Response(stream, {
      status: 200,
      headers: apiHeaders(request, env, {
        "X-Billing-Source": billingSource,
        "X-Credits-Charged": String(charge),
        ...routerHeaders,
        ...previewHeaders,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      }),
    });
  }

  const payload = await upstream.json().catch(() => null);
  const normalized = normalizeJson(apiFormat, payload);
  const text = normalized.choices[0]?.message.content ?? "";
  const charge = text && shouldChargeCredits(billingSource) ? 1 : 0;
  if (charge > 0) await consumeCredit(env, profile.id, charge);
  await recordUsage(env, {
    ...baseRecord,
    prompt_tokens: normalized.usage?.prompt_tokens ?? valid.promptEstimate,
    completion_tokens: normalized.usage?.completion_tokens ?? estimateTokens(text),
    credits_charged: charge,
    status: text ? "ok" : "empty",
    latency_ms: Date.now() - started,
  });

  return new Response(JSON.stringify(normalized), {
    status: 200,
    headers: apiHeaders(request, env, {
      "X-Billing-Source": billingSource,
      "X-Credits-Charged": String(charge),
      ...routerHeaders,
      ...previewHeaders,
      "Content-Type": "application/json; charset=utf-8",
    }),
  });
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
  if (auth.profile.status !== "active") {
    const info = quotaMessage("blocked");
    return jsonError(request, env, 403, info.message, info.code);
  }

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

  // -------------------------------------------------------------------------
  // Path 0: Free Model Router (Round-robin + 3-attempt pre-stream failover)
  // -------------------------------------------------------------------------
  if (valid.routerId) {
    return executeRouterChat(request, env, auth.profile, valid, valid.routerId);
  }

  // -------------------------------------------------------------------------
  // Path 1: Inline user-supplied BYOK provider — 0 credits deducted
  // -------------------------------------------------------------------------
  if (valid.customProvider) {
    const cp = valid.customProvider;
    const now = new Date().toISOString();
    const providerRow: ProviderRow = {
      id: "custom-byok",
      name: cp.name,
      base_url: cp.baseUrl,
      api_format: cp.apiFormat,
      auth_header: cp.authHeader,
      auth_prefix: cp.authPrefix,
      extra_headers: cp.extraHeaders,
      icon: null,
      color: null,
      notes: null,
      enabled: true,
      created_at: now,
      updated_at: now,
    };
    return executeByokChat(request, env, auth.profile.id, valid, {
      provider: providerRow,
      apiKey: cp.apiKey,
      upstreamModelId: valid.body.model,
      modelDisplayName: valid.body.model,
      userProviderId: null,
    });
  }

  // -------------------------------------------------------------------------
  // Path 2: Explicit saved user-owned provider / model — 0 credits deducted
  // -------------------------------------------------------------------------
  if (valid.userProviderId || valid.userModelId) {
    let resolvedProvider = null;
    let upstreamModelId = valid.body.model;
    let modelDisplayName = valid.body.model;

    if (valid.userModelId) {
      const match = await getUserModelWithProvider(env, auth.profile.id, valid.userModelId);
      if (!match || (valid.userProviderId && match.provider.id !== valid.userProviderId)) {
        return jsonError(request, env, 404, "Your custom model is not available.", "model_unavailable");
      }
      resolvedProvider = match.provider;
      upstreamModelId = match.model.upstream_id;
      modelDisplayName = match.model.display_name;
    } else if (valid.userProviderId) {
      const provider = await getUserProvider(env, auth.profile.id, valid.userProviderId);
      if (!provider || !provider.enabled) {
        return jsonError(request, env, 404, "Your custom provider is not available.", "model_unavailable");
      }
      resolvedProvider = provider;
      const savedModel = await getUserModelForProvider(env, auth.profile.id, provider.id, valid.body.model);
      if (savedModel) {
        upstreamModelId = savedModel.upstream_id;
        modelDisplayName = savedModel.display_name;
      }
    }

    if (!resolvedProvider) {
      return jsonError(request, env, 404, "Your custom provider is not available.", "model_unavailable");
    }

    const decrypted = await decryptUserProviderKey(env, resolvedProvider.api_key_ciphertext);
    if (!decrypted.ok) {
      return jsonError(request, env, 503, "The server could not read your stored provider credentials.");
    }

    return executeByokChat(request, env, auth.profile.id, valid, {
      provider: userProviderToProviderRow(resolvedProvider),
      apiKey: decrypted.apiKey,
      upstreamModelId,
      modelDisplayName,
      userProviderId: resolvedProvider.id,
    });
  }

  // -------------------------------------------------------------------------
  // Path 3: Default catalog model lookup (with automatic saved user-model fallback)
  // -------------------------------------------------------------------------
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

  // If the model ID is not a site default model, check whether it belongs to
  // the signed-in user's own added providers BEFORE enforcing site credits/quotas.
  if (!catalog) {
    const userMatch = await getUserModelWithProvider(env, auth.profile.id, valid.body.model);
    if (userMatch) {
      const decrypted = await decryptUserProviderKey(env, userMatch.provider.api_key_ciphertext);
      if (!decrypted.ok) {
        return jsonError(request, env, 503, "The server could not read your stored provider credentials.");
      }
      return executeByokChat(request, env, auth.profile.id, valid, {
        provider: userProviderToProviderRow(userMatch.provider),
        apiKey: decrypted.apiKey,
        upstreamModelId: userMatch.model.upstream_id,
        modelDisplayName: userMatch.model.display_name,
        userProviderId: userMatch.provider.id,
      });
    }
    // Diagnose whether the model exists and is enabled, yet hasn't passed
    // upstream provider verification (`upstream_verified = false`), so operators
    // and clients get an actionable error instead of an opaque 404.
    try {
      const unverified = await sbJson<Array<{ id: string; enabled: boolean; upstream_verified: boolean }>>(
        env,
        `catalog_models?select=id,enabled,upstream_verified&id=eq.${encodeURIComponent(valid.body.model)}&limit=1`,
      );
      if (unverified[0] && unverified[0].enabled && !unverified[0].upstream_verified) {
        return jsonError(
          request,
          env,
          503,
          "This model is enabled but has not passed provider verification yet. Run Test on its provider in the admin panel.",
          "model_unverified",
        );
      }
    } catch {
      // Ignore diagnostic lookup failures and fall back to standard 404.
    }
    return jsonError(request, env, 404, "This model is not available.", "model_unavailable");
  }

  // -------------------------------------------------------------------------
  // Site default model — enforce quota & credits, deduct 1 credit on success
  // -------------------------------------------------------------------------
  const billingSource: BillingSource = "site";
  if (shouldChargeCredits(billingSource) && typeof auth.profile.credits === "number" && auth.profile.credits <= 0) {
    return jsonError(
      request,
      env,
      402,
      "You have used all your credits. Contact the administrator or add more credits to continue.",
      "credits_exhausted",
    );
  }

  if (catalog.site_paid) {
    return jsonError(request, env, 403, "This model is reserved for paid plans.", "model_paid");
  }
  const provider = one(catalog.providers);
  if (!provider) {
    return jsonError(request, env, 404, "This model is not available.", "model_unavailable");
  }

  // Quota check and provider key lookup are independent: run them in parallel
  // so first-token latency does not pay for two sequential DB round trips.
  const [quota, keysResult] = await Promise.all([
    checkQuota(env, auth.profile, settings),
    listProviderKeys(env, provider.id).then(
      (list) => ({ ok: true as const, keys: list }),
      () => ({ ok: false as const, keys: [] }),
    ),
  ]);
  if (!quota.allowed && quota.reason) {
    const info = quotaMessage(quota.reason);
    return jsonError(request, env, quota.reason === "blocked" ? 403 : 429, info.message, info.code);
  }
  if (!keysResult.ok) {
    return jsonError(request, env, 503, "Models are temporarily unavailable. Please try again shortly.");
  }
  const keys = keysResult.keys;

  const started = Date.now();
  const intentJudge: PreviewAiJudge = async (promptMessages) => {
    const judgeOutcome = await callWithRotation(
      env,
      provider,
      keys,
      (apiKey) =>
        Promise.resolve(
          buildUpstreamRequest(
            provider,
            apiKey,
            {
              model: catalog.upstream_id,
              messages: promptMessages.map((m) => ({
                role: m.role as "system" | "user" | "assistant",
                content: m.content,
              })),
              temperature: 0,
              max_tokens: 48,
            },
            false,
          ),
        ),
    );
    if (!judgeOutcome.response) return null;
    const json = await judgeOutcome.response.json().catch(() => null);
    const normalized = normalizeJson(provider.api_format, json);
    return normalized.choices[0]?.message.content ?? null;
  };

  const skillMessages = toSkillMessages(valid.body.messages);
  const skillCtx = await resolveSkillExecution({
    messages: skillMessages,
    skillMode: valid.skillMode,
    env,
    aiJudge: intentJudge,
  });
  const effectiveMessages = injectSkillSystemPrompt(valid.body.messages, skillCtx.systemPrompt);
  const effectiveBody = { ...valid.body, messages: effectiveMessages };

  const build = (apiKey: string) => {
    const upstreamRequest = buildUpstreamRequest(
      provider,
      apiKey,
      { ...effectiveBody, model: catalog.upstream_id },
      valid.stream,
    );
    return Promise.resolve(upstreamRequest);
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
    billing_source: billingSource,
  };

  if (!outcome.response) {
    const failure = outcome.failure ?? { status: 503, message: "This model is temporarily unavailable." };
    void recordUsage(env, {
      ...baseRecord,
      completion_tokens: 0,
      credits_charged: 0,
      status: failure.status >= 500 ? "error" : "rejected",
      latency_ms: Date.now() - started,
    });
    return jsonError(request, env, failure.status, failure.message, "model_unavailable");
  }

  const upstream = outcome.response;
  const contentType = upstream.headers.get("content-type") ?? "";
  const previewHeaders = skillResponseHeaders(skillCtx);

  if (valid.stream && contentType.includes("event-stream") && upstream.body) {
    const charge = shouldChargeCredits(billingSource) ? 1 : 0;
    if (charge > 0) await consumeCredit(env, auth.profile.id, charge);
    const stream = upstream.body.pipeThrough(
      normalizeStream(provider.api_format, upstream.body, async (stats) => {
        await recordUsage(env, {
          ...baseRecord,
          prompt_tokens: stats.promptTokens ?? valid.promptEstimate,
          completion_tokens: stats.completionTokens ?? estimateTokens("x".repeat(Math.max(0, stats.textChars))),
          credits_charged: charge,
          status: stats.streamError ? "error" : "ok",
          latency_ms: Date.now() - started,
        });
      }),
    );
    return new Response(stream, {
      status: 200,
      headers: apiHeaders(request, env, {
        "X-Billing-Source": billingSource,
        "X-Credits-Charged": String(charge),
        ...previewHeaders,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      }),
    });
  }

  const payload = await upstream.json().catch(() => null);
  const normalized = normalizeJson(provider.api_format, payload);
  const text = normalized.choices[0]?.message.content ?? "";
  const charge = text && shouldChargeCredits(billingSource) ? 1 : 0;
  if (charge > 0) await consumeCredit(env, auth.profile.id, charge);
  await recordUsage(env, {
    ...baseRecord,
    prompt_tokens: normalized.usage?.prompt_tokens ?? valid.promptEstimate,
    completion_tokens: normalized.usage?.completion_tokens ?? estimateTokens(text),
    credits_charged: charge,
    status: text ? "ok" : "empty",
    latency_ms: Date.now() - started,
  });

  return new Response(JSON.stringify(normalized), {
    status: 200,
    headers: apiHeaders(request, env, {
      "X-Billing-Source": billingSource,
      "X-Credits-Charged": String(charge),
      ...previewHeaders,
      "Content-Type": "application/json; charset=utf-8",
    }),
  });
}

export function profileDisplay(profile: ProfileRow): string {
  return profile.display_name ?? profile.email;
}
