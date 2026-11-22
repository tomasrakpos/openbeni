// Shared logic detect; change this helper here and update callers if its contract changes.
import { classifyException, makeApiError, proxiedUrl, readJsonSafe, resolveProxyUrl } from "@/lib/http";
import { joinUrl, normalizeBaseUrl } from "@/lib/normalize";
import { parseModelList } from "@/lib/chatClient";
import type { ApiFormat, DetectionResult, ProbeStep } from "@/lib/types";

export interface DetectOptions {
  baseUrl: string;
  apiKey: string;
  extraHeaders?: Record<string, string>;
  proxyUrl?: string;
  useProxy?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Fired before each probe so the UI can show live progress. */
  onProbeStart?: (info: { id: string; label: string; method: "GET"; url: string }) => void;
  /** Fired when a probe finishes (success or failure). */
  onStep?: (step: ProbeStep) => void;
}

function candidateBases(raw: string): { base: string; note?: string }[] {
  const normalized = normalizeBaseUrl(raw, "openai").baseUrl;
  const out: { base: string; note?: string }[] = [{ base: normalized }];
  try {
    const url = new URL(normalized);
    const root = `${url.protocol}//${url.host}`;
    if (url.pathname !== "/" && url.pathname !== "") out.push({ base: joinUrl(root, ""), note: "root" });
    if (!/\/v1(beta)?$/.test(url.pathname)) out.push({ base: `${normalized.replace(/\/v1$/, "")}/v1`, note: "/v1" });
    out.push({ base: `${root}/v1beta`, note: "/v1beta" });
    if (url.pathname.endsWith("/v1")) out.push({ base: `${root}/openai/v1`, note: "/openai/v1" });
  } catch {
    // ignore — invalid URL reported by caller
  }
  const seen = new Set<string>();
  return out.filter((item) => {
    if (seen.has(item.base)) return false;
    seen.add(item.base);
    return true;
  });
}

async function probe(
  id: string,
  label: string,
  base: string,
  headers: Record<string, string>,
  opts: DetectOptions,
): Promise<{ step: ProbeStep; models: string[] }> {
  const url = joinUrl(base, "/models");
  const step: ProbeStep = { id, label, method: "GET", url, ok: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 12_000);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  const started = performance.now();
  try {
    const init: RequestInit = {
      headers: { Accept: "application/json", ...opts.extraHeaders, ...headers },
      signal: controller.signal,
      cache: "no-store",
    };
    const proxy = resolveProxyUrl(opts.proxyUrl);
    let response: Response;
    if (opts.useProxy) {
      response = await fetch(proxiedUrl(url, proxy), init);
    } else {
      try {
        response = await fetch(url, init);
      } catch (err) {
        if (controller.signal.aborted || classifyException(err, false) !== "cors") throw err;
        response = await fetch(proxiedUrl(url, proxy), init);
      }
    }
    step.status = response.status;
    const payload = await readJsonSafe(response);
    if (response.ok) {
      const models = parseModelList(payload).map((m) => m.id);
      step.ok = true;
      step.models = models;
      step.note = `${models.length} models · ${Math.round(performance.now() - started)}ms`;
      return { step, models };
    }
    const detail = typeof payload === "object" && payload ? JSON.stringify(payload).slice(0, 240) : String(payload).slice(0, 240);
    step.detail = `HTTP ${response.status}${detail ? ` — ${detail}` : ""}`;
    step.note = response.status === 401 || response.status === 403 ? "endpoint exists, key rejected" : "not a match";
  } catch (err) {
    const kind = classifyException(err, controller.signal.aborted && !opts.signal?.aborted);
    step.detail = err instanceof Error ? err.message : String(err);
    step.note = kind === "timeout" ? "timeout" : kind === "cors" ? "blocked by CORS" : "network unreachable";
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
  return { step, models: [] };
}

/**
 * Probe a provider in a fixed order and stop at the first success:
 *  1. OpenAI-compatible GET /models with Bearer
 *  2. Anthropic GET /models with x-api-key + anthropic-version
 *  3. Gemini GET /models with x-goog-api-key
 */
export async function detectFormat(opts: DetectOptions): Promise<DetectionResult> {
  const raw = opts.baseUrl.trim();
  if (!raw) {
    return { format: null, steps: [], baseUrl: raw, models: [], error: "Base URL is required." };
  }
  const bases = candidateBases(raw);
  const steps: ProbeStep[] = [];
  const attempts: { format: ApiFormat; base: string; headers: Record<string, string> }[] = [];

  const bearer: Record<string, string> = opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {};
  const anthropic: Record<string, string> = opts.apiKey
    ? { "x-api-key": opts.apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }
    : {};
  const gemini: Record<string, string> = opts.apiKey ? { "x-goog-api-key": opts.apiKey } : {};

  // prefer bases that already look versioned for each flavour
  for (const { base } of bases) {
    attempts.push({ format: "openai", base, headers: bearer });
  }
  for (const { base } of bases) {
    if (base.endsWith("/v1beta")) continue;
    attempts.push({ format: "anthropic", base, headers: anthropic });
  }
  const geminiBases = new Set<string>();
  for (const { base } of bases) {
    const root = base.replace(/\/v1$/, "");
    geminiBases.add(`${root}/v1beta`);
    geminiBases.add(base);
  }
  for (const base of geminiBases) {
    attempts.push({ format: "gemini", base, headers: gemini });
  }

  for (const attempt of attempts) {
    if (opts.signal?.aborted) break;
    const label =
      attempt.format === "openai"
        ? `OpenAI-compatible · ${attempt.base}`
        : attempt.format === "anthropic"
          ? `Anthropic Messages · ${attempt.base}`
          : `Gemini · ${attempt.base}`;
    opts.onProbeStart?.({
      id: attempt.format,
      label,
      method: "GET",
      url: joinUrl(attempt.base, "/models"),
    });
    const { step, models } = await probe(attempt.format, label, attempt.base, attempt.headers, opts);
    steps.push(step);
    opts.onStep?.(step);
    if (step.ok) {
      return { format: attempt.format, steps, baseUrl: attempt.base, models };
    }
  }

  const authFailure = steps.some((s) => s.status === 401 || s.status === 403);
  const corsFailure = steps.some((s) => /cors/i.test(s.note ?? "") || /cors|failed to fetch/i.test(s.detail ?? ""));
  const notFound = steps.every((s) => s.status === 404);
  let error = "No compatible models endpoint answered.";
  if (authFailure) error = "The endpoint exists but rejected your key (401/403). Check the key and its permissions.";
  else if (corsFailure) error = "Every request was blocked by CORS. Enable the proxy or use a CORS-friendly endpoint.";
  else if (notFound) error = "Nothing answered at /models. The base URL is likely wrong or missing a version segment.";
  else if (steps.every((s) => s.note === "timeout")) error = "All probes timed out. Check the host and increase the timeout.";
  return { format: null, steps, baseUrl: normalizeBaseUrl(raw, "openai").baseUrl, models: [], error };
}

export function formatLabel(format: ApiFormat): string {
  switch (format) {
    case "openai":
      return "OpenAI-compatible";
    case "anthropic":
      return "Anthropic Messages";
    case "gemini":
      return "Google Gemini";
    case "custom":
      return "Custom template";
  }
}
