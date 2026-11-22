// Cloudflare Pages Function for /api/routers.
import { handleRouters, type RoutersEnv } from "./_lib/routersHandler";

export const onRequest = ({
  request,
  env,
}: {
  request: Request;
  env?: RoutersEnv;
}) => handleRouters(request, env ?? {});
