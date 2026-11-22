// Vite build config; change development and production build settings here.
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
import { handleTokens } from "./functions/api/_lib/tokenHandlers";
import { handleUserProviders, type UserProviderEnv } from "./functions/api/_lib/userProviders";
import { handleRouters, type RoutersEnv } from "./functions/api/_lib/routersHandler";
import { handlePreviewIntent, type PreviewIntentEnv } from "./functions/api/preview-intent";
import { handleProviderInspect, type ProviderInspectEnv } from "./functions/api/provider-inspect";

/** Reads a Node request body into a Buffer (chat requests are small JSON). */
async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

function detectProto(req: IncomingMessage, host: string): "http" | "https" {
  const forwardedProto = (req.headers["x-forwarded-proto"] ?? "").toString().split(",")[0]?.trim().toLowerCase();
  if (forwardedProto === "https" || forwardedProto === "http") return forwardedProto;
  const forwarded = (req.headers.forwarded ?? "").toString();
  const protoMatch = /\bproto=(https?)\b/i.exec(forwarded);
  if (protoMatch?.[1]) return protoMatch[1].toLowerCase() === "https" ? "https" : "http";
  const cfVisitor = (req.headers["cf-visitor"] ?? "").toString();
  if (cfVisitor.includes('"https"')) return "https";
  // Behind TLS-terminating reverse proxies (e.g. e2b.app) that omit
  // X-Forwarded-Proto, infer https when the browser's Origin matches our exact Host.
  const origin = (req.headers.origin ?? "").toString().trim();
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (parsed.protocol === "https:" && parsed.host.toLowerCase() === host.toLowerCase()) {
        return "https";
      }
    } catch {
      // Ignore malformed origin header.
    }
  }
  return "http";
}

