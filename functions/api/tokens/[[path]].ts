// API route tokens; personal user API tokens (GET/POST /api/tokens, DELETE /api/tokens/:id).
import { handleTokens } from "../_lib/tokenHandlers";
import type { AuthEnv } from "../_lib/auth";

export async function onRequest(context: { request: Request; env: AuthEnv }): Promise<Response> {
  return handleTokens(context.request, context.env ?? {});
}
