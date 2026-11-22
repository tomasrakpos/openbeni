// Shared logic sse; change this helper here and update callers if its contract changes.
import type { StreamDelta } from "@/lib/types";

export interface SSEEvent {
  event?: string;
  data: string;
  id?: string;
}

/**
 * Incremental server-sent-events decoder.
 * Handles CRLF, multi-line data fields, comments, and chunk boundaries.
 */
export class SSEDecoder {
  private buffer = "";
  private eventName: string | undefined;
  private dataLines: string[] = [];
  private lastId: string | undefined;

  push(chunk: string): SSEEvent[] {
    this.buffer += chunk;
    const out: SSEEvent[] = [];
    let index = this.buffer.indexOf("\n");
    while (index !== -1) {
      let line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      const event = this.consumeLine(line);
      if (event) out.push(event);
      index = this.buffer.indexOf("\n");
    }
    return out;
  }

  flush(): SSEEvent[] {
    const out: SSEEvent[] = [];
    if (this.buffer.trim()) {
      const line = this.buffer.replace(/\r$/, "");
      this.buffer = "";
      const event = this.consumeLine(line);
      if (event) out.push(event);
    }
    const last = this.dispatch();
    if (last) out.push(last);
    return out;
  }

  private consumeLine(line: string): SSEEvent | null {
    if (line === "") return this.dispatch();
    if (line.startsWith(":")) return null;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    switch (field) {
      case "event":
        this.eventName = value;
        break;
      case "data":
        this.dataLines.push(value);
        break;
      case "id":
        this.lastId = value;
        break;
      default:
        break;
    }
    return null;
  }

