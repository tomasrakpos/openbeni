import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyModelTier, inspectProvider } from "../functions/api/_lib/providerInspector";
import { handleProviderInspect } from "../functions/api/provider-inspect";
import { buildComposerModels } from "../src/features/chat/modelOptions";
import type { AIModel, Provider } from "../src/lib/types";

describe("providerInspector: Free vs Paid classification", () => {
  it("classifies OpenRouter pricing metadata accurately (0 = free, >0 = paid)", () => {
    const freeModel = classifyModelTier(
      {
        id: "meta-llama/llama-3.3-70b-instruct:free",
        displayName: "Llama 3.3 70B (Free)",
        pricing: { prompt: 0, completion: 0 },
      },
      "https://openrouter.ai/api/v1",
    );
    expect(freeModel.tier).toBe("free");
    expect(freeModel.tierSource).toBe("pricing_metadata");

    const paidModel = classifyModelTier(
      {
        id: "anthropic/claude-3.7-sonnet",
        displayName: "Claude 3.7 Sonnet",
        pricing: { prompt: 0.000003, completion: 0.000015 },
      },
      "https://openrouter.ai/api/v1",
    );
    expect(paidModel.tier).toBe("paid");
    expect(paidModel.tierSource).toBe("pricing_metadata");
  });

  it("classifies paid-only providers vs free-tier & local providers when pricing is absent", () => {
    expect(
      classifyModelTier({ id: "gpt-4o", displayName: "gpt-4o" }, "https://api.openai.com/v1").tier,
    ).toBe("paid");
    expect(
      classifyModelTier({ id: "claude-sonnet-4-5", displayName: "claude-sonnet-4-5" }, "https://api.anthropic.com/v1").tier,
    ).toBe("paid");
    expect(
      classifyModelTier({ id: "llama-3.3-70b-versatile", displayName: "llama-3.3-70b-versatile" }, "https://api.groq.com/openai/v1").tier,
    ).toBe("free");
    expect(
      classifyModelTier({ id: "gemini-2.5-flash", displayName: "gemini-2.5-flash" }, "https://generativelanguage.googleapis.com/v1beta").tier,
    ).toBe("free");
    expect(
      classifyModelTier({ id: "qwen2.5:14b", displayName: "qwen2.5:14b" }, "http://localhost:11434/v1").tier,
    ).toBe("free");
  });
});

describe("providerInspector: live API-key health & bounce verification", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("catches invalid 401 key even when public GET /models returns 200", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/models")) {
        return new Response(
          JSON.stringify({
            data: [
              { id: "meta-llama/llama-3.3:free", pricing: { prompt: "0", completion: "0" } },
              { id: "openai/gpt-4o", pricing: { prompt: "0.0000025", completion: "0.00001" } },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      // Chat probe rejects the invalid key!
      return new Response(
        JSON.stringify({ error: { message: "No auth credentials found" } }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    });

    const result = await inspectProvider({
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "sk-or-invalid-key",
      format: "openai",
      verifyKeyLive: true,
    });

    expect(result.ok).toBe(false);
    expect(result.keyHealth.status).toBe("invalid_key");
    expect(result.keyHealth.ok).toBe(false);
    expect(result.keyHealth.httpStatus).toBe(401);
    expect(result.summary.totalModels).toBe(2);
    expect(result.summary.freeCount).toBe(1);
    expect(result.summary.paidCount).toBe(1);
  });

  it("detects free_only key when paid model bounces 402 but free model succeeds", async () => {
    let chatCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/models")) {
        return new Response(
          JSON.stringify({
            data: [
              { id: "openai/gpt-4o", pricing: { prompt: "0.0000025", completion: "0.00001" } },
              { id: "google/gemma-3-27b-it:free", pricing: { prompt: "0", completion: "0" } },
              { id: "meta-llama/llama-3.3:free", pricing: { prompt: "0", completion: "0" } },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      chatCalls += 1;
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (String(body.model).includes(":free")) {
        return new Response(
          JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ error: { message: "Insufficient credits" } }),
        { status: 402, headers: { "Content-Type": "application/json" } },
      );
    });

    const result = await inspectProvider({
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "sk-or-zero-balance-key",
      format: "openai",
      verifyKeyLive: true,
    });

    expect(result.ok).toBe(true);
    expect(result.keyHealth.status).toBe("free_only");
    expect(result.keyHealth.freeModelsUsable).toBe(true);
    expect(result.summary.freeCount).toBe(2);
    expect(result.summary.paidCount).toBe(1);
    expect(chatCalls).toBeGreaterThanOrEqual(1);
  });

  it("reports healthy status & latency when key completes live 1-token chat probe", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/models")) {
        return new Response(
          JSON.stringify({ data: [{ id: "gpt-4o-mini" }, { id: "gpt-4o" }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const req = new Request("http://localhost:5173/api/provider-inspect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-valid-test-key",
        format: "auto",
      }),
    });
    const res = await handleProviderInspect(req, {});
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.keyHealth.status).toBe("healthy");
    expect(data.summary.totalModels).toBe(2);
    expect(data.summary.paidCount).toBe(2);
    expect(data.summary.freeCount).toBe(0);
  });
});

describe("buildComposerModels: Free models first & user-added Free/Paid labels", () => {
  it("places free models at the very top of the chat menu and marks user-added paid models", () => {
    const now = Date.now();
    const userProvider: Provider = {
      id: "user-openrouter",
      name: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiFormat: "openai",
      auth: { header: "Authorization", prefix: "Bearer " },
      extraHeaders: {},
      timeoutMs: 45_000,
      useProxy: false,
      enabled: true,
      favorite: false,
      order: 1,
      paths: {},
      hasKey: true,
      createdAt: now,
      updatedAt: now,
    };
    const mk = (id: string, modelId: string, displayName: string, tier: "free" | "paid", order: number): AIModel => ({
      id,
      providerId: userProvider.id,
      modelId,
      displayName,
      capabilities: ["text"],
      tier,
      enabled: true,
      favorite: false,
      order,
      source: "api",
    });

    const models: AIModel[] = [
      mk("m-paid-1", "openai/gpt-4o", "GPT-4o", "paid", 0),
      mk("m-paid-2", "anthropic/claude-3.7-sonnet", "Claude 3.7 Sonnet", "paid", 1),
      mk("m-free-1", "meta-llama/llama-3.3-70b:free", "Llama 3.3 70B Free", "free", 2),
      mk("m-free-2", "google/gemma-3-27b:free", "Gemma 3 27B Free", "free", 3),
    ];

    const options = buildComposerModels([userProvider], models);
    expect(options.map((o) => o.id)).toEqual(["m-free-1", "m-free-2", "m-paid-1", "m-paid-2"]);
    expect(options[0].tier).toBe("free");
    expect(options[0].userAdded).toBe(true);
    expect(options[2].tier).toBe("paid");
    expect(options[2].userAdded).toBe(true);
  });
});
