// Tests for modelRoutes.test; add or update cases here to match observable behavior.
import { afterEach, describe, expect, it } from "vitest";
import { isBundledProvider, providerDisplayName } from "@/lib/bundled";
import {
  buildModelRoutes,
  canRotateRoute,
  isSameModel,
  markRouteFailure,
  markRouteSuccess,
  orderRoutes,
  resetRouteHealth,
} from "@/lib/modelRoutes";
import type { AIModel, Provider } from "@/lib/types";

function provider(patch: Partial<Provider>): Provider {
  return {
    id: "prov",
    name: "Provider",
    baseUrl: "https://example.com/v1",
    apiFormat: "openai",
    auth: { header: "Authorization", prefix: "Bearer " },
    extraHeaders: {},
    timeoutMs: 30_000,
    useProxy: false,
    enabled: true,
    favorite: false,
    order: 1,
    paths: {},
    hasKey: true,
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  };
}

function model(patch: Partial<AIModel>): AIModel {
  return {
    id: "model",
    providerId: "prov",
    modelId: "gpt-5.4-nano",
    displayName: "GPT-5.4 Nano",
    capabilities: ["text"],
    tier: "paid",
    enabled: true,
    favorite: false,
    order: 1,
    source: "preset",
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  };
}

afterEach(() => resetRouteHealth());

describe("bundled provider visibility", () => {
  it("treats only explicitly bundled rows as project-owned", () => {
    expect(isBundledProvider(provider({ id: "prov_default_coarena" }))).toBe(false);
    expect(isBundledProvider(provider({ id: "prov_x", bundled: true }))).toBe(true);
    expect(isBundledProvider(provider({ id: "prov_x" }))).toBe(false);
    expect(isBundledProvider(provider({ id: "prov_coarena", managed: true }))).toBe(false);
  });

  it("shows the site name instead of the bundled gateway brand", () => {
    expect(providerDisplayName(provider({ id: "prov_default_pollinations", name: "Pollinations" }))).toBe(
      "Pollinations",
    );
    expect(providerDisplayName(provider({ bundled: true, name: "Pollinations" }))).toBe("OpenHarneks");
    expect(providerDisplayName(provider({ name: "My key" }))).toBe("My key");
  });
});

describe("model identity", () => {
  it("matches the same model across naming styles", () => {
    const coarena = model({ id: "a", providerId: "prov_default_coarena", modelId: "minimax-m3-1-flash", displayName: "MiniMax M3.1 Flash" });
    const pollinations = model({
      id: "b",
      providerId: "prov_default_pollinations",
      modelId: "minimax/minimax-m3.1-flash",
      displayName: "MiniMax M3.1 Flash",
    });
    expect(isSameModel(coarena, pollinations)).toBe(true);
  });

  it("does not merge unrelated models", () => {
    const a = model({ id: "a", modelId: "gpt-5.4-nano", displayName: "GPT-5.4 Nano" });
    const b = model({ id: "b", modelId: "gpt-6.1-sol", displayName: "GPT-6.1 Sol" });
    expect(isSameModel(a, b)).toBe(false);
  });
});

describe("model route queue", () => {
  const coarena = provider({ id: "prov_default_coarena", order: 1 });
  const pollinations = provider({ id: "prov_default_pollinations", order: 2 });
  const selected = model({ id: "coarena-row", providerId: coarena.id, modelId: "minimax-m3-1-flash", displayName: "MiniMax M3.1 Flash" });
  const duplicate = model({ id: "polli-row", providerId: pollinations.id, modelId: "minimax/minimax-m3.1-flash", displayName: "MiniMax M3.1 Flash" });
  const unrelated = model({ id: "other", providerId: pollinations.id, modelId: "openai/gpt-6.1-sol", displayName: "GPT-6.1 Sol" });

  it("puts the selected route first and queues duplicate models behind it", () => {
    const routes = buildModelRoutes(selected, [coarena, pollinations], [selected, duplicate, unrelated]);
    expect(routes.map((route) => route.model.id)).toEqual(["coarena-row", "polli-row"]);
  });

  it("skips disabled providers and models", () => {
    const routes = buildModelRoutes(selected, [coarena, { ...pollinations, enabled: false }], [selected, duplicate]);
    expect(routes.map((route) => route.model.id)).toEqual(["coarena-row"]);
  });

  it("moves a limited route behind a healthy one and restores it", () => {
    const routes = orderRoutes([
      { provider: coarena, model: selected },
      { provider: pollinations, model: duplicate },
    ]);
    expect(routes[0]!.provider.id).toBe(coarena.id);

    markRouteFailure(routes[0]!, "rate-limit");
    expect(orderRoutes([
      { provider: coarena, model: selected },
      { provider: pollinations, model: duplicate },
    ])[0]!.provider.id).toBe(pollinations.id);

    markRouteSuccess(routes[0]!);
    expect(orderRoutes([
      { provider: coarena, model: selected },
      { provider: pollinations, model: duplicate },
    ])[0]!.provider.id).toBe(coarena.id);
  });

  it("allows switching hosts on transport errors", () => {
    expect(canRotateRoute("rate-limit")).toBe(true);
    expect(canRotateRoute("cors")).toBe(true);
    expect(canRotateRoute("network")).toBe(true);
    expect(canRotateRoute("timeout")).toBe(true);
    expect(canRotateRoute(undefined)).toBe(false);
  });
});
