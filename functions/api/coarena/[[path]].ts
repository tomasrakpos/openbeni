// API route [[path]]; change request/response handling here; shared auth/validation is in _lib.
import { handleCoarena, type CoarenaProxyEnv } from "../coarenaHandler";

/** Cloudflare Pages Function: /api/coarena/* (chat, models, status). */
export async function onRequest(context: { request: Request; env: CoarenaProxyEnv }): Promise<Response> {
  try {
    return await handleCoarena(context.request, context.env ?? {});
  } catch {
    return new Response(
      JSON.stringify({ error: { message: "The Coarena pool failed unexpectedly.", status: 500 } }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }
}
