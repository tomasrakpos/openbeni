import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ApiFormat, ProviderRow } from "../functions/api/_lib/providerKeys";
import { buildUpstreamRequest } from "../functions/api/_lib/upstream";
import { handlePreviewIntent } from "../functions/api/preview-intent";
import {
  buildModeASystemPrompt,
  classifyRequestCategory,
  clearSkillContentCache,
  createNodeSkillReader,
  detectGameEngine,
  estimateTokens,
  getSkillRegistry,
  injectSkillSystemPrompt,
  loadRegistryFromDisk,
  resolveSkillExecution,
  SKILL_INJECTION_MARKER,
  skillResponseHeaders,
  tryExecuteSkillModeB,
  type ClassifierCaller,
  type SkillCategory,
} from "../functions/api/_lib/skills";

const SKILLS_DIR = path.resolve(process.cwd(), "skills");
const nodeReader = createNodeSkillReader(SKILLS_DIR);

/** Helper to create a deterministic mock LLM classifier that inspects the full transcript. */
function makeMockClassifier(
  responder: (transcript: string, model: string) => string | Promise<string>
): ClassifierCaller {
  return async ({ transcript, model }) => responder(transcript, model);
}

function makeProvider(format: ApiFormat): ProviderRow {
  const now = new Date().toISOString();
  const baseMap: Record<ApiFormat, string> = {
    openai: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com/v1",
    gemini: "https://generativelanguage.googleapis.com/v1beta",
    custom: "https://custom.example.com/v1",
  };
  return {
    id: `test-${format}`,
    name: `Test ${format}`,
    base_url: baseMap[format],
    api_format: format,
    auth_header: format === "anthropic" ? "x-api-key" : format === "gemini" ? null : "Authorization",
    auth_prefix: format === "openai" || format === "custom" ? "Bearer " : null,
    extra_headers: null,
    icon: null,
    color: null,
    notes: null,
    enabled: true,
    created_at: now,
    updated_at: now,
  };
}

