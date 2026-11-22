// Tests for serverChat.test; add or update cases here to match observable behavior.
import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "../functions/api/_lib/crypto";
import {
  handleServerChat,
  shouldChargeCredits,
  validateChatRequest,
  type ChatEnv,
} from "../functions/api/_lib/serverChat";

const MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const ENV: ChatEnv = {
  SUPABASE_URL: "https://db.example.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  MASTER_ENCRYPTION_KEY: MASTER_KEY,
};

let ipCounter = 10;
function chatRequest(body: unknown, token = "jwt-user-1"): Request {
  ipCounter += 1;
  return new Request("https://app.example.com/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "cf-connecting-ip": `198.51.100.${ipCounter % 250}`,
    },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("billing policy", () => {
  it("charges credits ONLY for site default models and NEVER for user BYOK providers", () => {
    expect(shouldChargeCredits("site")).toBe(true);
    expect(shouldChargeCredits("byok")).toBe(false);
  });
});

describe("server chat validation", () => {
  it("accepts a minimal valid request", () => {
    const result = validateChatRequest({
      model: "model-1",
      messages: [{ role: "user", content: "hello" }],
      stream: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.stream).toBe(true);
      expect(result.body.model).toBe("model-1");
      expect(result.promptEstimate).toBeGreaterThan(0);
    }
  });

  it("rejects an empty or missing message list", () => {
    expect(validateChatRequest({ model: "m", messages: [] }).ok).toBe(false);
    expect(validateChatRequest({ model: "m" }).ok).toBe(false);
    expect(validateChatRequest(null).ok).toBe(false);
  });

  it("rejects unknown roles and non-text content", () => {
    expect(validateChatRequest({ model: "m", messages: [{ role: "tool", content: "x" }] }).ok).toBe(false);
    expect(validateChatRequest({ model: "m", messages: [{ role: "user", content: [{ type: "image" }] }] }).ok).toBe(false);
  });

  it("drops unknown fields (including spoofed billing flags) and clamps max_tokens", () => {
    const result = validateChatRequest({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 10_000_000,
      temperature: 99,
      top_p: -4,
      system: "leak",
      skipCredits: true,
      billingSource: "byok",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body.max_tokens).toBe(32_768);
      expect(result.body.temperature).toBe(2);
      expect(result.body.top_p).toBe(0);
      expect("system" in result.body).toBe(false);
      expect("skipCredits" in result.body).toBe(false);
      expect("billingSource" in result.body).toBe(false);
    }
  });

  it("rejects oversized conversations", () => {
    const messages = Array.from({ length: 130 }, () => ({ role: "user", content: "hello" }));
    expect(validateChatRequest({ model: "m", messages }).ok).toBe(false);

    const tooLong = [{ role: "user", content: "x".repeat(33_000) }];
    expect(validateChatRequest({ model: "m", messages: tooLong }).ok).toBe(false);
  });

  it("validates inline customProvider and blocks private/non-https SSRF URLs", () => {
    const ok = validateChatRequest({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
      customProvider: {
        baseUrl: "https://api.openai.com",
        apiFormat: "openai",
        apiKey: "sk-user-key",
      },
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.customProvider?.baseUrl).toBe("https://api.openai.com/v1");
      expect(ok.customProvider?.authHeader).toBe("Authorization");
      expect(ok.customProvider?.authPrefix).toBe("Bearer ");
    }

    const loopback = validateChatRequest({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
      customProvider: { baseUrl: "https://127.0.0.1/v1", apiFormat: "openai" },
    });
    expect(loopback.ok).toBe(false);

    const plainHttp = validateChatRequest({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
      customProvider: { baseUrl: "http://api.openai.com/v1", apiFormat: "openai" },
    });
    expect(plainHttp.ok).toBe(false);
  });
});

describe("credit deduction: site default models vs user-added providers", () => {
  interface MockOptions {
    credits: number;
    status?: "active" | "blocked";
    dailyUsed?: number;
    dailyLimit?: number | null;
    siteCiphertext?: string;
    userCiphertext?: string;
    userProviderEnabled?: boolean;
    streamUpstream?: boolean;
  }

  function installFetchMock(opts: MockOptions) {
    const creditCalls: { user: string; amount: number }[] = [];
    const usageRecords: Record<string, unknown>[] = [];
    const upstreamCalls: { url: string; auth: string | null }[] = [];
    let siteKeyLookupCount = 0;

    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      // Supabase Auth verification
      if (url.endsWith("/auth/v1/user")) {
        return new Response(
          JSON.stringify({ id: "user-1", email: "user@example.com", user_metadata: { display_name: "Alice" } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      // Supabase REST endpoints
      if (url.startsWith(`${ENV.SUPABASE_URL}/rest/v1/`)) {
        const restPath = url.slice(`${ENV.SUPABASE_URL}/rest/v1/`.length);

        if (restPath.startsWith("profiles?")) {
          return new Response(
            JSON.stringify([
              {
                id: "user-1",
                email: "user@example.com",
                display_name: "Alice",
                role: "user",
                status: opts.status ?? "active",
                credits: opts.credits,
                daily_token_limit: opts.dailyLimit ?? null,
                monthly_token_limit: null,
                created_at: "2026-01-01T00:00:00.000Z",
                last_seen_at: new Date().toISOString(),
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (restPath.startsWith("app_settings?")) {
          return new Response(
            JSON.stringify([
              {
                id: true,
                signup_open: true,
                default_signup_credits: 5,
                default_daily_token_limit: null,
                default_monthly_token_limit: null,
                updated_at: "2026-01-01T00:00:00.000Z",
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (restPath.startsWith("rpc/user_usage_totals")) {
          return new Response(
            JSON.stringify([{ input_tokens: opts.dailyUsed ?? 0, output_tokens: 0 }]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (restPath.startsWith("rpc/consume_user_credit")) {
          const parsed = JSON.parse(String(init?.body ?? "{}")) as { p_user: string; p_amount: number };
          creditCalls.push({ user: parsed.p_user, amount: parsed.p_amount });
          return new Response(JSON.stringify(Math.max(0, opts.credits - parsed.p_amount)), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (restPath.startsWith("usage_events")) {
          const rows = JSON.parse(String(init?.body ?? "[]")) as Record<string, unknown>[];
          usageRecords.push(...rows);
          return new Response("", { status: 201 });
        }

        if (restPath.startsWith("catalog_models?")) {
          if (restPath.includes("id=eq.site-model-1")) {
            return new Response(
              JSON.stringify([
                {
                  id: "site-model-1",
                  display_name: "Site GPT",
                  upstream_id: "gpt-4o-mini",
                  capabilities: ["text"],
                  site_paid: false,
                  providers: {
                    id: "site-prov-1",
                    name: "Site OpenAI",
                    base_url: "https://site-upstream.example.com/v1",
                    api_format: "openai",
                    auth_header: "Authorization",
                    auth_prefix: "Bearer ",
                    extra_headers: {},
                    icon: null,
                    color: null,
                    notes: null,
                    enabled: true,
                    created_at: "2026-01-01T00:00:00.000Z",
                    updated_at: "2026-01-01T00:00:00.000Z",
                  },
                },
              ]),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (restPath.startsWith("provider_keys?")) {
          siteKeyLookupCount += 1;
          return new Response(
            JSON.stringify([
              {
                id: "site-key-1",
                provider_id: "site-prov-1",
                ciphertext: opts.siteCiphertext ?? "",
                label: "Primary",
                enabled: true,
                cooldown_until: null,
                fail_count: 0,
                last_error: null,
                created_at: "2026-01-01T00:00:00.000Z",
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (restPath.startsWith("user_providers?")) {
          const isOwned = restPath.includes("id=eq.user-prov-1") && restPath.includes("user_id=eq.user-1");
          if (!isOwned) {
            return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
          }
          return new Response(
            JSON.stringify([
              {
                id: "user-prov-1",
                user_id: "user-1",
                name: "My OpenRouter",
                base_url: "https://user-upstream.example.com/v1",
                api_format: "openai",
                auth_header: "Authorization",
                auth_prefix: "Bearer ",
                extra_headers: {},
                api_key_ciphertext: opts.userCiphertext ?? null,
                key_hint: "sk-u…1234",
                icon: null,
                color: null,
                notes: null,
                enabled: opts.userProviderEnabled ?? true,
                created_at: "2026-01-01T00:00:00.000Z",
                updated_at: "2026-01-01T00:00:00.000Z",
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (restPath.startsWith("user_models?")) {
          const isUserModel =
            restPath.includes("user_id=eq.user-1") &&
            (restPath.includes("id=eq.user-model-1") || restPath.includes("upstream_id=eq.my-custom-llm"));
          if (!isUserModel || opts.userProviderEnabled === false) {
            return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
          }
          return new Response(
            JSON.stringify([
              {
                id: "user-model-1",
                user_id: "user-1",
                user_provider_id: "user-prov-1",
                upstream_id: "my-custom-llm",
                display_name: "My Custom LLM",
                context_window: 128000,
                capabilities: ["text"],
                enabled: true,
                created_at: "2026-01-01T00:00:00.000Z",
                updated_at: "2026-01-01T00:00:00.000Z",
                user_providers: {
                  id: "user-prov-1",
                  user_id: "user-1",
                  name: "My OpenRouter",
                  base_url: "https://user-upstream.example.com/v1",
                  api_format: "openai",
                  auth_header: "Authorization",
                  auth_prefix: "Bearer ",
                  extra_headers: {},
                  api_key_ciphertext: opts.userCiphertext ?? null,
                  key_hint: "sk-u…1234",
                  icon: null,
                  color: null,
                  notes: null,
                  enabled: true,
                  created_at: "2026-01-01T00:00:00.000Z",
                  updated_at: "2026-01-01T00:00:00.000Z",
                },
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
      }

      // Upstream AI provider requests
      const hdrs = new Headers(init?.headers);
      upstreamCalls.push({ url, auth: hdrs.get("Authorization") });
      if (opts.streamUpstream) {
        const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello!" } }] })}\n\ndata: [DONE]\n\n`;
        return new Response(sse, {
          status: 200,
          headers: { "Content-Type": "text/event-stream; charset=utf-8" },
        });
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "Hello from model" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    vi.stubGlobal("fetch", mockFetch);
    return {
      creditCalls,
      usageRecords,
      upstreamCalls,
      get siteKeyLookupCount() {
        return siteKeyLookupCount;
      },
    };
  }

  it("deducts 1 credit when using a default website catalog model", async () => {
    const siteCiphertext = await encryptSecret(MASTER_KEY, "sk-site-secret");
    const spy = installFetchMock({ credits: 5, siteCiphertext });

    const res = await handleServerChat(
      chatRequest({
        model: "site-model-1",
        messages: [{ role: "user", content: "Hello" }],
        stream: false,
      }),
      ENV,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Billing-Source")).toBe("site");
    expect(res.headers.get("X-Credits-Charged")).toBe("1");
    expect(spy.creditCalls).toEqual([{ user: "user-1", amount: 1 }]);
    expect(spy.upstreamCalls[0]?.url).toBe("https://site-upstream.example.com/v1/chat/completions");
    expect(spy.upstreamCalls[0]?.auth).toBe("Bearer sk-site-secret");
    expect(spy.usageRecords[0]).toMatchObject({ billing_source: "site", credits_charged: 1 });
  });

  it("rejects default website models with 402 credits_exhausted when user has 0 credits", async () => {
    const siteCiphertext = await encryptSecret(MASTER_KEY, "sk-site-secret");
    const spy = installFetchMock({ credits: 0, siteCiphertext });

    const res = await handleServerChat(
      chatRequest({
        model: "site-model-1",
        messages: [{ role: "user", content: "Hello" }],
      }),
      ENV,
    );

    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("credits_exhausted");
    expect(spy.creditCalls).toHaveLength(0);
    expect(spy.upstreamCalls).toHaveLength(0);
  });

  it("deducts ZERO credits when using a saved user-added provider (even with 0 credits and over site quota)", async () => {
    const userCiphertext = await encryptSecret(MASTER_KEY, "sk-user-byok-secret");
    const spy = installFetchMock({
      credits: 0,
      dailyUsed: 999_999,
      dailyLimit: 100,
      userCiphertext,
    });

    const res = await handleServerChat(
      chatRequest({
        userProviderId: "user-prov-1",
        model: "my-custom-llm",
        messages: [{ role: "user", content: "Hello from my own key" }],
        stream: false,
      }),
      ENV,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Billing-Source")).toBe("byok");
    expect(res.headers.get("X-Credits-Charged")).toBe("0");
    expect(spy.creditCalls).toHaveLength(0);
    expect(spy.siteKeyLookupCount).toBe(0);
    expect(spy.upstreamCalls[0]?.url).toBe("https://user-upstream.example.com/v1/chat/completions");
    expect(spy.upstreamCalls[0]?.auth).toBe("Bearer sk-user-byok-secret");
    expect(spy.usageRecords[0]).toMatchObject({
      billing_source: "byok",
      credits_charged: 0,
      user_provider_id: "user-prov-1",
    });
  });

  it("deducts ZERO credits for streamed responses from a user-added model resolved by userModelId or model ID", async () => {
    const userCiphertext = await encryptSecret(MASTER_KEY, "sk-user-stream-secret");
    const spy = installFetchMock({
      credits: 0,
      userCiphertext,
      streamUpstream: true,
    });

    // Resolved automatically by passing the saved user model's ID in `model`
    const res = await handleServerChat(
      chatRequest({
        model: "user-model-1",
        messages: [{ role: "user", content: "Stream please" }],
        stream: true,
      }),
      ENV,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Billing-Source")).toBe("byok");
    expect(res.headers.get("X-Credits-Charged")).toBe("0");
    const text = await res.text();
    expect(text).toContain("Hello!");
    expect(spy.creditCalls).toHaveLength(0);
    expect(spy.siteKeyLookupCount).toBe(0);
    expect(spy.upstreamCalls[0]?.auth).toBe("Bearer sk-user-stream-secret");
  });

  it("deducts ZERO credits when using an inline customProvider BYOK request (even at 0 credits)", async () => {
    const spy = installFetchMock({ credits: 0 });

    const res = await handleServerChat(
      chatRequest({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Direct BYOK" }],
        customProvider: {
          name: "My OpenAI",
          baseUrl: "https://my-gateway.example.com/v1",
          apiFormat: "openai",
          apiKey: "sk-inline-user-key",
        },
      }),
      ENV,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Billing-Source")).toBe("byok");
    expect(res.headers.get("X-Credits-Charged")).toBe("0");
    expect(spy.creditCalls).toHaveLength(0);
    expect(spy.siteKeyLookupCount).toBe(0);
    expect(spy.upstreamCalls[0]?.url).toBe("https://my-gateway.example.com/v1/chat/completions");
    expect(spy.upstreamCalls[0]?.auth).toBe("Bearer sk-inline-user-key");
  });

  it("never falls back to site catalog or skips credits when userProviderId is invalid or belongs to someone else", async () => {
    const siteCiphertext = await encryptSecret(MASTER_KEY, "sk-site-secret");
    const spy = installFetchMock({ credits: 5, siteCiphertext });

    const res = await handleServerChat(
      chatRequest({
        userProviderId: "someone-elses-provider",
        model: "site-model-1",
        messages: [{ role: "user", content: "Try to bypass" }],
      }),
      ENV,
    );

    expect(res.status).toBe(404);
    expect(spy.creditCalls).toHaveLength(0);
    expect(spy.siteKeyLookupCount).toBe(0);
    expect(spy.upstreamCalls).toHaveLength(0);
  });

  it("still blocks blocked accounts even when using a user-added provider", async () => {
    const userCiphertext = await encryptSecret(MASTER_KEY, "sk-user-key");
    const spy = installFetchMock({ credits: 5, status: "blocked", userCiphertext });

    const res = await handleServerChat(
      chatRequest({
        userProviderId: "user-prov-1",
        model: "my-custom-llm",
        messages: [{ role: "user", content: "Blocked user" }],
      }),
      ENV,
    );

    expect(res.status).toBe(403);
    expect(spy.upstreamCalls).toHaveLength(0);
  });
});
