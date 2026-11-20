// API route session; change request/response handling here; shared auth/validation is in _lib.
import { handleSession } from "./_lib/sessionHandlers";
import type { AuthEnv } from "./_lib/auth";

/** Cloudflare Pages Function: GET /api/session (current profile + role). */
export async function onRequest(context: { request: Request; env: AuthEnv }): Promise<Response> {
  return handleSession(context.request, context.env ?? {});
}
