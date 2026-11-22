// API route: POST /api/preview-intent — unified backend skill router & preview-intent
// classifier. Evaluates which of the 4 backend skills (`chat`, `web_builder`,
// `game_builder`, `deep_research`) should handle the conversation, runs live web
// / image search when applicable, and returns the composed skill prompt + headers.
import { resolveSkillExecution, skillResponseHeaders } from "./_lib/skills/router";
import {
  normalizeSkillMode,
  type SkillEnv,
  type SkillMessage,
} from "./_lib/skills/types";
import {
  apiHeaders,
  clientIp,
  jsonError,
  rateLimit,
  readJsonBody,
  rejectedOrigin,
  type SecurityEnv,
} from "./security";

export type PreviewIntentEnv = SecurityEnv & SkillEnv;

function parseMessages(raw: unknown): SkillMessage[] | null {
  if (!Array.isArray(raw)) return null;
  const out: SkillMessage[] = [];
  for (const entry of raw.slice(-24)) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as { role?: unknown; content?: unknown; hasImages?: unknown };
    const role = typeof obj.role === "string" ? obj.role : "";
    const content = typeof obj.content === "string" ? obj.content : "";
    const hasImages = obj.hasImages === true;
    if ((role === "user" || role === "assistant" || role === "system") && (content.trim() || hasImages)) {
      out.push({
        role,
        content: content.slice(0, 8000),
        ...(hasImages ? { hasImages: true } : {}),
      });
    }
  }
  return out;
}

export async function handlePreviewIntent(request: Request, env: PreviewIntentEnv): Promise<Response> {
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

  const limit = rateLimit("preview-intent", clientIp(request), 90, 60_000);
  if (!limit.ok) {
    return jsonError(request, env, 429, "Too many requests.", "rate_limited");
  }

  const body = await readJsonBody(request);
  if (!body.ok) {
    return jsonError(
      request,
      env,
      body.reason === "too-large" ? 413 : 400,
      body.reason === "too-large" ? "Request body too large." : "Invalid JSON body.",
    );
  }

  const payload = body.value as {
    messages?: unknown;
    skillMode?: unknown;
    enableLiveSearch?: unknown;
  } | null;
  const messages = parseMessages(payload?.messages);
  if (!messages) {
    return jsonError(request, env, 400, "messages must be an array.");
  }

  const skillMode = normalizeSkillMode(payload?.skillMode);
  const enableLiveSearch = payload?.enableLiveSearch !== false;

  const ctx = await resolveSkillExecution({
    messages,
    skillMode,
    env,
    enableLiveSearch,
  });

  const responseBody = {
    needsPreview: ctx.needsPreview,
    confidence: ctx.confidence,
    category: ctx.previewCategory,
    source: ctx.source,
    reason: ctx.reason,
    skillId: ctx.skillId,
    skillSource: ctx.source,
    webSources: ctx.webSources,
    imageAssets: ctx.imageAssets,
    systemPrompt: ctx.systemPrompt,
    // Kept for backwards compatibility with earlier callers
    builderSystemPrompt: ctx.systemPrompt,
  };

  return new Response(JSON.stringify(responseBody), {
    status: 200,
    headers: apiHeaders(request, env, {
      "Content-Type": "application/json; charset=utf-8",
      ...skillResponseHeaders(ctx),
    }),
  });
}

export const onRequest = async (context: { request: Request; env?: PreviewIntentEnv }) =>
  handlePreviewIntent(context.request, context.env ?? {});
