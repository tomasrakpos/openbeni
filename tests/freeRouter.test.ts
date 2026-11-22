import { describe, expect, it } from "vitest";
import { classifyModelTier } from "../functions/api/_lib/providerInspector";
import {
  executeWithRouterFailover,
  filterFreeEligibleModels,
  isRetryableRouterFailure,
  isRetryableRouterStatus,
  ROUTER_MAX_FAILOVER_ATTEMPTS,
  RouterScheduler,
  validateRouterName,
  type RouterMemberCandidate,
} from "../src/lib/routerEngine";
import { buildComposerModels } from "../src/features/chat/modelOptions";
import type { CombinedRouterItem } from "../src/stores/routers";

describe("Free/Paid/Unknown pricing classification", () => {
  it("labels models with zero API pricing metadata as free", () => {
    const res = classifyModelTier(
      { id: "vendor/model-a", displayName: "Model A", pricing: { prompt: 0, completion: 0 } },
      "https://api.custom-gateway.example/v1",
    );
    expect(res.tier).toBe("free");
    expect(res.tierSource).toBe("pricing_metadata");
  });

  it("labels models with non-zero API pricing metadata as paid", () => {
    const res = classifyModelTier(
      { id: "vendor/model-b", displayName: "Model B", pricing: { prompt: 0.5, completion: 1.5 } },
      "https://api.custom-gateway.example/v1",
    );
    expect(res.tier).toBe("paid");
    expect(res.tierSource).toBe("pricing_metadata");
  });

  it("labels official :free model tags as free", () => {
    const res = classifyModelTier(
      { id: "meta-llama/llama-3.3-70b-instruct:free", displayName: "Llama 3.3 Free" },
      "https://openrouter.ai/api/v1",
    );
    expect(res.tier).toBe("free");
    expect(res.tierSource).toBe("model_tag");
  });

  it("labels unrecognized custom providers with no pricing metadata as unknown (never guesses free)", () => {
    const res = classifyModelTier(
      { id: "acme-7b-chat", displayName: "Acme 7B Chat" },
      "https://api.unknown-vendor-no-pricing.example/v1",
    );
    expect(res.tier).toBe("unknown");
    expect(res.tierSource).toBe("unknown");
  });

  it("labels known paid-only providers (OpenAI / Anthropic) as paid", () => {
    expect(
      classifyModelTier({ id: "gpt-4o", displayName: "GPT-4o" }, "https://api.openai.com/v1").tier,
    ).toBe("paid");
    expect(
      classifyModelTier({ id: "claude-sonnet-4-5", displayName: "Claude Sonnet" }, "https://api.anthropic.com/v1").tier,
    ).toBe("paid");
  });
});

describe("Router name validation", () => {
  const existingRouters = ["Fast Free", "روتر سریع"];
  const existingModels = ["gpt-4o-mini", "Llama 3.3 70B"];

  it("rejects empty, too short (<2), and too long (>32) names", () => {
    expect(validateRouterName("").code).toBe("empty");
    expect(validateRouterName("   ").code).toBe("empty");
    expect(validateRouterName("a").code).toBe("too_short");
    expect(validateRouterName("x".repeat(33)).code).toBe("too_long");
  });

  it("rejects names containing ASCII or Unicode control characters", () => {
    expect(validateRouterName("Free\nRouter").code).toBe("control_chars");
    expect(validateRouterName("Free\tRouter").code).toBe("control_chars");
    expect(validateRouterName("Free\u0000Router").code).toBe("control_chars");
    expect(validateRouterName("Free\u007FRouter").code).toBe("control_chars");
  });

  it("rejects case-insensitive duplicates within owner scope", () => {
    const dupEn = validateRouterName("  fast free  ", { existingRouterNames: existingRouters });
    expect(dupEn.ok).toBe(false);
    expect(dupEn.code).toBe("duplicate_name");

    const dupFa = validateRouterName("روتر سریع", { existingRouterNames: existingRouters });
    expect(dupFa.ok).toBe(false);
    expect(dupFa.code).toBe("duplicate_name");
  });

  it("rejects collisions with real model IDs or display names", () => {
    const hitId = validateRouterName("GPT-4O-MINI", { existingModelNames: existingModels });
    expect(hitId.ok).toBe(false);
    expect(hitId.code).toBe("collides_with_model");

    const hitDisplay = validateRouterName("llama 3.3 70b", { existingModelNames: existingModels });
    expect(hitDisplay.ok).toBe(false);
    expect(hitDisplay.code).toBe("collides_with_model");
  });

  it("accepts valid 2–32 character English and Persian router names", () => {
    const okEn = validateRouterName("  OpenRouter Free Pool  ", {
      existingRouterNames: existingRouters,
      existingModelNames: existingModels,
    });
    expect(okEn.ok).toBe(true);
    expect(okEn.normalized).toBe("OpenRouter Free Pool");

    const okFa = validateRouterName("روتر مدل‌های رایگان", {
      existingRouterNames: existingRouters,
      existingModelNames: existingModels,
    });
    expect(okFa.ok).toBe(true);
    expect(okFa.normalized).toBe("روتر مدل‌های رایگان");
  });
});

