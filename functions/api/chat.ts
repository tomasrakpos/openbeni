// API route chat; change request/response handling here; shared auth/validation is in _lib.
import { handleServerChat, type ChatEnv } from "./_lib/serverChat";

/** Cloudflare Pages Function: POST /api/chat (server models, streamed). */
export async function onRequest(context: { request: Request; env: ChatEnv }): Promise<Response> {
  return handleServerChat(context.request, context.env ?? {});
}
