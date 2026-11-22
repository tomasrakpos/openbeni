// Regression tests for the full-stack root-cause audit fixes (chat, streaming,
// key rotation, auth idempotency, admin↔public consistency, and URL/header hygiene).
import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "../functions/api/_lib/crypto";
import { createAdminToken } from "../functions/api/_lib/adminAuth";
import { handleAdmin } from "../functions/api/_lib/adminHandlers";
import { resolveAuth } from "../functions/api/_lib/auth";
import { handleModels } from "../functions/api/_lib/modelsHandler";
import { callWithRotation, type ProviderKeyRow, type ProviderRow } from "../functions/api/_lib/providerKeys";
import { handleServerChat } from "../functions/api/_lib/serverChat";
import {
  authHeadersFor,
  buildUpstreamRequest,
  formatAuthHeaderValue,
  normalizeStream,
  scrubSecretText,
} from "../functions/api/_lib/upstream";
import { safeFetch } from "../functions/api/_lib/urlGuard";
import { streamChat } from "../src/lib/chatClient";
import { authHeaders } from "../src/lib/http";
import { normalizeBaseUrl } from "../src/lib/normalize";
import { parseStreamEvent } from "../src/lib/sse";
import type { ChatParams, Provider } from "../src/lib/types";

const MASTER = "audit-test-master-key-0123456789abcdef";
const ENV = {
  ADMIN_PASSWORD: "correct-horse-battery",
  ADMIN_SESSION_SECRET: "audit-session-secret",
  MASTER_ENCRYPTION_KEY: MASTER,
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
};

const PROVIDER: ProviderRow = {
  id: "prov-audit-1",
  name: "Audit Provider",
  base_url: "https://api.example.com/v1",
  api_format: "openai",
  auth_header: "Authorization",
  auth_prefix: "Bearer",
  extra_headers: {},
  icon: null,
  color: null,
  notes: null,
  enabled: true,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

function makeStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

async function readStreamText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("auth header formatting & secret hygiene", () => {
  it("inserts missing space after word-style prefixes like 'Bearer' on backend and frontend", () => {
    expect(formatAuthHeaderValue("Bearer", "sk-test123")).toBe("Bearer sk-test123");
    expect(formatAuthHeaderValue("Bearer ", "sk-test123")).toBe("Bearer sk-test123");
    expect(formatAuthHeaderValue("", "sk-test123")).toBe("sk-test123");
    expect(authHeadersFor(PROVIDER, "sk-test123").Authorization).toBe("Bearer sk-test123");

    const clientProvider = {
      id: "p1",
      name: "P",
      baseUrl: "https://api.example.com/v1",
      apiFormat: "openai",
      auth: { header: "Authorization", prefix: "Bearer" },
      extraHeaders: {},
      timeoutMs: 30_000,
      useProxy: false,
      enabled: true,
      favorite: false,
      order: 1,
      paths: {},
      createdAt: 0,
      updatedAt: 0,
    } satisfies Provider;
    expect(authHeaders(clientProvider, "sk-test123").Authorization).toBe("Bearer sk-test123");
  });

  it("scrubs leaked secret tokens from upstream error text", () => {
    const scrubbed = scrubSecretText("Invalid API key sk-proj-abc1234567890xyz in header Bearer eyJhbGciOiJIUzI1NiJ9");
    expect(scrubbed).not.toContain("sk-proj-abc1234567890xyz");
    expect(scrubbed).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(scrubbed).toContain("[redacted]");
  });
});

describe("normalizeStream fixes (custom format, Anthropic usage/errors, UTF-8 boundaries)", () => {
  it("emits tokens for 'custom' format instead of silently dropping the entire stream", async () => {
    const enc = new TextEncoder();
    const raw = makeStream([
      enc.encode('data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n'),
      enc.encode('data: {"text":"world"}\n\n'),
      enc.encode("data: [DONE]\n\n"),
    ]);
    let doneChars = 0;
    const out = await readStreamText(
      raw.pipeThrough(
        normalizeStream("custom", raw, (stats) => {
          doneChars = stats.textChars;
        }),
      ),
    );
    expect(out).toContain("Hello ");
    expect(out).toContain("world");
    expect(out).toContain("data: [DONE]");
    expect(doneChars).toBe(11);
  });

  it("captures Anthropic message_start input_tokens, handles split Persian UTF-8 bytes, and forwards mid-stream errors", async () => {
    const enc = new TextEncoder();
    const persianEvent = enc.encode(
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"سلام دنیا"}}\n\n',
    );
    // Split directly in the middle of a multi-byte UTF-8 Persian character
    const splitAt = persianEvent.indexOf(0xd8) + 1;
    const raw = makeStream([
      enc.encode('data: {"type":"message_start","message":{"usage":{"input_tokens":42}}}\n\n'),
      persianEvent.slice(0, splitAt),
      persianEvent.slice(splitAt),
      enc.encode('data: {"type":"error","error":{"message":"overloaded with key sk-ant-secret123456789"}}\n\n'),
    ]);

    let capturedPrompt: number | undefined;
    let capturedErr: string | undefined;
    const out = await readStreamText(
      raw.pipeThrough(
        normalizeStream("anthropic", raw, (stats) => {
          capturedPrompt = stats.promptTokens;
          capturedErr = stats.streamError;
        }),
      ),
    );

    expect(out).toContain("سلام دنیا");
    expect(capturedPrompt).toBe(42);
    expect(capturedErr).toContain("overloaded");
    expect(capturedErr).not.toContain("sk-ant-secret123456789");
    expect(out).toContain('"error"');
    expect(out).not.toContain("sk-ant-secret123456789");
  });
});

