// Shared logic serverChat; change this helper here and update callers if its contract changes.
import { currentAccessToken, getSupabaseAsync } from "@/lib/supabase";
import { classifyHttpStatus, makeApiError, type ApiError } from "@/lib/http";
import { redactSecrets } from "@/lib/errors";
import { SSEDecoder, parseStreamEvent, type SSEEvent } from "@/lib/sse";
import type { ChatParams, SkillId, SkillMode, StreamDelta, StreamUsage } from "@/lib/types";

export interface ServerChatResult {
  text: string;
  reasoning: string;
  usage: StreamUsage;
  latencyMs: number;
  firstTokenMs?: number;
  finishReason?: string;
  previewIntent?: boolean;
  previewCategory?: string;
  skillId?: SkillId;
  skillSourcesCount?: number;
}

export interface ServerChatOptions {
  modelId: string;
  routerId?: string;
  messages: { role: string; content: string }[];
  params: ChatParams;
  skillMode?: SkillMode;
  signal: AbortSignal;
  onDelta: (delta: StreamDelta) => void;
  onPreviewIntent?: (enabled: boolean, category?: string) => void;
  onSkillResolved?: (skillId: SkillId, sourcesCount: number) => void;
}

export interface BackendSearchSource {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

export interface BackendPreviewIntent {
  needsPreview: boolean;
  category: string;
  source?: string;
  skillId?: SkillId;
  skillSource?: string;
  webSources?: BackendSearchSource[];
  imageAssets?: Array<{ title: string; url: string }>;
  systemPrompt?: string;
  /** Backwards-compatible alias for systemPrompt. */
  builderSystemPrompt?: string;
}

function parseSkillIdHeader(raw: string | null): SkillId | undefined {
  if (raw === "chat" || raw === "web_builder" || raw === "game_builder" || raw === "deep_research") {
    return raw;
  }
  return undefined;
}

/**
 * Calls the same-origin backend `/api/preview-intent` endpoint to resolve the
 * active skill (`chat`, `web_builder`, `game_builder`, `deep_research`), run
 * live backend search/image lookup when needed, and return the composed skill
 * system prompt + preview-slider decision.
 */
export async function checkBackendPreviewIntent(
  messages: { role: string; content: string; hasImages?: boolean }[],
  signal?: AbortSignal,
  skillMode: SkillMode = "auto",
): Promise<BackendPreviewIntent | null> {
  try {
    const response = await fetch("/api/preview-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        skillMode,
        messages: messages.slice(-16).map((m) => ({
          role: m.role,
          content: typeof m.content === "string" ? m.content : "",
          ...(m.hasImages ? { hasImages: true } : {}),
        })),
      }),
      signal,
      cache: "no-store",
    });
    if (!response.ok) return null;
    const data = (await response.json().catch(() => null)) as
      | {
          needsPreview?: unknown;
          category?: unknown;
          source?: unknown;
          skillId?: unknown;
          skillSource?: unknown;
          webSources?: unknown;
          imageAssets?: unknown;
          systemPrompt?: unknown;
          builderSystemPrompt?: unknown;
        }
      | null;
    if (!data || typeof data.needsPreview !== "boolean") return null;
    const skillId = parseSkillIdHeader(typeof data.skillId === "string" ? data.skillId : null);
    const systemPrompt =
      typeof data.systemPrompt === "string"
        ? data.systemPrompt
        : typeof data.builderSystemPrompt === "string"
          ? data.builderSystemPrompt
          : undefined;
    return {
      needsPreview: data.needsPreview,
      category: typeof data.category === "string" ? data.category : "none",
      source: typeof data.source === "string" ? data.source : undefined,
      skillId,
      skillSource: typeof data.skillSource === "string" ? data.skillSource : undefined,
      webSources: Array.isArray(data.webSources) ? (data.webSources as BackendSearchSource[]) : [],
      imageAssets: Array.isArray(data.imageAssets)
        ? (data.imageAssets as Array<{ title: string; url: string }>)
        : [],
      systemPrompt,
      builderSystemPrompt: systemPrompt,
    };
  } catch {
    return null;
  }
}

interface ErrorPayload {
  error?: { message?: string; code?: string; status?: number };
}

function messageFor(status: number): string {
  if (status === 401) return "error.signInRequired";
  if (status === 403) return "error.accountBlocked";
  if (status === 429) return "error.quotaReached";
  if (status === 404) return "error.modelUnavailable";
  return "error.generic";
}

/**
 * Stream a site model through our same-origin `/api/chat` proxy.
 *
 * The browser sends only { model, messages, params } — never a key or a base
 * URL. The server authenticates the session, checks the quota, rotates the
 * provider key and normalizes the upstream stream to OpenAI SSE.
 */
