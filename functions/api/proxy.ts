/**
 * APISet Pro — built-in CORS proxy at `/api/proxy`.
 *
 * Some OpenAI-compatible gateways do not send `Access-Control-Allow-Origin`
 * for browser origins (IteraCompute is one of them). Providers flagged with
 * `useProxy` send their requests here instead:
 *
 *   POST /api/proxy?url=https%3A%2F%2Fapi.example.com%2Fv1%2Fchat%2Fcompletions
 *
 * The handler is deliberately small and dependency free so it runs unchanged
 * in two places:
 * - Cloudflare Pages Functions (this file, production)
 * - the Vite dev server (imported from vite.config.ts, development)
 *
 * Behaviour:
 * - streams the upstream body straight through, so SSE token streams work
 * - never forwards cookies, origin, referer, or hop-by-hop headers
 * - blocks loopback / RFC1918 targets
 * - optional ALLOWED_HOSTS allowlist and PROXY_TOKEN shared secret
 * - CORS is restricted to the site origin; there is no wildcard fallback
 * - a small per-IP rate limit limits abuse of the self-hosted proxy
 * - the shared secret is read from the `x-proxy-token` header only, never a URL
 */

import { allowedOrigin, apiHeaders, clientIp, jsonError, rateLimit, rejectedOrigin } from "./security";


