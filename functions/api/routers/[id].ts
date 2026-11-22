// Cloudflare Pages Function for /api/routers/:id.
import { handleRouters, type RoutersEnv } from "../_lib/routersHandler";

export const onRequest = ({
  request,
  env,
}: {
  request: Request;
  env?: RoutersEnv;
}) => handleRouters(request, env ?? {});
