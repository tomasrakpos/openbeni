import { describe, expect, it, vi } from "vitest";
import {
  SKILL_SYSTEM_MARKER,
  composeSkillSystemPrompt,
  injectSkillSystemPrompt,
} from "../functions/api/_lib/skills/definitions";
import {
  parseAiSkillDecision,
  resolveSkillExecution,
  routeSkillHeuristic,
  skillResponseHeaders,
} from "../functions/api/_lib/skills/router";
import { handlePreviewIntent } from "../functions/api/preview-intent";

describe("4-Skill Backend Intelligence System", () => {
  it("auto-routes EN & FA messages accurately across all 4 skills", () => {
    expect(routeSkillHeuristic([{ role: "user", content: "سلام چطوری؟" }]).skillId).toBe("chat");
    expect(routeSkillHeuristic([{ role: "user", content: "Hey, quick question about coffee." }]).skillId).toBe("chat");

    const web = routeSkillHeuristic([{ role: "user", content: "یک وبسایت فروشگاهی مدرن برای کافه بساز" }]);
    expect(web.skillId).toBe("web_builder");
    expect(web.needsPreview).toBe(true);

    const game = routeSkillHeuristic([{ role: "user", content: "یه بازی سه‌بعدی ماشین‌سواری با نورپردازی بساز" }]);
    expect(game.skillId).toBe("game_builder");
    expect(game.needsPreview).toBe(true);

    const researchFa = routeSkillHeuristic([{ role: "user", content: "تحقیق عمیق و مقایسه کامل بین Rust و Go برای میکروسرویس انجام بده" }]);
    expect(researchFa.skillId).toBe("deep_research");
    expect(researchFa.needsPreview).toBe(false);

    const researchEn = routeSkillHeuristic([{ role: "user", content: "Search the web for the latest WebGPU browser benchmarks" }]);
    expect(researchEn.skillId).toBe("deep_research");
    expect(researchEn.needsPreview).toBe(false);
  });

  it("routes attached UI screenshots/images to web_builder with vision replication directives", async () => {
    const ctx = await resolveSkillExecution({
      messages: [
        { role: "user", content: "از روی این عکس دقیقاً همین صفحه رو بساز", hasImages: true },
      ],
      enableLiveSearch: false,
    });
    expect(ctx.skillId).toBe("web_builder");
    expect(ctx.needsPreview).toBe(true);
    expect(ctx.systemPrompt).toContain("IMAGE / SCREENSHOT REPLICATION MODE");
    expect(ctx.systemPrompt).toContain("NO emojis or stickers");
    expect(ctx.systemPrompt).toContain("<plan>");
  });

  it("honors manual skill overrides immediately over auto heuristics", async () => {
    const manualGame = await resolveSkillExecution({
      messages: [{ role: "user", content: "سلام" }],
      skillMode: "game_builder",
      enableLiveSearch: false,
    });
    expect(manualGame.skillId).toBe("game_builder");
    expect(manualGame.source).toBe("manual");
    expect(manualGame.needsPreview).toBe(true);
    expect(manualGame.systemPrompt).toContain("Three.js");
    expect(manualGame.systemPrompt).toContain("requestAnimationFrame");

    const manualChat = await resolveSkillExecution({
      messages: [{ role: "user", content: "یک سایت فروشگاهی بساز" }],
      skillMode: "chat",
      enableLiveSearch: false,
    });
    expect(manualChat.skillId).toBe("chat");
    expect(manualChat.source).toBe("manual");
    expect(manualChat.needsPreview).toBe(false);
    expect(manualChat.systemPrompt).toContain("NEVER use meaningless emojis");
  });

  it("uses the AI router judge on ambiguous queries and parses JSON cleanly", async () => {
    expect(parseAiSkillDecision('```json\n{"skill":"deep_research"}\n```')).toBe("deep_research");
    expect(parseAiSkillDecision('{"skill":"invalid"}')).toBeNull();

    const judge = vi.fn(async () => '{"skill": "deep_research"}');
    const ctx = await resolveSkillExecution({
      messages: [{ role: "user", content: "برام یه بررسی روی این موضوع بساز" }],
      aiJudge: judge,
      enableLiveSearch: false,
    });
    expect(judge).toHaveBeenCalledTimes(1);
    expect(ctx.skillId).toBe("deep_research");
    expect(ctx.source).toBe("ai");
  });

  it("embeds live web sources & verified photo assets into skill prompts and injects idempotently", () => {
    const webPrompt = composeSkillSystemPrompt({
      skillId: "web_builder",
      messages: [{ role: "user", content: "Design an architecture studio website" }],
      webSources: [
        { title: "ArchDaily Minimalism", url: "https://example.com/arch", snippet: "Clean concrete grids", source: "duckduckgo" },
      ],
      imageAssets: [
        { title: "Modern concrete pavilion", url: "https://upload.wikimedia.org/sample.jpg", width: 1200, height: 800, source: "wikimedia" },
      ],
      hasImages: false,
    });
    expect(webPrompt).toContain("https://upload.wikimedia.org/sample.jpg");
    expect(webPrompt).toContain("ArchDaily Minimalism");
    expect(webPrompt).toContain(`${SKILL_SYSTEM_MARKER}web_builder]`);

    const researchPrompt = composeSkillSystemPrompt({
      skillId: "deep_research",
      messages: [{ role: "user", content: "Compare nuclear fusion milestones" }],
      webSources: [
        { title: "ITER 2026 Report", url: "https://example.com/iter", snippet: "Plasma confinement progress", source: "wikipedia-en" },
      ],
      imageAssets: [],
      hasImages: false,
    });
    expect(researchPrompt).toContain("ITER 2026 Report");
    expect(researchPrompt).toContain("[1](url)");

    const msgs = [
      { role: "system", content: "Custom user rule" },
      { role: "user", content: "hi" },
    ];
    const injected = injectSkillSystemPrompt(msgs, researchPrompt);
    expect(injected[0]?.content).toContain("Custom user rule");
    expect(injected[0]?.content).toContain(`${SKILL_SYSTEM_MARKER}deep_research]`);
    expect(injectSkillSystemPrompt(injected, researchPrompt)).toBe(injected);
  });

  it("exposes X-Skill-* headers via POST /api/preview-intent", async () => {
    const req = new Request("http://localhost:5173/api/preview-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
      body: JSON.stringify({
        skillMode: "deep_research",
        enableLiveSearch: false,
        messages: [{ role: "user", content: "تحلیل بازار نیمه‌هادی‌ها" }],
      }),
    });
    const res = await handlePreviewIntent(req, {});
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Skill-Id")).toBe("deep_research");
    expect(res.headers.get("X-Skill-Source")).toBe("manual");
    expect(res.headers.get("X-Preview-Intent")).toBe("0");

    const hdrs = skillResponseHeaders({
      skillId: "game_builder",
      source: "heuristic",
      confidence: "high",
      needsPreview: true,
      previewCategory: "game",
      reason: "build_game",
      webSources: [],
      imageAssets: [],
      systemPrompt: "prompt",
    });
    expect(hdrs["X-Skill-Id"]).toBe("game_builder");
    expect(hdrs["X-Preview-Intent"]).toBe("1");
  });
});
