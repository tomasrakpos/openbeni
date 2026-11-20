// API route [[path]]; change request/response handling here; shared auth/validation is in _lib.
import { handleAuth, type AuthRouteEnv } from "../_lib/authHandlers";

export async function onRequest(context: { request: Request; env: AuthRouteEnv }): Promise<Response> {
  return handleAuth(context.request, context.env ?? {});
}
