// Shared server logic upstream; update API callers when changing its contract.
import type { ApiFormat, ProviderRow } from "./providerKeys";
import { normalizeProviderBaseUrl } from "./urlGuard";

export interface UpstreamToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface NormalizedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessageParam {
  role: string;
  content: unknown;
  tool_call_id?: string;
  name?: string;
  tool_calls?: NormalizedToolCall[];
}

export interface ChatBody {
  model: string;
  messages: ChatMessageParam[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  tools?: UpstreamToolDefinition[];
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

export function formatAuthHeaderValue(prefix: string | null | undefined, key: string): string {
  const rawPrefix = prefix ?? "";
  if (!rawPrefix) return key;
  // Ensure a space after word-style schemes like "Bearer" or "Token" when the
  // trailing space was accidentally omitted (e.g. "Bearer" -> "Bearer sk-...").
  if (/[A-Za-z0-9]$/.test(rawPrefix) && !/^\s/.test(key)) {
    return `${rawPrefix} ${key}`;
  }
  return `${rawPrefix}${key}`;
}

function headerValue(provider: ProviderRow, key: string, stream = false): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: stream ? "text/event-stream, application/json" : "application/json",
    ...(stream ? { "Accept-Encoding": "identity" } : {}),
    ...(provider.extra_headers ?? {}),
  };
  if (provider.auth_header) {
    headers[provider.auth_header] = formatAuthHeaderValue(provider.auth_prefix, key);
  }
  return headers;
}

/**
 * Remove `stream_options` from a JSON RequestInit body when an OpenAI-compatible
 * upstream gateway rejects unknown fields with HTTP 400/422.
 */
export function stripStreamOptions(init: RequestInit): RequestInit | null {
  if (typeof init.body !== "string") return null;
  try {
    const parsed = JSON.parse(init.body) as Record<string, unknown>;
    if (!("stream_options" in parsed)) return null;
    delete parsed.stream_options;
    return { ...init, body: JSON.stringify(parsed) };
  } catch {
    return null;
  }
}

export function buildUpstreamRequest(
  provider: ProviderRow,
  apiKey: string,
  body: ChatBody,
  stream: boolean,
): { url: string; init: RequestInit } {
  const headers = headerValue(provider, apiKey, stream);
  const format: ApiFormat = provider.api_format ?? "openai";

  if (format === "anthropic") {
    const system = body.messages
      .filter((message) => message.role === "system")
      .map((message) => textOfContent(message.content))
      .join("\n\n");
    const messages = body.messages
      .filter((message) => message.role !== "system")
      .map((message) => {
        if (message.role === "tool") {
          return {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: message.tool_call_id ?? "tool_1",
                content: textOfContent(message.content),
              },
            ],
          };
        }
        if (message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
          const blocks: Record<string, unknown>[] = [];
          const text = textOfContent(message.content);
          if (text) blocks.push({ type: "text", text });
          for (const tc of message.tool_calls) {
            blocks.push({
              type: "tool_use",
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            });
          }
          return { role: "assistant", content: blocks };
        }
        return { role: message.role === "assistant" ? "assistant" : "user", content: message.content };
      });
    const payload: Record<string, unknown> = {
      model: body.model,
      messages,
      max_tokens: Math.max(1, Number(body.max_tokens ?? 4096)),
      temperature: body.temperature ?? 0.7,
      stream,
    };
    if (body.top_p !== undefined) payload.top_p = body.top_p;
    if (system) payload.system = system;
    if (Array.isArray(body.tools) && body.tools.length > 0) {
      payload.tools = body.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }
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
      .map((message) => {
        if (message.role === "tool") {
          return {
            role: "user",
            parts: [
              {
                functionResponse: {
                  name: message.name ?? "read_skill",
                  response: { content: textOfContent(message.content) },
                },
              },
            ],
          };
        }
        if (message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
          const parts: Record<string, unknown>[] = [];
          const text = textOfContent(message.content);
          if (text) parts.push({ text });
          for (const tc of message.tool_calls) {
            parts.push({
              functionCall: {
                name: tc.name,
                args: tc.arguments,
              },
            });
          }
          return { role: "model", parts };
        }
        return {
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: textOfContent(message.content) }],
        };
      });
    const payload: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: body.temperature ?? 0.7,
        topP: body.top_p ?? 1,
        maxOutputTokens: Math.max(1, Number(body.max_tokens ?? 4096)),
      },
    };
    if (system) payload.systemInstruction = { parts: [{ text: system }] };
    if (Array.isArray(body.tools) && body.tools.length > 0) {
      payload.tools = [
        {
          functionDeclarations: body.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ];
    }
    const key = provider.auth_header ? "" : apiKey;
    const cleanModel = body.model.replace(/^models\//i, "");
    const url = `${normalizeProviderBaseUrl(provider.base_url, format)}/models/${encodeURIComponent(cleanModel)}:${
      stream ? "streamGenerateContent?alt=sse" : "generateContent"
    }`;
    if (key) headers["x-goog-api-key"] = key;
    return { url, init: { method: "POST", headers, body: JSON.stringify(payload) } };
  }

  const openaiMessages = body.messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool",
        tool_call_id: message.tool_call_id ?? "tool_1",
        content: textOfContent(message.content),
      };
    }
    if (message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      return {
        role: "assistant",
        content: textOfContent(message.content) || null,
        tool_calls: message.tool_calls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        })),
      };
    }
    return { role: message.role, content: message.content };
  });

  const payload: Record<string, unknown> = {
    model: body.model,
    messages: openaiMessages,
    stream,
    ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    ...(body.top_p !== undefined ? { top_p: body.top_p } : {}),
    ...(body.max_tokens !== undefined ? { max_tokens: body.max_tokens } : {}),
  };
  if (Array.isArray(body.tools) && body.tools.length > 0 && format !== "custom") {
    payload.tools = body.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
    payload.tool_choice = "auto";
  }
  if (stream) Object.assign(payload, { stream_options: { include_usage: true } });
  return {
    url: joinPath(provider.base_url, "/chat/completions", format),
    init: { method: "POST", headers, body: JSON.stringify(payload) },
  };
}