  private dispatch(): SSEEvent | null {
    if (this.dataLines.length === 0) {
      this.eventName = undefined;
      return null;
    }
    const event: SSEEvent = { data: this.dataLines.join("\n") };
    if (this.eventName) event.event = this.eventName;
    if (this.lastId) event.id = this.lastId;
    this.dataLines = [];
    this.eventName = undefined;
    return event;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function parseOpenAIDelta(payload: unknown): StreamDelta | null {
  const root = asRecord(payload);
  if (!root) return null;
  const choices = root.choices;
  const choice = Array.isArray(choices) ? asRecord(choices[0]) : null;
  const delta: StreamDelta = {};
  if (choice) {
    const d = asRecord(choice.delta);
    const msg = asRecord(choice.message);
    const content = d?.content ?? msg?.content;
    if (typeof content === "string" && content.length > 0) delta.text = content;
    if (Array.isArray(content)) {
      const text = content
        .map((part) => {
          const p = asRecord(part);
          return typeof p?.text === "string" ? p.text : "";
        })
        .join("");
      if (text) delta.text = text;
    }
    const reasoning = d?.reasoning_content ?? d?.reasoning ?? msg?.reasoning_content;
    if (typeof reasoning === "string" && reasoning.length > 0) delta.reasoning = reasoning;
    if (typeof choice.finish_reason === "string") delta.finish = choice.finish_reason;
  }
  const usage = asRecord(root.usage);
  if (usage) {
    delta.usage = {
      promptTokens: num(usage.prompt_tokens),
      completionTokens: num(usage.completion_tokens),
    };
  }
  if (!delta.text && !delta.reasoning && !delta.usage && !delta.finish) return null;
  return delta;
}

export function parseAnthropicDelta(event: string | undefined, payload: unknown): StreamDelta | null {
  const root = asRecord(payload);
  if (!root) return null;
  const type = typeof root.type === "string" ? root.type : event;
  if (type === "content_block_delta") {
    const delta = asRecord(root.delta);
    const deltaType = delta?.type;
    if ((deltaType === "text_delta" || deltaType === undefined) && typeof delta?.text === "string") {
      return { text: delta.text };
    }
    if (deltaType === "thinking_delta" && typeof delta?.thinking === "string") {
      return { reasoning: delta.thinking };
    }
    return null;
  }
  if (type === "message_start") {
    const message = asRecord(root.message);
    const usage = asRecord(message?.usage);
    if (usage) return { usage: { promptTokens: num(usage.input_tokens), completionTokens: num(usage.output_tokens) } };
    return null;
  }
  if (type === "message_delta") {
    const delta = asRecord(root.delta);
    const usage = asRecord(root.usage);
    const out: StreamDelta = {};
    if (typeof delta?.stop_reason === "string") out.finish = delta.stop_reason;
    if (usage) out.usage = { completionTokens: num(usage.output_tokens) };
    if (!out.finish && !out.usage) return null;
    return out;
  }
  return null;
}

export function parseGeminiDelta(payload: unknown): StreamDelta | null {
  const root = asRecord(payload);
  if (!root) return null;
  const candidates = root.candidates;
  const candidate = Array.isArray(candidates) ? asRecord(candidates[0]) : null;
  const content = asRecord(candidate?.content);
  const parts = content?.parts;
  let text = "";
  let reasoning = "";
  if (Array.isArray(parts)) {
    for (const raw of parts) {
      const part = asRecord(raw);
      if (!part) continue;
      if (typeof part.text === "string") {
        if (part.thought === true) reasoning += part.text;
        else text += part.text;
      }
    }
  }
  const delta: StreamDelta = {};
  if (text) delta.text = text;
  if (reasoning) delta.reasoning = reasoning;
  if (typeof candidate?.finishReason === "string") delta.finish = candidate.finishReason;
  const usage = asRecord(root.usageMetadata);
  if (usage) {
    delta.usage = {
      promptTokens: num(usage.promptTokenCount),
      completionTokens: num(usage.candidatesTokenCount),
    };
  }
  if (!delta.text && !delta.reasoning && !delta.finish && !delta.usage) return null;
  return delta;
}

/** Simple JSON path getter: "choices[0].message.content", "data.items[2].text" */
export function getPath(source: unknown, path: string): unknown {
  if (!path) return source;
  const tokens = path
    .replace(/\[\s*(\d+)\s*\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  let cursor: unknown = source;
  for (const token of tokens) {
    if (cursor == null) return undefined;
    if (Array.isArray(cursor)) {
      const index = Number(token);
      if (!Number.isInteger(index)) return undefined;
      cursor = cursor[index];
    } else if (typeof cursor === "object") {
      cursor = (cursor as Record<string, unknown>)[token];
    } else {
      return undefined;
    }
  }
  return cursor;
}

export function parseCustomDelta(payload: unknown, deltaPath: string, reasoningPath?: string): StreamDelta | null {
  const text = getPath(payload, deltaPath);
  const reasoning = reasoningPath ? getPath(payload, reasoningPath) : undefined;
  const delta: StreamDelta = {};
  if (typeof text === "string" && text.length > 0) delta.text = text;
  else if (Array.isArray(text)) {
    const joined = text.filter((t): t is string => typeof t === "string").join("");
    if (joined) delta.text = joined;
  }
  if (typeof reasoning === "string" && reasoning.length > 0) delta.reasoning = reasoning;
  if (!delta.text && !delta.reasoning) return null;
  return delta;
}

function extractStreamError(payload: unknown): string | undefined {
  const root = asRecord(payload);
  if (!root) return undefined;
  if (typeof root.error === "string" && root.error.trim()) return root.error.trim();
  const errObj = asRecord(root.error);
  if (errObj && typeof errObj.message === "string" && errObj.message.trim()) {
    return errObj.message.trim();
  }
  if (root.type === "error") {
    if (typeof root.message === "string" && root.message.trim()) return root.message.trim();
    return "The upstream provider returned a stream error.";
  }
  return undefined;
}

/** Parse one complete SSE event for the given format. */
export function parseStreamEvent(
  format: "openai" | "anthropic" | "gemini" | "custom",
  event: SSEEvent,
  customDeltaPath = "choices[0].delta.content",
  customReasoningPath?: string,
): StreamDelta | null {
  const raw = event.data.trim();
  if (!raw || raw === "[DONE]") return null;
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  const streamErr = extractStreamError(payload);
  if (streamErr) return { error: streamErr };
  switch (format) {
    case "openai":
      return parseOpenAIDelta(payload);
    case "anthropic":
      return parseAnthropicDelta(event.event, payload);
    case "gemini":
      return parseGeminiDelta(payload);
    case "custom":
      return parseCustomDelta(payload, customDeltaPath, customReasoningPath);
  }
}