describe("callWithRotation fixes (stream_options fallback, timeout vs network, key scrubbing)", () => {
  it("retries once without stream_options on HTTP 400 without cooling down the key", async () => {
    const ciphertext = await encryptSecret(MASTER, "sk-live-secret123456");
    const keys: ProviderKeyRow[] = [
      {
        id: "k1",
        provider_id: PROVIDER.id,
        ciphertext,
        label: "primary",
        enabled: true,
        cooldown_until: null,
        fail_count: 0,
        last_error: null,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ];

    const seenBodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/rest/v1/")) return new Response("", { status: 204 });
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        seenBodies.push(body);
        if ("stream_options" in body) {
          return new Response(JSON.stringify({ error: { message: "Unknown field: stream_options" } }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("data: [DONE]\n\n", {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }),
    );

    const outcome = await callWithRotation(ENV, PROVIDER, keys, (apiKey) =>
      Promise.resolve(
        buildUpstreamRequest(
          PROVIDER,
          apiKey,
          { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }], stream: true },
          true,
        ),
      ),
    );

    expect(outcome.response?.status).toBe(200);
    expect(seenBodies.length).toBe(2);
    expect("stream_options" in seenBodies[0]!).toBe(true);
    expect("stream_options" in seenBodies[1]!).toBe(false);
  });

  it("scrubs the active key from non-retryable upstream errors", async () => {
    const secret = "sk-my-very-secret-key-987654";
    const ciphertext = await encryptSecret(MASTER, secret);
    const keys: ProviderKeyRow[] = [
      {
        id: "k1",
        provider_id: PROVIDER.id,
        ciphertext,
        label: "k1",
        enabled: true,
        cooldown_until: null,
        fail_count: 0,
        last_error: null,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("/rest/v1/")) return new Response("", { status: 204 });
        return new Response(JSON.stringify({ error: { message: `Bad model for ${secret}` } }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const outcome = await callWithRotation(ENV, PROVIDER, keys, () =>
      Promise.resolve({ url: "https://api.example.com/v1/chat/completions", init: { method: "POST" } }),
    );
    expect(outcome.failure?.status).toBe(400);
    expect(outcome.failure?.message).not.toContain(secret);
    expect(outcome.failure?.message).toContain("[redacted]");
  });
});

describe("safeFetch caller abort preservation", () => {
  it("aborts immediately when caller AbortSignal is already aborted", async () => {
    const caller = new AbortController();
    caller.abort();
    await expect(
      safeFetch(new URL("https://api.example.com/v1/models"), { signal: caller.signal }, { timeoutMs: 5000 }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("resolveAuth credit idempotency (5 credits granted at most once)", () => {
  it("uses resolution=ignore-duplicates and re-reads existing profile on conflict without resetting credits", async () => {
    let profileReads = 0;
    let insertPrefer = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (url.includes("/auth/v1/user")) {
          return new Response(
            JSON.stringify({ id: "u-1", email: "user@example.com", user_metadata: { full_name: "Ali" } }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.includes("/rest/v1/profiles") && method === "GET") {
          profileReads += 1;
          // First read sees empty (simulating race), second read sees existing row with 2 remaining credits
          const rows =
            profileReads === 1
              ? []
              : [
                  {
                    id: "u-1",
                    email: "user@example.com",
                    display_name: "Ali",
                    role: "user",
                    status: "active",
                    credits: 2,
                    daily_token_limit: null,
                    monthly_token_limit: null,
                    created_at: "2026-01-01T00:00:00.000Z",
                    last_seen_at: new Date().toISOString(),
                  },
                ];
          return new Response(JSON.stringify(rows), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (url.includes("/rest/v1/app_settings")) {
          return new Response(JSON.stringify([{ id: true, signup_open: true, default_signup_credits: 5 }]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/rest/v1/profiles") && method === "POST") {
          insertPrefer = new Headers(init?.headers).get("prefer") ?? "";
          // PostgREST returns [] when ON CONFLICT DO NOTHING skips an existing row
          return new Response(JSON.stringify([]), { status: 201, headers: { "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
      }),
    );

    const auth = await resolveAuth(
      new Request("https://app.example.com/api/session", {
        headers: { Authorization: "Bearer valid-jwt" },
      }),
      ENV,
    );

    expect(insertPrefer).toContain("resolution=ignore-duplicates");
    expect(insertPrefer).not.toContain("merge-duplicates");
    expect(auth?.profile.credits).toBe(2);
  });
});

describe("admin↔public consistency & serverChat diagnostics", () => {
  it("returns no-store Cache-Control on /api/models", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } })),
    );
    const res = await handleModels(new Request("https://app.example.com/api/models"), ENV);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("preserves admin custom display_name on provider re-test and awaits Realtime broadcast", async () => {
    const ciphertext = await encryptSecret(MASTER, "sk-valid-key-123456");
    let upsertedRows: Array<{ upstream_id: string; display_name: string }> = [];
    let broadcastCompleted = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (url.includes("/realtime/v1/api/broadcast")) {
          broadcastCompleted = true;
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        if (url.includes("/rest/v1/providers")) {
          return new Response(JSON.stringify([PROVIDER]), { status: 200 });
        }
        if (url.includes("/rest/v1/provider_keys")) {
          return new Response(
            JSON.stringify([
              {
                id: "k1",
                provider_id: PROVIDER.id,
                ciphertext,
                label: "k1",
                enabled: true,
                cooldown_until: null,
                fail_count: 0,
                last_error: null,
                created_at: "2026-01-01T00:00:00.000Z",
              },
            ]),
            { status: 200 },
          );
        }
        if (url.includes("/rest/v1/catalog_models") && method === "GET") {
          return new Response(
            JSON.stringify([
              {
                id: "cm-1",
                provider_id: PROVIDER.id,
                upstream_id: "gpt-4o-mini",
                display_name: "My Custom Admin Name",
                enabled: true,
                site_paid: false,
                upstream_verified: true,
              },
            ]),
            { status: 200 },
          );
        }
        if (url.includes("/rest/v1/catalog_models") && method === "POST") {
          upsertedRows = JSON.parse(String(init?.body ?? "[]")) as Array<{
            upstream_id: string;
            display_name: string;
          }>;
          return new Response("", { status: 201 });
        }
        if (url.includes("/rest/v1/routers")) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (url.includes("api.example.com/v1/models")) {
          return new Response(JSON.stringify({ data: [{ id: "gpt-4o-mini" }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("api.example.com/v1/chat/completions")) {
          return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify([]), { status: 200 });
      }),
    );

    const { token } = await createAdminToken(ENV);
    const res = await handleAdmin(
      new Request(`https://app.example.com/api/admin/providers/${PROVIDER.id}/test`, {
        method: "POST",
        headers: { "x-admin-key": token },
      }),
      ENV,
    );

    expect(res.status).toBe(200);
    expect(broadcastCompleted).toBe(true);
    expect(upsertedRows[0]?.display_name).toBe("My Custom Admin Name");
  });

  it("returns 503 model_unverified instead of opaque 404 when an enabled model has upstream_verified=false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/auth/v1/user")) {
          return new Response(JSON.stringify({ id: "u-2", email: "u2@example.com" }), { status: 200 });
        }
        if (url.includes("/rest/v1/profiles")) {
          return new Response(
            JSON.stringify([
              {
                id: "u-2",
                email: "u2@example.com",
                display_name: "U2",
                role: "user",
                status: "active",
                credits: 5,
                daily_token_limit: null,
                monthly_token_limit: null,
                created_at: "2026-01-01T00:00:00.000Z",
                last_seen_at: new Date().toISOString(),
              },
            ]),
            { status: 200 },
          );
        }
        if (url.includes("/rest/v1/app_settings")) {
          return new Response(JSON.stringify([{ id: true, signup_open: true }]), { status: 200 });
        }
        if (url.includes("/rest/v1/catalog_models") && url.includes("upstream_verified=eq.true")) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (url.includes("/rest/v1/catalog_models") && url.includes("select=id,enabled,upstream_verified")) {
          return new Response(
            JSON.stringify([{ id: "model-unverified-1", enabled: true, upstream_verified: false }]),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify([]), { status: 200 });
      }),
    );

    const res = await handleServerChat(
      new Request("https://app.example.com/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer valid-token",
          "cf-connecting-ip": "10.9.9.9",
        },
        body: JSON.stringify({
          model: "model-unverified-1",
          messages: [{ role: "user", content: "hello" }],
          stream: false,
        }),
      }),
      ENV,
    );

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("model_unverified");
  });
});

describe("frontend URL normalization, custom provider fallback, and SSE mid-stream errors", () => {
  it("applies known API path prefixes on client normalizeBaseUrl", () => {
    expect(normalizeBaseUrl("https://openrouter.ai", "openai").baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(normalizeBaseUrl("https://api.groq.com", "openai").baseUrl).toBe("https://api.groq.com/openai/v1");
    expect(normalizeBaseUrl("https://coarena.ai", "openai").baseUrl).toBe("https://coarena.ai/api/v1");
  });

  it("retries direct client streamChat without stream_options when upstream returns HTTP 400", async () => {
    const seenBodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const parsed = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        seenBodies.push(parsed);
        if ("stream_options" in parsed) {
          return new Response(JSON.stringify({ error: { message: "unrecognized field: stream_options" } }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "Recovered reply" } }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const openaiProvider: Provider = {
      id: "p-openai",
      name: "OpenAI Compat",
      baseUrl: "https://compat.example.com/v1",
      apiFormat: "openai",
      auth: { header: "Authorization", prefix: "Bearer" },
      extraHeaders: {},
      timeoutMs: 30_000,
      useProxy: false,
      enabled: true,
      favorite: false,
      order: 1,
      paths: {},
      createdAt: 0,
      updatedAt: 0,
    };
    const params: ChatParams = { temperature: 0.7, topP: 1, maxTokens: 512 };
    const controller = new AbortController();
    const res = await streamChat({
      provider: openaiProvider,
      apiKey: "sk-test123",
      modelId: "my-model",
      messages: [{ role: "user", content: "hi" }],
      params,
      signal: controller.signal,
      onDelta: () => undefined,
    });
    expect(res.text).toBe("Recovered reply");
    expect(seenBodies.length).toBe(2);
    expect("stream_options" in seenBodies[0]!).toBe(true);
    expect("stream_options" in seenBodies[1]!).toBe(false);
  });

  it("parses mid-stream SSE error payloads for OpenAI and Anthropic", () => {
    const openaiErr = parseStreamEvent("openai", {
      data: JSON.stringify({ error: { message: "Rate limit hit mid-stream" } }),
    });
    expect(openaiErr?.error).toBe("Rate limit hit mid-stream");

    const anthropicErr = parseStreamEvent("anthropic", {
      event: "error",
      data: JSON.stringify({ type: "error", error: { message: "overloaded_error" } }),
    });
    expect(anthropicErr?.error).toBe("overloaded_error");
  });
});
