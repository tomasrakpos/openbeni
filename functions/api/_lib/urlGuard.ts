/**
 * SSRF guard shared by the admin API and the server-side chat proxy.
 *
 * Only public https targets are allowed. Redirects are followed manually and
 * every hop is re-validated, so a public host cannot bounce the server into
 * loopback / RFC1918 space.
 */

export function isPrivateHost(hostname: string): boolean {
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

export type UrlCheck = { ok: true; url: URL } | { ok: false; message: string };

/** API shapes that share the provider URL rules. */
export type ProviderFormat = "openai" | "anthropic" | "gemini" | "custom";

const ENDPOINT_SUFFIXES = [
  "/chat/completions",
  "/completions",
  "/messages",
  "/responses",
  "/models",
  "/generatecontent",
  "/streamgeneratecontent",
  "/embeddings",
  "/images/generations",
];

const KNOWN_HOST_API_PREFIX: Record<string, string> = {
  "coarena.ai": "/api/v1",
  "www.coarena.ai": "/api/v1",
  "openrouter.ai": "/api/v1",
  "www.openrouter.ai": "/api/v1",
  "api.groq.com": "/openai/v1",
};

/**
 * Canonical provider base URL, mirroring `src/lib/normalize.ts` so a provider
 * saved by the admin panel and one saved in the browser resolve the same
 * endpoint. The server used to store the raw string, which turned
 * `https://api.openai.com` into `https://api.openai.com/chat/completions`
 * (a 404 the chat surfaced as "model unavailable").
 *
 * Rules: drop query/hash, collapse duplicate slashes, strip a pasted endpoint
 * (`/v1/chat/completions`, `/models`, …), collapse `/v1/v1`, apply canonical
 * prefixes for hosts whose API lives under `/api/v1` or `/openai/v1`, and add
 * the default version segment when the URL has no path.
 */
export function normalizeProviderBaseUrl(raw: string, format: ProviderFormat = "openai"): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return raw.trim().replace(/\/+$/, "");
  }

  let path = url.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  const lower = path.toLowerCase();
  for (const suffix of ENDPOINT_SUFFIXES) {
    if (lower.endsWith(suffix)) {
      path = path.slice(0, path.length - suffix.length);
      break;
    }
  }
  path = path.replace(/\/models\/[^/]+:(?:stream)?generatecontent$/i, "");
  path = path.replace(/\/(v1beta|v1|v2|v3)\/\1\b/gi, "/$1");

  const hostPrefix = KNOWN_HOST_API_PREFIX[url.hostname.toLowerCase()];
  if (hostPrefix && format !== "custom") {
    const cleanLower = path.toLowerCase();
    if (!cleanLower || cleanLower === "/" || cleanLower === "/v1" || cleanLower === "/api" || cleanLower === "/openai") {
      path = hostPrefix;
    }
  }

  if (!path || path === "/") {
    path = format === "gemini" ? "/v1beta" : format === "custom" ? "" : "/v1";
  }
  path = path.replace(/\/+$/, "");

  url.pathname = path || "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

export function validateProviderBaseUrl(raw: string, format: ProviderFormat = "openai"): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, message: "The base URL is not a valid absolute URL." };
  }
  if (url.protocol !== "https:") return { ok: false, message: "The base URL must use https://." };
  if (url.username || url.password) {
    return { ok: false, message: "Credentials in the base URL are not allowed." };
  }
  if (isPrivateHost(url.hostname)) {
    return { ok: false, message: "Private, loopback and link-local hosts are not allowed." };
  }
  if (url.port && url.port !== "443") {
    return { ok: false, message: "Only the default https port is allowed." };
  }
  return { ok: true, url: new URL(normalizeProviderBaseUrl(raw, format)) };
}

const AUTH_HEADERS = ["authorization", "x-api-key", "api-key", "x-goog-api-key"];

export interface SafeFetchOptions {
  maxRedirects?: number;
  timeoutMs?: number;
}

/**
 * fetch() with manual, re-validated redirects. Auth headers are dropped when a
 * redirect crosses to a different host. Throws on an unsafe target.
 */
export async function safeFetch(
  target: URL,
  init: RequestInit,
  options: SafeFetchOptions = {},
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 3;
  const timeoutMs = options.timeoutMs ?? 60_000;
  let current = target;
  let currentInit: RequestInit = { ...init };
  let headers = new Headers(init.headers);
  const callerSignal = init.signal;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (callerSignal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onCallerAbort = () => controller.abort();
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true });

    let response: Response;
    try {
      response = await fetch(current.toString(), {
        ...currentInit,
        headers,
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (err) {
      if (timedOut) {
        const timeoutErr = new Error(`Upstream request timed out after ${Math.round(timeoutMs / 1000)}s.`);
        timeoutErr.name = "TimeoutError";
        throw timeoutErr;
      }
      throw err;
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    }

    if (![301, 302, 303, 307, 308].includes(response.status)) return response;

    const location = response.headers.get("location");
    if (!location) return response;
    if (hop === maxRedirects) {
      await response.body?.cancel();
      throw new Error("Too many upstream redirects.");
    }

    const next = new URL(location, current);
    if (next.protocol !== "https:" || isPrivateHost(next.hostname)) {
      await response.body?.cancel();
      throw new Error("The upstream redirected to a blocked or insecure host.");
    }

    if (next.hostname !== current.hostname) {
      const sanitized = new Headers(headers);
      for (const name of AUTH_HEADERS) sanitized.delete(name);
      headers = sanitized;
    }

    if (
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) && currentInit.method === "POST")
    ) {
      currentInit = { ...currentInit, method: "GET", body: undefined };
    }

    await response.body?.cancel();
    current = next;
  }

  throw new Error("Too many upstream redirects.");
}
