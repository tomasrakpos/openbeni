// Vite build config; change development and production build settings here.
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { defineConfig, type Plugin } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { handleCoarena, type CoarenaProxyEnv } from "./functions/api/coarenaHandler";
import { handleProxy, type ProxyEnv } from "./functions/api/proxy";
import { handleAuth, type AuthRouteEnv } from "./functions/api/_lib/authHandlers";
import { handleSession, handleConfig } from "./functions/api/_lib/sessionHandlers";
import { handleModels } from "./functions/api/_lib/modelsHandler";
import { handleServerChat, type ChatEnv } from "./functions/api/_lib/serverChat";
import { handleAdmin, type AdminEnv } from "./functions/api/_lib/adminHandlers";

/** Reads a Node request body into a Buffer (chat requests are small JSON). */
async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host ?? "127.0.0.1:5173";
  const url = new URL(req.url ?? "/", `http://${host}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  const method = (req.method ?? "GET").toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody ? await readBody(req) : undefined;
  return new Request(url, { method, headers, body });
}

async function sendWebResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status;
  if (response.statusText) res.statusMessage = response.statusText;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  // Never let a browser or intermediary buffer an SSE stream.
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Accel-Buffering", "no");

  if (!response.body || res.destroyed) {
    res.end();
    return;
  }
  try {
    await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), res);
  } catch {
    if (!res.writableEnded) res.end();
  }
}

/** Development CSP: allows Vite's inline bootstrap and the HMR websocket. */
const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* wss:",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "frame-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

function securityHeaders(): Plugin {
  const install = (server: { middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void } }) => {
    server.middlewares.use((_req, res, next) => {
      res.setHeader("Content-Security-Policy", DEV_CSP);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      next();
    });
  };
  return {
    name: "apiset-security-headers",
    configureServer(server) {
      install(server);
    },
    configurePreviewServer(server) {
      install(server);
    },
  };
}

interface ServerEnv extends ProxyEnv, CoarenaProxyEnv, AuthRouteEnv, ChatEnv, AdminEnv {}

/**
 * Serves `/api/proxy` and `/api/coarena/*` during `vite dev` and `vite preview`
 * with the exact same handlers Cloudflare Pages runs in production.
 *
 * Non-`VITE_` variables are read with `loadEnv(mode, cwd, "")`, so
 * `COARENA_KEYS` never leaks into the client bundle.
 */
function apiMiddleware(env: ServerEnv): Plugin {
  const install = (server: { middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void } }) => {
    server.middlewares.use((req, res, next) => {
      const requestPath = (req.url ?? "").split("?")[0] ?? "";
      const isProxy = requestPath === "/api/proxy";
      const isCoarena = requestPath === "/api/coarena" || requestPath.startsWith("/api/coarena/");
      const isAuth = requestPath === "/api/auth" || requestPath.startsWith("/api/auth/");
      const isSession = requestPath === "/api/session";
      const isConfig = requestPath === "/api/config";
      const isModels = requestPath === "/api/models";
      const isChat = requestPath === "/api/chat";
      const isAdmin = requestPath === "/api/admin" || requestPath.startsWith("/api/admin/");
      if (!isProxy && !isCoarena && !isAuth && !isSession && !isConfig && !isModels && !isChat && !isAdmin) {
        next();
        return;
      }
      void (async () => {
        try {
          const request = await toWebRequest(req);
          let response: Response;
          if (isCoarena) response = await handleCoarena(request, env);
          else if (isProxy) response = await handleProxy(request, env);
          else if (isAuth) response = await handleAuth(request, env);
          else if (isSession) response = await handleSession(request, env);
          else if (isConfig) response = await handleConfig(request, env);
          else if (isModels) response = await handleModels(request, env);
          else if (isChat) response = await handleServerChat(request, env);
          else response = await handleAdmin(request, env);
          await sendWebResponse(response, res);
        } catch (error) {
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
          }
          res.end(
            JSON.stringify({
              error: {
                message: error instanceof Error ? error.message : "The local API handler failed.",
              },
            }),
          );
        }
      })();
    });
  };

  return {
    name: "apiset-api",
    configureServer(server) {
      install(server);
    },
    configurePreviewServer(server) {
      install(server);
    },
  };
}

/**
 * Development-only shared store for the admin preview.
 *
 * `/admin` on localhost keeps its data in this file instead of the browser, so
 * a provider added in one browser is visible to every other browser (and to
 * the public site) on the same machine — the same behaviour a real database
 * gives a deployed site.
 *
 * The file holds preview API keys in plain text. It only exists while
 * `vite dev` is running, is never part of a build, and is meant for local
 * testing only.
 */
