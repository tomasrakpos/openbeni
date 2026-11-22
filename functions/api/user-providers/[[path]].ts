// API route user-providers; user-added (BYOK) providers and models (/api/user-providers/*).
import { handleUserProviders, type UserProviderEnv } from "../_lib/userProviders";

export async function onRequest(context: { request: Request; env: UserProviderEnv }): Promise<Response> {
  return handleUserProviders(context.request, context.env ?? {});
}
