// Shared server logic upstream; update API callers when changing its contract.
import type { ApiFormat, ProviderRow } from "./providerKeys";
import { normalizeProviderBaseUrl } from "./urlGuard";

export interface ChatBody {
  model: string;
  messages: { role: string; content: unknown }[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  [key: string]: unknown;
}

function joinPath(base: string, path: string, format: ApiFormat): string {
  // Same canonical form the browser uses on save, so rows written before this
  // rule existed (https://api.openai.com instead of /v1) still resolve.
  const clean = normalizeProviderBaseUrl(base, format);
  if (clean.endsWith(path)) return clean;
  return `${clean}${path}`;
}

function textOfContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
        ? ((part as { text: string }).text)
        : ""))
      .join("");
  }
  return "";
}

/** Auth + custom headers for a provider. Never returned to the browser. */
export function authHeadersFor(provider: ProviderRow, key: string): Record<string, string> {
  return headerValue(provider, key);
}

function headerValue(provider: ProviderRow, key: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(provider.extra_headers ?? {}) };
  if (provider.auth_header) {
    headers[provider.auth_header] = `${provider.auth_prefix ?? ""}${key}`;
  }
  return headers;
}

export function buildUpstreamRequest(
  provider: ProviderRow,
  apiKey: string,
  body: ChatBody,
  stream: boolean,
): { url: string; init: RequestInit } {
  const headers = headerValue(provider, apiKey);
  const format: ApiFormat = provider.api_format ?? "openai";

  if (format === "anthropic") {
    const system = body.messages
      .filter((message) => message.role === "system")
      .map((message) => textOfContent(message.content))
      .join("\n\n");
    const messages = body.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({ role: message.role === "assistant" ? "assistant" : "user", content: message.content }));
    const payload: Record<string, unknown> = {
      model: body.model,
      messages,
      max_tokens: Math.max(1, Number(body.max_tokens ?? 4096)),
      temperature: body.temperature ?? 0.7,
      stream,
    };
    if (body.top_p !== undefined) payload.top_p = body.top_p;
    if (system) payload.system = system;
    headers["anthropic-version"] = headers["anthropic-version"] ?? "2023-06-01";
    return {
      url: joinPath(provider.base_url, "/messages", format),
      init: { method: "POST", headers, body: JSON.stringify(payload) },
    };
  }

  if (format === "gemini") {
    const system = body.messages
      .filter((message) => message.role === "system")
      .map((message) => textOfContent(message.content))
      .join("\n\n");
    const contents = body.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: textOfContent(message.content) }],
      }));
    const payload: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: body.temperature ?? 0.7,
        topP: body.top_p ?? 1,
        maxOutputTokens: Math.max(1, Number(body.max_tokens ?? 4096)),
      },
    };
    if (system) payload.systemInstruction = { parts: [{ text: system }] };
    const key = provider.auth_header ? "" : apiKey;
    const url = `${normalizeProviderBaseUrl(provider.base_url, format)}/models/${encodeURIComponent(body.model)}:${
      stream ? "streamGenerateContent?alt=sse" : "generateContent"
    }`;
    if (key) headers["x-goog-api-key"] = key;
    return { url, init: { method: "POST", headers, body: JSON.stringify(payload) } };
  }

  const payload = {
    model: body.model,
    messages: body.messages,
    stream,
    ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    ...(body.top_p !== undefined ? { top_p: body.top_p } : {}),
    ...(body.max_tokens !== undefined ? { max_tokens: body.max_tokens } : {}),
  };
  if (stream) Object.assign(payload, { stream_options: { include_usage: true } });
  return {
    url: joinPath(provider.base_url, "/chat/completions", format),
    init: { method: "POST", headers, body: JSON.stringify(payload) },
  };
}

export interface NormalizedJson {
  choices: { message: { content: string }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function normalizeJson(format: ApiFormat, payload: unknown): NormalizedJson {
  const root = (payload ?? {}) as Record<string, unknown>;
  if (format === "anthropic") {
    const content = Array.isArray(root.content) ? root.content : [];
    const text = content
      .map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
        ? ((part as { text: string }).text)
        : ""))
      .join("");
    const usage = root.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    return {
      choices: [{ message: { content: text }, finish_reason: typeof root.stop_reason === "string" ? root.stop_reason : undefined }],
      usage: { prompt_tokens: usage?.input_tokens, completion_tokens: usage?.output_tokens },
    };
  }
  if (format === "gemini") {
    const candidates = Array.isArray(root.candidates) ? root.candidates : [];
    const first = (candidates[0] ?? {}) as { content?: { parts?: unknown[] }; finishReason?: string };
    const text = (first.content?.parts ?? [])
      .map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
        ? ((part as { text: string }).text)
        : ""))
      .join("");
    const usage = root.usageMetadata as
      | { promptTokenCount?: number; candidatesTokenCount?: number }
      | undefined;
    return {
      choices: [{ message: { content: text }, finish_reason: first.finishReason }],
      usage: { prompt_tokens: usage?.promptTokenCount, completion_tokens: usage?.candidatesTokenCount },
    };
  }
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const first = (choices[0] ?? {}) as {
    message?: { content?: unknown };
    finish_reason?: string;
  };
  const usage = root.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
  return {
    choices: [
      {
        message: { content: textOfContent(first.message?.content) },
        finish_reason: first.finish_reason,
      },
    ],
    usage: { prompt_tokens: usage?.prompt_tokens, completion_tokens: usage?.completion_tokens },
  };
}

