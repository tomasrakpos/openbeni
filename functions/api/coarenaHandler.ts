/**
 * Same-origin Coarena endpoint. The browser calls this; the server adds a
 * rotated key from `COARENA_KEYS`. Keys never exist in the client bundle.
 *
 *   POST /api/coarena/chat    OpenAI-shaped chat completion (stream or JSON)
 *   GET  /api/coarena/models  sanitized model list from Coarena
 *   GET  /api/coarena/status  pool health: total / healthy / per-key state
 *
 * Official docs: https://coarena.ai/docs (base https://coarena.ai/api/v1,
 * Authorization: Bearer <key>). The base URL can be overridden with
 * COARENA_BASE_URL for a self-hosted mirror.
 */

import {
  COARENA_MODELS,
  COARENA_MODEL_IDS,
  RETRYABLE_STATUS,
  coarenaBase,
  cooldownFor,
  markFailure,
  markSuccess,
  parseKeys,
  poolStatus,
  scrubKeys,
  selectKey,
  type CoarenaEnv,
} from "./coarenaPool";
import {
  apiHeaders,
  clientIp,
  jsonError,
  rateLimit,
  readJsonBody,
  rejectedOrigin,
  type SecurityEnv,
} from "./security";

export type CoarenaProxyEnv = CoarenaEnv & SecurityEnv;

const MAX_MESSAGES = 120;
const MAX_MESSAGE_CHARS = 32_000;
const MAX_TOTAL_CHARS = 160_000;
const MAX_TOKENS = 32_768;
const MAX_ERROR_BYTES = 4_096;

const ALLOWED_ROLES = new Set(["system", "user", "assistant", "tool"]);

const ALLOWED_FIELDS = new Set([
  "model",
  "messages",
  "stream",
  "temperature",
  "top_p",
  "max_tokens",
  "max_completion_tokens",
  "stop",
  "presence_penalty",
  "frequency_penalty",
  "response_format",
  "tools",
  "tool_choice",
  "reasoning_effort",
  "parallel_tool_calls",
  "seed",
  "user",
]);

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateBody(value: unknown): { ok: true; body: Json; stream: boolean } | { ok: false; message: string } {
  if (!isObject(value)) return { ok: false, message: "The request body must be a JSON object." };
  const model = typeof value.model === "string" ? value.model.trim() : "";
  if (!COARENA_MODEL_IDS.has(model)) return { ok: false, message: "Unknown or unavailable model." };

  const messages = value.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, message: "messages must be a non-empty array." };
  }
  if (messages.length > MAX_MESSAGES) {
    return { ok: false, message: `Too many messages (limit ${MAX_MESSAGES}).` };
  }

  let totalChars = 0;
  const cleanMessages: Json[] = [];
  for (const entry of messages) {
    if (!isObject(entry)) return { ok: false, message: "Each message must be an object." };
    const role = typeof entry.role === "string" ? entry.role : "";
    if (!ALLOWED_ROLES.has(role)) return { ok: false, message: "Invalid message role." };
    const content = entry.content;
    if (typeof content === "string") {
      totalChars += content.length;
      if (content.length > MAX_MESSAGE_CHARS) {
        return { ok: false, message: `A message is longer than ${MAX_MESSAGE_CHARS.toLocaleString()} characters.` };
      }
      cleanMessages.push({ role, content });
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (!isObject(part)) return { ok: false, message: "Invalid message content." };
        if (typeof part.text === "string") totalChars += part.text.length;
        if (typeof part.image_url === "object" && part.image_url !== null) {
          return { ok: false, message: "Image inputs are not enabled for this endpoint." };
        }
        if (typeof part.type === "string" && part.type === "video_url") {
          return { ok: false, message: "Video inputs are not enabled for this endpoint." };
        }
      }
      cleanMessages.push({ role, content });
    } else {
      return { ok: false, message: "Message content must be text." };
    }
    if (totalChars > MAX_TOTAL_CHARS) {
      return { ok: false, message: `The conversation is longer than ${MAX_TOTAL_CHARS.toLocaleString()} characters.` };
    }
  }

  const clean: Json = { model, messages: cleanMessages };
  for (const [key, val] of Object.entries(value)) {
    if (!ALLOWED_FIELDS.has(key) || key === "messages") continue;
    clean[key] = val;
  }
  for (const field of ["max_tokens", "max_completion_tokens"] as const) {
    if (typeof clean[field] === "number") {
      const number = Math.floor(clean[field] as number);
      if (!Number.isFinite(number) || number < 1) delete clean[field];
      else clean[field] = Math.min(number, MAX_TOKENS);
    }
  }
  if (typeof clean.temperature === "number") {
    clean.temperature = Math.max(0, Math.min(2, clean.temperature));
  }
  if (typeof clean.top_p === "number") clean.top_p = Math.max(0, Math.min(1, clean.top_p));
  const stream = value.stream === true;
  clean.stream = stream;
  return { ok: true, body: clean, stream };
}

