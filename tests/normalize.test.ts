// Tests for normalize.test; add or update cases here to match observable behavior.
import { describe, expect, it } from "vitest";
import { joinUrl, normalizeBaseUrl, versionSegment } from "@/lib/normalize";

describe("normalizeBaseUrl", () => {
  it("adds https and strips pasted endpoints", () => {
    const result = normalizeBaseUrl("api.openai.com/v1/chat/completions");
    expect(result.valid).toBe(true);
    expect(result.baseUrl).toBe("https://api.openai.com/v1");
    expect(result.changes.map((c) => c.code)).toContain("protocol");
    expect(result.changes.map((c) => c.code)).toContain("removed-endpoint");
  });

  it("keeps http for local hosts and trims trailing slashes", () => {
    const result = normalizeBaseUrl("localhost:11434/v1/", "openai");
    expect(result.baseUrl).toBe("http://localhost:11434/v1");
    expect(result.changes.map((c) => c.code)).toContain("protocol");
    expect(result.changes.map((c) => c.code)).toContain("trailing-slash");
  });

  it("adds the version segment matching the API format", () => {
    expect(normalizeBaseUrl("https://api.example.com", "openai").baseUrl).toBe(
      "https://api.example.com/v1",
    );
    expect(normalizeBaseUrl("https://generativelanguage.googleapis.com", "gemini").baseUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta",
    );
  });

  it("collapses duplicated version segments", () => {
    expect(normalizeBaseUrl("https://api.example.com/v1/v1").baseUrl).toBe(
      "https://api.example.com/v1",
    );
  });

  it("removes query strings, hashes and duplicate slashes", () => {
    const result = normalizeBaseUrl("https://api.example.com//v1//models?key=1#frag");
    expect(result.baseUrl).toBe("https://api.example.com/v1");
    expect(result.changes.map((c) => c.code)).toContain("removed-endpoint");
    expect(result.changes.map((c) => c.code)).toContain("removed-query");
    expect(result.changes.map((c) => c.code)).toContain("removed-hash");
    expect(result.changes.map((c) => c.code)).toContain("collapsed-slashes");
  });

  it("strips Gemini model-specific endpoints", () => {
    const result = normalizeBaseUrl(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent",
      "gemini",
    );
    expect(result.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta");
  });

  it("rejects empty and malformed input", () => {
    expect(normalizeBaseUrl("   ").valid).toBe(false);
    expect(normalizeBaseUrl("").baseUrl).toBe("");
    expect(normalizeBaseUrl("http://").valid).toBe(false);
  });

  it("reports the version segment for each format", () => {
    expect(versionSegment("gemini")).toBe("/v1beta");
    expect(versionSegment("openai")).toBe("/v1");
    expect(versionSegment("anthropic")).toBe("/v1");
  });
});

describe("joinUrl", () => {
  it("joins without doubling or dropping slashes", () => {
    expect(joinUrl("https://api.example.com/v1/", "/models")).toBe(
      "https://api.example.com/v1/models",
    );
    expect(joinUrl("https://api.example.com/v1", "models")).toBe(
      "https://api.example.com/v1/models",
    );
  });

  it("returns the base when the path is empty", () => {
    expect(joinUrl("https://api.example.com/v1/", "")).toBe("https://api.example.com/v1");
  });

  it("passes absolute URLs through", () => {
    expect(joinUrl("https://api.example.com", "https://cdn.example.com/models")).toBe(
      "https://cdn.example.com/models",
    );
  });
});
