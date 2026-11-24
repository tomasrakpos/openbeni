// POST /api/preview-intent — Server-side skill classification & preview intent endpoint.
// Evaluates which category (`website`, `game`, `chat`, `deep_thinking`, `other`) applies
// via the fast LLM classifier (with safe fallback to `chat`) and returns the targeted
// skill selection and Mode A system prompt for direct browser-BYOK flows.

import {
  resolveSkillExecution,
  skillResponseHeaders,
  normalizeSkillMode,
  type SkillChatMessage,
  type SkillRuntimeEnv,
} from "./_lib/skills";
import { apiHeaders, clientIp, jsonError, rateLimit, readJsonBody, rejectedOrigin, type SecurityEnv } from "./security";

export type PreviewIntentEnv = SecurityEnv & SkillRuntimeEnv;

function sanitizeMessages(raw: unknown): SkillChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: SkillChatMessage[] = [];
  for (const item of raw.slice(-20)) {
    if (!item || typeof item !== "object") continue;
    const obj = item as { role?: unknown; content?: unknown };
    const role = typeof obj.role === "string" ? obj.role.trim() : "";
    if (role !== "user" && role !== "assistant" && role !== "system") continue;
    if (typeof obj.content === "string") {
      out.push({ role, content: obj.content.slice(0, 12_000) });
    } else if (Array.isArray(obj.content)) {
      out.push({ role, content: obj.content });
    }
  }
  return out;
}

export async function handlePreviewIntent(request: Request, env: PreviewIntentEnv = {}): Promise<Response> {
  if (request.method === "OPTIONS") {
    if (rejectedOrigin(request, env)) return jsonError(request, env, 403, "Origin not allowed.");
    return new Response(null, { status: 204, headers: apiHeaders(request, env) });
  }
  if (rejectedOrigin(request, env)) return jsonError(request, env, 403, "Origin not allowed.");
  if (request.method !== "POST") return jsonError(request, env, 405, "Method not allowed.");

  const ipLimit = rateLimit("preview-intent", clientIp(request), 60, 60_000);
  if (!ipLimit.ok) {
    return jsonError(request, env, 429, "Too many requests.", "rate_limited", {
      "Retry-After": String(ipLimit.retryAfter),
    });
  }

  const parsed = await readJsonBody(request);
  if (!parsed.ok) {
    return jsonError(request, env, parsed.reason === "too-large" ? 413 : 400, "Invalid request body.");
  }

  const payload = parsed.value as {
    messages?: unknown;
    skillMode?: unknown;
    providerFormat?: unknown;
    model?: unknown;
  };
  const messages = sanitizeMessages(payload?.messages);
  const skillMode = normalizeSkillMode(payload?.skillMode);
  const providerFormat =
    typeof payload?.providerFormat === "string" ? payload.providerFormat : undefined;
  const model = typeof payload?.model === "string" ? payload.model : undefined;

  const resolved = await resolveSkillExecution({
    messages,
    skillMode,
    env,
    requestUrl: request.url,
    providerFormat,
    model,
  });

  const headers = apiHeaders(request, env, {
    "Content-Type": "application/json; charset=utf-8",
    ...skillResponseHeaders(resolved),
  });

  return new Response(
    JSON.stringify({
      category: resolved.classification.category,
      skillId: resolved.classification.category,
      source: resolved.classification.source,
      confidence: resolved.classification.confidence,
      needsPreview: resolved.needsPreview,
      previewCategory:
        resolved.classification.category === "game"
          ? "game"
          : resolved.classification.category === "website"
            ? "website"
            : "none",
      detectedEngine: resolved.selection.detectedEngine ?? null,
      matchedDesignBrand: resolved.selection.matchedDesignBrand ?? null,
      mode: resolved.selection.mode,
      selectedSkills: resolved.selection.selected.map((s) => s.id),
      totalTokens: resolved.selection.totalTokens,
      maxTokens: resolved.selection.maxTokens,
      systemPrompt: resolved.modeASystemPrompt,
    }),
    { status: 200, headers },
  );
}

export async function onRequest(context: {
  request: Request;
  env: PreviewIntentEnv;
}): Promise<Response> {
  return handlePreviewIntent(context.request, context.env ?? {});
}
