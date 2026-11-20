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

import { clientIp, jsonError, rateLimit, rejectedOrigin, apiHeaders } from "./security";


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
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-ray",
  "cf-visitor",
  "cdn-loop",
]);

/** Response headers that are recomputed or unsafe to expose. */
const DROP_RESPONSE_HEADERS = new Set([
  ...HOP_BY_HOP,
  "content-encoding",
  "content-length",
  "set-cookie",
  "set-cookie2",
]);

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

function authorized(request: Request, env: ProxyEnv): boolean {
  const expected = (env.PROXY_TOKEN ?? "").trim();
  if (!expected) return isLocalRequest(request);
  const provided = request.headers.get("x-proxy-token") ?? "";
  return provided.length > 0 && provided === expected;
}

function isLocalRequest(request: Request): boolean {
  const host = new URL(request.url).hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
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

  const limited = rateLimit("proxy", clientIp(request), 60, 60_000);
  if (!limited.ok) {
    return jsonError(request, env, 429, "Too many proxy requests. Please wait a moment.", "rate_limited", {
      "Retry-After": String(limited.retryAfter),
    });
  }

  if (!(env.PROXY_TOKEN ?? "").trim() && !isLocalRequest(request)) {
    return errorResponse(
      request,
      env,
      503,
      "The proxy is disabled on this deployment. Set PROXY_TOKEN on the server before using /api/proxy.",
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

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      upstream = await fetch(current.toString(), {
        method: currentMethod,
        headers: currentHeaders,
        body: currentMethod === "GET" || currentMethod === "HEAD" ? undefined : currentBody,
        redirect: "manual",
      });

      const isRedirect = [301, 302, 303, 307, 308].includes(upstream.status);
      if (!isRedirect) break;

      const location = upstream.headers.get("location");
      if (!location) break;
      if (hop === MAX_REDIRECTS) {
        await upstream.body?.cancel();
        return errorResponse(request, env, 502, "Too many upstream redirects.");
      }

      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        await upstream.body?.cancel();
        return errorResponse(request, env, 502, "The upstream returned an invalid redirect location.");
      }

      const redirectCheck = checkTarget(next, env);
      if (redirectCheck) {
        await upstream.body?.cancel();
        return errorResponse(request, env, redirectCheck.status, redirectCheck.message);
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
        upstream.status === 303 ||
        ((upstream.status === 301 || upstream.status === 302) && currentMethod === "POST");
      if (switchToGet) {
        currentMethod = "GET";
        currentBody = undefined;
      }

      await upstream.body?.cancel();
      current = next;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upstream request failed.";
    return errorResponse(request, env, 502, `Could not reach ${current.host}: ${message}`);
  }

  if (!upstream) {
    return errorResponse(request, env, 502, "The upstream request did not complete.");
  }

  const responseHeaders = baseHeaders(request, env);
  for (const [key, value] of upstream.headers) {
    const lower = key.toLowerCase();
    if (DROP_RESPONSE_HEADERS.has(lower)) continue;
    if (lower.startsWith("cf-")) continue;
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