interface StreamStats {
  textChars: number;
  promptTokens?: number;
  completionTokens?: number;
}

/**
 * Convert Anthropic/Gemini SSE into OpenAI-compatible chunks and track output
 * size so the caller can record usage without storing message content.
 */
export function normalizeStream(
  format: ApiFormat,
  upstream: ReadableStream<Uint8Array>,
  onDone: (stats: StreamStats) => void,
): TransformStream<Uint8Array, Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const stats: StreamStats = { textChars: 0 };
  let buffer = "";

  const emit = (controller: TransformStreamDefaultController<Uint8Array>, value: unknown) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
  };

  const handleEvent = (controller: TransformStreamDefaultController<Uint8Array>, data: string) => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    if (format === "anthropic") {
      const type = parsed.type;
      if (type === "content_block_delta") {
        const delta = parsed.delta as { text?: string } | undefined;
        if (delta?.text) {
          stats.textChars += delta.text.length;
          emit(controller, { choices: [{ delta: { content: delta.text } }] });
        }
      } else if (type === "message_delta") {
        const usage = parsed.usage as { input_tokens?: number; output_tokens?: number } | undefined;
        if (usage) {
          stats.promptTokens = usage.input_tokens;
          stats.completionTokens = usage.output_tokens;
        }
        const delta = parsed.delta as { stop_reason?: string } | undefined;
        emit(controller, { choices: [{ delta: {}, finish_reason: delta?.stop_reason ?? "stop" }] });
      }
      return;
    }
    if (format === "gemini") {
      const candidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
      const first = (candidates[0] ?? {}) as { content?: { parts?: unknown[] }; finishReason?: string };
      const text = (first.content?.parts ?? [])
        .map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
          ? ((part as { text: string }).text)
          : ""))
        .join("");
      if (text) {
        stats.textChars += text.length;
        emit(controller, { choices: [{ delta: { content: text } }] });
      }
      const usage = parsed.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;
      if (usage) {
        stats.promptTokens = usage.promptTokenCount;
        stats.completionTokens = usage.candidatesTokenCount;
      }
      if (first.finishReason) emit(controller, { choices: [{ delta: {}, finish_reason: first.finishReason }] });
      return;
    }
    // OpenAI: pass through untouched; count content and scavenge usage.
    const usage = parsed.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
    if (usage) {
      stats.promptTokens = usage.prompt_tokens;
      stats.completionTokens = usage.completion_tokens;
    }
    const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
    const delta = (choices[0] as { delta?: { content?: unknown } } | undefined)?.delta;
    if (typeof delta?.content === "string") stats.textChars += delta.content.length;
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      // Some providers delimit SSE events with CRLF; accept both so a CRLF
      // stream is parsed instead of silently buffering until the end.
      let match = /\r?\n\r?\n/.exec(buffer);
      while (match) {
        const raw = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        for (const line of raw.split(/\r?\n/)) {
          if (line.startsWith("data:")) handleEvent(controller, line.slice(5).trim());
        }
        match = /\r?\n\r?\n/.exec(buffer);
      }
      if (format === "openai") controller.enqueue(chunk);
    },
    flush(controller) {
      const tail = buffer.trim();
      if (tail) {
        for (const line of tail.split(/\r?\n/)) {
          if (line.startsWith("data:")) handleEvent(controller, line.slice(5).trim());
        }
      }
      if (format !== "openai") {
        const usage = {
          ...(stats.promptTokens !== undefined ? { prompt_tokens: stats.promptTokens } : {}),
          ...(stats.completionTokens !== undefined ? { completion_tokens: stats.completionTokens } : {}),
        };
        emit(controller, { choices: [{ delta: {}, finish_reason: "stop" }], usage });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      }
      onDone(stats);
    },
  });
}
