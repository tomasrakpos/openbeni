// Tests for sse.test; add or update cases here to match observable behavior.
import { describe, expect, it } from "vitest";
import {
  SSEDecoder,
  getPath,
  parseAnthropicDelta,
  parseCustomDelta,
  parseGeminiDelta,
  parseOpenAIDelta,
  parseStreamEvent,
} from "@/lib/sse";

describe("SSEDecoder", () => {
  it("waits for a complete event across chunk boundaries", () => {
    const decoder = new SSEDecoder();
    expect(decoder.push("data: hel")).toEqual([]);
    expect(decoder.push("lo")).toEqual([]);
    expect(decoder.push("\n\n")).toEqual([{ data: "hello" }]);
  });

  it("handles CRLF line endings and comments", () => {
    const decoder = new SSEDecoder();
    const events = decoder.push(": keep-alive\r\nevent: delta\r\ndata: one\r\n\r\n");
    expect(events).toEqual([{ event: "delta", data: "one" }]);
  });

  it("joins multi-line data fields and carries the last id", () => {
    const decoder = new SSEDecoder();
    const events = decoder.push("id: 42\ndata: first\ndata: second\n\n");
    expect(events).toEqual([{ id: "42", data: "first\nsecond" }]);
  });

  it("flushes a trailing event without a blank line", () => {
    const decoder = new SSEDecoder();
    expect(decoder.push("data: tail")).toEqual([]);
    expect(decoder.flush()).toEqual([{ data: "tail" }]);
  });

  it("ignores unknown fields and bare lines", () => {
    const decoder = new SSEDecoder();
    expect(decoder.push("retry: 1000\n\n")).toEqual([]);
    expect(decoder.push(":comment\n\n")).toEqual([]);
  });
});

describe("parseOpenAIDelta", () => {
  it("extracts text, reasoning, finish reason and usage", () => {
    expect(parseOpenAIDelta({ choices: [{ delta: { content: "Hi" } }] })).toEqual({ text: "Hi" });
    expect(parseOpenAIDelta({ choices: [{ delta: { reasoning_content: "why" } }] })).toEqual({
      reasoning: "why",
    });
    expect(
      parseOpenAIDelta({
        choices: [{ delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 12, completion_tokens: 4 },
      }),
    ).toEqual({
      finish: "stop",
      usage: { promptTokens: 12, completionTokens: 4 },
    });
  });

  it("joins array-shaped content parts", () => {
    expect(
      parseOpenAIDelta({
        choices: [{ delta: { content: [{ text: "a" }, { text: "b" }] } }],
      }),
    ).toEqual({ text: "ab" });
  });

  it("returns null for empty or invalid payloads", () => {
    expect(parseOpenAIDelta({})).toBeNull();
    expect(parseOpenAIDelta(null)).toBeNull();
    expect(parseOpenAIDelta({ choices: [{ delta: { content: "" } }] })).toBeNull();
  });
});

describe("parseAnthropicDelta", () => {
  it("parses text and thinking deltas", () => {
    expect(
      parseAnthropicDelta(undefined, {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "hello" },
      }),
    ).toEqual({ text: "hello" });
    expect(
      parseAnthropicDelta(undefined, {
        type: "content_block_delta",
        delta: { type: "thinking_delta", thinking: "hmm" },
      }),
    ).toEqual({ reasoning: "hmm" });
  });

  it("parses message_start usage and message_delta stop reason", () => {
    expect(
      parseAnthropicDelta(undefined, {
        type: "message_start",
        message: { usage: { input_tokens: 9, output_tokens: 1 } },
      }),
    ).toEqual({ usage: { promptTokens: 9, completionTokens: 1 } });
    expect(
      parseAnthropicDelta(undefined, {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 6 },
      }),
    ).toEqual({ finish: "end_turn", usage: { completionTokens: 6 } });
  });

  it("ignores unrelated events", () => {
    expect(parseAnthropicDelta("ping", { type: "ping" })).toBeNull();
    expect(parseAnthropicDelta(undefined, { type: "content_block_stop" })).toBeNull();
  });
});

describe("parseGeminiDelta", () => {
  it("separates thought parts from answer text", () => {
    expect(
      parseGeminiDelta({
        candidates: [
          {
            content: {
              parts: [{ text: "thinking", thought: true }, { text: "answer" }],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7 },
      }),
    ).toEqual({
      reasoning: "thinking",
      text: "answer",
      finish: "STOP",
      usage: { promptTokens: 5, completionTokens: 7 },
    });
  });

  it("returns null when there is nothing useful", () => {
    expect(parseGeminiDelta({})).toBeNull();
    expect(parseGeminiDelta({ candidates: [{ content: { parts: [] } }] })).toBeNull();
  });
});

describe("getPath and custom deltas", () => {
  const payload = { data: { items: [{ text: "a" }, { text: "b" }] } };

  it("reads nested paths with bracket indices", () => {
    expect(getPath(payload, "data.items[1].text")).toBe("b");
    expect(getPath(payload, "data.items.0.text")).toBe("a");
    expect(getPath(payload, "data.missing.value")).toBeUndefined();
    expect(getPath(payload, "")).toBe(payload);
  });

  it("reads custom delta and reasoning paths and joins arrays", () => {
    expect(parseCustomDelta({ token: "x" }, "token")).toEqual({ text: "x" });
    expect(parseCustomDelta({ out: ["a", "b"] }, "out")).toEqual({ text: "ab" });
    expect(parseCustomDelta({ r: "why", t: "ok" }, "t", "r")).toEqual({ text: "ok", reasoning: "why" });
    expect(parseCustomDelta({}, "token")).toBeNull();
  });
});

describe("parseStreamEvent", () => {
  it("ignores [DONE] markers and malformed JSON", () => {
    expect(parseStreamEvent("openai", { data: "[DONE]" })).toBeNull();
    expect(parseStreamEvent("openai", { data: "not json" })).toBeNull();
    expect(parseStreamEvent("openai", { data: "" })).toBeNull();
  });

  it("dispatches to the correct parser", () => {
    expect(parseStreamEvent("openai", { data: '{"choices":[{"delta":{"content":"x"}}]}' })).toEqual({
      text: "x",
    });
    expect(
      parseStreamEvent("anthropic", {
        event: "content_block_delta",
        data: '{"delta":{"type":"text_delta","text":"y"}}',
      }),
    ).toEqual({ text: "y" });
    expect(
      parseStreamEvent("gemini", {
        data: '{"candidates":[{"content":{"parts":[{"text":"z"}]}}]}',
      }),
    ).toEqual({ text: "z" });
  });
});