export interface NormalizedJson {
  choices: {
    message: {
      content: string;
      tool_calls?: NormalizedToolCall[];
    };
    finish_reason?: string;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function safeParseToolArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
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
    const toolCalls: NormalizedToolCall[] = [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const p = part as { type?: unknown; id?: unknown; name?: unknown; input?: unknown };
      if (p.type === "tool_use" && typeof p.name === "string") {
        toolCalls.push({
          id: typeof p.id === "string" ? p.id : `tool_${toolCalls.length + 1}`,
          name: p.name,
          arguments: safeParseToolArgs(p.input),
        });
      }
    }
    const usage = root.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    return {
      choices: [
        {
          message: {
            content: text,
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
          },
          finish_reason: typeof root.stop_reason === "string" ? root.stop_reason : undefined,
        },
      ],
      usage: { prompt_tokens: usage?.input_tokens, completion_tokens: usage?.output_tokens },
    };
  }
  if (format === "gemini") {
    const candidates = Array.isArray(root.candidates) ? root.candidates : [];
    const first = (candidates[0] ?? {}) as { content?: { parts?: unknown[] }; finishReason?: string };
    const parts = first.content?.parts ?? [];
    const text = parts
      .map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
        ? ((part as { text: string }).text)
        : ""))
      .join("");
    const toolCalls: NormalizedToolCall[] = [];
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const fc = (part as { functionCall?: { name?: unknown; args?: unknown } }).functionCall;
      if (fc && typeof fc.name === "string") {
        toolCalls.push({
          id: `gemini_call_${toolCalls.length + 1}`,
          name: fc.name,
          arguments: safeParseToolArgs(fc.args),
        });
      }
    }
    const usage = root.usageMetadata as
      | { promptTokenCount?: number; candidatesTokenCount?: number }
      | undefined;
    return {
      choices: [
        {
          message: {
            content: text,
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
          },
          finish_reason: first.finishReason,
        },
      ],
      usage: { prompt_tokens: usage?.promptTokenCount, completion_tokens: usage?.candidatesTokenCount },
    };
  }
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const first = (choices[0] ?? {}) as {
    message?: {
      content?: unknown;
      tool_calls?: Array<{
        id?: unknown;
        function?: { name?: unknown; arguments?: unknown };
      }>;
    };
    finish_reason?: string;
  };
  const toolCalls: NormalizedToolCall[] = [];
  if (Array.isArray(first.message?.tool_calls)) {
    for (const tc of first.message!.tool_calls!) {
      if (typeof tc?.function?.name === "string") {
        toolCalls.push({
          id: typeof tc.id === "string" ? tc.id : `call_${toolCalls.length + 1}`,
          name: tc.function.name,
          arguments: safeParseToolArgs(tc.function.arguments),
        });
      }
    }
  }
  const usage = root.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
  return {
    choices: [
      {
        message: {
          content: textOfContent(first.message?.content),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: first.finish_reason,
      },
    ],
    usage: { prompt_tokens: usage?.prompt_tokens, completion_tokens: usage?.completion_tokens },
  };
}