async function toWebRequest(req: IncomingMessage, signal?: AbortSignal): Promise<Request> {
  const forwardedHost = (req.headers["x-forwarded-host"] ?? "").toString().split(",")[0]?.trim();
  const host = forwardedHost || req.headers.host || "127.0.0.1:5173";
  const proto = detectProto(req, host);
  const url = new URL(req.url ?? "/", `${proto}://${host}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  const method = (req.method ?? "GET").toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody ? await readBody(req) : undefined;
  return new Request(url, { method, headers, body, ...(signal ? { signal } : {}) });
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

  // Disable Nagle's algorithm and flush headers immediately so the browser
  // receives SSE tokens with minimal latency instead of waiting on Node buffers.
  res.socket?.setNoDelay(true);
  res.flushHeaders();

  if (!response.body || res.destroyed) {
    res.end();
    return;
  }

  const reader = response.body.getReader();
  const onClose = () => {
    void reader.cancel().catch(() => undefined);
  };
  res.once("close", onClose);

  try {
    for (;;) {
      if (res.destroyed || res.writableEnded) {
        await reader.cancel().catch(() => undefined);
        break;
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      if (!res.write(value)) {
        await new Promise<void>((resolve) => {
          res.once("drain", resolve);
          res.once("close", resolve);
        });
      }
    }
  } catch {
    // Client aborted or upstream stream closed early.
  } finally {
    res.off("close", onClose);
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
].join("; ");

function securityHeaders(): Plugin {
  const install = (server: { middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void } }) => {
    server.middlewares.use((_req, res, next) => {
      res.setHeader("Content-Security-Policy", DEV_CSP);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
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

interface ServerEnv extends ProxyEnv, CoarenaProxyEnv, AuthRouteEnv, ChatEnv, AdminEnv, UserProviderEnv, RoutersEnv, PreviewIntentEnv {}

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
      const isPreviewIntent = requestPath === "/api/preview-intent";
      const isProviderInspect = requestPath === "/api/provider-inspect";
      const isTokens = requestPath === "/api/tokens" || requestPath.startsWith("/api/tokens/");
      const isUserProviders = requestPath === "/api/user-providers" || requestPath.startsWith("/api/user-providers/");
      const isRouters = requestPath === "/api/routers" || requestPath.startsWith("/api/routers/");
      const isAdmin = requestPath === "/api/admin" || requestPath.startsWith("/api/admin/");
      if (!isProxy && !isCoarena && !isAuth && !isSession && !isConfig && !isModels && !isChat && !isPreviewIntent && !isProviderInspect && !isTokens && !isUserProviders && !isRouters && !isAdmin) {
        next();
        return;
      }
      void (async () => {
        const abort = new AbortController();
        const onDisconnect = () => {
          if (!res.writableEnded) abort.abort();
        };
        res.once("close", onDisconnect);
        try {
          const request = await toWebRequest(req, abort.signal);
          let response: Response;
          if (isCoarena) response = await handleCoarena(request, env);
          else if (isProxy) response = await handleProxy(request, env);
          else if (isAuth) response = await handleAuth(request, env);
          else if (isSession) response = await handleSession(request, env);
          else if (isConfig) response = await handleConfig(request, env);
          else if (isModels) response = await handleModels(request, env);
          else if (isChat) response = await handleServerChat(request, env);
          else if (isPreviewIntent) response = await handlePreviewIntent(request, env);
          else if (isProviderInspect) response = await handleProviderInspect(request, env);
          else if (isTokens) response = await handleTokens(request, env);
          else if (isUserProviders) response = await handleUserProviders(request, env);
          else if (isRouters) response = await handleRouters(request, env);
          else response = await handleAdmin(request, env);
          await sendWebResponse(response, res);
        } catch (error) {
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
          }
          if (!res.writableEnded) {
            res.end(
              JSON.stringify({
                error: {
                  message: error instanceof Error ? error.message : "The local API handler failed.",
                },
              }),
            );
          }
        } finally {
          res.off("close", onDisconnect);
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
      host: "0.0.0.0",
      allowedHosts: true,
      warmup: {
        // Pre-transform primary routes and lazy dialogs right when dev starts
        // so first click on Providers, Settings, Wizard, or /admin never stalls.
        clientFiles: [
          "./src/main.tsx",
          "./src/App.tsx",
          "./src/features/providers/ProvidersPage.tsx",
          "./src/features/providers/ProviderWizard.tsx",
          "./src/features/settings/SettingsDialog.tsx",
          "./src/features/models/ModelPicker.tsx",
          "./src/features/layout/SearchDialog.tsx",
          "./src/features/layout/CommandPalette.tsx",
          "./src/features/admin/AdminApp.tsx",
          "./src/features/admin/AdminPage.tsx",
        ],
      },
      watch: {
        // The admin preview store is written on every panel action. Watching it
        // would make Vite reload the page, which looked like "Test connection"
        // refreshing the site.
        ignored: ["**/.dev-admin/**"],
      },
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "zustand",
        "dexie",
        "lucide-react",
        "framer-motion",
        "sonner",
        "gsap",
        "recharts",
        "react-is",
        "cmdk",
        "@radix-ui/react-dialog",
        "@radix-ui/react-tabs",
        "@radix-ui/react-select",
        "@radix-ui/react-switch",
        "@radix-ui/react-tooltip",
      ],
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
          // Keep stable core vendor chunks only; let Rollup co-locate lazy
          // dependencies (shiki, markdown/katex, supabase, dompurify, recharts)
          // with their dynamic imports so they never enter initial modulepreloads.
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (
              id.includes("/react/") ||
              id.includes("/react-dom/") ||
              id.includes("/scheduler/") ||
              id.includes("/framer-motion/")
            ) {
              return "vendor";
            }
            if (id.includes("/dexie/")) return "db";
            if (id.includes("/gsap/")) return "gsap";
            if (
              id.includes("/clsx/") ||
              id.includes("/tailwind-merge/") ||
              id.includes("/class-variance-authority/")
            ) {
              return "ui";
            }
            return undefined;
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
