// API route models; change request/response handling here; shared auth/validation is in _lib.
import { handleModels } from "./_lib/modelsHandler";
import type { AuthEnv } from "./_lib/auth";

/** Cloudflare Pages Function: GET /api/models (sanitized enabled catalog). */
export async function onRequest(context: { request: Request; env: AuthEnv }): Promise<Response> {
  return handleModels(context.request, context.env ?? {});
}
