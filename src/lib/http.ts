// Shared logic http; change this helper here and update callers if its contract changes.
import type { ErrorKind, Provider } from "@/lib/types";

export interface ApiError extends Error {
  kind: ErrorKind;
  status?: number;
}

export function makeApiError(kind: ErrorKind, message: string, status?: number): ApiError {
  const err = new Error(message) as ApiError;
  err.kind = kind;
  err.status = status;
  return err;
}

export function classifyHttpStatus(status: number): ErrorKind {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not-found";
  if (status === 402 || status === 429) return "rate-limit";
  if (status === 408) return "timeout";
  if (status >= 500) return "server";
  return "http";
}

/**
 * Some gateways report an exhausted key as HTTP 400 with a message such as
 * "You have reached your specified API usage limits". Treat that as a quota
 * error so the key pool can rotate instead of surfacing a generic HTTP error.
 */
const QUOTA_MESSAGE =
  /(quota|usage limit|rate.?limit|too many requests|insufficient|credit|limit (?:has been )?reached|reached your)/i;

export function isQuotaMessage(message?: string): boolean {
  return typeof message === "string" && QUOTA_MESSAGE.test(message);
}

export function makeHttpError(status: number, message: string): ApiError {
  const kind = classifyHttpStatus(status);
  if ((kind === "http" || kind === "not-found") && isQuotaMessage(message)) {
    return makeApiError("rate-limit", message, status);
  }
  return makeApiError(kind, message, status);
}

export function classifyException(err: unknown, timedOut: boolean): ErrorKind {
  if (timedOut) return "timeout";
  if (err instanceof DOMException && err.name === "AbortError") return "unknown";
  if (err instanceof TypeError) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return "network";
    return "cors";
  }
  if (err instanceof Error) {
    if (/abort/i.test(err.name)) return "unknown";
    if (/timeout|timed out/i.test(err.message)) return "timeout";
    if (/network|failed to fetch|load failed/i.test(err.message)) {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return "network";
      return "cors";
    }
  }
  return "unknown";
}

