// Comprehensive Vitest suite for the token-based credit system:
//   - Formula (short chat, medium/long message, project build, vision, deep research, model weights, caps)
//   - Atomic reservation under concurrent requests (no overspend)
//   - Mid-stream interruption (charges only produced tokens, releases remaining reservation)
//   - One-time 5-credit signup grant (`reason = 'signup_grant'`, idempotent across logins)
//   - Migration SQL invariants (tables, RLS, FOR UPDATE, unique user_id)

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAuth } from "../functions/api/_lib/auth";
import {
  calculateTokenCredits,
  DEFAULT_MAX_CREDITS_PER_REQUEST,
  DEFAULT_MIN_CREDITS_PER_REQUEST,
  DEFAULT_SIGNUP_CREDITS,
  estimateReservationCredits,
  estimateTokensFromLength,
  extractCreditPolicy,
  hasImagesInMessages,
  resolveModelWeight,
  resolveTaskWeight,
  roundCredits,
} from "../functions/api/_lib/credits";
import { encryptSecret } from "../functions/api/_lib/crypto";
import { handleServerChat, validateChatRequest, type ChatEnv } from "../functions/api/_lib/serverChat";

const MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const ENV: ChatEnv = {
  SUPABASE_URL: "https://credits-test.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  MASTER_ENCRYPTION_KEY: MASTER_KEY,
};

