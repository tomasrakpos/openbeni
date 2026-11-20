import { describe, expect, it } from "vitest";
import {
  normalizeProviderBaseUrl,
  validateProviderBaseUrl,
} from "../functions/api/_lib/urlGuard";
import { buildUpstreamRequest } from "../functions/api/_lib/upstream";
import type { ProviderRow } from "../functions/api/_lib/providerKeys";

function provider(base_url: string, api_format: ProviderRow["api_format"] = "openai"): ProviderRow {
  return {
    id: "p",
    name: "p",
    base_url,
    api_format,
    auth_header: "Authorization",
    auth_prefix: "Bearer ",
    extra_headers: null,
    icon: null,
    color: null,
    notes: null,
    enabled: true,
    created_at: "",
    updated_at: "",
  };
}

describe("provider base URL normalisation", () => {
  it("adds the default version segment when the URL has no path", () => {
    expect(normalizeProviderBaseUrl("https://api.openai.com")).toBe("https://api.openai.com/v1");
    expect(normalizeProviderBaseUrl("https://api.anthropic.com", "anthropic")).toBe(
      "https://api.anthropic.com/v1",
    );
    expect(normalizeProviderBaseUrl("https://generativelanguage.googleapis.com", "gemini")).toBe(
      "https://generativelanguage.googleapis.com/v1beta",
    );
    expect(normalizeProviderBaseUrl("https://gateway.example.com", "custom")).toBe(
      "https://gateway.example.com",
    );
  });

  it("keeps real sub-paths and removes duplicates or pasted endpoints", () => {
    expect(normalizeProviderBaseUrl("https://openrouter.ai/api/v1")).toBe("https://openrouter.ai/api/v1");
    expect(normalizeProviderBaseUrl("https://api.groq.com/openai/v1")).toBe("https://api.groq.com/openai/v1");
    expect(normalizeProviderBaseUrl("https://api.openai.com/v1/")).toBe("https://api.openai.com/v1");
    expect(normalizeProviderBaseUrl("https://api.openai.com/v1/v1")).toBe("https://api.openai.com/v1");
    expect(normalizeProviderBaseUrl("https://api.openai.com/v1/chat/completions")).toBe(
      "https://api.openai.com/v1",
    );
    expect(normalizeProviderBaseUrl("https://api.openai.com/models")).toBe("https://api.openai.com/v1");
  });

  it("returns the canonical URL from validateProviderBaseUrl", () => {
    const check = validateProviderBaseUrl("https://api.openai.com");
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.url.toString().replace(/\/+$/, "")).toBe("https://api.openai.com/v1");
    expect(validateProviderBaseUrl("http://api.openai.com").ok).toBe(false);
    expect(validateProviderBaseUrl("https://127.0.0.1/v1").ok).toBe(false);
  });
});

describe("server upstream request", () => {
  it("calls the versioned chat endpoint for an unversioned base URL", () => {
    const request = buildUpstreamRequest(provider("https://api.openai.com"), "k", {
      model: "gpt-4o-mini",
      messages: [],
    }, true);
    expect(request.url).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("does not touch an already normalised base URL", () => {
    const request = buildUpstreamRequest(provider("https://api.openai.com/v1", "openai"), "k", {
      model: "gpt-4o-mini",
      messages: [],
    }, false);
    expect(request.url).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("builds the Gemini endpoint under the version segment", () => {
    const request = buildUpstreamRequest(
      provider("https://generativelanguage.googleapis.com", "gemini"),
      "k",
      { model: "gemini-2.0-flash", messages: [{ role: "user", content: "hi" }] },
      true,
    );
    expect(request.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse",
    );
  });
});