export interface StreamStats {
  promptTokens?: number;
  completionTokens?: number;
  textChars: number;
  streamError?: string;
  interrupted?: boolean;
}

const SECRET_TOKEN_RE =
  /(?:sk-(?:proj-|ant-|or-v1-|live-|test-)?|AIza|gsk_|xai-|hf_|r8_|glpat-)[A-Za-z0-9_\-]{8,}|Bearer\s+[A-Za-z0-9._\-]{12,}/gi;

export function scrubSecretText(text: string): string {
  return text.replace(SECRET_TOKEN_RE, "[redacted]");
}

function extractStreamErrorMessage(parsed: Record<string, unknown>): string | null {
  const err = parsed.error;
  if (typeof err === "string" && err.trim()) return scrubSecretText(err.trim().slice(0, 300));
  if (err && typeof err === "object") {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return scrubSecretText(msg.trim().slice(0, 300));
  }
  return null;
}

/**
 * Convert Anthropic/Gemini/custom SSE into OpenAI-compatible chunks and track
 * output size so the caller can record usage without storing message content.
 */
export function normalizeStream(
  format: ApiFormat,
  _upstream: ReadableStream<Uint8Array>,
  onDone: (stats: StreamStats) => void | Promise<void>,
): TransformStream<Uint8Array, Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const stats: StreamStats = { textChars: 0 };
  let buffer = "";

  const emit = (controller: TransformStreamDefaultController<Uint8Array>, value: unknown) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
  };

  const handleEvent = (controller: TransformStreamDefaultController<Uint8Array>, data: string) => {
    if (!data || data === "[DONE]") return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }

    // Surface mid-stream provider errors across all formats so the client never
    // silently displays an empty or truncated reply.
    if (parsed.type === "error" || parsed.error) {
      const errMsg = extractStreamErrorMessage(parsed) ?? "The upstream provider terminated the stream with an error.";
      stats.streamError = errMsg;
      if (format !== "openai") {
        emit(controller, { error: { message: errMsg } });
      }
      return;
    }

    if (format === "anthropic") {
      const type = parsed.type;
      if (type === "message_start") {
        const message = parsed.message as { usage?: { input_tokens?: number } } | undefined;
        if (typeof message?.usage?.input_tokens === "number") {
          stats.promptTokens = message.usage.input_tokens;
        }
      } else if (type === "content_block_delta") {
        const delta = parsed.delta as { type?: string; text?: string; thinking?: string } | undefined;
        if (delta?.text) {
          stats.textChars += delta.text.length;
          emit(controller, { choices: [{ delta: { content: delta.text } }] });
        } else if (delta?.thinking) {
          emit(controller, { choices: [{ delta: { reasoning_content: delta.thinking } }] });
        }
      } else if (type === "message_delta") {
        const usage = parsed.usage as { input_tokens?: number; output_tokens?: number } | undefined;
        if (usage) {
          if (typeof usage.input_tokens === "number") stats.promptTokens = usage.input_tokens;
          if (typeof usage.output_tokens === "number") stats.completionTokens = usage.output_tokens;
        }
        const delta = parsed.delta as { stop_reason?: string } | undefined;
        emit(controller, { choices: [{ delta: {}, finish_reason: delta?.stop_reason ?? "stop" }] });
      }
      return;
    }
    if (format === "gemini") {
      const candidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
      const first = (candidates[0] ?? {}) as { content?: { parts?: unknown[] }; finishReason?: string };
      let text = "";
      let reasoning = "";
      for (const part of first.content?.parts ?? []) {
        if (!part || typeof part !== "object") continue;
        const p = part as { text?: unknown; thought?: unknown };
        if (typeof p.text === "string") {
          if (p.thought === true) reasoning += p.text;
          else text += p.text;
        }
      }
      if (text || reasoning) {
        stats.textChars += text.length;
        emit(controller, {
          choices: [
            {
              delta: {
                ...(text ? { content: text } : {}),
                ...(reasoning ? { reasoning_content: reasoning } : {}),
              },
            },
          ],
        });
      }
      const usage = parsed.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;
      if (usage) {
        stats.promptTokens = usage.promptTokenCount;
        stats.completionTokens = usage.candidatesTokenCount;
      }
      if (first.finishReason) emit(controller, { choices: [{ delta: {}, finish_reason: first.finishReason }] });
      return;
    }

    // OpenAI and custom OpenAI-compatible streams: scavenge usage and counts.
    const usage = parsed.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
    if (usage) {
      stats.promptTokens = usage.prompt_tokens;
      stats.completionTokens = usage.completion_tokens;
    }
    const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
    const delta = (choices[0] as { delta?: { content?: unknown; reasoning_content?: unknown } } | undefined)?.delta;
    if (typeof delta?.content === "string") stats.textChars += delta.content.length;

    // For "custom" format, emit normalized OpenAI chunks when non-OpenAI-passthrough
    // payloads arrive (previously "custom" chunks were never enqueued at all!).
    if (format === "custom") {
      if (choices.length > 0 || usage) {
        emit(controller, parsed);
      } else if (typeof parsed.text === "string" && parsed.text) {
        stats.textChars += parsed.text.length;
        emit(controller, { choices: [{ delta: { content: parsed.text } }] });
      } else if (typeof parsed.content === "string" && parsed.content) {
        stats.textChars += parsed.content.length;
        emit(controller, { choices: [{ delta: { content: parsed.content } }] });
      }
    }
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
    async flush(controller) {
      // Flush any trailing multi-byte UTF-8 sequence (e.g. Persian/emoji)
      buffer += decoder.decode();
      const tail = buffer.trim();
      if (tail) {
        for (const line of tail.split(/\r?\n/)) {
          if (line.startsWith("data:")) handleEvent(controller, line.slice(5).trim());
        }
      }
      if (format !== "openai") {
        if (!stats.streamError) {
          const usage = {
            ...(stats.promptTokens !== undefined ? { prompt_tokens: stats.promptTokens } : {}),
            ...(stats.completionTokens !== undefined ? { completion_tokens: stats.completionTokens } : {}),
          };
          emit(controller, { choices: [{ delta: {}, finish_reason: "stop" }], usage });
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      }
      await onDone(stats);
    },
  });
}