let ipSeq = 1;
function makeChatRequest(body: unknown, token = "jwt-user-1"): Request {
  ipSeq += 1;
  return new Request("https://app.example.com/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "cf-connecting-ip": `203.0.113.${(ipSeq % 240) + 1}`,
    },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// In-memory atomic Supabase credit store matching 0007_token_credits.sql RPCs
// ---------------------------------------------------------------------------
interface LedgerEntry {
  id: string;
  user_id: string;
  delta: number;
  reason: string;
  model_id: string | null;
  tokens_in: number;
  tokens_out: number;
}

interface ReservationRow {
  id: string;
  user_id: string;
  amount: number;
  status: "reserved" | "committed" | "released";
}

class MockCreditDb {
  profiles = new Map<string, { id: string; email: string; display_name: string; role: string; status: string; credits: number; daily_token_limit: null; monthly_token_limit: null; created_at: string; last_seen_at: string }>();
  userCredits = new Map<string, { user_id: string; balance: number; updated_at: string }>();
  ledger: LedgerEntry[] = [];
  reservations = new Map<string, ReservationRow>();
  settings = {
    id: true,
    signup_open: true,
    default_signup_credits: DEFAULT_SIGNUP_CREDITS,
    min_credits_per_request: DEFAULT_MIN_CREDITS_PER_REQUEST,
    max_credits_per_request: DEFAULT_MAX_CREDITS_PER_REQUEST,
    default_daily_token_limit: null as number | null,
    default_monthly_token_limit: null as number | null,
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  private idCounter = 0;

  ensureUserCredits(userId: string, signupCredits = this.settings.default_signup_credits) {
    const existing = this.userCredits.get(userId);
    if (existing) {
      return { balance: existing.balance, granted: false };
    }
    const grant = roundCredits(Math.max(0, signupCredits));
    this.userCredits.set(userId, { user_id: userId, balance: grant, updated_at: new Date().toISOString() });
    this.ledger.push({
      id: `led-${++this.idCounter}`,
      user_id: userId,
      delta: grant,
      reason: "signup_grant",
      model_id: null,
      tokens_in: 0,
      tokens_out: 0,
    });
    const prof = this.profiles.get(userId);
    if (prof) prof.credits = grant;
    return { balance: grant, granted: true };
  }

  reserve(userId: string, amount: number, minRequired: number) {
    const row = this.userCredits.get(userId);
    if (!row) {
      return { ok: false, reservation_id: null, reserved_amount: 0, available_balance: 0, balance: 0 };
    }
    let activeReserved = 0;
    for (const r of this.reservations.values()) {
      if (r.user_id === userId && r.status === "reserved") activeReserved += r.amount;
    }
    const available = roundCredits(Math.max(0, row.balance - activeReserved));
    const safeMin = roundCredits(Math.max(0, minRequired));
    const safeReq = roundCredits(Math.max(safeMin, amount));
    if (available < safeMin) {
      return {
        ok: false,
        reservation_id: null,
        reserved_amount: 0,
        available_balance: available,
        balance: row.balance,
      };
    }
    const hold = roundCredits(Math.min(safeReq, available));
    const resId = `res-${++this.idCounter}`;
    this.reservations.set(resId, { id: resId, user_id: userId, amount: hold, status: "reserved" });
    return {
      ok: true,
      reservation_id: resId,
      reserved_amount: hold,
      available_balance: roundCredits(Math.max(0, available - hold)),
      balance: row.balance,
    };
  }

  commit(
    reservationId: string,
    actualAmount: number,
    reason: string,
    modelId: string | null,
    tokensIn: number,
    tokensOut: number,
  ) {
    const res = this.reservations.get(reservationId);
    if (!res) return { charged: 0, balance: 0 };
    const uc = this.userCredits.get(res.user_id);
    if (!uc) return { charged: 0, balance: 0 };
    if (res.status !== "reserved") return { charged: 0, balance: uc.balance };
    const charge = roundCredits(Math.min(uc.balance, res.amount, Math.max(0, actualAmount)));
    if (charge > 0) {
      uc.balance = roundCredits(Math.max(0, uc.balance - charge));
      uc.updated_at = new Date().toISOString();
      const prof = this.profiles.get(res.user_id);
      if (prof) prof.credits = uc.balance;
      res.status = "committed";
      this.ledger.push({
        id: `led-${++this.idCounter}`,
        user_id: res.user_id,
        delta: -charge,
        reason,
        model_id: modelId,
        tokens_in: Math.max(0, Math.floor(tokensIn)),
        tokens_out: Math.max(0, Math.floor(tokensOut)),
      });
    } else {
      res.status = "released";
    }
    return { charged: charge, balance: uc.balance };
  }

  release(reservationId: string) {
    const res = this.reservations.get(reservationId);
    if (!res) return 0;
    if (res.status === "reserved") res.status = "released";
    return this.userCredits.get(res.user_id)?.balance ?? 0;
  }
}

function installCreditFetchMock(opts: {
  db: MockCreditDb;
  siteCiphertext: string;
  modelWeight?: number;
  upstreamHandler: (url: string, init?: RequestInit) => Promise<Response> | Response;
  userId?: string;
  userEmail?: string;
}) {
  const userId = opts.userId ?? "user-1";
  const userEmail = opts.userEmail ?? "user1@example.com";
  let upstreamCount = 0;

  const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url.startsWith(`${ENV.SUPABASE_URL}/auth/v1/user`)) {
      return new Response(
        JSON.stringify({ id: userId, email: userEmail, user_metadata: { full_name: "Test User" } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (url.startsWith(`${ENV.SUPABASE_URL}/rest/v1/`)) {
      const restPath = url.slice(`${ENV.SUPABASE_URL}/rest/v1/`.length);
      const method = (init?.method ?? "GET").toUpperCase();

      if (restPath.startsWith("profiles")) {
        if (method === "POST") {
          const rows = JSON.parse(String(init?.body ?? "[]")) as Array<Record<string, unknown>>;
          const row = rows[0];
          const id = String(row?.id ?? userId);
          if (opts.db.profiles.has(id)) {
            // Simulate ON CONFLICT DO NOTHING with Prefer: resolution=ignore-duplicates
            return new Response(JSON.stringify([]), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          const created = {
            id,
            email: String(row?.email ?? userEmail),
            display_name: String(row?.display_name ?? "Test User"),
            role: String(row?.role ?? "user"),
            status: "active",
            credits: typeof row?.credits === "number" ? row.credits : opts.db.settings.default_signup_credits,
            daily_token_limit: null,
            monthly_token_limit: null,
            created_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
          };
          opts.db.profiles.set(id, created);
          return new Response(JSON.stringify([created]), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
        }
        const existing = opts.db.profiles.get(userId);
        return new Response(JSON.stringify(existing ? [existing] : []), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (restPath.startsWith("app_settings?")) {
        return new Response(JSON.stringify([opts.db.settings]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (restPath.startsWith("rpc/ensure_user_credits")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { p_user: string; p_signup_credits?: number };
        const result = opts.db.ensureUserCredits(body.p_user, body.p_signup_credits);
        return new Response(JSON.stringify([result]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (restPath.startsWith("rpc/reserve_user_credits")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          p_user: string;
          p_amount: number;
          p_min_required: number;
        };
        const result = opts.db.reserve(body.p_user, body.p_amount, body.p_min_required);
        return new Response(JSON.stringify([result]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (restPath.startsWith("rpc/commit_credit_reservation")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          p_reservation_id: string;
          p_actual_amount: number;
          p_reason: string;
          p_model_id: string | null;
          p_tokens_in: number;
          p_tokens_out: number;
        };
        const result = opts.db.commit(
          body.p_reservation_id,
          body.p_actual_amount,
          body.p_reason,
          body.p_model_id,
          body.p_tokens_in,
          body.p_tokens_out,
        );
        return new Response(JSON.stringify([result]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (restPath.startsWith("rpc/release_credit_reservation")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { p_reservation_id: string };
        const balance = opts.db.release(body.p_reservation_id);
        return new Response(JSON.stringify(balance), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (restPath.startsWith("rpc/user_usage_totals")) {
        return new Response(JSON.stringify([{ input_tokens: 0, output_tokens: 0 }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (restPath.startsWith("usage_events")) {
        return new Response("", { status: 201 });
      }

      if (restPath.startsWith("catalog_models?")) {
        return new Response(
          JSON.stringify([
            {
              id: "site-model-1",
              display_name: "Site Base Model",
              upstream_id: "gpt-4o-mini",
              capabilities: ["text"],
              site_paid: false,
              model_weight: opts.modelWeight ?? 1.0,
              providers: {
                id: "site-prov-1",
                name: "Site OpenAI",
                base_url: "https://site-upstream.example.com/v1",
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
              },
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (restPath.startsWith("provider_keys?")) {
        return new Response(
          JSON.stringify([
            {
              id: "site-key-1",
              provider_id: "site-prov-1",
              ciphertext: opts.siteCiphertext,
              label: "Primary",
              enabled: true,
              cooldown_until: null,
              fail_count: 0,
              last_error: null,
              created_at: "2026-01-01T00:00:00.000Z",
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    upstreamCount += 1;
    return await opts.upstreamHandler(url, init);
  });

  vi.stubGlobal("fetch", mockFetch);
  return {
    get upstreamCount() {
      return upstreamCount;
    },
  };
}

// ===========================================================================
// 1. Formula tests
// ===========================================================================
describe("token credit formula", () => {
  it("charges minimum 0.5 credits for a short/simple chat question (10 messages on 5 credits)", () => {
    const shortChat = calculateTokenCredits({
      tokensIn: 80,
      tokensOut: 120,
      modelWeight: resolveModelWeight(1),
      taskWeight: resolveTaskWeight("chat"),
    });
    expect(shortChat).toBe(0.5);

    const mediumChat = calculateTokenCredits({
      tokensIn: 200,
      tokensOut: 300,
      modelWeight: resolveModelWeight(1),
      taskWeight: resolveTaskWeight("chat"),
    });
    expect(mediumChat).toBe(0.5);
  });

  it("scales upward for longer messages", () => {
    const longChat = calculateTokenCredits({
      tokensIn: 500,
      tokensOut: 1100,
      modelWeight: 1,
      taskWeight: resolveTaskWeight("chat"),
    });
    // 1600 / 1000 * 1 * 1 = 1.6 -> ceiled to 0.5 step = 2.0
    expect(longChat).toBe(2);
  });

  it("applies skill-derived task weights (website/game=1.5, deep_thinking=1.5, vision/image=1.2, chat=1.0)", () => {
    expect(resolveTaskWeight("chat")).toBe(1.0);
    expect(resolveTaskWeight("website")).toBe(1.5);
    expect(resolveTaskWeight("game")).toBe(1.5);
    expect(resolveTaskWeight("deep_thinking")).toBe(1.5);
    expect(resolveTaskWeight("vision")).toBe(1.2);
    expect(resolveTaskWeight("image_analysis")).toBe(1.2);
    expect(resolveTaskWeight("chat", { hasImages: true })).toBe(1.2);
    expect(resolveTaskWeight("other")).toBe(1.0);

    // Project build (website): 600 in + 1200 out = 1800 tokens * 1.0 * 1.5 = 2.7 -> 3.0 credits (capped at 3)
    const projectBuild = calculateTokenCredits({
      tokensIn: 600,
      tokensOut: 1200,
      modelWeight: 1,
      taskWeight: resolveTaskWeight("website"),
    });
    expect(projectBuild).toBe(3);

    // Image analysis: 400 in + 600 out = 1000 tokens * 1.0 * 1.2 = 1.2 -> 1.5 credits
    const visionTask = calculateTokenCredits({
      tokensIn: 400,
      tokensOut: 600,
      modelWeight: 1,
      taskWeight: resolveTaskWeight("chat", { hasImages: true }),
    });
    expect(visionTask).toBe(1.5);

    // Expensive model (weight=2) on medium chat (500 tokens): 0.5 * 2 * 1 = 1.0 credit
    const expensiveModel = calculateTokenCredits({
      tokensIn: 200,
      tokensOut: 300,
      modelWeight: resolveModelWeight(2),
      taskWeight: resolveTaskWeight("chat"),
    });
    expect(expensiveModel).toBe(1);
  });

  it("respects configurable min/max credit caps from app_settings", () => {
    const policy = extractCreditPolicy({
      default_signup_credits: 5,
      min_credits_per_request: 0.5,
      max_credits_per_request: 3,
    });
    // Very large project generation (5000 tokens * 1.5 = 7.5) is capped at 3 per request
    expect(
      calculateTokenCredits({
        tokensIn: 1500,
        tokensOut: 3500,
        modelWeight: 1,
        taskWeight: 1.5,
        policy,
      }),
    ).toBe(3);

    // Higher custom cap (e.g. 5) lets heavy single-shot project build reach 5 credits
    const raisedPolicy = extractCreditPolicy({
      min_credits_per_request: 0.5,
      max_credits_per_request: 5,
    });
    expect(
      calculateTokenCredits({
        tokensIn: 1000,
        tokensOut: 2200,
        modelWeight: 1,
        taskWeight: 1.5,
        policy: raisedPolicy,
      }),
    ).toBe(5);
  });

  it("estimates tokens by dividing text length by 4 when provider usage is absent", () => {
    expect(estimateTokensFromLength("")).toBe(0);
    expect(estimateTokensFromLength("abcd")).toBe(1);
    expect(estimateTokensFromLength("x".repeat(401))).toBe(101);
  });

  it("detects multimodal image messages and strips client-spoofed credit fields", () => {
    expect(
      hasImagesInMessages([
        { role: "user", content: [{ type: "text", text: "Describe" }, { type: "image_url", image_url: { url: "https://example.com/a.png" } }] },
      ]),
    ).toBe(true);
    expect(hasImagesInMessages([{ role: "user", content: "Just text" }])).toBe(false);

    const validated = validateChatRequest({
      model: "site-model-1",
      messages: [{ role: "user", content: "hi" }],
      credits: 0,
      modelWeight: 0.01,
      taskWeight: 0.01,
    });
    expect(validated.ok).toBe(true);
    if (validated.ok) {
      expect("credits" in validated.body).toBe(false);
      expect("modelWeight" in validated.body).toBe(false);
      expect("taskWeight" in validated.body).toBe(false);
    }
  });
});

// ===========================================================================
// 2. One-time 5-credit signup grant
// ===========================================================================
describe("one-time 5-credit signup grant", () => {
  it("grants exactly 5 credits once after first login with reason = 'signup_grant' and never resets on later logins", async () => {
    const db = new MockCreditDb();
    const siteCiphertext = await encryptSecret(MASTER_KEY, "sk-test-secret");
    installCreditFetchMock({
      db,
      siteCiphertext,
      userId: "new-google-user",
      userEmail: "newuser@gmail.com",
      upstreamHandler: () => new Response("{}", { status: 200 }),
    });

    // Two concurrent first-login requests race against resolveAuth
    const [ctx1, ctx2] = await Promise.all([
      resolveAuth(makeChatRequest({}, "jwt-google-1"), ENV),
      resolveAuth(makeChatRequest({}, "jwt-google-1"), ENV),
    ]);

    expect(ctx1?.profile.credits).toBe(5);
    expect(ctx2?.profile.credits).toBe(5);
    const grants = db.ledger.filter((e) => e.user_id === "new-google-user" && e.reason === "signup_grant");
    expect(grants).toHaveLength(1);
    expect(grants[0]?.delta).toBe(5);

    // Spend 1.5 credits, then sign in again — balance must remain 3.5 (never reset to 5)
    const r = db.reserve("new-google-user", 3, 0.5);
    expect(r.ok).toBe(true);
    db.commit(r.reservation_id!, 1.5, "chat_usage", "site-model-1", 400, 900);
    expect(db.userCredits.get("new-google-user")?.balance).toBe(3.5);

    const ctxLater = await resolveAuth(makeChatRequest({}, "jwt-google-1"), ENV);
    expect(ctxLater?.profile.credits).toBe(3.5);
    expect(db.ledger.filter((e) => e.reason === "signup_grant")).toHaveLength(1);
  });
});

// ===========================================================================
// 3. Atomic reservations under concurrent requests
// ===========================================================================
describe("atomic credit reservations under concurrent requests", () => {
  it("prevents concurrent requests from spending beyond available balance and rejects excess with 402 credits_exhausted", async () => {
    const db = new MockCreditDb();
    db.ensureUserCredits("user-1", 2.0);
    db.profiles.set("user-1", {
      id: "user-1",
      email: "user1@example.com",
      display_name: "User 1",
      role: "user",
      status: "active",
      credits: 2.0,
      daily_token_limit: null,
      monthly_token_limit: null,
      created_at: "2026-01-01T00:00:00.000Z",
      last_seen_at: new Date().toISOString(),
    });

    const siteCiphertext = await encryptSecret(MASTER_KEY, "sk-site-secret");

    // Hold upstream responses open until both accepted requests are in flight so
    // reservations definitely overlap concurrently.
    let releaseUpstream!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseUpstream = resolve;
    });

    const spy = installCreditFetchMock({
      db,
      siteCiphertext,
      upstreamHandler: async () => {
        await gate;
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "A".repeat(3200) }, finish_reason: "stop" }],
            usage: { prompt_tokens: 200, completion_tokens: 800 }, // 1000 tokens -> 1.0 credit
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    });

    // Each request asks max_tokens=800 with 200 prompt -> estimated reserve = 1.0 credit.
    // With 2.0 balance and 5 concurrent requests, at most 2 may reserve and run; 3 must fail 402.
    const pending = Array.from({ length: 5 }, () =>
      handleServerChat(
        makeChatRequest({
          model: "site-model-1",
          skillMode: "chat",
          max_tokens: 800,
          messages: [{ role: "user", content: "x".repeat(400) }],
          stream: false,
        }),
        ENV,
      ),
    );

    // Wait a brief tick for all 5 concurrent handlers to hit reserve_user_credits
    await new Promise((r) => setTimeout(r, 30));
    releaseUpstream();

    const responses = await Promise.all(pending);
    const okResponses = responses.filter((r) => r.status === 200);
    const exhaustedResponses = responses.filter((r) => r.status === 402);

    expect(okResponses).toHaveLength(2);
    expect(exhaustedResponses).toHaveLength(3);
    expect(spy.upstreamCount).toBe(2);
    expect(db.userCredits.get("user-1")?.balance).toBe(0);

    // Verify 402 payload includes credits_exhausted code and remaining count
    const errPayload = (await exhaustedResponses[0]!.json()) as {
      error: { code: string; remaining: number; message: string };
    };
    expect(errPayload.error.code).toBe("credits_exhausted");
    expect(errPayload.error.remaining).toBe(0);
    expect(errPayload.error.message).toMatch(/0 credits remaining/i);

    // All reservations must be finalized (none stuck in "reserved")
    const stuck = [...db.reservations.values()].filter((r) => r.status === "reserved");
    expect(stuck).toHaveLength(0);
  });

  it("releases the full reservation when upstream fails (0 credits charged)", async () => {
    const db = new MockCreditDb();
    db.ensureUserCredits("user-1", 5.0);
    db.profiles.set("user-1", {
      id: "user-1",
      email: "user1@example.com",
      display_name: "User 1",
      role: "user",
      status: "active",
      credits: 5.0,
      daily_token_limit: null,
      monthly_token_limit: null,
      created_at: "2026-01-01T00:00:00.000Z",
      last_seen_at: new Date().toISOString(),
    });
    const siteCiphertext = await encryptSecret(MASTER_KEY, "sk-site-secret");
    installCreditFetchMock({
      db,
      siteCiphertext,
      upstreamHandler: () => new Response("upstream down", { status: 503 }),
    });

    const res = await handleServerChat(
      makeChatRequest({
        model: "site-model-1",
        skillMode: "chat",
        messages: [{ role: "user", content: "Hello" }],
        stream: false,
      }),
      ENV,
    );

    expect(res.status).toBe(503);
    expect(db.userCredits.get("user-1")?.balance).toBe(5.0);
    const allRes = [...db.reservations.values()];
    expect(allRes).toHaveLength(1);
    expect(allRes[0]?.status).toBe("released");
  });
});

// ===========================================================================
// 4. Mid-stream interruption
// ===========================================================================
describe("mid-stream interruption accounting", () => {
  it("charges only for tokens generated before client abort and releases the rest of the reservation", async () => {
    const db = new MockCreditDb();
    db.ensureUserCredits("user-1", 5.0);
    db.profiles.set("user-1", {
      id: "user-1",
      email: "user1@example.com",
      display_name: "User 1",
      role: "user",
      status: "active",
      credits: 5.0,
      daily_token_limit: null,
      monthly_token_limit: null,
      created_at: "2026-01-01T00:00:00.000Z",
      last_seen_at: new Date().toISOString(),
    });

    const siteCiphertext = await encryptSecret(MASTER_KEY, "sk-site-secret");
    const encoder = new TextEncoder();

    installCreditFetchMock({
      db,
      siteCiphertext,
      upstreamHandler: () => {
        // Produce one 400-char chunk (~100 output tokens), then pause until cancelled
        let chunkSent = false;
        const body = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (!chunkSent) {
              chunkSent = true;
              const event = `data: ${JSON.stringify({ choices: [{ delta: { content: "x".repeat(400) } }] })}\n\n`;
              controller.enqueue(encoder.encode(event));
            }
          },
        });
        return new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/event-stream; charset=utf-8" },
        });
      },
    });

    // Reserve ceiling is 3.0 credits (max_tokens=4096, website skill weight=1.5),
    // but stream gets aborted after ~100 output tokens + ~5 input tokens -> 105 * 1.5 / 1000 = 0.1575 -> 0.5 credits!
    expect(
      estimateReservationCredits({
        promptTokens: 5,
        maxTokens: 4096,
        modelWeight: 1,
        taskWeight: 1.5,
      }),
    ).toBe(3);

    const res = await handleServerChat(
      makeChatRequest({
        model: "site-model-1",
        skillMode: "website",
        max_tokens: 4096,
        messages: [{ role: "user", content: "Build a landing page" }],
        stream: true,
      }),
      ENV,
    );

    expect(res.status).toBe(200);
    // While stream is open, 3.0 credits are reserved in credit_reservations
    const activeRes = [...db.reservations.values()][0];
    expect(activeRes?.amount).toBe(3);
    expect(activeRes?.status).toBe("reserved");

    // Read the first chunk, then cancel mid-stream (Stop button)
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    await reader.cancel("user_stopped");

    // Only 0.5 credits deducted (NOT the 3.0 cap); remaining 4.5 credits free immediately
    expect(db.userCredits.get("user-1")?.balance).toBe(4.5);
    expect(activeRes?.status).toBe("committed");

    const usageEntry = db.ledger.find((e) => e.reason === "chat_stream_partial");
    expect(usageEntry).toBeDefined();
    expect(usageEntry?.delta).toBe(-0.5);
    expect(usageEntry?.tokens_out).toBe(100);
  });

  it("uses text-length / 4 fallback when non-streaming provider omits usage", async () => {
    const db = new MockCreditDb();
    db.ensureUserCredits("user-1", 5.0);
    db.profiles.set("user-1", {
      id: "user-1",
      email: "user1@example.com",
      display_name: "User 1",
      role: "user",
      status: "active",
      credits: 5.0,
      daily_token_limit: null,
      monthly_token_limit: null,
      created_at: "2026-01-01T00:00:00.000Z",
      last_seen_at: new Date().toISOString(),
    });
    const siteCiphertext = await encryptSecret(MASTER_KEY, "sk-site-secret");
    installCreditFetchMock({
      db,
      siteCiphertext,
      upstreamHandler: () =>
        new Response(
          JSON.stringify({
            // No `usage` field returned by upstream!
            choices: [{ message: { content: "A".repeat(4800) }, finish_reason: "stop" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    });

    const res = await handleServerChat(
      makeChatRequest({
        model: "site-model-1",
        skillMode: "chat",
        messages: [{ role: "user", content: "Write an essay" }],
        stream: false,
      }),
      ENV,
    );

    expect(res.status).toBe(200);
    // 4800 / 4 = 1200 output tokens + ~4 input tokens = 1204 tokens -> 1.5 credits
    expect(res.headers.get("X-Credits-Charged")).toBe("1.5");
    expect(res.headers.get("X-Credits-Remaining")).toBe("3.5");
    const entry = db.ledger.find((e) => e.reason === "chat_usage");
    expect(entry?.tokens_out).toBe(1200);
    expect(entry?.delta).toBe(-1.5);
  });
});

// ===========================================================================
// 5. SQL Migration invariants (0007_token_credits.sql)
// ===========================================================================
describe("0007_token_credits.sql migration invariants", () => {
  it("defines required tables, RLS policies, unique signup grant, and FOR UPDATE atomic reservation", () => {
    const sql = readFileSync(
      path.resolve(process.cwd(), "supabase/migrations/0007_token_credits.sql"),
      "utf8",
    ).toLowerCase();

    expect(sql).toContain("create table if not exists public.user_credits");
    expect(sql).toContain("user_id uuid primary key");
    expect(sql).toContain("create table if not exists public.credit_ledger");
    expect(sql).toContain("create table if not exists public.credit_reservations");
    expect(sql).toContain("status text not null default 'reserved' check (status in ('reserved', 'committed', 'released'))");
    expect(sql).toContain("add column if not exists model_weight");
    expect(sql).toContain("add column if not exists min_credits_per_request");
    expect(sql).toContain("add column if not exists max_credits_per_request");

    // RLS: read own for user_credits & credit_ledger; revoke all writes from authenticated/anon
    expect(sql).toContain("alter table public.user_credits enable row level security");
    expect(sql).toContain("alter table public.credit_ledger enable row level security");
    expect(sql).toContain("alter table public.credit_reservations enable row level security");
    expect(sql).toContain("revoke all on public.user_credits from public, anon, authenticated");
    expect(sql).toContain("revoke all on public.credit_ledger from public, anon, authenticated");
    expect(sql).toContain("revoke all on public.credit_reservations from public, anon, authenticated");
    expect(sql).toContain("grant select on public.user_credits to authenticated");
    expect(sql).toContain("grant select on public.credit_ledger to authenticated");

    // Atomic locking & idempotent one-time signup grant
    expect(sql).toContain("for update");
    expect(sql).toContain("on conflict (user_id) do nothing");
    expect(sql).toContain("'signup_grant'");
    expect(sql).toContain("grant execute on function public.reserve_user_credits");
    expect(sql).toContain("to service_role");
  });
});
