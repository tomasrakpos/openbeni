// Tests for usage.test; add or update cases here to match observable behavior.
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkQuota, estimateMessageTokens, estimateTokens, limitsFor, recordUsage } from "../functions/api/_lib/usage";
import type { AppSettingsRow, ProfileRow } from "../functions/api/_lib/auth";

const ENV = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role-test" };

const PROFILE: ProfileRow = {
  id: "user-1",
  email: "user@example.com",
  display_name: "User",
  role: "user",
  status: "active",
  daily_token_limit: null,
  monthly_token_limit: null,
  created_at: "2026-01-01T00:00:00.000Z",
  last_seen_at: "2026-01-01T00:00:00.000Z",
};

const SETTINGS: AppSettingsRow = {
  id: true,
  signup_open: true,
  default_daily_token_limit: null,
  default_monthly_token_limit: null,
  updated_at: "2026-01-01T00:00:00.000Z",
};

function mockUsage(input: number, output: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify([{ input_tokens: input, output_tokens: output }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("token estimates", () => {
  it("counts text roughly and never returns zero for non-empty input", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(40))).toBe(10);
  });

  it("sums message text only", () => {
    const estimate = estimateMessageTokens([
      { role: "user", content: "hello world" },
      { role: "assistant", content: "hi there" },
    ]);
    expect(estimate).toBeGreaterThan(0);
    expect(estimate).toBeLessThan(20);
  });
});

describe("quota decisions", () => {
  it("prefers per-user limits over the defaults", () => {
    expect(limitsFor({ ...PROFILE, daily_token_limit: 1000 }, { ...SETTINGS, default_daily_token_limit: 5 })).toEqual({
      daily: 1000,
      monthly: null,
    });
  });

  it("allows a user under a limit", async () => {
    mockUsage(100, 100);
    const result = await checkQuota(ENV, PROFILE, { ...SETTINGS, default_daily_token_limit: 10_000 });
    expect(result.allowed).toBe(true);
    expect(result.dailyUsed).toBe(200);
  });

  it("blocks a user over the daily limit", async () => {
    mockUsage(400, 400);
    const result = await checkQuota(ENV, PROFILE, { ...SETTINGS, default_daily_token_limit: 500 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("daily");
  });

  it("blocks a blocked profile regardless of usage", async () => {
    mockUsage(0, 0);
    const result = await checkQuota(ENV, { ...PROFILE, status: "blocked" }, SETTINGS);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("blocked");
  });

  it("fails open when the totals cannot be read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    const result = await checkQuota(ENV, PROFILE, { ...SETTINGS, default_daily_token_limit: 10 });
    expect(result.allowed).toBe(true);
    expect(result.dailyUsed).toBe(0);
  });
});

describe("usage recording", () => {
  it("posts metadata only, never message text", async () => {
    let body = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        body = String(init?.body ?? "");
        return new Response("", { status: 201 });
      }),
    );
    await recordUsage(ENV, {
      user_id: "user-1",
      provider_id: "prov-1",
      model_id: "model-1",
      model_name: "Model",
      provider_name: "Provider",
      prompt_tokens: 12,
      completion_tokens: 34,
      status: "ok",
      latency_ms: 120,
    });
    const payload = JSON.parse(body) as Record<string, unknown>[];
    expect(payload[0]).toMatchObject({ prompt_tokens: 12, completion_tokens: 34, status: "ok" });
    expect(body).not.toContain("messages");
    expect(body).not.toContain("content");
  });
});
