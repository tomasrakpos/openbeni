/**
 * APISet Pro — optional CORS proxy for Cloudflare Workers.
 *
 * Deploy this when a provider does not send CORS headers for browser calls
 * (OpenAI, Anthropic, most OpenAI-compatible gateways). The app sends:
 *
 *   GET https://<worker>/?url=https%3A%2F%2Fapi.openai.com%2Fv1%2Fmodels
 *
 * Features
 * - Streaming-safe: the upstream body is piped straight through, so SSE works.
 * - Host allowlist via ALLOWED_HOSTS (comma separated, `*.example.com` wildcards).
 * - Blocks localhost / RFC1918 targets unless they are explicitly allowlisted.
 * - Never forwards cookies, origin, referer, or Cloudflare-specific headers.
 * - Optional shared secret via PROXY_TOKEN (sent as the `x-proxy-token` header).
 *
 * Environment variables (Settings → Variables in the Cloudflare dashboard):
 *   ALLOWED_HOSTS   "api.openai.com,api.anthropic.com,*.openrouter.ai"
 *                   Leave unset to allow any public host. Always set it in
 *                   production so the worker cannot be abused as an open proxy.
 *   ALLOWED_ORIGIN  "https://apiset-pro.pages.dev" (default "*")
 *   PROXY_TOKEN     optional shared secret
 *
 * Deploy:
 *   npx wrangler deploy --config worker/wrangler.toml
 */

interface Env {
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

/** Response headers that must be recomputed or are unsafe to expose. */
const DROP_RESPONSE_HEADERS = new Set([
  ...HOP_BY_HOP,
  "content-encoding",
  "content-length",
  "set-cookie",
  "set-cookie2",
]);

const ALLOW_HEADERS = [
  "accept",
  "authorization",
  "content-type",
  "x-api-key",
  "api-key",
  "x-goog-api-key",
  "anthropic-version",
  "anthropic-beta",
  "anthropic-dangerous-direct-browser-access",
  "openai-organization",
  "openai-project",
  "x-proxy-token",
].join(", ");

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

function allowedHosts(env: Env): string[] {
  return (env.ALLOWED_HOSTS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function hostMatches(host: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1); // ".example.com"
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  return host === pattern;
}

function corsOrigin(request: Request, env: Env): string {
  const configured = (env.ALLOWED_ORIGIN ?? "*").trim();
  if (configured === "*" || !configured) return "*";
  const origin = request.headers.get("Origin");
  const allowed = configured
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (origin && allowed.includes(origin)) return origin;
  return allowed[0] ?? "*";
}

function baseHeaders(request: Request, env: Env): Headers {
  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", corsOrigin(request, env));
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", ALLOW_HEADERS);
  headers.set("Access-Control-Max-Age", "86400");
  headers.set("Access-Control-Expose-Headers", "Content-Type, X-Request-Id");
  headers.set("Vary", "Origin");
  headers.set("Cache-Control", "no-store");
  return headers;
}

function json(request: Request, env: Env, status: number, message: string): Response {
  const headers = baseHeaders(request, env);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify({ error: { message, status } }), { status, headers });
}

function isLocalRequest(request: Request): boolean {
  const host = new URL(request.url).hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

function authorized(request: Request, env: Env): boolean {
  const expected = (env.PROXY_TOKEN ?? "").trim();
  if (!expected) return isLocalRequest(request);
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
function checkTarget(target: URL, env: Env): TargetCheck | null {
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return { status: 400, message: "Only http(s) targets are supported." };
  }
  if (target.username || target.password) {
    return { status: 400, message: "Credentials in the target URL are not allowed. Send an auth header instead." };
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

async function handle(request: Request, env: Env): Promise<Response> {
  const requestUrl = new URL(request.url);

  // CORS preflight never sees the target URL in some browsers, so answer early.
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: baseHeaders(request, env) });
  }

  if (!(env.PROXY_TOKEN ?? "").trim() && !isLocalRequest(request)) {
    return json(
      request,
      env,
      503,
      "The proxy is disabled on this deployment. Set PROXY_TOKEN on the server before using /api/proxy.",
    );
  }

  if (!authorized(request, env)) {
    return json(request, env, 401, "Missing or invalid proxy token.");
  }

  const raw = requestUrl.searchParams.get("url");
  if (!raw) {
    return json(request, env, 400, "Missing ?url= parameter. Usage: /?url=https%3A%2F%2Fapi.example.com%2Fv1%2Fmodels");
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return json(request, env, 400, "The ?url= parameter is not a valid absolute URL.");
  }

  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return json(request, env, 400, "Only http(s) targets are supported.");
  }
  const initialCheck = checkTarget(target, env);
  if (initialCheck) return json(request, env, initialCheck.status, initialCheck.message);

  const headers = new Headers();
  for (const [key, value] of request.headers) {
    const lower = key.toLowerCase();
    if (DROP_REQUEST_HEADERS.has(lower)) continue;
    if (lower.startsWith("cf-") || lower.startsWith("sec-") || lower.startsWith("x-forwarded-")) continue;
    headers.set(key, value);
  }

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const bodyBuffer = hasBody ? await request.arrayBuffer() : undefined;

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
        return json(request, env, 502, "Too many upstream redirects.");
      }

      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        await upstream.body?.cancel();
        return json(request, env, 502, "The upstream returned an invalid redirect location.");
      }

      const redirectCheck = checkTarget(next, env);
      if (redirectCheck) {
        await upstream.body?.cancel();
        return json(request, env, redirectCheck.status, redirectCheck.message);
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
    return json(request, env, 502, `Could not reach ${current.host}: ${message}`);
  }

  if (!upstream) {
    return json(request, env, 502, "The upstream request did not complete.");
  }

  const responseHeaders = baseHeaders(request, env);
  for (const [key, value] of upstream.headers) {
    const lower = key.toLowerCase();
    if (DROP_RESPONSE_HEADERS.has(lower)) continue;
    if (lower.startsWith("cf-")) continue;
    responseHeaders.set(key, value);
  }
  // Keep the upstream content type (important for text/event-stream) but force
  // no buffering through any intermediary.
  responseHeaders.set("X-Accel-Buffering", "no");
  responseHeaders.set("Cache-Control", "no-store");

  const body = method === "HEAD" || upstream.status === 204 || upstream.status === 304 ? null : upstream.body;
  return new Response(body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected proxy error.";
      return json(request, env, 500, message);
    }
  },
};
