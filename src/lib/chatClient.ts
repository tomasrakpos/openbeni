// Shared logic chatClient; change this helper here and update callers if its contract changes.
import {
  classifyException,
  classifyHttpStatus,
  COARENA_ENDPOINTS,
  extractErrorMessage,
  makeApiError,
  makeHttpError,
  readJsonSafe,
  redactKey,
  requestHeaders,
  resolveProxyUrl,
  timedFetch,
  proxiedUrl,
} from "@/lib/http";
import { redactSecrets } from "@/lib/errors";
import { joinUrl } from "@/lib/normalize";
import { SSEDecoder, getPath, parseStreamEvent } from "@/lib/sse";
import type {
  ChatMessageInput,
  ChatParams,
  ModelPricing,
  Provider,
  StreamDelta,
  StreamUsage,
} from "@/lib/types";

export function defaultChatPath(provider: Provider, modelId: string): string {
  if (provider.apiFormat === "custom") {
    const endpoint = provider.custom?.endpoint?.trim() || "/chat/completions";
    return endpoint.replace(/\{\{\s*model\s*\}\}/g, encodeURIComponent(stripModelsPrefix(modelId)));
  }
  const override = provider.paths.chat?.trim();
  if (override) return override.replace(/\{\{\s*model\s*\}\}/g, encodeURIComponent(stripModelsPrefix(modelId)));
  switch (provider.apiFormat) {
    case "anthropic":
      return "/messages";
    case "gemini":
      return `/models/${encodeURIComponent(stripModelsPrefix(modelId))}:streamGenerateContent?alt=sse`;
    default:
      return "/chat/completions";
  }
}

export function isManagedProvider(provider: Provider): boolean {
  return provider.managed === true;
}

export function modelsUrl(provider: Provider): string {
  if (isManagedProvider(provider)) return COARENA_ENDPOINTS.models;
  const override = provider.paths.models?.trim() || provider.custom?.modelsPath?.trim();
  if (override) return joinUrl(provider.baseUrl, override);
  return joinUrl(provider.baseUrl, "/models");
}

export function chatUrl(provider: Provider, modelId: string): string {
  if (isManagedProvider(provider)) return COARENA_ENDPOINTS.chat;
  return joinUrl(provider.baseUrl, defaultChatPath(provider, modelId));
}