export interface ProxyEnv {
  ALLOWED_HOSTS?: string;
  ALLOWED_ORIGIN?: string;
  PROXY_TOKEN?: string;
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/** Request headers we never forward upstream. */
const DROP_REQUEST_HEADERS = new Set([
  ...HOP_BY_HOP,
  "host",
  "content-length",
  "accept-encoding",
  "cookie",
  "cookie2",
  "origin",
  "referer",
  "forwarded",
  "via",
  "x-real-ip",
  "true-client-ip",
  "x-proxy-token",
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-ray",
  "cf-visitor",
  "cdn-loop",
]);

/** Response headers that are recomputed, unsafe, or would clobber our own CORS/security policy. */
const DROP_RESPONSE_HEADERS = new Set([
  ...HOP_BY_HOP,
  "content-encoding",
  "content-length",
  "set-cookie",
  "set-cookie2",
  "alt-svc",
  "strict-transport-security",
  "content-security-policy",
  "content-security-policy-report-only",
  "permissions-policy",
  "referrer-policy",
  "x-content-type-options",
  "vary",
]);

const CONNECT_TIMEOUT_MS = 30_000;

/**
 * Known AI hosts whose OpenAI-compatible API lives under a non-`/v1` prefix
 * (for example, `https://coarena.ai/api/v1` returns JSON while `/v1` hits the
 * Next.js website 404 page). Rewriting up front avoids a wasted 404 round trip.
 */
const CANONICAL_HOST_PREFIX: Record<string, string> = {
  "coarena.ai": "/api/v1",
  "www.coarena.ai": "/api/v1",
  "openrouter.ai": "/api/v1",
  "www.openrouter.ai": "/api/v1",
  "api.groq.com": "/openai/v1",
};

const API_LEAF_PATH = /^\/(chat\/completions|completions|messages|responses|models|embeddings|images\/generations)(\/|$)/i;

function canonicalizeProxyTarget(target: URL): URL {
  const prefix = CANONICAL_HOST_PREFIX[target.hostname.toLowerCase()];
  if (!prefix) return target;
  const path = target.pathname.replace(/\/{2,}/g, "/");
  const lower = path.toLowerCase();
  if (lower.startsWith(`${prefix}/`) || lower === prefix) return target;

  let rewritten: string | null = null;
  if (lower.startsWith("/v1/")) {
    rewritten = `${prefix}${path.slice(3)}`;
  } else if (lower === "/v1") {
    rewritten = prefix;
  } else if (lower.startsWith("/api/") && API_LEAF_PATH.test(path.slice(4))) {
    rewritten = `${prefix}${path.slice(4)}`;
  } else if (lower.startsWith("/openai/") && API_LEAF_PATH.test(path.slice(7))) {
    rewritten = `${prefix}${path.slice(7)}`;
  } else if (API_LEAF_PATH.test(path)) {
    rewritten = `${prefix}${path}`;
  }
  if (!rewritten) return target;

  const next = new URL(target.toString());
  next.pathname = rewritten;
  return next;
}

/**
 * Generic fallback when a custom provider at `/v1/<endpoint>`, `/api/<endpoint>`,
 * or `/<endpoint>` returns an HTML 404/405 page (common on Next.js apps whose API sits at `/api/v1`).
 */
function apiV1FallbackTarget(target: URL): URL | null {
  const path = target.pathname.replace(/\/{2,}/g, "/");
  const lower = path.toLowerCase();
  if (lower.startsWith("/api/v1/") || lower === "/api/v1") return null;
  let rewritten: string | null = null;
  if (lower.startsWith("/v1/")) {
    rewritten = `/api${path}`;
  } else if (lower.startsWith("/api/") && API_LEAF_PATH.test(path.slice(4))) {
    rewritten = `/api/v1${path.slice(4)}`;
  } else if (API_LEAF_PATH.test(path)) {
    rewritten = `/api/v1${path}`;
  }
  if (!rewritten) return null;
  const next = new URL(target.toString());
  next.pathname = rewritten;
  return next;
}

function isHtmlResponse(response: Response): boolean {
  const ct = (response.headers.get("content-type") ?? "").toLowerCase();
  return ct.includes("text/html") || ct.includes("application/xhtml");
}

function wantsStreamingResponse(method: string, target: URL, headers: Headers): boolean {
  const accept = (headers.get("accept") ?? "").toLowerCase();
  if (accept.includes("text/event-stream")) return true;
  if (method !== "POST") return false;
  const path = target.pathname.toLowerCase();
  return (
    path.endsWith("/chat/completions") ||
    path.endsWith("/messages") ||
    path.includes("streamgeneratecontent")
  );
}

/**
 * Some OpenAI-compatible gateways reject `stream_options: { include_usage: true }`
 * with HTTP 400/422. Strip it and return the cleaned buffer if present.
 */
function stripStreamOptions(buffer: ArrayBuffer | undefined, contentType: string): ArrayBuffer | null {
  if (!buffer || !contentType.toLowerCase().includes("application/json")) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(buffer)) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !("stream_options" in parsed)) {
      return null;
    }
    delete parsed.stream_options;
    const encoded = new TextEncoder().encode(JSON.stringify(parsed));
    return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
  } catch {
    return null;
  }
}

async function fetchWithConnectTimeout(
  url: string,
  init: RequestInit,
  clientSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, CONNECT_TIMEOUT_MS);

  const onClientAbort = () => controller.abort();
  if (clientSignal) {
    if (clientSignal.aborted) {
      clearTimeout(timer);
      controller.abort();
    } else {
      clientSignal.addEventListener("abort", onClientAbort, { once: true });
    }
  }

  try {
    // Once headers arrive, clear the connect timer so long-running SSE streams
    // can continue indefinitely without being cut off by the connect timeout.
    const response = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timer);
    return response;
  } catch (err) {
    clearTimeout(timer);
    if (timedOut) {
      throw new Error(`Upstream timed out after ${Math.round(CONNECT_TIMEOUT_MS / 1000)}s.`);
    }
    throw err;
  } finally {
    clientSignal?.removeEventListener("abort", onClientAbort);
  }
}