describe("Strict exclusion of paid and unknown models from free routers", () => {
  it("admits only enabled, unlocked models with pricing === 'free'", () => {
    const candidates: RouterMemberCandidate[] = [
      { id: "m-free-1", modelId: "free-1", pricing: "free", enabled: true, position: 1 },
      { id: "m-paid", modelId: "paid-1", pricing: "paid", enabled: true, position: 2 },
      { id: "m-unknown", modelId: "unknown-1", pricing: "unknown", enabled: true, position: 3 },
      { id: "m-disabled", modelId: "free-disabled", pricing: "free", enabled: false, position: 4 },
      { id: "m-locked", modelId: "free-locked", pricing: "free", enabled: true, locked: true, position: 5 },
      { id: "m-prov-off", modelId: "free-prov-off", pricing: "free", enabled: true, providerEnabled: false, position: 6 },
      { id: "m-free-2", modelId: "free-2", pricing: "free", enabled: true, position: 0 },
    ];

    const eligible = filterFreeEligibleModels(candidates);
    expect(eligible.map((m) => m.id)).toEqual(["m-free-2", "m-free-1"]);
    expect(eligible.some((m) => m.pricing === "paid" || m.pricing === "unknown")).toBe(false);
  });

  it("renders empty routers as disabled in the composer model options", () => {
    const routers: CombinedRouterItem[] = [
      {
        id: "r-empty",
        selectionId: "router::r-empty",
        ownerScope: "public",
        source: "server",
        providerId: "p1",
        providerName: "OpenHarneks",
        name: "Empty Pool",
        type: "free",
        enabled: true,
        activeMemberCount: 0,
        memberModelIds: [],
        capabilities: ["text"],
        billingSource: "site",
      },
      {
        id: "r-live",
        selectionId: "router::r-live",
        ownerScope: "public",
        source: "server",
        providerId: "p1",
        providerName: "OpenHarneks",
        name: "Live Pool",
        type: "free",
        enabled: true,
        activeMemberCount: 2,
        memberModelIds: ["m1", "m2"],
        capabilities: ["text"],
        billingSource: "site",
      },
    ];
    const options = buildComposerModels([], [], routers, "en");
    const emptyOpt = options.find((o) => o.id === "router::r-empty");
    const liveOpt = options.find((o) => o.id === "router::r-live");
    expect(emptyOpt?.isRouter).toBe(true);
    expect(emptyOpt?.disabled).toBe(true);
    expect(liveOpt?.isRouter).toBe(true);
    expect(liveOpt?.disabled).toBe(false);
  });
});

describe("Round-robin rotation and short-term priority for last successful model", () => {
  const members = [{ id: "m1" }, { id: "m2" }, { id: "m3" }];

  it("distributes healthy requests evenly via Round-robin", () => {
    const scheduler = new RouterScheduler({ stickyWindowMs: 30_000, cooldownMs: 60_000 });
    const now = 1_000_000;
    const first = scheduler.nextOrder("r1", members, now);
    const second = scheduler.nextOrder("r1", members, now + 100);
    const third = scheduler.nextOrder("r1", members, now + 200);
    const fourth = scheduler.nextOrder("r1", members, now + 300);

    expect([first[0]!.id, second[0]!.id, third[0]!.id, fourth[0]!.id]).toEqual([
      "m1",
      "m2",
      "m3",
      "m1",
    ]);
  });

  it("gives short-term priority to the last successful model after failover and resumes Round-robin once window expires", () => {
    const scheduler = new RouterScheduler({ stickyWindowMs: 10_000, cooldownMs: 10_000 });
    let clock = 2_000_000;

    // m1 fails, failover succeeds on m2
    scheduler.recordFailure("r1", "m1", 10_000, clock);
    scheduler.recordSuccess("r1", "m2", { viaFailover: true, now: clock });

    // Within the short sticky window, m2 stays prioritized first
    const immediate = scheduler.nextOrder("r1", members, clock + 1_000);
    expect(immediate[0]!.id).toBe("m2");

    // Once sticky window & cooldown expire, Round-robin resumes across all members
    clock += 15_000;
    const picks = [
      scheduler.nextOrder("r1", members, clock)[0]!.id,
      scheduler.nextOrder("r1", members, clock + 100)[0]!.id,
      scheduler.nextOrder("r1", members, clock + 200)[0]!.id,
    ];
    expect(new Set(picks)).toEqual(new Set(["m1", "m2", "m3"]));
  });
});