export function stripModelsPrefix(modelId: string): string {
  return modelId.replace(/^models\//i, "");
}

function imagePart(format: Provider["apiFormat"], image: { mimeType: string; data: string }) {
  if (format === "anthropic") {
    return { type: "image", source: { type: "base64", media_type: image.mimeType, data: image.data } };
  }
  if (format === "gemini") {
    return { inlineData: { mimeType: image.mimeType, data: image.data } };
  }
  return { type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.data}` } };
}

export function buildOpenAIMessages(messages: ChatMessageInput[]) {
  return messages.map((m) => {
    const hasMedia = (m.images && m.images.length > 0) || (m.videos && m.videos.length > 0);
    if (!hasMedia) return { role: m.role, content: m.content };
    const parts: unknown[] = [];
    if (m.content) parts.push({ type: "text", text: m.content });
    for (const image of m.images ?? []) parts.push(imagePart("openai", image));
    for (const video of m.videos ?? []) {
      parts.push({ type: "video_url", video_url: { url: `data:${video.mimeType};base64,${video.data}` } });
    }
    return { role: m.role, content: parts };
  });
}

export function buildAnthropicMessages(messages: ChatMessageInput[]) {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      const parts: unknown[] = [];
      if (m.content) parts.push({ type: "text", text: m.content });
      for (const image of m.images ?? []) parts.push(imagePart("anthropic", image));
      const content = parts.length === 0 ? m.content : parts.length === 1 && m.content ? m.content : parts;
      return { role: m.role, content };
    });
}

export function buildGeminiContents(messages: ChatMessageInput[]) {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      const parts: unknown[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const image of m.images ?? []) parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
      for (const video of m.videos ?? []) parts.push({ inlineData: { mimeType: video.mimeType, data: video.data } });
      return { role: m.role === "assistant" ? "model" : "user", parts };
    });
}

export function renderTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) => {
    if (!(key in vars)) return match;
    return JSON.stringify(vars[key]);
  });
}

export function buildBody(
  provider: Provider,
  modelId: string,
  messages: ChatMessageInput[],
  params: ChatParams,
  stream: boolean,
): Record<string, unknown> {
  const systemMessages = messages.filter((m) => m.role === "system");
  const system = systemMessages.map((m) => m.content).join("\n\n");
  switch (provider.apiFormat) {
    case "anthropic": {
      const body: Record<string, unknown> = {
        model: stripModelsPrefix(modelId),
        max_tokens: Math.max(1, params.maxTokens || 4096),
        messages: buildAnthropicMessages(messages),
        stream,
        temperature: params.temperature,
      };
      if (params.topP < 1) body.top_p = params.topP;
      if (system) body.system = system;
      return body;
    }
    case "gemini": {
      const body: Record<string, unknown> = {
        contents: buildGeminiContents(messages),
        generationConfig: {
          temperature: params.temperature,
          topP: params.topP,
          maxOutputTokens: params.maxTokens,
        },
      };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      return body;
    }
    case "custom": {
      const template = provider.custom?.bodyTemplate ?? "";
      if (!template.trim()) throw makeApiError("unknown", "Custom body template is empty");
      const messagesForTemplate = messages.map((m) => ({ role: m.role, content: m.content }));
      const rendered = renderTemplate(template, {
        model: stripModelsPrefix(modelId),
        messages: messagesForTemplate,
        temperature: params.temperature,
        top_p: params.topP,
        max_tokens: params.maxTokens,
        stream,
      });
      try {
        return JSON.parse(rendered) as Record<string, unknown>;
      } catch (err) {
        throw makeApiError(
          "unknown",
          `Custom body template is not valid JSON after substitution: ${err instanceof Error ? err.message : ""}`,
        );
      }
    }
    default: {
      const body: Record<string, unknown> = {
        model: stripModelsPrefix(modelId),
        messages: [...systemMessages, ...messages.filter((m) => m.role !== "system")].map((m) => {
          if (!m.images?.length && !m.videos?.length) return { role: m.role, content: m.content };
          const parts: unknown[] = [];
          if (m.content) parts.push({ type: "text", text: m.content });
          for (const image of m.images ?? []) parts.push(imagePart(provider.apiFormat, image));
          return { role: m.role, content: parts };
        }),
        stream,
        temperature: params.temperature,
        top_p: params.topP,
        max_tokens: params.maxTokens,
      };
      if (stream) body.stream_options = { include_usage: true };
      if (params.reasoningEffort) body.reasoning_effort = params.reasoningEffort;
      return body;
    }
  }
}

export async function listModels(
  provider: Provider,
  apiKey: string,
  proxyUrl?: string,
  signal?: AbortSignal,
): Promise<{ id: string; name?: string; contextWindow?: number; pricing?: ModelPricing }[]> {
  const url = modelsUrl(provider);
  const headers = requestHeaders(provider, apiKey);
  headers.Accept = "application/json";
  const init: RequestInit = { method: "GET", headers };
  const timeout = provider.timeoutMs;
  let response: Response;
  try {
    response = (
      await timedFetch(url, init, timeout, {
        signal,
        proxyUrl: provider.useProxy ? resolveProxyUrl(proxyUrl) : undefined,
      })
    ).response;
  } catch (err) {
    const kind = (err as { kind?: string }).kind;
    if (provider.useProxy || kind !== "cors") throw err;
    response = (
      await timedFetch(url, init, timeout, { signal, proxyUrl: resolveProxyUrl(proxyUrl) })
    ).response;
  }
  if (!response.ok) {
    const payload = await readJsonSafe(response);
    throw makeHttpError(
      response.status,
      extractErrorMessage(payload) ?? `HTTP ${response.status} from ${url}`,
    );
  }
  const payload = await readJsonSafe(response);
  return parseModelList(payload);
}

export function parseModelList(payload: unknown): { id: string; name?: string; contextWindow?: number; pricing?: ModelPricing }[] {
  const root = payload as Record<string, unknown> | null;
  let items: unknown[] = [];
  if (Array.isArray(payload)) items = payload;
  else if (root && Array.isArray(root.data)) items = root.data;
  else if (root && Array.isArray(root.models)) items = root.models;
  else if (root && root.data && Array.isArray((root.data as Record<string, unknown>).models)) {
    items = (root.data as Record<string, unknown>).models as unknown[];
  }
  const out: { id: string; name?: string; contextWindow?: number; pricing?: ModelPricing }[] = [];
  for (const item of items) {
    if (typeof item === "string") {
      out.push({ id: stripModelsPrefix(item) });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const rawId = rec.id ?? rec.name ?? rec.model ?? rec.slug;
    if (typeof rawId !== "string") continue;
    const id = stripModelsPrefix(rawId);
    const name = typeof rec.display_name === "string" ? rec.display_name : typeof rec.displayName === "string" ? rec.displayName : undefined;
    const context =
      typeof rec.context_length === "number"
        ? rec.context_length
        : typeof rec.context_window === "number"
          ? rec.context_window
          : typeof rec.inputTokenLimit === "number"
            ? rec.inputTokenLimit
            : undefined;
    let pricing: ModelPricing | undefined;
    const p = rec.pricing as Record<string, unknown> | undefined;
    if (p && (typeof p.prompt === "string" || typeof p.prompt === "number")) {
      const prompt = Number(p.prompt);
      const completion = Number(p.completion ?? 0);
      if (Number.isFinite(prompt) && Number.isFinite(completion)) {
        pricing = { prompt: prompt * 1_000_000, completion: completion * 1_000_000 };
      }
    }
    out.push({ id, name, contextWindow: context, pricing });
  }
  return out;
}

export function extractText(provider: Provider, payload: unknown): string {
  if (!payload) return "";
  if (typeof payload === "string") return payload;
  switch (provider.apiFormat) {
    case "anthropic": {
      const content = getPath(payload, "content");
      if (Array.isArray(content)) {
        return content
          .map((part) => (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string"
            ? ((part as Record<string, unknown>).text as string)
            : ""))
          .join("");
      }
      return "";
    }
    case "gemini": {
      const parts = getPath(payload, "candidates[0].content.parts");
      if (Array.isArray(parts)) {
        return parts
          .map((part) => (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string"
            ? ((part as Record<string, unknown>).text as string)
            : ""))
          .join("");
      }
      return "";
    }
    case "custom": {
      const value = getPath(payload, provider.custom?.textPath || "choices[0].message.content");
      return typeof value === "string" ? value : "";
    }
    default: {
      const value = getPath(payload, "choices[0].message.content");
      if (typeof value === "string") return value;
      const arrayValue = getPath(payload, "choices[0].delta.content");
      return typeof arrayValue === "string" ? arrayValue : "";
    }
  }
}

export interface StreamChatOptions {
  provider: Provider;
  apiKey: string;
  modelId: string;
  messages: ChatMessageInput[];
  params: ChatParams;
  signal: AbortSignal;
  proxyUrl?: string;
  onDelta: (delta: StreamDelta) => void;
}

export interface StreamChatResult {
  text: string;
  reasoning: string;
  usage: StreamUsage;
  latencyMs: number;
  firstTokenMs?: number;
  finishReason?: string;
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/**
 * Some gateways (OpenRouter in particular) reject browser-origin requests
 * outright: the CORS preflight comes back as a security-policy 403, so fetch
 * throws a TypeError before the app can read anything. If a provider was saved
 * without the proxy flag, retry once through the same-origin proxy instead of
 * surfacing an opaque "Failed to fetch".
 */
async function fetchWithCorsFallback(
  url: string,
  init: RequestInit,
  provider: Provider,
  proxyUrl: string | undefined,
): Promise<Response> {
  // Managed providers already talk to our own origin; never proxy again.
  if (isManagedProvider(provider)) return fetch(url, init);
  if (provider.useProxy) {
    return fetch(proxiedUrl(url, resolveProxyUrl(proxyUrl)), init);
  }
  try {
    return await fetch(url, init);
  } catch (err) {
    if (init.signal?.aborted || classifyException(err, false) !== "cors") throw err;
    return fetch(proxiedUrl(url, resolveProxyUrl(proxyUrl)), init);
  }
}

export async function streamChat(options: StreamChatOptions): Promise<StreamChatResult> {
  const { provider, apiKey, modelId, messages, params, signal, proxyUrl, onDelta } = options;
  const url = chatUrl(provider, modelId);
  const headers = requestHeaders(provider, apiKey);
  const body = buildBody(provider, modelId, messages, params, true);

  const started = performance.now();
  let firstTokenMs: number | undefined;
  const controller = new AbortController();
  let connectTimedOut = false;
  const connectTimer = setTimeout(() => {
    connectTimedOut = true;
    controller.abort();
  }, Math.max(5000, provider.timeoutMs));
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort, { once: true });

  let response: Response;
  try {
    response = await fetchWithCorsFallback(
      url,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store",
      },
      provider,
      proxyUrl,
    );
  } catch (err) {
    clearTimeout(connectTimer);
    signal.removeEventListener("abort", onAbort);
    if (isAbort(err) && !connectTimedOut && signal.aborted) throw makeApiError("unknown", "aborted");
    const kind = classifyException(err, connectTimedOut);
    throw makeApiError(
      kind,
      connectTimedOut
        ? `No response within ${Math.round(provider.timeoutMs / 1000)}s`
        : err instanceof Error
          ? err.message
          : "Network request failed",
    );
  }
  clearTimeout(connectTimer);

  if (!response.ok) {
    signal.removeEventListener("abort", onAbort);
    const payload = await readJsonSafe(response);
    throw makeHttpError(
      response.status,
      redactSecrets(extractErrorMessage(payload) ?? `HTTP ${response.status}`),
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  const tookHeaders = performance.now() - started;

  // A few gateways ignore stream:true and return a single JSON document.
  if (contentType.includes("application/json") && !contentType.includes("event-stream")) {
    signal.removeEventListener("abort", onAbort);
    const payload = await readJsonSafe(response);
    const text = extractText(provider, payload);
    if (!text) {
      const errMessage = redactSecrets(
        extractErrorMessage(payload) ?? "The provider returned an empty response.",
      );
      throw makeApiError("unknown", errMessage);
    }
    return { text, reasoning: "", usage: {}, latencyMs: Math.round(performance.now() - started), firstTokenMs: Math.round(tookHeaders) };
  }

  const reader = response.body?.getReader();
  if (!reader) {
    signal.removeEventListener("abort", onAbort);
    throw makeApiError("unknown", "The response has no body to stream.");
  }

  const decoder = new TextDecoder();
  const sse = new SSEDecoder();
  let text = "";
  let reasoning = "";
  let usage: StreamUsage = {};
  let finishReason: string | undefined;
  let idleTimer: number | undefined;

  const resetIdle = () => {
    if (idleTimer) window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => controller.abort(), 90_000);
  };

  const consume = (event: import("@/lib/sse").SSEEvent) => {
    const delta = parseStreamEvent(
      provider.apiFormat,
      event,
      provider.custom?.deltaPath ?? "choices[0].delta.content",
      provider.custom?.reasoningPath,
    );
    if (!delta) return;
    if (delta.text) {
      if (firstTokenMs === undefined) firstTokenMs = Math.round(performance.now() - started);
      text += delta.text;
    }
    if (delta.reasoning) reasoning += delta.reasoning;
    if (delta.usage) usage = { ...usage, ...delta.usage };
    if (delta.finish) finishReason = delta.finish;
    onDelta(delta);
  };

  try {
    resetIdle();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      resetIdle();
      const chunk = decoder.decode(value, { stream: true });
      if (!chunk) continue;
      if (provider.apiFormat === "custom" && provider.custom?.streamMode === "json") {
        // whole-document mode: buffer, then parse on completion
        text += chunk;
        continue;
      }
      for (const event of sse.push(chunk)) consume(event);
    }
    const tail = decoder.decode();
    if (tail) for (const event of sse.push(tail)) consume(event);
    for (const event of sse.flush()) consume(event);
  } catch (err) {
    if (isAbort(err) && signal.aborted) {
      return { text, reasoning, usage, latencyMs: Math.round(performance.now() - started), firstTokenMs, finishReason: "aborted" };
    }
    if (isAbort(err)) {
      throw makeApiError("timeout", "The stream stalled for 90 seconds and was stopped.");
    }
    throw makeApiError(classifyException(err, false), err instanceof Error ? err.message : "Stream failed");
  } finally {
    if (idleTimer) window.clearTimeout(idleTimer);
    signal.removeEventListener("abort", onAbort);
  }

  if (provider.apiFormat === "custom" && provider.custom?.streamMode === "json") {
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
    const extracted = extractText(provider, payload);
    text = extracted || text;
  }

  return {
    text,
    reasoning,
    usage,
    latencyMs: Math.round(performance.now() - started),
    firstTokenMs,
    finishReason,
  };
}

export interface TestModelResult {
  ok: boolean;
  latencyMs: number;
  kind: ReturnType<typeof classifyHttpStatus> | "timeout" | "cors" | "network" | "unknown";
  message?: string;
  tokens?: number;
}

export async function testModel(
  provider: Provider,
  apiKey: string,
  modelId: string,
  proxyUrl?: string,
  signal?: AbortSignal,
): Promise<TestModelResult> {
  const url = chatUrl(provider, modelId);
  const headers = requestHeaders(provider, apiKey);
  const params: ChatParams = { temperature: 0, topP: 1, maxTokens: 1 };
  let body: Record<string, unknown>;
  try {
    body = buildBody(provider, modelId, [{ role: "user", content: "ping" }], params, false);
  } catch (err) {
    return { ok: false, latencyMs: 0, kind: "unknown", message: err instanceof Error ? err.message : "Invalid template" };
  }
  const started = performance.now();
  try {
    const init: RequestInit = { method: "POST", headers, body: JSON.stringify(body) };
    const first = await timedFetch(url, init, 15_000, {
      signal,
      proxyUrl: provider.useProxy ? resolveProxyUrl(proxyUrl) : undefined,
    }).catch(async (err: { kind?: string }) => {
      if (provider.useProxy || err.kind !== "cors") throw err;
      return timedFetch(url, init, 15_000, { signal, proxyUrl: resolveProxyUrl(proxyUrl) });
    });
    const { response, latencyMs } = first;
    const payload = await readJsonSafe(response);
    const text = extractText(provider, payload);
    if (!response.ok) {
      return {
        ok: false,
        latencyMs,
        kind: classifyHttpStatus(response.status),
        message: redactSecrets(extractErrorMessage(payload) ?? `HTTP ${response.status}`),
      };
    }
    return { ok: true, latencyMs, kind: "ok", tokens: text ? text.length : 0 };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started);
    if (err && typeof err === "object" && "kind" in err) {
      const apiErr = err as { kind: TestModelResult["kind"]; message?: string };
      return { ok: false, latencyMs, kind: apiErr.kind, message: apiErr.message };
    }
    return { ok: false, latencyMs, kind: "unknown", message: err instanceof Error ? err.message : "Request failed" };
  }
}
