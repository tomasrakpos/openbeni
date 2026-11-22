// API route: POST /api/provider-inspect — smart server-side API key verification,
// format detection, and Free vs Paid model classification.
// Used by both the User ProviderWizard and the Admin Panel so every key is tested
// live (without leaking keys in logs) and returns exact Free/Paid counts + latency.
import { inspectProvider } from "./_lib/providerInspector";
import type { ApiFormat } from "./_lib/providerKeys";
import { sanitizeExtraHeaders } from "./_lib/userProviders";
import {
  apiHeaders,
  clientIp,
  jsonError,
  rateLimit,
  readJsonBody,
  rejectedOrigin,
  type SecurityEnv,
} from "./security";

export type ProviderInspectEnv = SecurityEnv;

const ALLOWED_FORMATS = new Set(["auto", "openai", "anthropic", "gemini", "custom"]);

export async function handleProviderInspect(
  request: Request,
  env: ProviderInspectEnv,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    if (rejectedOrigin(request, env)) {
      return jsonError(request, env, 403, "Origin is not allowed.");
    }
    return new Response(null, { status: 204, headers: apiHeaders(request, env) });
  }

  if (rejectedOrigin(request, env)) {
    return jsonError(request, env, 403, "Origin is not allowed.");
  }

  if (request.method !== "POST") {
    return jsonError(request, env, 405, "Method not allowed.");
  }

  const limit = rateLimit("provider-inspect", clientIp(request), 30, 60_000);
  if (!limit.ok) {
    return jsonError(request, env, 429, "Too many inspection requests. Please wait a moment.", "rate_limited");
  }

  const parsed = await readJsonBody(request);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") {
    return jsonError(
      request,
      env,
      !parsed.ok && parsed.reason === "too-large" ? 413 : 400,
      "Invalid JSON body.",
    );
  }

  const body = parsed.value as Record<string, unknown>;
  const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim().slice(0, 500) : "";
  if (!baseUrl) {
    return jsonError(request, env, 400, "baseUrl is required.");
  }

  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim().slice(0, 1000) : "";
  const rawFormat = typeof body.format === "string" ? body.format.trim().toLowerCase() : "auto";
  const format = (ALLOWED_FORMATS.has(rawFormat) ? rawFormat : "auto") as ApiFormat | "auto";
  const authHeader = typeof body.authHeader === "string" ? body.authHeader.trim().slice(0, 80) : undefined;
  const authPrefix = typeof body.authPrefix === "string" ? body.authPrefix.slice(0, 40) : undefined;
  const extraHeaders = sanitizeExtraHeaders(body.extraHeaders);
  const verifyKeyLive = body.verifyKeyLive !== false;

  const result = await inspectProvider({
    baseUrl,
    apiKey,
    format,
    ...(authHeader ? { authHeader } : {}),
    ...(authPrefix !== undefined ? { authPrefix } : {}),
    extraHeaders,
    verifyKeyLive,
  });

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: apiHeaders(request, env, {
      "Content-Type": "application/json; charset=utf-8",
    }),
  });
}

export const onRequest = async (context: { request: Request; env?: ProviderInspectEnv }) =>
  handleProviderInspect(context.request, context.env ?? {});
