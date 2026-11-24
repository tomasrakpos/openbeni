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
import {
  buildCombinedRouters,
  eligibleFreeModelsForLocalProviders,
  isAdminPublicRouter,
  localRouterProviderIds,
  type CombinedRouterItem,
  type LocalUserRouter,
  type PublicRouterItem,
} from "../src/stores/routers";
import type { AIModel, Provider } from "../src/lib/types";

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
    // Admin public routers appear as native OpenHarneks models (never as routers)
    expect(emptyOpt?.isRouter).toBe(false);
    expect(emptyOpt?.isNativeBrand).toBe(true);
    expect(emptyOpt?.note).toBe("OpenHarneks");
    expect(emptyOpt?.disabled).toBe(true);
    expect(liveOpt?.isRouter).toBe(false);
    expect(liveOpt?.isNativeBrand).toBe(true);
    expect(liveOpt?.label).toBe("Live Pool");
    expect(liveOpt?.note).toBe("OpenHarneks");
    expect(liveOpt?.routerActiveCount).toBeUndefined();
    expect(liveOpt?.disabled).toBe(false);
  });

  it("keeps personal user routers with standard Router UI while disguising admin routers as native OpenHarneks models", () => {
    const routers: CombinedRouterItem[] = [
      {
        id: "admin-r1",
        selectionId: "router::admin-r1",
        ownerScope: "public",
        source: "server",
        providerName: "OpenHarneks",
        name: "Harness Pro",
        type: "free",
        enabled: true,
        activeMemberCount: 4,
        memberModelIds: [],
        capabilities: ["text"],
        billingSource: "site",
      },
      {
        id: "user-r1",
        selectionId: "router::user-r1",
        ownerScope: "user",
        source: "local",
        providerId: "byok-1",
        providerName: "My Groq",
        name: "My Free Router",
        type: "free",
        enabled: true,
        activeMemberCount: 3,
        memberModelIds: ["m1", "m2", "m3"],
        capabilities: ["text"],
        billingSource: "byok",
      },
    ];
    const options = buildComposerModels([], [], routers, "en");
    const adminOpt = options.find((o) => o.id === "router::admin-r1");
    const userOpt = options.find((o) => o.id === "router::user-r1");

    expect(adminOpt).toMatchObject({
      label: "Harness Pro",
      note: "OpenHarneks",
      isRouter: false,
      isNativeBrand: true,
      userAdded: false,
      disabled: false,
    });
    expect(adminOpt?.routerActiveCount).toBeUndefined();

    expect(userOpt).toMatchObject({
      label: "My Free Router",
      note: "3 active",
      isRouter: true,
      userAdded: true,
      routerActiveCount: 3,
      disabled: false,
    });
    expect(userOpt?.isNativeBrand).toBeUndefined();
  });

  it("strips underlying provider id, provider name, and member model ids for admin public routers in buildCombinedRouters", () => {
    const rawPublic: PublicRouterItem[] = [
      {
        id: "admin-stealth",
        ownerScope: "public",
        source: "server",
        providerId: "secret-openrouter-uuid",
        userProviderId: null,
        providerName: "OpenRouter",
        name: "Harneks Fast",
        type: "free",
        enabled: true,
        activeMemberCount: 5,
        memberModelIds: ["secret-llama-id", "secret-gemma-id"],
        capabilities: ["text"],
        billingSource: "site",
        consumesCredits: true,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ];
    const combined = buildCombinedRouters(rawPublic, [], [], []);
    expect(combined).toHaveLength(1);
    expect(isAdminPublicRouter(combined[0])).toBe(true);
    expect(combined[0]?.providerId).toBeNull();
    expect(combined[0]?.providerName).toBe("OpenHarneks");
    expect(combined[0]?.memberModelIds).toEqual([]);
    expect(combined[0]?.activeMemberCount).toBe(5);
    expect(combined[0]?.name).toBe("Harneks Fast");
  });

  it("keeps hidden (catalog-disabled) verified free models eligible for admin routers while still excluding paid/unverified models", () => {
    const adminProviderModels = [
      { id: "m-hidden-free", modelId: "vendor/free-a:free", pricing: "free" as const, catalogEnabled: false, upstreamVerified: true, sitePaid: false },
      { id: "m-visible-free", modelId: "vendor/free-b:free", pricing: "free" as const, catalogEnabled: true, upstreamVerified: true, sitePaid: false },
      { id: "m-hidden-paid", modelId: "vendor/paid-c", pricing: "paid" as const, catalogEnabled: false, upstreamVerified: true, sitePaid: true },
      { id: "m-unverified-free", modelId: "vendor/unverified:free", pricing: "free" as const, catalogEnabled: false, upstreamVerified: false, sitePaid: false },
    ];
    const eligible = filterFreeEligibleModels(
      adminProviderModels.map((m, idx) => ({
        id: m.id,
        modelId: m.modelId,
        pricing: m.pricing,
        enabled: m.upstreamVerified,
        locked: m.sitePaid,
        position: idx,
      })),
    );
    expect(eligible.map((m) => m.id)).toEqual(["m-hidden-free", "m-visible-free"]);
  });
});