async function readErrorText(response: Response, env: CoarenaEnv): Promise<string> {
  try {
    const text = (await response.text()).slice(0, MAX_ERROR_BYTES);
    const parsed = JSON.parse(text) as Json;
    const error = parsed.error;
    if (isObject(error) && typeof error.message === "string") return scrubKeys(error.message, env);
    return scrubKeys(text, env);
  } catch {
    return "";
  }
}

function upstreamHeaders(key: string, stream: boolean): Headers {
  return new Headers({
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Accept: stream ? "text/event-stream" : "application/json",
    "User-Agent": "OpenHarness/1.0 (+same-origin Coarena pool)",
  });
}

interface ChatOutcome {
  response?: Response;
  failure?: { status: number; message: string };
}

async function callChat(env: CoarenaEnv, body: Json, stream: boolean): Promise<ChatOutcome> {
  const keys = parseKeys(env);
  if (keys.length === 0) return { failure: { status: 503, message: "Coarena is not configured on this server." } };

  const tried = new Set<string>();
  let last: { status: number; message: string } | undefined;

  for (let attempt = 0; attempt < keys.length; attempt += 1) {
    const key = selectKey(env);
    if (!key || tried.has(key)) break;
    tried.add(key);
    const index = keys.indexOf(key) + 1;

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 45_000);

    let response: Response;
    try {
      response = await fetch(`${coarenaBase(env)}/chat/completions`, {
        method: "POST",
        headers: upstreamHeaders(key, stream),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timer);
      const reason = timedOut ? "timeout" : "network";
      markFailure(key, reason, 30_000);
      console.warn(`[coarena] key ${index}: ${reason}`);
      last = {
        status: 503,
        message: timedOut ? "Coarena timed out. Please retry." : "Could not reach Coarena. Please retry.",
      };
      continue;
    }
    clearTimeout(timer);

    if (response.ok) {
      markSuccess(key);
      return { response };
    }

    const message = (await readErrorText(response, env)) || `HTTP ${response.status}`;
    const retryable = RETRYABLE_STATUS.has(response.status) || response.status >= 500;
    if (!retryable) {
      return { failure: { status: response.status, message } };
    }

    const { reason, ms } = cooldownFor(response.status, message);
    markFailure(key, reason, ms);
    console.warn(`[coarena] key ${index}: ${reason} (HTTP ${response.status})`);
    last = { status: response.status, message };
  }

  return {
    failure: {
      status: 503,
      message:
        "Coarena is temporarily unavailable because every key is cooling down. Please try again in a few minutes.",
    },
  };
}