/**
 * Pipes an upstream SSE stream through `normalizeStream` while guaranteeing that
 * `onDone(stats)` runs **exactly once** even if the consumer cancels mid-stream
 * (e.g. Stop button / client disconnect) or the upstream stream errors mid-flight.
 * That lets server-side credit settlement charge only for tokens produced so far
 * and immediately release the remaining reservation.
 */
export function pipeNormalizedStream(
  format: ApiFormat,
  upstream: ReadableStream<Uint8Array>,
  onDone: (stats: StreamStats) => void | Promise<void>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const stats: StreamStats = { textChars: 0 };
  let buffer = "";
  let settled = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  const finalize = async (interrupted: boolean) => {
    if (settled) return;
    settled = true;
    if (interrupted) stats.interrupted = true;
    await onDone({ ...stats });
  };

  const emit = (controller: ReadableStreamDefaultController<Uint8Array>, value: unknown) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
  };

  const handleEvent = (controller: ReadableStreamDefaultController<Uint8Array>, data: string) => {
    if (!data || data === "[DONE]") return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }

    if (parsed.type === "error" || parsed.error) {
      const errMsg = extractStreamErrorMessage(parsed) ?? "The upstream provider terminated the stream with an error.";
      stats.streamError = errMsg;
      if (format !== "openai") {
        emit(controller, { error: { message: errMsg } });
      }
      return;
    }

    if (format === "anthropic") {
      const type = parsed.type;
      if (type === "message_start") {
        const message = parsed.message as { usage?: { input_tokens?: number } } | undefined;
        if (typeof message?.usage?.input_tokens === "number") {
          stats.promptTokens = message.usage.input_tokens;
        }
      } else if (type === "content_block_delta") {
        const delta = parsed.delta as { type?: string; text?: string; thinking?: string } | undefined;
        if (delta?.text) {
          stats.textChars += delta.text.length;
          emit(controller, { choices: [{ delta: { content: delta.text } }] });
        } else if (delta?.thinking) {
          stats.textChars += delta.thinking.length;
          emit(controller, { choices: [{ delta: { reasoning_content: delta.thinking } }] });
        }
      } else if (type === "message_delta") {
        const usage = parsed.usage as { input_tokens?: number; output_tokens?: number } | undefined;
        if (usage) {
          if (typeof usage.input_tokens === "number") stats.promptTokens = usage.input_tokens;
          if (typeof usage.output_tokens === "number") stats.completionTokens = usage.output_tokens;
        }
        const delta = parsed.delta as { stop_reason?: string } | undefined;
        emit(controller, { choices: [{ delta: {}, finish_reason: delta?.stop_reason ?? "stop" }] });
      }
      return;
    }

    if (format === "gemini") {
      const candidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
      const first = (candidates[0] ?? {}) as { content?: { parts?: unknown[] }; finishReason?: string };
      let text = "";
      let reasoning = "";
      for (const part of first.content?.parts ?? []) {
        if (!part || typeof part !== "object") continue;
        const p = part as { text?: unknown; thought?: unknown };
        if (typeof p.text === "string") {
          if (p.thought === true) reasoning += p.text;
          else text += p.text;
        }
      }
      if (text || reasoning) {
        stats.textChars += text.length + reasoning.length;
        emit(controller, {
          choices: [
            {
              delta: {
                ...(text ? { content: text } : {}),
                ...(reasoning ? { reasoning_content: reasoning } : {}),
              },
            },
          ],
        });
      }
      const usage = parsed.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;
      if (usage) {
        stats.promptTokens = usage.promptTokenCount;
        stats.completionTokens = usage.candidatesTokenCount;
      }
      if (first.finishReason) emit(controller, { choices: [{ delta: {}, finish_reason: first.finishReason }] });
      return;
    }

    const usage = parsed.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
    if (usage) {
      stats.promptTokens = usage.prompt_tokens;
      stats.completionTokens = usage.completion_tokens;
    }
    const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
    const delta = (choices[0] as { delta?: { content?: unknown; reasoning_content?: unknown } } | undefined)?.delta;
    if (typeof delta?.content === "string") stats.textChars += delta.content.length;
    if (typeof delta?.reasoning_content === "string") stats.textChars += delta.reasoning_content.length;

    if (format === "custom") {
      if (choices.length > 0 || usage) {
        emit(controller, parsed);
      } else if (typeof parsed.text === "string" && parsed.text) {
        stats.textChars += parsed.text.length;
        emit(controller, { choices: [{ delta: { content: parsed.text } }] });
      } else if (typeof parsed.content === "string" && parsed.content) {
        stats.textChars += parsed.content.length;
        emit(controller, { choices: [{ delta: { content: parsed.content } }] });
      }
    }
  };

  return new ReadableStream<Uint8Array>({
    start() {
      reader = upstream.getReader();
    },
    async pull(controller) {
      if (!reader) {
        controller.close();
        await finalize(false);
        return;
      }
      try {
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          const tail = buffer.trim();
          if (tail) {
            for (const line of tail.split(/\r?\n/)) {
              if (line.startsWith("data:")) handleEvent(controller, line.slice(5).trim());
            }
          }
          if (format !== "openai") {
            if (!stats.streamError) {
              const usage = {
                ...(stats.promptTokens !== undefined ? { prompt_tokens: stats.promptTokens } : {}),
                ...(stats.completionTokens !== undefined ? { completion_tokens: stats.completionTokens } : {}),
              };
              emit(controller, { choices: [{ delta: {}, finish_reason: "stop" }], usage });
            }
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          }
          await finalize(Boolean(stats.streamError));
          controller.close();
          return;
        }
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          let match = /\r?\n\r?\n/.exec(buffer);
          while (match) {
            const raw = buffer.slice(0, match.index);
            buffer = buffer.slice(match.index + match[0].length);
            for (const line of raw.split(/\r?\n/)) {
              if (line.startsWith("data:")) handleEvent(controller, line.slice(5).trim());
            }
            match = /\r?\n\r?\n/.exec(buffer);
          }
          if (format === "openai") controller.enqueue(value);
        }
      } catch (err) {
        await finalize(true);
        controller.error(err);
      }
    },
    async cancel(reason) {
      try {
        await reader?.cancel(reason);
      } catch {
        // Ignore upstream cancel errors.
      }
      await finalize(true);
    },
  });
}
