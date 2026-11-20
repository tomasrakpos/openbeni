// Tests for urlGuard.test; add or update cases here to match observable behavior.
import { describe, expect, it } from "vitest";
import { isPrivateHost, safeFetch, validateProviderBaseUrl } from "../functions/api/_lib/urlGuard";

describe("validateProviderBaseUrl", () => {
  it("accepts a public https URL", () => {
    const result = validateProviderBaseUrl("https://api.openai.com/v1");
    expect(result.ok).toBe(true);
  });

  it("rejects non-https schemes", () => {
    expect(validateProviderBaseUrl("http://api.openai.com/v1").ok).toBe(false);
    expect(validateProviderBaseUrl("file:///etc/passwd").ok).toBe(false);
  });

  it("rejects loopback, private and link-local hosts", () => {
    for (const host of [
      "https://localhost/v1",
      "https://127.0.0.1/v1",
      "https://10.1.2.3/v1",
      "https://192.168.0.5/v1",
      "https://172.20.0.1/v1",
      "https://169.254.169.254/latest",
      "https://[::1]/v1",
    ]) {
      expect(validateProviderBaseUrl(host).ok, host).toBe(false);
    }
  });

  it("rejects credentials and non-default ports", () => {
    expect(validateProviderBaseUrl("https://user:pass@api.example.com/v1").ok).toBe(false);
    expect(validateProviderBaseUrl("https://api.example.com:8443/v1").ok).toBe(false);
    expect(validateProviderBaseUrl("https://api.example.com:443/v1").ok).toBe(true);
  });

  it("rejects relative and garbage URLs", () => {
    expect(validateProviderBaseUrl("api.example.com").ok).toBe(false);
    expect(validateProviderBaseUrl("not a url").ok).toBe(false);
  });
});

describe("isPrivateHost", () => {
  it("flags private ranges only", () => {
    expect(isPrivateHost("127.0.0.1")).toBe(true);
    expect(isPrivateHost("8.8.8.8")).toBe(false);
    expect(isPrivateHost("api.example.com")).toBe(false);
    expect(isPrivateHost("100.64.0.1")).toBe(true);
    expect(isPrivateHost("100.63.0.1")).toBe(false);
  });
});

describe("safeFetch", () => {
  it("re-validates redirects and blocks a hop to loopback", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(null, {
        status: 302,
        headers: { Location: "http://127.0.0.1/secret" },
      })) as typeof fetch;
    try {
      await expect(
        safeFetch(new URL("https://api.example.com/v1/models"), { method: "GET" }),
      ).rejects.toThrow(/blocked|insecure/i);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("drops auth headers when a redirect crosses hosts", async () => {
    const original = globalThis.fetch;
    const seen: Headers[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers));
      if (seen.length === 1) {
        return new Response(null, { status: 302, headers: { Location: "https://cdn.example.net/v1/models" } });
      }
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    try {
      const response = await safeFetch(new URL("https://api.example.com/v1/models"), {
        method: "GET",
        headers: { Authorization: "Bearer secret" },
      });
      expect(response.status).toBe(200);
      expect(seen[0]?.get("authorization")).toBe("Bearer secret");
      expect(seen[1]?.get("authorization")).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });
});
