// Tests for coarenaPool.test; add or update cases here to match observable behavior.
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCoarena } from "../functions/api/coarenaHandler";
import { markFailure, markSuccess, parseKeys, poolStatus, scrubKeys, selectKey } from "../functions/api/coarenaPool";

const KEY_A = "coa_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const KEY_B = "coa_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

afterEach(() => {
  markSuccess(KEY_A);
  markSuccess(KEY_B);
  vi.unstubAllGlobals();
});

describe("Coarena key parsing", () => {
  it("accepts comma, semicolon, and newline separated keys and drops junk", () => {
    const env = { COARENA_KEYS: `${KEY_A}, ${KEY_B};\nnope, ${KEY_A}` };
    expect(parseKeys(env)).toEqual([KEY_A, KEY_B]);
  });

  it("returns an empty pool when unset", () => {
    expect(parseKeys({})).toEqual([]);
  });
});

describe("Coarena pool health", () => {
  it("selects the first healthy key and rotates after a failure", () => {
    const env = { COARENA_KEYS: `${KEY_A},${KEY_B}` };
    expect(selectKey(env)).toBe(KEY_A);

    markFailure(KEY_A, "auth", 60_000);
    expect(selectKey(env)).toBe(KEY_B);

    const status = poolStatus(env);
    expect(status.total).toBe(2);
    expect(status.healthy).toBe(1);
    expect(status.keys.map((key) => key.status)).toEqual(["cooling", "ok"]);
    expect(JSON.stringify(status)).not.toContain("coa_");
  });

  it("returns null when every key is cooling down", () => {
    const env = { COARENA_KEYS: `${KEY_A},${KEY_B}` };
    markFailure(KEY_A, "quota", 60_000);
    markFailure(KEY_B, "quota", 60_000);
    expect(selectKey(env)).toBeNull();
  });

  it("scrubs key values from upstream text", () => {
    const env = { COARENA_KEYS: KEY_A };
    expect(scrubKeys(`bad key ${KEY_A} here`, env)).toBe("bad key [redacted] here");
  });
});

describe("Coarena handler", () => {
  it("reports pool status without keys", async () => {
    const response = await handleCoarena(new Request("http://localhost/api/coarena/status"), {
      COARENA_KEYS: `${KEY_A},${KEY_B}`,
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: { total: number; healthy: number } };
    expect(payload.data.total).toBe(2);
    expect(payload.data.healthy).toBe(2);
    expect(JSON.stringify(payload)).not.toContain("coa_");
  });

  it("rejects an unknown model before calling upstream", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await handleCoarena(
      new Request("http://localhost/api/coarena/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "made-up-model", messages: [{ role: "user", content: "hi" }] }),
      }),
      { COARENA_KEYS: KEY_A },
    );
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("replays the same request silently with the next key on 401", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push((init.headers as Headers).get("Authorization") ?? "");
        if (calls.length === 1) {
          return new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 });
        }
        return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const response = await handleCoarena(
      new Request("http://localhost/api/coarena/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-6-luna",
          messages: [{ role: "user", content: "hi" }],
        }),
      }),
      { COARENA_KEYS: `${KEY_A},${KEY_B}` },
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([`Bearer ${KEY_A}`, `Bearer ${KEY_B}`]);
  });

  it("returns one friendly error when every key fails, with no key details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { message: `bad ${KEY_A} ${KEY_B}` } }), { status: 401 })),
    );
    const response = await handleCoarena(
      new Request("http://localhost/api/coarena/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-6-luna",
          messages: [{ role: "user", content: "hi" }],
        }),
      }),
      { COARENA_KEYS: `${KEY_A},${KEY_B}` },
    );
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).not.toContain("coa_");
    expect(text).toMatch(/temporarily unavailable/i);
  });
});
