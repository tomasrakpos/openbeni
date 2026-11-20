// API route [[path]]; change request/response handling here; shared auth/validation is in _lib.
import { handleAdmin, type AdminEnv } from "../_lib/adminHandlers";

/** Cloudflare Pages Function: /api/admin/* (admin only). */
export async function onRequest(context: { request: Request; env: AdminEnv }): Promise<Response> {
  return handleAdmin(context.request, context.env ?? {});
}
