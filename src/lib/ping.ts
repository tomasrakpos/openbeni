// Shared logic ping; change this helper here and update callers if its contract changes.
import { testModel } from "@/lib/chatClient";
import { classifyException, classifyHttpStatus, extractErrorMessage, proxiedUrl, readJsonSafe, resolveProxyUrl } from "@/lib/http";
import { modelsUrl } from "@/lib/chatClient";
import { joinUrl } from "@/lib/normalize";
import type { AIModel, ErrorKind, PingResult, Provider } from "@/lib/types";
import { uid } from "@/lib/id";

export interface PingContext {
  provider: Provider;
  apiKey: string;
  proxyUrl?: string;
  signal?: AbortSignal;
}

export async function pingProvider(ctx: PingContext): Promise<PingResult> {
  const { provider, apiKey, signal } = ctx;
  const url = modelsUrl(provider);
  const headers: Record<string, string> = { Accept: "application/json", ...provider.extraHeaders };
  if (!provider.managed && provider.auth.header && apiKey) {
    headers[provider.auth.header] = `${provider.auth.prefix ?? ""}${apiKey}`;
  }
  if (!provider.managed && provider.apiFormat === "anthropic") {
    headers["anthropic-version"] ??= "2023-06-01";
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  }
  const target =
    provider.managed || !provider.useProxy ? url : proxiedUrl(url, resolveProxyUrl(ctx.proxyUrl));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const started = performance.now();
  try {
    const response = await fetch(target, { headers, signal: controller.signal, cache: "no-store" });
    const latencyMs = Math.round(performance.now() - started);
    const payload = await readJsonSafe(response);
    const kind: ErrorKind = classifyHttpStatus(response.status);
    return {
      id: uid("ping"),
      providerId: provider.id,
      at: Date.now(),
      latencyMs,
      ok: response.ok,
      httpStatus: response.status,
      kind,
      message: response.ok ? undefined : extractErrorMessage(payload) ?? `HTTP ${response.status}`,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started);
    const timedOut = controller.signal.aborted && !signal?.aborted;
    const kind = classifyException(err, timedOut);
    return {
      id: uid("ping"),
      providerId: provider.id,
      at: Date.now(),
      latencyMs,
      ok: false,
      kind: timedOut ? "timeout" : kind,
      message: timedOut ? "No answer within 10s" : err instanceof Error ? err.message : "Request failed",
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function pingModel(ctx: PingContext, model: AIModel): Promise<PingResult> {
  const result = await testModel(ctx.provider, ctx.apiKey, model.modelId, ctx.proxyUrl, ctx.signal);
  return {
    id: uid("ping"),
    providerId: ctx.provider.id,
    modelId: model.id,
    at: Date.now(),
    latencyMs: result.latencyMs,
    ok: result.ok,
    kind: result.kind as ErrorKind,
    message: result.message,
  };
}

export function latencyTone(latencyMs: number, ok: boolean): "good" | "warn" | "bad" {
  if (!ok) return "bad";
  if (latencyMs < 800) return "good";
  if (latencyMs < 2500) return "warn";
  return "bad";
}

export function latestPing(pings: PingResult[], providerId: string, modelId?: string): PingResult | undefined {
  let latest: PingResult | undefined;
  for (const ping of pings) {
    if (ping.providerId !== providerId) continue;
    if (modelId ? ping.modelId !== modelId : ping.modelId !== undefined) continue;
    if (!latest || ping.at > latest.at) latest = ping;
  }
  return latest;
}

export function sparkline(pings: PingResult[], providerId: string, limit = 20): PingResult[] {
  return pings
    .filter((p) => p.providerId === providerId && p.modelId === undefined)
    .sort((a, b) => a.at - b.at)
    .slice(-limit);
}

export { joinUrl };