describe("Multi-provider Free Model Routers (Admin & User)", () => {
  const makeProvider = (id: string, name: string, enabled = true): Provider => ({
    id,
    name,
    baseUrl: `https://api.${id}.example/v1`,
    apiFormat: "openai",
    auth: { header: "Authorization", prefix: "Bearer " },
    extraHeaders: {},
    timeoutMs: 30_000,
    useProxy: false,
    enabled,
    favorite: false,
    order: 0,
    paths: {},
    hasKey: true,
    createdAt: 1,
    updatedAt: 1,
  });

  const makeModel = (
    id: string,
    providerId: string,
    pricingTier: "free" | "paid" | "unknown",
    enabled = true,
  ): AIModel => ({
    id,
    providerId,
    modelId: `${providerId}/${id}`,
    displayName: `${providerId} ${id}`,
    capabilities: ["text"],
    tier: pricingTier,
    pricingTier,
    enabled,
    favorite: false,
    order: 0,
    source: "api",
    createdAt: 1,
    updatedAt: 1,
  });

  it("pools 80 verified free models across 3 providers while excluding paid/unknown/disabled models", () => {
    const p1 = makeProvider("p1", "OpenRouter");
    const p2 = makeProvider("p2", "Groq");
    const p3 = makeProvider("p3", "Nvidia");

    const models: AIModel[] = [
      ...Array.from({ length: 30 }, (_, i) => makeModel(`p1-free-${i}`, "p1", "free")),
      ...Array.from({ length: 20 }, (_, i) => makeModel(`p2-free-${i}`, "p2", "free")),
      ...Array.from({ length: 30 }, (_, i) => makeModel(`p3-free-${i}`, "p3", "free")),
      // Noise that must be excluded
      makeModel("p1-paid", "p1", "paid"),
      makeModel("p2-unknown", "p2", "unknown"),
      makeModel("p3-disabled", "p3", "free", false),
    ];

    const eligible = eligibleFreeModelsForLocalProviders([p1, p2, p3], models);
    expect(eligible).toHaveLength(80);
    expect(new Set(eligible.map((e) => e.provider.id))).toEqual(new Set(["p1", "p2", "p3"]));

    const router: LocalUserRouter = {
      id: "multi-user-r1",
      providerId: "p1",
      providerIds: ["p1", "p2", "p3"],
      name: "Mega 80 Free Pool",
      type: "free",
      enabled: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const combined = buildCombinedRouters([], [router], [p1, p2, p3], models);
    expect(combined).toHaveLength(1);
    expect(combined[0]?.activeMemberCount).toBe(80);
    expect(combined[0]?.providerIds).toEqual(["p1", "p2", "p3"]);
    expect(combined[0]?.providerName).toBe("OpenRouter + Groq + Nvidia");
    expect(combined[0]?.memberModelIds).toHaveLength(80);

    // Composer still shows personal multi-provider router as a Router with 80 active models
    const options = buildComposerModels([p1, p2, p3], models, combined, "en");
    const opt = options.find((o) => o.id === "router::multi-user-r1");
    expect(opt).toMatchObject({
      label: "Mega 80 Free Pool",
      note: "80 active",
      isRouter: true,
      routerActiveCount: 80,
      userAdded: true,
      disabled: false,
    });
  });

  it("keeps a multi-provider router active when one provider is disabled or removed, using the remaining providers", () => {
    const p1 = makeProvider("p1", "OpenRouter", false); // disabled
    const p2 = makeProvider("p2", "Groq", true);
    const p3 = makeProvider("p3", "Nvidia", true);

    const models: AIModel[] = [
      ...Array.from({ length: 30 }, (_, i) => makeModel(`p1-free-${i}`, "p1", "free")),
      ...Array.from({ length: 20 }, (_, i) => makeModel(`p2-free-${i}`, "p2", "free")),
      ...Array.from({ length: 30 }, (_, i) => makeModel(`p3-free-${i}`, "p3", "free")),
    ];

    const router: LocalUserRouter = {
      id: "multi-r2",
      providerId: "p1",
      providerIds: ["p1", "p2", "p3"],
      name: "Resilient Pool",
      type: "free",
      enabled: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    // With p1 disabled, p2 (20) + p3 (30) = 50 remain active
    const combinedDisabled = buildCombinedRouters([], [router], [p1, p2, p3], models);
    expect(combinedDisabled[0]?.activeMemberCount).toBe(50);

    // With p1 deleted completely from providers list, p2 + p3 still keep router alive with 50 models
    const combinedDeleted = buildCombinedRouters([], [router], [p2, p3], models);
    expect(combinedDeleted).toHaveLength(1);
    expect(combinedDeleted[0]?.activeMemberCount).toBe(50);
    expect(combinedDeleted[0]?.providerIds).toEqual(["p2", "p3"]);
  });

  it("disguises multi-provider admin routers as native OpenHarneks models with zero provider/model leakage", () => {
    const adminMulti: PublicRouterItem = {
      id: "admin-multi-80",
      ownerScope: "public",
      source: "server",
      providerId: "p1",
      providerIds: ["p1", "p2", "p3"],
      userProviderId: null,
      providerName: "OpenRouter + Groq + Nvidia",
      providerNames: ["OpenRouter", "Groq", "Nvidia"],
      name: "Harneks Omni",
      type: "free",
      enabled: true,
      activeMemberCount: 80,
      memberModelIds: ["m1", "m2"],
      capabilities: ["text"],
      billingSource: "site",
      consumesCredits: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const combined = buildCombinedRouters([adminMulti], [], [], []);
    expect(combined).toHaveLength(1);
    expect(combined[0]?.providerId).toBeNull();
    expect(combined[0]?.providerIds).toEqual([]);
    expect(combined[0]?.providerName).toBe("OpenHarneks");
    expect(combined[0]?.providerNames).toEqual([]);
    expect(combined[0]?.memberModelIds).toEqual([]);
    expect(combined[0]?.activeMemberCount).toBe(80);

    const options = buildComposerModels([], [], combined, "en");
    expect(options[0]).toMatchObject({
      id: "router::admin-multi-80",
      label: "Harneks Omni",
      note: "OpenHarneks",
      isRouter: false,
      isNativeBrand: true,
      userAdded: false,
      disabled: false,
    });
    expect(options[0]?.routerActiveCount).toBeUndefined();
  });

  it("normalizes legacy single-provider localRouterProviderIds cleanly", () => {
    expect(localRouterProviderIds({ providerId: "p1", providerIds: [] })).toEqual(["p1"]);
    expect(localRouterProviderIds({ providerId: "p1", providerIds: ["p1", "p2", "p1", "p3"] })).toEqual([
      "p1",
      "p2",
      "p3",
    ]);
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
