// Shared logic normalize; change this helper here and update callers if its contract changes.
import type { ApiFormat } from "@/lib/types";

export type NormalizeCode =
  | "trimmed"
  | "protocol"
  | "trailing-slash"
  | "removed-endpoint"
  | "added-version"
  | "collapsed-slashes"
  | "removed-query"
  | "removed-hash";

export interface NormalizeChange {
  code: NormalizeCode;
  detail?: string;
}

export interface NormalizeResult {
  baseUrl: string;
  changes: NormalizeChange[];
  valid: boolean;
}

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

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"]);

function isLocalHost(host: string): boolean {
  if (LOCAL_HOSTS.has(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return false;
}

export function versionSegment(format: ApiFormat): string {
  if (format === "gemini") return "/v1beta";
  return "/v1";
}

/**
 * Normalize any base URL a user might paste into a clean API root.
 * Handles: missing protocol, trailing slashes, pasted full endpoints,
 * duplicated version segments, query strings and hash fragments.
 */
export function normalizeBaseUrl(raw: string, format: ApiFormat = "openai"): NormalizeResult {
  const changes: NormalizeChange[] = [];
  let input = (raw ?? "").trim();
  if (!input) return { baseUrl: "", changes, valid: false };
  if (input !== raw) changes.push({ code: "trimmed" });

  if (input.startsWith("//")) {
    input = `https:${input}`;
    changes.push({ code: "protocol", detail: "https" });
  }

  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(input)) {
    const hostPart = input.split("/")[0] ?? "";
    const host = hostPart.split(":")[0] ?? "";
    const scheme = isLocalHost(host) ? "http" : "https";
    input = `${scheme}://${input}`;
    changes.push({ code: "protocol", detail: scheme });
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { baseUrl: input, changes, valid: false };
  }

  if (url.hash) {
    url.hash = "";
    changes.push({ code: "removed-hash" });
  }
  if (url.search) {
    url.search = "";
    changes.push({ code: "removed-query" });
  }

  let path = url.pathname.replace(/\/{2,}/g, "/");
  if (path !== url.pathname) changes.push({ code: "collapsed-slashes" });

  // strip a pasted endpoint like /v1/chat/completions or /models
  let lower = path.toLowerCase().replace(/\/$/, "");
  for (const suffix of ENDPOINT_SUFFIXES) {
    if (lower.endsWith(suffix)) {
      path = path.slice(0, path.length - suffix.length);
      changes.push({ code: "removed-endpoint", detail: suffix });
      break;
    }
  }

  // deltas like models/gemini-x:streamGenerateContent
  path = path.replace(/\/models\/[^/]+:(stream)?generatecontent$/i, "");
  path = path.replace(/\/models\/[^/]+$/i, "");

  // remove duplicated version segments: /v1/v1 -> /v1
  path = path.replace(/\/(v1|v1beta|v2|v3|openai)\/\1\b/gi, "/$1");

  if (!path || path === "/") {
    path = versionSegment(format);
    changes.push({ code: "added-version", detail: path.replace("/", "") });
  }

  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
    changes.push({ code: "trailing-slash" });
  }

  url.pathname = path;
  return { baseUrl: url.toString().replace(/\/$/, ""), changes, valid: true };
}

/** Join a base URL and a relative path without doubling slashes or dropping queries. */
export function joinUrl(base: string, path: string): string {
  if (!path) return base.replace(/\/+$/, "");
  if (/^https?:\/\//i.test(path)) return path;
  const b = base.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

export function suggestionForUrl(raw: string): string | null {
  if (!raw.trim()) return null;
  if (/\/chat\/completions\b/i.test(raw)) return "removed-endpoint";
  if (/\/v1\/v1\b/i.test(raw)) return "collapsed-slashes";
  if (/\s/.test(raw)) return "trimmed";
  return null;
}
