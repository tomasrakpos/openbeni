// Tests for chatClient.test; add or update cases here to match observable behavior.
import { describe, expect, it } from "vitest";
import {
  buildAnthropicMessages,
  buildBody,
  buildGeminiContents,
  buildOpenAIMessages,
  chatUrl,
  defaultChatPath,
  extractText,
  modelsUrl,
  parseModelList,
  renderTemplate,
  stripModelsPrefix,
} from "@/lib/chatClient";
import type { ChatMessageInput, ChatParams, Provider } from "@/lib/types";

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: "provider-1",
    name: "Test provider",
    baseUrl: "https://api.example.com/v1",
    apiFormat: "openai",
    auth: { header: "Authorization", prefix: "Bearer " },
    extraHeaders: {},
    timeoutMs: 30_000,
    useProxy: false,
    enabled: true,
    favorite: false,
    order: 1,
    paths: {},
    hasKey: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

const params: ChatParams = { temperature: 0.7, topP: 0.9, maxTokens: 512 };
const messages: ChatMessageInput[] = [
  { role: "system", content: "You are terse." },
  { role: "user", content: "Hello" },
];

describe("renderTemplate", () => {
  it("substitutes known variables as JSON values", () => {
    const rendered = renderTemplate('{"model": {{model}}, "stream": {{stream}}}', {
      model: "gpt-x",
      stream: true,
    });
    expect(JSON.parse(rendered)).toEqual({ model: "gpt-x", stream: true });
  });

  it("leaves unknown placeholders untouched", () => {
    expect(renderTemplate("{{known}} {{unknown}}", { known: 1 })).toBe('1 {{unknown}}');
  });
});

describe("buildBody", () => {
  it("builds an OpenAI-compatible body with system messages in place", () => {
    const body = buildBody(provider(), "models/gpt-x", messages, params, true);
    expect(body.model).toBe("gpt-x");
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.max_tokens).toBe(512);
    expect(body.temperature).toBe(0.7);
    const wire = body.messages as { role: string; content: string }[];
    expect(wire.map((m) => m.role)).toEqual(["system", "user"]);
    expect(wire[0]?.content).toBe("You are terse.");
  });

  it("hoists the system prompt for Anthropic", () => {
    const body = buildBody(provider({ apiFormat: "anthropic" }), "claude-x", messages, params, true);
    expect(body.system).toBe("You are terse.");
    expect(body.max_tokens).toBe(512);
    expect(body.top_p).toBe(0.9);
    const wire = body.messages as { role: string }[];
    expect(wire.map((m) => m.role)).toEqual(["user"]);
  });

  it("omits top_p for Anthropic when it is 1", () => {
    const body = buildBody(
      provider({ apiFormat: "anthropic" }),
      "claude-x",
      messages,
      { ...params, topP: 1 },
      true,
    );
    expect(body.top_p).toBeUndefined();
  });

  it("builds Gemini contents and generation config", () => {
    const body = buildBody(provider({ apiFormat: "gemini" }), "gemini-x", messages, params, true) as {
      contents: unknown[];
      systemInstruction: { parts: { text: string }[] };
      generationConfig: Record<string, unknown>;
    };
    expect(body.contents).toHaveLength(1);
    expect(body.systemInstruction.parts[0]?.text).toBe("You are terse.");
    expect(body.generationConfig.maxOutputTokens).toBe(512);
    expect(body.generationConfig.temperature).toBe(0.7);
  });

  it("renders a custom JSON body template", () => {
    const body = buildBody(
      provider({
        apiFormat: "custom",
        custom: {
          endpoint: "/chat",
          headers: {},
          bodyTemplate: '{"model": {{model}}, "messages": {{messages}}, "stream": {{stream}}}',
          textPath: "reply",
          deltaPath: "token",
          streamMode: "sse",
        },
      }),
      "custom-model",
      messages,
      params,
      false,
    );
    expect(body.model).toBe("custom-model");
    expect(body.stream).toBe(false);
    expect(body.messages).toEqual(messages.map((m) => ({ role: m.role, content: m.content })));
  });

  it("rejects empty and broken custom templates", () => {
    const empty = provider({ apiFormat: "custom", custom: undefined });
    expect(() => buildBody(empty, "m", messages, params, true)).toThrow(/empty/i);

    const broken = provider({
      apiFormat: "custom",
      custom: {
        endpoint: "/chat",
        headers: {},
        bodyTemplate: "{not json",
        textPath: "x",
        deltaPath: "x",
        streamMode: "sse",
      },
    });
    expect(() => buildBody(broken, "m", messages, params, true)).toThrow(/valid JSON/i);
  });
});

