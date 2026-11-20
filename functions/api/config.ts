// API route config; change request/response handling here; shared auth/validation is in _lib.
import { handleConfig } from "./_lib/sessionHandlers";
import type { AuthEnv } from "./_lib/auth";

/** Cloudflare Pages Function: GET /api/config (accounts + signup state). */
export async function onRequest(context: { request: Request; env: AuthEnv }): Promise<Response> {
  return handleConfig(context.request, context.env ?? {});
}
