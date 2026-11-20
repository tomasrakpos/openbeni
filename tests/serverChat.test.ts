// Tests for serverChat.test; add or update cases here to match observable behavior.
import { describe, expect, it } from "vitest";
import { validateChatRequest } from "../functions/api/_lib/serverChat";

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

  it("drops unknown fields and clamps max_tokens", () => {
    const result = validateChatRequest({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 10_000_000,
      temperature: 99,
      top_p: -4,
      system: "leak",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body.max_tokens).toBe(32_768);
      expect(result.body.temperature).toBe(2);
      expect(result.body.top_p).toBe(0);
      expect("system" in result.body).toBe(false);
    }
  });

  it("rejects oversized conversations", () => {
    const messages = Array.from({ length: 130 }, () => ({ role: "user", content: "hello" }));
    expect(validateChatRequest({ model: "m", messages }).ok).toBe(false);

    const tooLong = [{ role: "user", content: "x".repeat(33_000) }];
    expect(validateChatRequest({ model: "m", messages: tooLong }).ok).toBe(false);
  });
});