describe("message builders", () => {
  it("keeps system messages for OpenAI and drops them elsewhere", () => {
    expect(buildOpenAIMessages(messages)).toHaveLength(2);
    expect(buildAnthropicMessages(messages)).toHaveLength(1);
    expect(buildGeminiContents(messages)).toHaveLength(1);
  });

  it("maps Gemini assistant messages to the model role", () => {
    const contents = buildGeminiContents([{ role: "assistant", content: "hi" }]) as {
      role: string;
    }[];
    expect(contents[0]?.role).toBe("model");
  });
});

describe("URLs", () => {
  it("builds default chat paths per format", () => {
    expect(defaultChatPath(provider(), "gpt-x")).toBe("/chat/completions");
    expect(defaultChatPath(provider({ apiFormat: "anthropic" }), "claude")).toBe("/messages");
    expect(defaultChatPath(provider({ apiFormat: "gemini" }), "models/gemini-x")).toBe(
      "/models/gemini-x:streamGenerateContent?alt=sse",
    );
  });

  it("honours path overrides and model placeholders", () => {
    const p = provider({ paths: { chat: "/custom/{{model}}", models: "/catalog" } });
    expect(defaultChatPath(p, "models/foo")).toBe("/custom/foo");
    expect(chatUrl(p, "models/foo")).toBe("https://api.example.com/v1/custom/foo");
    expect(modelsUrl(p)).toBe("https://api.example.com/v1/catalog");
    expect(modelsUrl(provider())).toBe("https://api.example.com/v1/models");
  });

  it("strips the models/ prefix", () => {
    expect(stripModelsPrefix("models/gpt-x")).toBe("gpt-x");
    expect(stripModelsPrefix("gpt-x")).toBe("gpt-x");
  });
});

describe("parseModelList", () => {
  it("parses OpenAI-style data arrays and converts per-token pricing", () => {
    const models = parseModelList({
      data: [
        {
          id: "models/gpt-x",
          display_name: "GPT X",
          context_length: 128000,
          pricing: { prompt: "0.000002", completion: "0.000004" },
        },
        "plain-model",
      ],
    });
    expect(models[0]).toEqual({
      id: "gpt-x",
      name: "GPT X",
      contextWindow: 128000,
      pricing: { prompt: 2, completion: 4 },
    });
    expect(models[1]).toEqual({ id: "plain-model" });
  });

  it("parses alternative shapes", () => {
    expect(parseModelList({ models: [{ name: "alpha" }] })).toEqual([{ id: "alpha" }]);
    expect(parseModelList({ data: { models: [{ model: "beta" }] } })).toEqual([{ id: "beta" }]);
    expect(parseModelList(null)).toEqual([]);
  });
});

describe("extractText", () => {
  it("extracts the reply for every format", () => {
    expect(extractText(provider(), { choices: [{ message: { content: "a" } }] })).toBe("a");
    expect(
      extractText(provider({ apiFormat: "anthropic" }), {
        content: [{ type: "text", text: "b" }, { type: "text", text: "c" }],
      }),
    ).toBe("bc");
    expect(
      extractText(provider({ apiFormat: "gemini" }), {
        candidates: [{ content: { parts: [{ text: "d" }] } }],
      }),
    ).toBe("d");
    expect(
      extractText(
        provider({
          apiFormat: "custom",
          custom: {
            endpoint: "/chat",
            headers: {},
            bodyTemplate: "{}",
            textPath: "reply.text",
            deltaPath: "token",
            streamMode: "json",
          },
        }),
        { reply: { text: "e" } },
      ),
    ).toBe("e");
  });

  it("returns an empty string for unusable payloads", () => {
    expect(extractText(provider(), null)).toBe("");
    expect(extractText(provider(), {})).toBe("");
  });
});
