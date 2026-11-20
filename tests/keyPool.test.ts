// Tests for keyPool.test; add or update cases here to match observable behavior.
import { afterEach, describe, expect, it } from "vitest";
import { makeHttpError } from "@/lib/http";
import {
  canRotateKey,
  getProviderKeyCandidates,
  isManagedProvider,
  markKeyFailure,
  markKeySuccess,
  resetKeyHealth,
} from "@/lib/keyPool";
import type { Provider } from "@/lib/types";

const byok: Provider = {
  id: "prov_custom",
  name: "Custom",
  baseUrl: "https://example.com/v1",
  apiFormat: "openai",
  auth: { header: "Authorization", prefix: "Bearer " },
  extraHeaders: {},
  timeoutMs: 60_000,
  useProxy: false,
  enabled: true,
  favorite: false,
  order: 1,
  presetId: "custom",
  paths: {},
  hasKey: true,
  createdAt: 0,
  updatedAt: 0,
};

const managed: Provider = {
  ...byok,
  id: "prov_coarena",
  name: "Coarena",
  baseUrl: "https://coarena.ai/api/v1",
  presetId: "coarena",
  managed: true,
  auth: { header: "", prefix: "" },
  hasKey: false,
};

afterEach(() => resetKeyHealth());

describe("managed providers", () => {
  it("sends no browser key: a single empty candidate", () => {
    expect(isManagedProvider(managed)).toBe(true);
    expect(getProviderKeyCandidates(managed, "coa_should_be_ignored")).toEqual([""]);
  });

  it("never treats a stored key as auth for a managed row", () => {
    expect(getProviderKeyCandidates(managed, null)).toEqual([""]);
  });
});

describe("BYOK key health", () => {
  it("returns no candidates when nothing is stored", () => {
    expect(getProviderKeyCandidates(byok, null)).toEqual([]);
    expect(getProviderKeyCandidates(byok, "")).toEqual([]);
  });

  it("returns the stored key", () => {
    expect(getProviderKeyCandidates(byok, "sk-test")).toEqual(["sk-test"]);
  });

  it("cools a rate-limited key down and restores it on success", () => {
    expect(getProviderKeyCandidates(byok, "sk-test")).toEqual(["sk-test"]);
    markKeyFailure("sk-test", "rate-limit");
    expect(getProviderKeyCandidates(byok, "sk-test")).toEqual([]);
    markKeySuccess("sk-test");
    expect(getProviderKeyCandidates(byok, "sk-test")).toEqual(["sk-test"]);
  });
});

describe("key rotation errors", () => {
  it("classifies quota-style HTTP 400 and payment errors as rate limits", () => {
    expect(makeHttpError(400, "You have reached your specified API usage limits").kind).toBe("rate-limit");
    expect(makeHttpError(402, "Payment required").kind).toBe("rate-limit");
    expect(makeHttpError(400, "Invalid request").kind).toBe("http");
  });

  it("only rotates on errors another key can fix", () => {
    expect(canRotateKey("rate-limit")).toBe(true);
    expect(canRotateKey("auth")).toBe(true);
    expect(canRotateKey("server")).toBe(true);
    expect(canRotateKey("cors")).toBe(false);
    expect(canRotateKey("timeout")).toBe(false);
    expect(canRotateKey(undefined)).toBe(false);
  });
});