export function proxiedUrl(target: string, proxyUrl: string): string {
  const base = proxyUrl.trim().replace(/\/+$/, "");
  if (!base) return target;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}url=${encodeURIComponent(target)}`;
}

/**
 * Gateways that need a proxy but have no URL configured use the bundled
 * same-origin endpoint: a Vite middleware in dev and a Cloudflare Pages
 * Function in production. Providers that do not need a proxy never call it.
 */
export const SAME_ORIGIN_PROXY = "/api/proxy";

/** Server-managed Coarena endpoints (no key in the browser). */
export const COARENA_ENDPOINTS = {
  chat: "/api/coarena/chat",
  models: "/api/coarena/models",
  status: "/api/coarena/status",
} as const;

export function resolveProxyUrl(proxyUrl?: string): string {
  const configured = proxyUrl?.trim();
  return configured || SAME_ORIGIN_PROXY;
}

export interface TimedFetchResult {
  response: Response;
  latencyMs: number;
  url: string;
}

/** fetch with a hard timeout, external abort support, and optional CORS proxy. */
export async function timedFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  options: { signal?: AbortSignal; proxyUrl?: string } = {},
): Promise<TimedFetchResult> {
  const target = options.proxyUrl ? proxiedUrl(url, options.proxyUrl) : url;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1000, timeoutMs));
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });

  const started = performance.now();
  try {
    const response = await fetch(target, { ...init, signal: controller.signal, cache: "no-store" });
    return { response, latencyMs: Math.round(performance.now() - started), url: target };
  } catch (err) {
    const kind = classifyException(err, timedOut);
    const message = timedOut
      ? `Request timed out after ${Math.round(timeoutMs / 1000)}s`
      : err instanceof Error
        ? err.message
        : "Request failed";
    throw makeApiError(kind, message);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

export interface AuthHeaders {
  [key: string]: string;
}

export function authHeaders(provider: Provider, apiKey: string): AuthHeaders {
  const out: AuthHeaders = {};
  const { header, prefix } = provider.auth;
  if (header && apiKey) {
    const rawPrefix = prefix ?? "";
    const sep = rawPrefix && /[A-Za-z0-9]$/.test(rawPrefix) && !/^\s/.test(apiKey) ? " " : "";
    out[header] = `${rawPrefix}${sep}${apiKey}`;
  }
  return out;
}

export function requestHeaders(provider: Provider, apiKey: string): AuthHeaders {
  const headers: AuthHeaders = {
    "Content-Type": "application/json",
    Accept: "text/event-stream, application/json",
    ...provider.extraHeaders,
    ...authHeaders(provider, apiKey),
  };
  if (provider.apiFormat === "anthropic") {
    headers["anthropic-version"] = provider.extraHeaders["anthropic-version"] ?? "2023-06-01";
    // Required when calling Anthropic directly from a browser origin.
    headers["anthropic-dangerous-direct-browser-access"] = "true";
    headers["content-type"] = "application/json";
  }
  return headers;
}

/** Remove a key from any text that may reach the UI, logs, or exports. */
export function redactKey(input: string, key: string): string {
  if (!key || key.length < 6) return input;
  return input.split(key).join("[redacted]");
}

export function errorHint(kind: ErrorKind, lang: "en" | "fa"): string {
  const en: Record<ErrorKind, string> = {
    ok: "Reachable.",
    auth: "The key was rejected. Double-check the key and that it is allowed for this endpoint.",
    "rate-limit": "Rate limited by the provider. Wait a moment or check your quota.",
    cors: "Blocked by CORS. Enable the proxy for this provider, or use a server that allows browser origins.",
    network: "Network unreachable. Check your connection and the base URL.",
    timeout: "No answer within the timeout. Increase the provider timeout or check the host.",
    "not-found": "Endpoint not found. The base URL path is probably wrong (missing /v1 or a typo).",
    server: "The provider returned a server error. Try again shortly.",
    http: "The provider rejected the request. Inspect the status and message.",
    unknown: "Unknown failure. Check the browser console for details.",
  };
  const fa: Record<ErrorKind, string> = {
    ok: "در دسترس است.",
    auth: "کلید رد شد. کلید و مجوز آن برای این endpoint را بررسی کنید.",
    "rate-limit": "محدودیت نرخ درخواست. کمی صبر کنید یا سهمیه را بررسی کنید.",
    cors: "توسط CORS مسدود شد. پروکسی این provider را فعال کنید یا از سروری استفاده کنید که مبدأ مرورگر را می‌پذیرد.",
    network: "شبکه در دسترس نیست. اتصال و آدرس پایه را بررسی کنید.",
    timeout: "پاسخی در زمان مجاز نیامد. timeout یا میزبان را بررسی کنید.",
    "not-found": "endpoint پیدا نشد. مسیر آدرس پایه احتمالاً اشتباه است (مثلاً /v1 جا افتاده).",
    server: "خطای سرور provider. کمی بعد دوباره تلاش کنید.",
    http: "provider درخواست را رد کرد. وضعیت و پیام را بررسی کنید.",
    unknown: "خطای ناشناخته. کنسول مرورگر را بررسی کنید.",
  };
  return (lang === "fa" ? fa : en)[kind];
}

export async function readJsonSafe(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function extractErrorMessage(payload: unknown): string | undefined {
  if (!payload) return undefined;
  if (typeof payload === "string") return payload.slice(0, 300);
  if (typeof payload !== "object") return undefined;
  const rec = payload as Record<string, unknown>;
  const err = rec.error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (typeof e.message === "string") return e.message;
  }
  if (typeof rec.message === "string") return rec.message;
  if (typeof rec.detail === "string") return rec.detail;
  return undefined;
}

export async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, tasks.length)).fill(0).map(async () => {
    for (;;) {
      const index = cursor++;
      const task = tasks[index];
      if (!task) return;
      try {
        results[index] = { status: "fulfilled", value: await task() };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  });
  await Promise.all(workers);
  return results;
}