async function handleChat(request: Request, env: CoarenaProxyEnv): Promise<Response> {
  const limit = rateLimit("coarena-chat", clientIp(request), 20, 60_000);
  if (!limit.ok) {
    return jsonError(request, env, 429, "Too many requests. Please wait a moment.", "rate_limited", {
      "Retry-After": String(limit.retryAfter),
    });
  }

  const parsed = await readJsonBody(request);
  if (!parsed.ok) {
    return jsonError(
      request,
      env,
      413,
      parsed.reason === "too-large" ? "Request body is too large." : "Invalid JSON body.",
    );
  }
  const valid = validateBody(parsed.value);
  if (!valid.ok) return jsonError(request, env, 400, valid.message);

  const outcome = await callChat(env, valid.body, valid.stream);
  if (outcome.response) {
    const headers = apiHeaders(request, env, {
      "Content-Type": outcome.response.headers.get("content-type") ?? "application/json; charset=utf-8",
      "X-Accel-Buffering": "no",
    });
    return new Response(outcome.response.body, { status: outcome.response.status, headers });
  }
  const failure = outcome.failure ?? { status: 503, message: "Coarena is unavailable." };
  return jsonError(request, env, failure.status, failure.message, "coarena_unavailable");
}

async function handleModels(request: Request, env: CoarenaProxyEnv): Promise<Response> {
  const limit = rateLimit("coarena-models", clientIp(request), 60, 60_000);
  if (!limit.ok) {
    return jsonError(request, env, 429, "Too many requests.", "rate_limited", {
      "Retry-After": String(limit.retryAfter),
    });
  }

  // The list is public, but sending a healthy key keeps it consistent with the
  // account's actual catalogue. Fall back to the curated, verified list when
  // the pool is cooling down.
  const key = selectKey(env);
  if (key) {
    try {
      const response = await fetch(`${coarenaBase(env)}/models`, {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) {
        const payload = (await response.json()) as { data?: unknown };
        const rows = Array.isArray(payload.data) ? payload.data : [];
        const data = rows
          .filter(isObject)
          .map((row) => ({
            id: typeof row.id === "string" ? row.id : "",
            display_name: typeof row.display_name === "string" ? row.display_name : row.id,
            context_length: typeof row.context_length === "number" ? row.context_length : undefined,
            max_completion_tokens:
              typeof row.max_completion_tokens === "number" ? row.max_completion_tokens : undefined,
          }))
          .filter((row) => COARENA_MODEL_IDS.has(row.id));
        const headers = apiHeaders(request, env, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "private, max-age=300",
        });
        return new Response(JSON.stringify({ object: "list", data }), { status: 200, headers });
      }
    } catch {
      // Fall through to the curated list.
    }
  }

  const headers = apiHeaders(request, env, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, max-age=300",
  });
  return new Response(JSON.stringify({ object: "list", data: COARENA_MODELS }), { status: 200, headers });
}

async function handleStatus(request: Request, env: CoarenaProxyEnv): Promise<Response> {
  const limit = rateLimit("coarena-status", clientIp(request), 60, 60_000);
  if (!limit.ok) {
    return jsonError(request, env, 429, "Too many requests.", "rate_limited", {
      "Retry-After": String(limit.retryAfter),
    });
  }
  const headers = apiHeaders(request, env, { "Content-Type": "application/json; charset=utf-8" });
  return new Response(JSON.stringify({ data: poolStatus(env) }), { status: 200, headers });
}

export async function handleCoarena(request: Request, env: CoarenaProxyEnv = {}): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/coarena\/?/, "").replace(/\/+$/, "");

  if (request.method === "OPTIONS") {
    if (rejectedOrigin(request, env)) return jsonError(request, env, 403, "Origin not allowed.");
    return new Response(null, { status: 204, headers: apiHeaders(request, env) });
  }
  if (rejectedOrigin(request, env)) return jsonError(request, env, 403, "Origin not allowed.");

  if (path === "status" && request.method === "GET") return handleStatus(request, env);
  if (path === "models" && request.method === "GET") return handleModels(request, env);
  if (path === "chat" && request.method === "POST") return handleChat(request, env);

  return jsonError(request, env, 404, "Not found.");
}
