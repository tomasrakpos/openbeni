// Shared logic serverChat; change this helper here and update callers if its contract changes.
import { currentAccessToken } from "@/lib/supabase";
import { classifyHttpStatus, makeApiError, type ApiError } from "@/lib/http";
import { SSEDecoder, parseStreamEvent, type SSEEvent } from "@/lib/sse";
import type { ChatParams, StreamDelta, StreamUsage } from "@/lib/types";

export interface ServerChatResult {
  text: string;
  reasoning: string;
  usage: StreamUsage;
  latencyMs: number;
  firstTokenMs?: number;
  finishReason?: string;
}

export interface ServerChatOptions {
  modelId: string;
  messages: { role: string; content: string }[];
  params: ChatParams;
  signal: AbortSignal;
  onDelta: (delta: StreamDelta) => void;
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

  let response: Response;
  try {
    response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: options.modelId,
        messages: options.messages.map((message) => ({ role: message.role, content: message.content })),
        temperature: options.params.temperature,
        top_p: options.params.topP,
        max_tokens: options.params.maxTokens,
        stream: true,
      }),
      signal: options.signal,
      cache: "no-store",
    });
  } catch (error) {
    if (options.signal.aborted) throw makeApiError("unknown", "aborted");
    throw makeApiError("network", "error.network");
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as ErrorPayload | null;
    const kind = classifyHttpStatus(response.status);
    const err = makeApiError(kind, payload?.error?.message || messageFor(response.status), response.status) as ApiError & {
      code?: string;
    };
    err.code = payload?.error?.code;
    throw err;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json") && !contentType.includes("event-stream")) {
    const payload = (await response.json().catch(() => null)) as {
      choices?: { message?: { content?: string } }[];
      usage?: StreamUsage;
    } | null;
    const text = payload?.choices?.[0]?.message?.content ?? "";
    return {
      text,
      reasoning: "",
      usage: payload?.usage ?? {},
      latencyMs: Math.round(performance.now() - started),
    };
  }

  const reader = response.body?.getReader();
  if (!reader) throw makeApiError("unknown", "error.generic");

  const decoder = new TextDecoder();
  const sse = new SSEDecoder();
  let text = "";
  let reasoning = "";
  let usage: StreamUsage = {};
  let finishReason: string | undefined;

  const consume = (event: SSEEvent) => {
    const delta = parseStreamEvent("openai", event, "choices[0].delta.content");
    if (!delta) return;
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
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
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
    throw makeApiError("network", "error.network");
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
