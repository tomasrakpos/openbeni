// Tests for detect.test; add or update cases here to match observable behavior.
import { afterEach, describe, expect, it, vi } from "vitest";
import { detectFormat, formatLabel } from "@/lib/detect";

interface RecordedCall {
  url: string;
  headers: Record<string, string>;
}

function record(calls: RecordedCall[], input: unknown, init?: { headers?: unknown }) {
  calls.push({
    url: String(input),
    headers: (init?.headers ?? {}) as Record<string, string>,
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("detectFormat", () => {
  it("stops at the first working OpenAI-compatible endpoint", async () => {
    const calls: RecordedCall[] = [];
    const starts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: { headers?: unknown }) => {
        record(calls, input, init);
        return json({ data: [{ id: "gpt-test" }, { id: "models/gpt-other" }] });
      }),
    );

    const result = await detectFormat({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      onProbeStart: (info) => starts.push(info.url),
    });

    expect(result.format).toBe("openai");
    expect(result.baseUrl).toBe("https://api.example.com/v1");
    expect(result.models).toEqual(["gpt-test", "gpt-other"]);
    expect(result.steps).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.example.com/v1/models");
    expect(calls[0]?.headers.Authorization).toBe("Bearer sk-test");
    expect(starts).toEqual(["https://api.example.com/v1/models"]);
  });

  it("falls back to the Anthropic probe and sends x-api-key", async () => {
    const calls: RecordedCall[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: { headers?: unknown }) => {
        record(calls, input, init);
        const headers = (init?.headers ?? {}) as Record<string, string>;
        if (headers["x-api-key"] === "sk-ant") {
          return json({ data: [{ id: "claude-test" }] });
        }
        return json({ error: "not found" }, 404);
      }),
    );

    const result = await detectFormat({ baseUrl: "https://api.example.com/v1", apiKey: "sk-ant" });

    expect(result.format).toBe("anthropic");
    expect(result.baseUrl).toBe("https://api.example.com/v1");
    expect(result.models).toEqual(["claude-test"]);
    expect(result.steps).toHaveLength(5);
    const winning = calls.find((call) => call.headers["x-api-key"] === "sk-ant");
    expect(winning?.url).toBe("https://api.example.com/v1/models");
    expect(winning?.headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("falls back to the Gemini probe with x-goog-api-key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: unknown, init?: { headers?: unknown }) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        if (headers["x-goog-api-key"] === "gm-key") {
          return json({ models: [{ name: "models/gemini-test" }] });
        }
        return json({}, 404);
      }),
    );

    const result = await detectFormat({
      baseUrl: "https://generativelanguage.googleapis.com",
      apiKey: "gm-key",
    });

    expect(result.format).toBe("gemini");
    expect(result.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta");
    expect(result.models).toEqual(["gemini-test"]);
  });

  it("reports a helpful error when every probe 404s", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 404)));

    const result = await detectFormat({ baseUrl: "https://api.example.com/v1", apiKey: "k" });

    expect(result.format).toBeNull();
    expect(result.error).toMatch(/Nothing answered at \/models/);
    expect(result.steps.length).toBeGreaterThanOrEqual(10);
    expect(result.steps.every((step) => step.status === 404)).toBe(true);
  });

  it("detects the 'key rejected' case", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "nope" }, 401)));

    const result = await detectFormat({ baseUrl: "https://api.example.com/v1", apiKey: "bad" });

    expect(result.format).toBeNull();
    expect(result.error).toMatch(/rejected your key/);
  });

  it("reports CORS when every request throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    const result = await detectFormat({ baseUrl: "https://api.example.com/v1", apiKey: "k" });

    expect(result.format).toBeNull();
    expect(result.error).toMatch(/CORS/i);
    expect(result.steps.every((step) => step.note === "blocked by CORS")).toBe(true);
  });

  it("routes probes through the configured proxy", async () => {
    const calls: RecordedCall[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: { headers?: unknown }) => {
        record(calls, input, init);
        return json({ data: [{ id: "m" }] });
      }),
    );

    await detectFormat({
      baseUrl: "https://api.example.com/v1",
      apiKey: "k",
      useProxy: true,
      proxyUrl: "https://proxy.example.dev",
    });

    expect(calls[0]?.url).toBe(
      "https://proxy.example.dev?url=https%3A%2F%2Fapi.example.com%2Fv1%2Fmodels",
    );
  });

  it("rejects an empty base URL without touching the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await detectFormat({ baseUrl: "   ", apiKey: "" });

    expect(result.format).toBeNull();
    expect(result.error).toMatch(/required/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports each probe through onStep", async () => {
    const steps: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: [{ id: "x" }] })));

    await detectFormat({
      baseUrl: "https://api.example.com/v1",
      apiKey: "k",
      onStep: (step) => steps.push(step.id),
    });

    expect(steps).toEqual(["openai"]);
  });
});

describe("formatLabel", () => {
  it("labels every format", () => {
    expect(formatLabel("openai")).toBe("OpenAI-compatible");
    expect(formatLabel("anthropic")).toBe("Anthropic Messages");
    expect(formatLabel("gemini")).toBe("Google Gemini");
    expect(formatLabel("custom")).toBe("Custom template");
  });
});