export async function streamServerChat(options: ServerChatOptions): Promise<ServerChatResult> {
  const token = await currentAccessToken();
  if (!token) throw makeApiError("auth", "error.signInRequired");

  const started = performance.now();
  let firstTokenMs: number | undefined;

  const requestBody = JSON.stringify({
    model: options.modelId,
    ...(options.routerId ? { routerId: options.routerId } : {}),
    messages: options.messages.map((message) => ({ role: message.role, content: message.content })),
    temperature: options.params.temperature,
    top_p: options.params.topP,
    max_tokens: options.params.maxTokens,
    ...(options.skillMode && options.skillMode !== "auto" ? { skillMode: options.skillMode } : {}),
    stream: true,
  });

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal.addEventListener("abort", onAbort, { once: true });

  const sendRequest = async (accessToken: string): Promise<Response> =>
    fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${accessToken}`,
      },
      body: requestBody,
      signal: controller.signal,
      cache: "no-store",
    });

  let response: Response;
  try {
    response = await sendRequest(token);
    // If the access token expired just before sending, silently refresh once
    // and retry so the user doesn't hit an unnecessary 401 error.
    if (response.status === 401 && !options.signal.aborted) {
      const supabase = await getSupabaseAsync();
      const refreshed = supabase ? await supabase.auth.refreshSession().catch(() => null) : null;
      const freshToken = refreshed?.data?.session?.access_token;
      if (freshToken && freshToken !== token) {
        await response.body?.cancel().catch(() => undefined);
        response = await sendRequest(freshToken);
      }
    }
  } catch {
    options.signal.removeEventListener("abort", onAbort);
    if (options.signal.aborted) throw makeApiError("unknown", "aborted");
    throw makeApiError("network", "error.network");
  }

  if (!response.ok) {
    options.signal.removeEventListener("abort", onAbort);
    const payload = (await response.json().catch(() => null)) as ErrorPayload | null;
    const kind = classifyHttpStatus(response.status);
    const err = makeApiError(kind, payload?.error?.message || messageFor(response.status), response.status) as ApiError & {
      code?: string;
    };
    err.code = payload?.error?.code;
    throw err;
  }

  const previewIntentHeader = response.headers.get("x-preview-intent");
  const previewIntent = previewIntentHeader === "1";
  const previewCategory = response.headers.get("x-preview-category") ?? undefined;
  if (previewIntentHeader !== null) {
    options.onPreviewIntent?.(previewIntent, previewCategory);
  }
  const skillId = parseSkillIdHeader(response.headers.get("x-skill-id"));
  const skillSourcesRaw = Number(response.headers.get("x-skill-search-count") ?? "0");
  const skillSourcesCount = Number.isFinite(skillSourcesRaw) && skillSourcesRaw > 0 ? skillSourcesRaw : 0;
  if (skillId) {
    options.onSkillResolved?.(skillId, skillSourcesCount);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json") && !contentType.includes("event-stream")) {
    options.signal.removeEventListener("abort", onAbort);
    const payload = (await response.json().catch(() => null)) as {
      choices?: { message?: { content?: string } }[];
      usage?: StreamUsage & { prompt_tokens?: number; completion_tokens?: number };
    } | null;
    const text = payload?.choices?.[0]?.message?.content ?? "";
    const normalizedUsage: StreamUsage = {
      promptTokens: payload?.usage?.promptTokens ?? payload?.usage?.prompt_tokens,
      completionTokens: payload?.usage?.completionTokens ?? payload?.usage?.completion_tokens,
    };
    return {
      text,
      reasoning: "",
      usage: normalizedUsage,
      latencyMs: Math.round(performance.now() - started),
      previewIntent,
      previewCategory,
      skillId,
      skillSourcesCount,
    };
  }

  const reader = response.body?.getReader();
  if (!reader) {
    options.signal.removeEventListener("abort", onAbort);
    throw makeApiError("unknown", "error.generic");
  }

  const decoder = new TextDecoder();
  const sse = new SSEDecoder();
  let text = "";
  let reasoning = "";
  let usage: StreamUsage = {};
  let finishReason: string | undefined;
  let idleTimedOut = false;
  let idleTimer: number | undefined;

  const resetIdle = () => {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimedOut = true;
      controller.abort();
    }, 90_000) as unknown as number;
  };

  const consume = (event: SSEEvent) => {
    const delta = parseStreamEvent("openai", event, "choices[0].delta.content");
    if (!delta) return;
    if (delta.error) {
      throw makeApiError("server", redactSecrets(delta.error));
    }
    if (delta.text) {
      if (firstTokenMs === undefined) firstTokenMs = Math.round(performance.now() - started);
      text += delta.text;
    }
    if (delta.reasoning) reasoning += delta.reasoning;
    if (delta.usage) usage = { ...usage, ...delta.usage };
    if (delta.finish) finishReason = delta.finish;
    options.onDelta(delta);
  };

  try {
    resetIdle();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      resetIdle();
      const chunk = decoder.decode(value, { stream: true });
      if (!chunk) continue;
      for (const event of sse.push(chunk)) consume(event);
    }
    const tail = decoder.decode();
    if (tail) for (const event of sse.push(tail)) consume(event);
    for (const event of sse.flush()) consume(event);
  } catch (error) {
    if (options.signal.aborted) {
      return {
        text,
        reasoning,
        usage,
        latencyMs: Math.round(performance.now() - started),
        firstTokenMs,
        finishReason: "aborted",
      };
    }
    if (idleTimedOut) {
      throw makeApiError("timeout", "The stream stalled for 90 seconds and was stopped.");
    }
    if (error instanceof Error && "kind" in error) throw error;
    throw makeApiError("network", "error.network");
  } finally {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    options.signal.removeEventListener("abort", onAbort);
  }

  return {
    text,
    reasoning,
    usage,
    latencyMs: Math.round(performance.now() - started),
    firstTokenMs,
    finishReason,
    previewIntent,
    previewCategory,
    skillId,
    skillSourcesCount,
  };
}