describe("Router failover (max 3 attempts & no mid-stream restart)", () => {
  it("classifies 401, 403, 404, 429, 5xx, timeout, and network failures as retryable", () => {
    for (const status of [401, 403, 404, 429, 500, 502, 503, 504]) {
      expect(isRetryableRouterStatus(status)).toBe(true);
      expect(isRetryableRouterFailure({ status, message: "err" })).toBe(true);
    }
    expect(isRetryableRouterStatus(400)).toBe(false);
    expect(isRetryableRouterFailure({ timeout: true, message: "timed out" })).toBe(true);
    expect(isRetryableRouterFailure({ network: true, message: "fetch failed" })).toBe(true);
  });

  it("automatically fails over across retryable pre-stream errors up to 3 attempts", async () => {
    const scheduler = new RouterScheduler();
    const members = [{ id: "m1" }, { id: "m2" }, { id: "m3" }, { id: "m4" }];
    const tried: string[] = [];

    const result = await executeWithRouterFailover({
      routerId: "r-failover",
      members,
      scheduler,
      execute: async (member) => {
        tried.push(member.id);
        if (member.id === "m1") {
          return { ok: false, error: { status: 429, message: "Rate limited" } };
        }
        if (member.id === "m2") {
          return { ok: false, error: { status: 503, message: "Service unavailable" } };
        }
        return { ok: true, value: `answer from ${member.id}` };
      },
    });

    expect(result.ok).toBe(true);
    expect(result.value).toBe("answer from m3");
    expect(result.usedMember?.id).toBe("m3");
    expect(tried).toEqual(["m1", "m2", "m3"]);
    expect(result.attempts).toHaveLength(3);
  });

  it("caps failover strictly at 3 attempts and returns a clear error when all 3 fail", async () => {
    const scheduler = new RouterScheduler();
    const members = [{ id: "m1" }, { id: "m2" }, { id: "m3" }, { id: "m4" }, { id: "m5" }];
    const tried: string[] = [];

    const result = await executeWithRouterFailover({
      routerId: "r-cap",
      members,
      scheduler,
      maxAttempts: ROUTER_MAX_FAILOVER_ATTEMPTS,
      execute: async (member) => {
        tried.push(member.id);
        return { ok: false, error: { status: 502, message: `Bad gateway on ${member.id}` } };
      },
    });

    expect(result.ok).toBe(false);
    expect(result.midStreamInterrupted).toBe(false);
    expect(tried).toHaveLength(3);
    expect(result.attempts).toHaveLength(3);
    expect(result.error).toContain("All 3 router attempts failed");
  });

  it("NEVER restarts on another model if streaming already started and dropped mid-stream", async () => {
    const scheduler = new RouterScheduler();
    const members = [{ id: "m1" }, { id: "m2" }, { id: "m3" }];
    const tried: string[] = [];

    const result = await executeWithRouterFailover({
      routerId: "r-midstream",
      members,
      scheduler,
      execute: async (member, { markStreamStarted }) => {
        tried.push(member.id);
        // First output token delivered to user
        markStreamStarted();
        // Connection drops mid-stream
        return { ok: false, error: { status: 502, message: "Stream dropped mid-response" } };
      },
    });

    expect(result.ok).toBe(false);
    expect(result.midStreamInterrupted).toBe(true);
    expect(tried).toEqual(["m1"]);
    expect(result.attempts).toHaveLength(1);
  });
});