describe("External Skills System — Step 3 Verification", () => {
  it("loads startup frontmatter metadata for all imported skills without bulk-loading bodies", () => {
    const registry = getSkillRegistry();
    expect(registry.skills.length).toBeGreaterThanOrEqual(140);
    expect(registry.byId.get("taste-skill")?.core).toBe(true);
    expect(registry.byId.get("taste-skill")?.priority).toBe(1);
    expect(registry.byId.get("impeccable")?.core).toBe(true);
    expect(registry.byId.get("impeccable")?.priority).toBe(2);
    expect(registry.byId.get("natural-chat")?.category).toBe("chat");
    expect(registry.byId.get("deep-thinking")?.category).toBe("deep_thinking");
    // Built-in awesome-gamedev router MUST NOT be imported
    expect(registry.byId.get("router")).toBeUndefined();
    // Playwright CLI and TypeUI MUST NOT be imported
    expect(registry.byId.get("playwright-cli")).toBeUndefined();
    expect(registry.byId.get("playwright")).toBeUndefined();
    expect(registry.byId.get("typeui")).toBeUndefined();
    // Awesome DESIGN.md brand index exists separately for single-brand lazy lookup
    expect(registry.designMdIndex.length).toBeGreaterThanOrEqual(80);
  });

  it("1. Landing page request -> classified as website, loads core website skills (taste-skill + impeccable) & single matched DESIGN.md only", async () => {
    const resolved = await resolveSkillExecution({
      messages: [
        {
          role: "user",
          content: "Build a high-craft SaaS landing page with smooth React animations inspired by Stripe",
        },
      ],
      reader: nodeReader,
      callClassifier: makeMockClassifier(() =>
        JSON.stringify({ category: "website", confidence: 0.97 })
      ),
    });

    expect(resolved.classification.category).toBe("website");
    expect(resolved.classification.source).toBe("llm");
    expect(resolved.needsPreview).toBe(true);

    const ids = resolved.selection.selected.map((s) => s.id);
    // Core skills MUST appear first in strict priority order
    expect(ids[0]).toBe("taste-skill");
    expect(ids[1]).toBe("impeccable");
    // Single matching DESIGN.md loaded for Stripe — never bulk-loaded
    expect(resolved.selection.matchedDesignBrand).toBe("stripe");
    const designDocs = ids.filter((id) => id.startsWith("awesome-design-md:"));
    expect(designDocs).toEqual(["awesome-design-md:stripe"]);
    // No game skills leaked into website category
    expect(ids.some((id) => id.startsWith("godot-") || id.startsWith("unity-"))).toBe(false);
    // System prompt contains unmodified core skill text
    expect(resolved.modeASystemPrompt).toContain(SKILL_INJECTION_MARKER);
    expect(resolved.modeASystemPrompt).toContain("taste-skill");
    expect(resolved.modeASystemPrompt).toContain("impeccable");
  });

  it("2. Godot platformer request -> classified as game, loads ONLY Godot (+ matching genre) skills, not Unity/Unreal", async () => {
    const resolved = await resolveSkillExecution({
      messages: [
        {
          role: "user",
          content: "Help me build a 2D platformer game in Godot with GDScript character movement",
        },
      ],
      reader: nodeReader,
      callClassifier: makeMockClassifier(() =>
        JSON.stringify({ category: "game", confidence: 0.98 })
      ),
    });

    expect(resolved.classification.category).toBe("game");
    expect(resolved.needsPreview).toBe(true);
    expect(resolved.selection.detectedEngine).toBe("godot");

    const ids = resolved.selection.selected.map((s) => s.id);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    // Must load Godot skills
    expect(ids.some((id) => id.startsWith("godot-"))).toBe(true);
    // Must NOT load any Unity, Unreal, Roblox, Phaser, or Bevy skills
    for (const doc of resolved.selection.selected) {
      expect(["godot", "general"]).toContain(doc.engine);
      expect(doc.id).not.toMatch(/^(unity|unreal|roblox|phaser|pixijs|bevy|pygame)-/);
    }
    // Website core skills must NOT be loaded
    expect(ids).not.toContain("taste-skill");
    expect(ids).not.toContain("impeccable");
  });

  it("3. Casual greeting -> classified as chat, loads ONLY natural-chat", async () => {
    const resolved = await resolveSkillExecution({
      messages: [{ role: "user", content: "Hey there! How's your day going?" }],
      reader: nodeReader,
      callClassifier: makeMockClassifier(() =>
        JSON.stringify({ category: "chat", confidence: 0.99 })
      ),
    });

    expect(resolved.classification.category).toBe("chat");
    expect(resolved.needsPreview).toBe(false);
    expect(resolved.selection.selected.map((s) => s.id)).toEqual(["natural-chat"]);
    expect(resolved.modeASystemPrompt).toContain("Natural Chat");
  });

  it("4. Hard analytical question -> classified as deep_thinking, loads ONLY deep-thinking", async () => {
    const resolved = await resolveSkillExecution({
      messages: [
        {
          role: "user",
          content:
            "Analyze the distributed consensus trade-offs between Raft, Multi-Paxos, and deterministic state-machine replication under WAN tail-latency spikes.",
        },
      ],
      reader: nodeReader,
      callClassifier: makeMockClassifier(() =>
        JSON.stringify({ category: "deep_thinking", confidence: 0.95 })
      ),
    });

    expect(resolved.classification.category).toBe("deep_thinking");
    expect(resolved.needsPreview).toBe(false);
    expect(resolved.selection.selected.map((s) => s.id)).toEqual(["deep-thinking"]);
    expect(resolved.modeASystemPrompt).toContain("Deep Thinking");
    expect(resolved.modeASystemPrompt).toContain("first principles");
  });

  it("5. Follow-up message ('make the hero darker') keeps website category via multi-turn transcript", async () => {
    let seenTranscript = "";
    const resolved = await resolveSkillExecution({
      messages: [
        { role: "user", content: "Build a landing page for an AI code editor" },
        { role: "assistant", content: "Here is the landing page with a light hero section." },
        { role: "user", content: "make the hero darker" },
      ],
      reader: nodeReader,
      callClassifier: makeMockClassifier((transcript) => {
        seenTranscript = transcript;
        // Classifier receives earlier turns and keeps "website"
        if (/landing page/i.test(transcript) && /make the hero darker/i.test(transcript)) {
          return JSON.stringify({ category: "website", confidence: 0.94 });
        }
        return JSON.stringify({ category: "chat", confidence: 0.7 });
      }),
    });

    expect(seenTranscript).toContain("Build a landing page");
    expect(seenTranscript).toContain("make the hero darker");
    expect(resolved.classification.category).toBe("website");
    expect(resolved.selection.selected.map((s) => s.id)).toContain("taste-skill");

    // Game follow-up also retains detected engine from prior user turn
    expect(
      detectGameEngine("Build a Godot 2D platformer\nadd coyote time and double jump")
    ).toBe("godot");
  });

  it("6. Classifier failure, timeout, invalid JSON, or low confidence falls back safely to chat without logging private text", async () => {
    const logs: string[] = [];
    const secretText = "PRIVATE_USER_SECRET_TOKEN_XYZ_999";

    // 6a. Thrown network/API error -> chat fallback
    const onError = await classifyRequestCategory({
      messages: [{ role: "user", content: secretText }],
      callClassifier: async () => {
        throw new Error("upstream_503");
      },
      logger: (line) => logs.push(line),
    });
    expect(onError.category).toBe("chat");
    expect(onError.source).toBe("fallback");

    // 6b. Invalid JSON -> chat fallback
    const onBadJson = await classifyRequestCategory({
      messages: [{ role: "user", content: secretText }],
      callClassifier: async () => "I think this might be website maybe?",
      logger: (line) => logs.push(line),
    });
    expect(onBadJson.category).toBe("chat");
    expect(onBadJson.source).toBe("fallback");

    // 6c. Low confidence -> chat fallback
    const onLowConf = await classifyRequestCategory({
      messages: [{ role: "user", content: secretText }],
      callClassifier: async () => JSON.stringify({ category: "website", confidence: 0.2 }),
      logger: (line) => logs.push(line),
    });
    expect(onLowConf.category).toBe("chat");
    expect(onLowConf.source).toBe("fallback");

    // 6d. Timeout -> chat fallback
    const onTimeout = await classifyRequestCategory({
      messages: [{ role: "user", content: secretText }],
      env: { SKILL_CLASSIFIER_TIMEOUT_MS: "350" },
      callClassifier: async () =>
        new Promise<string>((resolve) =>
          setTimeout(() => resolve('{"category":"website","confidence":0.99}'), 2000)
        ),
      logger: (line) => logs.push(line),
    });
    expect(onTimeout.category).toBe("chat");
    expect(onTimeout.source).toBe("fallback");

    // Privacy check: NONE of the logs may contain private user text
    expect(logs.length).toBeGreaterThanOrEqual(4);
    for (const line of logs) {
      expect(line).not.toContain(secretText);
      expect(line).toContain("category=chat");
    }
  });

  it("7. Token budget enforcement: never exceeds configured maxTokens (env or override)", async () => {
    const tightBudget = 1600;
    const resolved = await resolveSkillExecution({
      messages: [
        {
          role: "user",
          content:
            "Build an animated React Tailwind Shadcn SaaS landing page inspired by Linear with Three.js hero",
        },
      ],
      reader: nodeReader,
      env: { SKILL_MAX_TOKENS: String(tightBudget) },
      callClassifier: makeMockClassifier(() =>
        JSON.stringify({ category: "website", confidence: 0.96 })
      ),
    });

    expect(resolved.selection.maxTokens).toBe(tightBudget);
    expect(resolved.selection.totalTokens).toBeLessThanOrEqual(tightBudget);
    // Core skills still prioritized first
    expect(resolved.selection.selected[0]?.id).toBe("taste-skill");
    // Lower-priority add-ons were skipped due to tight budget
    expect(resolved.selection.skippedDueToBudget.length).toBeGreaterThan(0);

    // Verify independent token re-count on loaded content
    const recomputed = resolved.selection.selected.reduce(
      (sum, doc) => sum + estimateTokens(doc.content),
      0
    );
    expect(recomputed).toBeLessThanOrEqual(tightBudget);
  });

  it("8. Provider independence: switching between OpenAI, Anthropic, Gemini, and custom preserves skill loading in Mode A and Mode B (+ automatic fallback)", async () => {
    const formats: ApiFormat[] = ["openai", "anthropic", "gemini", "custom"];

    // 8a. Mode A (default direct injection) works identically across all 4 providers
    for (const fmt of formats) {
      const resolved = await resolveSkillExecution({
        messages: [{ role: "user", content: "Build a portfolio website" }],
        providerFormat: fmt,
        model: `test-model-${fmt}`,
        reader: nodeReader,
        callClassifier: makeMockClassifier(() =>
          JSON.stringify({ category: "website", confidence: 0.95 })
        ),
      });

      expect(resolved.selection.mode).toBe("direct");
      const systemBlock = buildModeASystemPrompt(resolved.selection);
      const injected = injectSkillSystemPrompt(
        [{ role: "user", content: "Build a portfolio website" }],
        systemBlock
      );

      const provider = makeProvider(fmt);
      const req = buildUpstreamRequest(
        provider,
        "test-key",
        { model: `test-model-${fmt}`, messages: injected, stream: false },
        false
      );
      const parsedBody = JSON.parse(String(req.init.body)) as Record<string, unknown>;

      if (fmt === "anthropic") {
        expect(String(parsedBody.system)).toContain(SKILL_INJECTION_MARKER);
      } else if (fmt === "gemini") {
        const sys = parsedBody.systemInstruction as { parts: Array<{ text: string }> };
        expect(sys.parts[0].text).toContain(SKILL_INJECTION_MARKER);
      } else {
        const msgs = parsedBody.messages as Array<{ role: string; content: string }>;
        expect(msgs[0].role).toBe("system");
        expect(msgs[0].content).toContain(SKILL_INJECTION_MARKER);
      }
    }

    // 8b. Mode B (`read_skill` tool) works across OpenAI, Anthropic, and Gemini
    const toolTestCases: Array<{
      format: ApiFormat;
      firstResponse: unknown;
      secondResponse: unknown;
    }> = [
      {
        format: "openai",
        firstResponse: {
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "read_skill",
                      arguments: JSON.stringify({ name: "natural-chat" }),
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        },
        secondResponse: {
          choices: [{ message: { content: "OpenAI Mode B answer!" }, finish_reason: "stop" }],
        },
      },
      {
        format: "anthropic",
        firstResponse: {
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "read_skill",
              input: { name: "natural-chat" },
            },
          ],
          stop_reason: "tool_use",
        },
        secondResponse: {
          content: [{ type: "text", text: "Anthropic Mode B answer!" }],
          stop_reason: "end_turn",
        },
      },
      {
        format: "gemini",
        firstResponse: {
          candidates: [
            {
              content: {
                parts: [{ functionCall: { name: "read_skill", args: { name: "natural-chat" } } }],
              },
              finishReason: "STOP",
            },
          ],
        },
        secondResponse: {
          candidates: [
            {
              content: { parts: [{ text: "Gemini Mode B answer!" }] },
              finishReason: "STOP",
            },
          ],
        },
      },
    ];

    for (const tc of toolTestCases) {
      const resolved = await resolveSkillExecution({
        messages: [{ role: "user", content: "Hi!" }],
        providerFormat: tc.format,
        model: `tool-model-${tc.format}`,
        env: { SKILL_DEFAULT_MODE: "tool" },
        reader: nodeReader,
        callClassifier: makeMockClassifier(() =>
          JSON.stringify({ category: "chat", confidence: 0.99 })
        ),
      });
      expect(resolved.selection.mode).toBe("tool");
      expect(resolved.readSkillTool?.name).toBe("read_skill");

      let step = 0;
      const mockFetch = vi.fn(async () => {
        const payload = step === 0 ? tc.firstResponse : tc.secondResponse;
        step++;
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as unknown as typeof fetch;

      const modeB = await tryExecuteSkillModeB({
        provider: makeProvider(tc.format),
        apiKey: "test-key",
        baseBody: {
          model: `tool-model-${tc.format}`,
          messages: [{ role: "user", content: "Hi!" }],
        },
        resolved,
        reader: nodeReader,
        fetcher: mockFetch,
      });

      expect(modeB.usedMode).toBe("tool");
      expect(modeB.loadedViaTool).toEqual(["natural-chat"]);
      expect(modeB.normalized?.choices[0]?.message.content).toContain("Mode B answer!");
    }

    // 8c. Mode B automatically falls back to Mode A when provider rejects tools (HTTP 400) or is custom
    const customResolved = await resolveSkillExecution({
      messages: [{ role: "user", content: "Hi!" }],
      providerFormat: "custom",
      env: { SKILL_DEFAULT_MODE: "tool" },
      reader: nodeReader,
      callClassifier: makeMockClassifier(() =>
        JSON.stringify({ category: "chat", confidence: 0.99 })
      ),
    });
    expect(customResolved.selection.mode).toBe("direct");

    const openaiToolResolved = await resolveSkillExecution({
      messages: [{ role: "user", content: "Hi!" }],
      providerFormat: "openai",
      env: { SKILL_DEFAULT_MODE: "tool" },
      reader: nodeReader,
      callClassifier: makeMockClassifier(() =>
        JSON.stringify({ category: "chat", confidence: 0.99 })
      ),
    });
    const rejectingFetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "tools not supported" } }), { status: 400 })
    ) as unknown as typeof fetch;

    const fallbackResult = await tryExecuteSkillModeB({
      provider: makeProvider("openai"),
      apiKey: "test-key",
      baseBody: { model: "no-tools-model", messages: [{ role: "user", content: "Hi!" }] },
      resolved: openaiToolResolved,
      reader: nodeReader,
      fetcher: rejectingFetch,
    });
    expect(fallbackResult.usedMode).toBe("direct");
    expect(fallbackResult.fallbackReason).toBe("tool_unsupported_http_400");
  });

  it("9. Adding a new skill only requires dropping a folder into /skills and assigning its category in skills.config.json", async () => {
    clearSkillContentCache();
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbeni-skills-ext-"));
    try {
      await fs.mkdir(path.join(tmpDir, "custom-rust-skill"), { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, "custom-rust-skill", "SKILL.md"),
        "---\nname: custom-rust-skill\ndescription: Custom test skill loaded dynamically\nlicense: MIT\n---\n\n# Custom Rust Skill\nFollow strict ownership rules.\n",
        "utf8"
      );
      await fs.writeFile(
        path.join(tmpDir, "skills.config.json"),
        JSON.stringify({
          version: 1,
          defaults: {
            mode: "direct",
            maxTokensPerRequest: 4000,
            maxSelectedSkills: { website: 3, game: 3, chat: 1, deep_thinking: 1, other: 1 },
            classifier: {
              model: "gpt-4o-mini",
              timeoutMs: 3000,
              historyMessages: 6,
              fallbackCategory: "chat",
              minConfidence: 0.45,
            },
          },
          providerModes: {},
          modelModes: {},
          skills: {
            "custom-rust-skill": {
              category: "deep_thinking" as SkillCategory,
              priority: 1,
              core: true,
              tags: ["rust", "ownership"],
            },
          },
        }),
        "utf8"
      );

      const diskRegistry = await loadRegistryFromDisk(tmpDir);
      const diskReader = createNodeSkillReader(tmpDir);
      expect(diskRegistry.byId.get("custom-rust-skill")?.name).toBe("custom-rust-skill");

      const resolved = await resolveSkillExecution({
        messages: [{ role: "user", content: "Explain Rust borrow checker tradeoffs" }],
        registry: diskRegistry,
        reader: diskReader,
        callClassifier: makeMockClassifier(() =>
          JSON.stringify({ category: "deep_thinking", confidence: 0.99 })
        ),
      });
      expect(resolved.selection.selected.map((s) => s.id)).toEqual(["custom-rust-skill"]);
      expect(resolved.modeASystemPrompt).toContain("Follow strict ownership rules.");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("10. /api/preview-intent endpoint honors manual override and returns privacy-safe skill headers", async () => {
    const req = new Request("https://openbeni.local/api/preview-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        skillMode: "website",
        messages: [{ role: "user", content: "Build a landing page" }],
      }),
    });

    const res = await handlePreviewIntent(req, {});
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Skill-Category")).toBe("website");
    expect(res.headers.get("X-Skill-Mode")).toBe("direct");
    expect(res.headers.get("X-Preview-Intent")).toBe("1");

    const data = (await res.json()) as {
      category: string;
      needsPreview: boolean;
      selectedSkills: string[];
    };
    expect(data.category).toBe("website");
    expect(data.needsPreview).toBe(true);
    expect(data.selectedSkills).toContain("taste-skill");
    expect(data.selectedSkills).toContain("impeccable");

    // Header helper check
    const resolved = await resolveSkillExecution({
      messages: [{ role: "user", content: "hello" }],
      skillMode: "chat",
      reader: nodeReader,
    });
    const hdrs = skillResponseHeaders(resolved);
    expect(hdrs["X-Skill-Category"]).toBe("chat");
    expect(hdrs["X-Preview-Intent"]).toBe("0");
  });
});
