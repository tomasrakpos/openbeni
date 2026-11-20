// Tests for http.test; add or update cases here to match observable behavior.
import { describe, expect, it } from "vitest";
import {
  classifyException,
  classifyHttpStatus,
  errorHint,
  extractErrorMessage,
  makeApiError,
  proxiedUrl,
  redactKey,
} from "@/lib/http";

describe("classifyHttpStatus", () => {
  it("maps status codes to error kinds", () => {
    expect(classifyHttpStatus(200)).toBe("ok");
    expect(classifyHttpStatus(204)).toBe("ok");
    expect(classifyHttpStatus(401)).toBe("auth");
    expect(classifyHttpStatus(403)).toBe("auth");
    expect(classifyHttpStatus(404)).toBe("not-found");
    expect(classifyHttpStatus(408)).toBe("timeout");
    expect(classifyHttpStatus(429)).toBe("rate-limit");
    expect(classifyHttpStatus(500)).toBe("server");
    expect(classifyHttpStatus(503)).toBe("server");
    expect(classifyHttpStatus(418)).toBe("http");
  });
});

describe("classifyException", () => {
  it("prefers an explicit timeout", () => {
    expect(classifyException(new Error("whatever"), true)).toBe("timeout");
  });

  it("treats fetch TypeErrors as CORS in a browser-like environment", () => {
    expect(classifyException(new TypeError("Failed to fetch"), false)).toBe("cors");
  });

  it("recognises timeout and abort errors", () => {
    expect(classifyException(new Error("Request timed out"), false)).toBe("timeout");
    expect(classifyException(Object.assign(new Error("x"), { name: "AbortError" }), false)).toBe(
      "unknown",
    );
  });

  it("falls back to unknown", () => {
    expect(classifyException("nope", false)).toBe("unknown");
  });
});

describe("makeApiError", () => {
  it("attaches the kind and status", () => {
    const error = makeApiError("auth", "bad key", 401);
    expect(error).toBeInstanceOf(Error);
    expect(error.kind).toBe("auth");
    expect(error.status).toBe(401);
    expect(error.message).toBe("bad key");
  });
});

describe("proxiedUrl", () => {
  it("wraps a target with an encoded url parameter", () => {
    const url = proxiedUrl("https://api.example.com/v1/models?x=1", "https://proxy.example.dev");
    expect(url).toBe(
      "https://proxy.example.dev?url=https%3A%2F%2Fapi.example.com%2Fv1%2Fmodels%3Fx%3D1",
    );
  });

  it("appends with & when the proxy already has a query", () => {
    expect(proxiedUrl("https://a.dev/x", "https://proxy.dev?token=abc")).toBe(
      "https://proxy.dev?token=abc&url=https%3A%2F%2Fa.dev%2Fx",
    );
  });

  it("returns the target untouched without a proxy", () => {
    expect(proxiedUrl("https://a.dev/x", "  ")).toBe("https://a.dev/x");
  });
});

describe("redactKey", () => {
  it("removes the whole key without revealing any characters", () => {
    const key = "sk-1234567890abcdef";
    const redacted = redactKey(`Bearer ${key}`, key);
    expect(redacted).not.toContain(key);
    expect(redacted).toBe("Bearer [redacted]");
    expect(redacted).not.toContain("sk-");
  });

  it("leaves input alone for short keys", () => {
    expect(redactKey("Bearer abc", "abc")).toBe("Bearer abc");
  });
});

describe("extractErrorMessage", () => {
  it("handles strings, nested error objects and message fields", () => {
    expect(extractErrorMessage("plain")).toBe("plain");
    expect(extractErrorMessage({ error: "bad" })).toBe("bad");
    expect(extractErrorMessage({ error: { message: "nested" } })).toBe("nested");
    expect(extractErrorMessage({ message: "top" })).toBe("top");
    expect(extractErrorMessage(null)).toBeUndefined();
  });
});

describe("errorHint", () => {
  it("returns a hint in both languages", () => {
    expect(errorHint("cors", "en")).toMatch(/CORS/);
    expect(errorHint("cors", "fa")).not.toHaveLength(0);
    expect(errorHint("auth", "en")).toMatch(/key/i);
  });
});