/** Upper bound for a proxied request body (images are sent as base64). */
const MAX_PROXY_BODY_BYTES = 12 * 1024 * 1024;

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "::1" ||
    host === "0:0:0:0:0:0:0:1" ||
    host === "0.0.0.0"
  ) {
    return true;
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return false;
  const a = Number(ipv4[1]);
  const b = Number(ipv4[2]);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

function allowedHosts(env: ProxyEnv): string[] {
  return (env.ALLOWED_HOSTS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function hostMatches(host: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1);
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  return host === pattern;
}

function baseHeaders(request: Request, env: ProxyEnv): Headers {
  return apiHeaders(request, env);
}

function errorResponse(request: Request, env: ProxyEnv, status: number, message: string): Response {
  return jsonError(request, env, status, message);
}

function isLocalRequest(request: Request): boolean {
  const host = new URL(request.url).hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

function isSameOriginBrowserRequest(request: Request, env: ProxyEnv): boolean {
  if (isLocalRequest(request)) return true;
  if (allowedOrigin(request, env)) return true;
  // Same-origin GET fetches omit Origin and (under Referrer-Policy: no-referrer)
  // omit Referrer, but browsers still attach Sec-Fetch-Site: same-origin.
  const fetchSite = (request.headers.get("sec-fetch-site") ?? "").trim().toLowerCase();
  if (fetchSite === "same-origin") {
    const configured = (env.ALLOWED_ORIGIN ?? "")
      .split(",")
      .map((entry) => entry.trim().replace(/\/+$/, ""))
      .filter(Boolean);
    if (configured.length === 0) return true;
    return configured.includes(new URL(request.url).origin);
  }
  return false;
}

function authorized(request: Request, env: ProxyEnv): boolean {
  const expected = (env.PROXY_TOKEN ?? "").trim();
  if (!expected) return isSameOriginBrowserRequest(request, env);
  const provided = request.headers.get("x-proxy-token") ?? "";
  return provided.length > 0 && provided === expected;
}

interface TargetCheck {
  status: number;
  message: string;
}

/**
 * One policy for the initial URL and for every redirect destination.
 * Redirects are followed manually so a public host cannot bounce us into
 * loopback or RFC1918 space (SSRF).
 */
function checkTarget(target: URL, env: ProxyEnv): TargetCheck | null {
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return { status: 400, message: "Only http(s) targets are supported." };
  }
  if (target.username || target.password) {
    return {
      status: 400,
      message: "Credentials in the target URL are not allowed. Send an auth header instead.",
    };
  }

  const allowlist = allowedHosts(env);
  const host = target.hostname.toLowerCase();
  if (allowlist.length > 0) {
    if (!allowlist.some((pattern) => hostMatches(host, pattern))) {
      return { status: 403, message: `Host ${host} is not in ALLOWED_HOSTS.` };
    }
  } else if (isPrivateHost(host)) {
    return {
      status: 403,
      message:
        "Private and loopback hosts are blocked. Add the host to ALLOWED_HOSTS only if you really need it.",
    };
  }

  if (target.protocol === "http:" && !allowlist.some((pattern) => hostMatches(host, pattern))) {
    return { status: 400, message: "Plain http is only allowed for explicitly allowlisted hosts." };
  }
  return null;
}

/** Core proxy handler shared by the dev server and Pages Functions. */
export async function handleProxy(request: Request, env: ProxyEnv = {}): Promise<Response> {
  const requestUrl = new URL(request.url);

  if (rejectedOrigin(request, env)) {
    return errorResponse(request, env, 403, "Origin not allowed.");
  }

  // CORS preflight does not carry the target URL, so answer it immediately.
  if (request.method.toUpperCase() === "OPTIONS") {
    return new Response(null, { status: 204, headers: baseHeaders(request, env) });
  }

  const limited = rateLimit("proxy", clientIp(request), 120, 60_000);
  if (!limited.ok) {
    return jsonError(request, env, 429, "Too many proxy requests. Please wait a moment.", "rate_limited", {
      "Retry-After": String(limited.retryAfter),
    });
  }

  if (!(env.PROXY_TOKEN ?? "").trim() && !isSameOriginBrowserRequest(request, env)) {
    return errorResponse(
      request,
      env,
      503,
      "The proxy is disabled for non-same-origin requests on this deployment. Set PROXY_TOKEN on the server before calling /api/proxy externally.",
    );
  }

  if (!authorized(request, env)) {
    return errorResponse(request, env, 401, "Missing or invalid proxy token.");
  }

  if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(request.method.toUpperCase())) {
    return errorResponse(request, env, 405, "Method not allowed.");
  }

  const raw = requestUrl.searchParams.get("url");
  if (!raw) {
    return errorResponse(
      request,
      env,
      400,
      "Missing ?url= parameter. Usage: /api/proxy?url=https%3A%2F%2Fapi.example.com%2Fv1%2Fmodels",
    );
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return errorResponse(request, env, 400, "The ?url= parameter is not a valid absolute URL.");
  }

  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return errorResponse(request, env, 400, "Only http(s) targets are supported.");
  }
  target = canonicalizeProxyTarget(target);
  const initialCheck = checkTarget(target, env);
  if (initialCheck) return errorResponse(request, env, initialCheck.status, initialCheck.message);

  const headers = new Headers();
  for (const [key, value] of request.headers) {
    const lower = key.toLowerCase();
    if (DROP_REQUEST_HEADERS.has(lower)) continue;
    if (lower.startsWith("cf-") || lower.startsWith("sec-") || lower.startsWith("x-forwarded-")) continue;
    headers.set(key, value);
  }

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  // Ask upstream gateways not to gzip-compress SSE streams; compressed SSE
  // chunks often get buffered until a 4–8 KB block fills, stalling first token.
  if (wantsStreamingResponse(method, target, headers)) {
    headers.set("accept-encoding", "identity");
  }

  let bodyBuffer: ArrayBuffer | undefined;
  if (hasBody) {
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_PROXY_BODY_BYTES) {
      return errorResponse(request, env, 413, "Request body is too large.");
    }
    bodyBuffer = await request.arrayBuffer();
    if (bodyBuffer.byteLength > MAX_PROXY_BODY_BYTES) {
      return errorResponse(request, env, 413, "Request body is too large.");
    }
  }

  let upstream: Response | null = null;
  let current = target;
  let currentMethod = method;
  let currentBody = bodyBuffer;
  let currentHeaders = headers;
  const MAX_REDIRECTS = 3;

  const sendWithRedirects = async (
    startTarget: URL,
    bodyForRequest: ArrayBuffer | undefined,
  ): Promise<Response | null> => {
    let response: Response | null = null;
    current = startTarget;
    currentMethod = method;
    currentBody = bodyForRequest;
    currentHeaders = headers;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      response = await fetchWithConnectTimeout(
        current.toString(),
        {
          method: currentMethod,
          headers: currentHeaders,
          body: currentMethod === "GET" || currentMethod === "HEAD" ? undefined : currentBody,
          redirect: "manual",
        },
        request.signal,
      );

      const isRedirect = [301, 302, 303, 307, 308].includes(response.status);
      if (!isRedirect) break;

      const location = response.headers.get("location");
      if (!location) break;
      if (hop === MAX_REDIRECTS) {
        await response.body?.cancel();
        throw { proxyError: errorResponse(request, env, 502, "Too many upstream redirects.") };
      }

      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        await response.body?.cancel();
        throw { proxyError: errorResponse(request, env, 502, "The upstream returned an invalid redirect location.") };
      }

      const redirectCheck = checkTarget(next, env);
      if (redirectCheck) {
        await response.body?.cancel();
        throw { proxyError: errorResponse(request, env, redirectCheck.status, redirectCheck.message) };
      }

      // A redirect to another host must not carry the caller's credentials.
      if (next.hostname.toLowerCase() !== current.hostname.toLowerCase()) {
        const sanitized = new Headers(currentHeaders);
        for (const name of ["authorization", "x-api-key", "api-key", "x-goog-api-key", "x-proxy-token"]) {
          sanitized.delete(name);
        }
        currentHeaders = sanitized;
      }

      const switchToGet =
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) && currentMethod === "POST");
      if (switchToGet) {
        currentMethod = "GET";
        currentBody = undefined;
      }

      await response.body?.cancel();
      current = next;
    }

    return response;
  };

  try {
    upstream = await sendWithRedirects(target, bodyBuffer);

    // If a custom provider at /v1/... hit a web-app HTML 404/405 page, retry
    // automatically at /api/v1/... so Next.js-hosted gateways work out of the box.
    if (upstream && (upstream.status === 404 || upstream.status === 405) && isHtmlResponse(upstream)) {
      const fallback = apiV1FallbackTarget(target);
      if (fallback && !checkTarget(fallback, env)) {
        const retry = await sendWithRedirects(fallback, bodyBuffer);
        if (retry && (!isHtmlResponse(retry) || retry.ok)) {
          await upstream.body?.cancel().catch(() => undefined);
          upstream = retry;
          target = fallback;
        } else if (retry) {
          await retry.body?.cancel().catch(() => undefined);
        }
      }
    }

    // If an OpenAI-compatible gateway rejects `stream_options` with 400/422,
    // transparently retry once without `stream_options`.
    if (upstream && (upstream.status === 400 || upstream.status === 422) && currentMethod === "POST") {
      const stripped = stripStreamOptions(bodyBuffer, currentHeaders.get("content-type") ?? "");
      if (stripped) {
        const errPreview = await upstream.clone().text().catch(() => "");
        if (/stream_options|extra_forbidden|unrecognized|unknown field|additional properties/i.test(errPreview)) {
          await upstream.body?.cancel().catch(() => undefined);
          upstream = await sendWithRedirects(target, stripped);
        }
      }
    }
  } catch (error) {
    if (error && typeof error === "object" && "proxyError" in error) {
      return (error as { proxyError: Response }).proxyError;
    }
    const message = error instanceof Error ? error.message : "Upstream request failed.";
    return errorResponse(request, env, 502, `Could not reach ${current.host}: ${message}`);
  }

  if (!upstream) {
    return errorResponse(request, env, 502, "The upstream request did not complete.");
  }

  // Never dump a raw website HTML 404/405 page into the chat UI — return a
  // structured JSON error pointing at the wrong API base URL instead.
  if ((upstream.status === 404 || upstream.status === 405) && isHtmlResponse(upstream)) {
    await upstream.body?.cancel().catch(() => undefined);
    return errorResponse(
      request,
      env,
      upstream.status,
      `The provider returned an HTML ${upstream.status} page for ${current.host}${current.pathname} instead of an API response. Check the provider base URL (for example, /api/v1 instead of /v1).`,
    );
  }

  const responseHeaders = baseHeaders(request, env);
  for (const [key, value] of upstream.headers) {
    const lower = key.toLowerCase();
    if (DROP_RESPONSE_HEADERS.has(lower)) continue;
    if (lower.startsWith("cf-") || lower.startsWith("access-control-") || lower.startsWith("cross-origin-")) continue;
    responseHeaders.set(key, value);
  }
  // Keep the upstream content type (important for text/event-stream) but make
  // sure no intermediary buffers the token stream.
  responseHeaders.set("X-Accel-Buffering", "no");
  responseHeaders.set("Cache-Control", "no-store");

  const body = method === "HEAD" || upstream.status === 204 || upstream.status === 304 ? null : upstream.body;
  return new Response(body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

/** Cloudflare Pages Functions entry point. */
export async function onRequest(context: { request: Request; env: ProxyEnv }): Promise<Response> {
  try {
    return await handleProxy(context.request, context.env ?? {});
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected proxy error.";
    return errorResponse(context.request, context.env ?? {}, 500, message);
  }
}