function devAdminStore(): Plugin {
  const dir = path.resolve(__dirname, ".dev-admin");
  const file = path.join(dir, "state.json");

  const install = (server: { middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void } }) => {
    server.middlewares.use((req, res, next) => {
      const requestPath = (req.url ?? "").split("?")[0] ?? "";
      if (requestPath !== "/api/dev-admin/state") {
        next();
        return;
      }
      void (async () => {
        const method = (req.method ?? "GET").toUpperCase();
        try {
          if (method === "GET") {
            let raw: string | null = null;
            try {
              raw = await readFile(file, "utf8");
            } catch {
              raw = null;
            }
            let state: unknown = null;
            if (raw) {
              try {
                state = JSON.parse(raw);
              } catch {
                state = null;
              }
            }
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.setHeader("Cache-Control", "no-store");
            res.end(JSON.stringify({ state }));
            return;
          }

          if (method === "PUT") {
            const body = await readBody(req);
            const parsed: unknown = JSON.parse(body?.toString("utf8") || "null");
            if (!parsed || typeof parsed !== "object") {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ error: { message: "Expected a JSON object." } }));
              return;
            }
            await mkdir(dir, { recursive: true });
            await writeFile(file, JSON.stringify(parsed), "utf8");
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.setHeader("Cache-Control", "no-store");
            res.end('{"ok":true}');
            return;
          }

          if (method === "DELETE") {
            await rm(file, { force: true });
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.setHeader("Cache-Control", "no-store");
            res.end('{"ok":true}');
            return;
          }

          res.statusCode = 405;
          res.end();
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(
            JSON.stringify({
              error: { message: error instanceof Error ? error.message : "The preview store failed." },
            }),
          );
        }
      })();
    });
  };

  return {
    name: "apiset-dev-admin-store",
    configureServer(server) {
      install(server);
    },
  };
}

export default defineConfig(({ mode }) => {
  // Third argument "" loads every variable, including server-only secrets.
  const env = loadEnv(mode, process.cwd(), "");
  const serverEnv: ServerEnv = {
    ALLOWED_HOSTS: env.ALLOWED_HOSTS,
    ALLOWED_ORIGIN: env.ALLOWED_ORIGIN,
    PROXY_TOKEN: env.PROXY_TOKEN,
    COARENA_KEYS: env.COARENA_KEYS,
    COARENA_BASE_URL: env.COARENA_BASE_URL,
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
    ADMIN_EMAILS: env.ADMIN_EMAILS,
    ADMIN_PASSWORD: env.ADMIN_PASSWORD,
    ADMIN_SESSION_SECRET: env.ADMIN_SESSION_SECRET,
    MASTER_ENCRYPTION_KEY: env.MASTER_ENCRYPTION_KEY,
  };

  return {
    // The admin panel can only write to Postgres when the server holds both the
    // project URL and the service-role key. When it does not, development falls
    // back to the shared preview store instead of failing every write.
    define: {
      __SERVER_DB__: JSON.stringify(
        Boolean((env.SUPABASE_URL ?? "").trim() && (env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim()),
      ),
    },
    plugins: [securityHeaders(), apiMiddleware(serverEnv), devAdminStore(), react(), tailwindcss()],
    server: {
      watch: {
        // The admin preview store is written on every panel action. Watching it
        // would make Vite reload the page, which looked like "Test connection"
        // refreshing the site.
        ignored: ["**/.dev-admin/**"],
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      target: "es2022",
      // Never ship source maps to production.
      sourcemap: false,
      minify: "esbuild",
      chunkSizeWarningLimit: 1600,
      rollupOptions: {
        output: {
          // Stable vendor chunks: a dependency upgrade does not invalidate the
          // app chunk, and the browser can cache these across releases.
          manualChunks: {
            vendor: ["react", "react-dom", "framer-motion"],
            supabase: ["@supabase/supabase-js"],
            markdown: ["react-markdown", "remark-gfm", "remark-math", "rehype-sanitize"],
            katex: ["katex", "rehype-katex"],
            highlight: ["shiki"],
            db: ["dexie"],
            gsap: ["gsap"],
            dompurify: ["dompurify"],
            ui: ["clsx", "tailwind-merge", "class-variance-authority"],
          },
        },
      },
    },
    // Keep console.error/console.warn for real failures; strip only debug logs.
    esbuild: {
      pure: ["console.log", "console.debug"],
      drop: ["debugger"],
    },
    test: {
      environment: "node",
      include: ["tests/**/*.test.ts"],
    },
  };
});
