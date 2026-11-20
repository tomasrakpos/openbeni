// Tests for providerKeys.test; add or update cases here to match observable behavior.
import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "../functions/api/_lib/crypto";
import {
  callWithRotation,
  keyStatus,
  summarizeProvider,
  type ProviderKeyRow,
  type ProviderRow,
} from "../functions/api/_lib/providerKeys";

const MASTER = "rotation-test-master-key-0123456789abcdef";
const ENV = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
  MASTER_ENCRYPTION_KEY: MASTER,
};

const PROVIDER: ProviderRow = {
  id: "prov-1",
  name: "Test",
  base_url: "https://api.example.com/v1",
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
};

function keyRow(id: string, ciphertext: string, index: number): ProviderKeyRow {
  return {
    id,
    provider_id: PROVIDER.id,
    ciphertext,
    label: `key-${index}`,
    enabled: true,
    cooldown_until: null,
    fail_count: 0,
    last_error: null,
    created_at: `2026-01-0${index}T00:00:00.000Z`,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("key rotation", () => {
  it("retries the same request with the next key after a retryable failure", async () => {
    const first = await encryptSecret(MASTER, "key-one");
    const second = await encryptSecret(MASTER, "key-two");
    const keys = [keyRow("k1", first, 1), keyRow("k2", second, 2)];

    const upstreamAuth: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/rest/v1/")) return new Response("", { status: 204 });
        const auth = new Headers(init?.headers).get("authorization") ?? "";
        upstreamAuth.push(auth);
        if (auth.includes("key-one")) {
          return new Response(JSON.stringify({ error: { message: "invalid api key" } }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const outcome = await callWithRotation(ENV, PROVIDER, keys, (apiKey) =>
      Promise.resolve({ url: "https://api.example.com/v1/chat/completions", init: { method: "POST", headers: { Authorization: `Bearer ${apiKey}` } } }),
    );

    expect(outcome.failure).toBeUndefined();
    expect(outcome.response?.status).toBe(200);
    expect(outcome.keyIndex).toBe(2);
    expect(outcome.usedKeys).toBe(2);
    expect(upstreamAuth).toEqual(["Bearer key-one", "Bearer key-two"]);
  });

  it("does not retry a non-retryable error", async () => {
    const ciphertext = await encryptSecret(MASTER, "key-one");
    const keys = [keyRow("k1", ciphertext, 1), keyRow("k2", ciphertext, 2)];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/rest/v1/")) return new Response("", { status: 204 });
      return new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await callWithRotation(ENV, PROVIDER, keys, () =>
      Promise.resolve({ url: "https://api.example.com/v1/chat/completions", init: { method: "POST" } }),
    );
    expect(outcome.response).toBeUndefined();
    expect(outcome.failure?.status).toBe(400);
    expect(outcome.usedKeys).toBe(1);
  });

  it("returns a friendly failure when every key is cooling down", async () => {
    const ciphertext = await encryptSecret(MASTER, "key-one");
    const cooling: ProviderKeyRow = {
      ...keyRow("k1", ciphertext, 1),
      cooldown_until: new Date(Date.now() + 60_000).toISOString(),
    };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await callWithRotation(ENV, PROVIDER, [cooling], () =>
      Promise.resolve({ url: "https://api.example.com/v1/chat/completions", init: { method: "POST" } }),
    );
    expect(outcome.response).toBeUndefined();
    expect(outcome.failure?.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("key status", () => {
  it("reports ok, cooling and disabled", () => {
    const base = keyRow("k1", "v1.a.b", 1);
    expect(keyStatus(base)).toBe("ok");
    expect(keyStatus({ ...base, cooldown_until: new Date(Date.now() + 10_000).toISOString() })).toBe("cooling");
    expect(keyStatus({ ...base, enabled: false })).toBe("disabled");
  });

  it("summarizes healthy keys without exposing ciphertext", () => {
    const base = keyRow("k1", "v1.cipher.text", 1);
    const summary = summarizeProvider(PROVIDER, [
      base,
      { ...base, id: "k2", cooldown_until: new Date(Date.now() + 60_000).toISOString() },
    ]);
    expect(summary.keyCount).toBe(2);
    expect(summary.healthyKeys).toBe(1);
    expect(JSON.stringify(summary)).not.toContain("cipher");
  });
});
