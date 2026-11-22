import { describe, expect, it, vi } from "vitest";
import {
  analyzePreviewIntentHeuristic,
  classifyPreviewIntent,
  parseAiIntentDecision,
  previewIntentHeaders,
} from "../functions/api/_lib/previewIntent";
import { handlePreviewIntent } from "../functions/api/preview-intent";
import {
  PROJECT_BUILDER_MARKER,
  injectProjectBuilderPrompt,
} from "../functions/api/_lib/projectBuilderPrompt";
import { extractStreamingProjectFiles, splitChatAndArtifact } from "../src/lib/codefiles";

describe("backend preview-intent classifier", () => {
  it("keeps preview disabled for lobby/empty, greetings, search, and general Q&A (EN & FA)", () => {
    const nonPreviewPrompts = [
      "",
      "Hello, how are you?",
      "سلام چطوری؟",
      "Search the web for the latest AI news",
      "تو اینترنت سرچ کن قیمت دلار امروز چنده",
      "What is the difference between React and Vue?",
      "تفاوت HTML و CSS چیه؟ توضیح بده",
      "Translate this paragraph into Persian",
      "این متن رو خلاصه کن",
      "Write a short story about space travel",
      "بهترین فیلم‌های سال ۲۰۲۶ رو معرفی کن",
    ];

    for (const content of nonPreviewPrompts) {
      const res = analyzePreviewIntentHeuristic([{ role: "user", content }]);
      expect(res.needsPreview, `expected needsPreview=false for: ${content}`).toBe(false);
    }
  });

  it("enables preview for website, game, web app, and UI build prompts (EN & FA)", () => {
    const cases: Array<[string, string]> = [
      ["Build me a modern landing page for a coffee shop", "website"],
      ["یک وبسایت فروشگاهی مدرن برام بساز", "website"],
      ["Create a playable snake game in HTML5 canvas", "game"],
      ["یه بازی دوز یا مار برام بساز", "game"],
      ["Make an interactive pomodoro timer web app", "app"],
      ["یه ماشین حساب تحت وب طراحی کن", "app"],
      ["Design a responsive login page with glass cards", "ui"],
      ["یک صفحه ورود و فرم تماس زیبا طراحی کن", "ui"],
    ];

    for (const [content, expectedCategory] of cases) {
      const res = analyzePreviewIntentHeuristic([{ role: "user", content }]);
      expect(res.needsPreview, `expected needsPreview=true for: ${content}`).toBe(true);
      expect(res.category).toBe(expectedCategory);
      expect(res.confidence).toBe("high");
    }
  });

  it("keeps preview enabled for follow-up edits once an assistant produced project code", () => {
    const res = analyzePreviewIntentHeuristic([
      { role: "user", content: "یه سایت ساده بساز" },
      { role: "assistant", content: "```html\n<!doctype html><html><body><h1>Hi</h1></body></html>\n```" },
      { role: "user", content: "رنگ پس‌زمینه رو تیره کن" },
    ]);
    expect(res.needsPreview).toBe(true);
    expect(res.source).toBe("existing_project");
  });

  it("delegates ambiguous prompts to the AI judge and falls back safely on errors", async () => {
    const aiJudge = vi.fn(async () => '{"preview": true, "category": "app"}');
    const resolved = await classifyPreviewIntent({
      messages: [{ role: "user", content: "برام یه ابزار مدیریت هزینه‌های ماهانه بساز" }],
      aiJudge,
    });
    expect(aiJudge).toHaveBeenCalledTimes(1);
    expect(resolved.needsPreview).toBe(true);
    expect(resolved.source).toBe("ai");
    expect(resolved.category).toBe("app");

    const failingJudge = vi.fn(async () => {
      throw new Error("timeout");
    });
    const fallback = await classifyPreviewIntent({
      messages: [{ role: "user", content: "برام یه چیزی بساز" }],
      aiJudge: failingJudge,
    });
    expect(failingJudge).toHaveBeenCalledTimes(1);
    expect(fallback.needsPreview).toBe(false);
    expect(fallback.source).toBe("heuristic");
  });

  it("parses JSON responses with or without markdown code fences", () => {
    expect(parseAiIntentDecision('```json\n{"preview":true,"category":"game"}\n```')).toEqual({
      needsPreview: true,
      category: "game",
    });
    expect(parseAiIntentDecision('{"preview": false, "category": "none"}')).toEqual({
      needsPreview: false,
      category: "none",
    });
    expect(parseAiIntentDecision("not json")).toBeNull();
  });

  it("emits consistent X-Preview-* headers and serves POST /api/preview-intent", async () => {
    const headers = previewIntentHeaders({
      needsPreview: true,
      confidence: "high",
      category: "website",
      source: "ai",
      reason: "ai_website",
    });
    expect(headers).toEqual({
      "X-Preview-Intent": "1",
      "X-Preview-Category": "website",
      "X-Preview-Source": "ai",
    });

    const req = new Request("http://localhost:5173/api/preview-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "یک بازی مار تحت وب بساز" }],
      }),
    });
    const res = await handlePreviewIntent(req, {});
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Preview-Intent")).toBe("1");
    expect(res.headers.get("X-Preview-Category")).toBe("game");
    const json = (await res.json()) as {
      needsPreview: boolean;
      category: string;
      builderSystemPrompt?: string;
    };
    expect(json.needsPreview).toBe(true);
    expect(json.category).toBe("game");
    expect(json.builderSystemPrompt).toContain(PROJECT_BUILDER_MARKER);
    expect(json.builderSystemPrompt).toContain("<plan>");
    expect(json.builderSystemPrompt).toContain("@step:");
  });

  it("injects the project-builder prompt without duplicating or overwriting existing system prompts", () => {
    const msgs = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "یک سایت فروشگاهی با سبد خرید بساز" },
    ];
    const injected = injectProjectBuilderPrompt(msgs, "website", msgs);
    expect(injected).toHaveLength(2);
    expect(injected[0]?.content).toContain("You are helpful.");
    expect(injected[0]?.content).toContain(PROJECT_BUILDER_MARKER);
    expect(injected[0]?.content).toContain("Persian");

    // Idempotent: second call does not duplicate
    const again = injectProjectBuilderPrompt(injected, "website", msgs);
    expect(again).toBe(injected);
  });

  it("tracks dynamic <plan> tasks through pending -> active -> done across any programming language", () => {
    const pythonStreaming = [
      "Building your FastAPI task manager.",
      "",
      "<plan>",
      "- Define task data models",
      "- Implement CRUD endpoints",
      "- Add in-memory persistence",
      "</plan>",
      "",
      "```python main.py",
      "# @step: Define task data models",
      "from dataclasses import dataclass",
      "# @step: Implement CRUD endpoints",
      "def list_tasks(): return []",
    ].join("\n");

    const mid = splitChatAndArtifact(pythonStreaming, true, "en");
    expect(mid.beforeText).toBe("Building your FastAPI task manager.");
    expect(mid.beforeText).not.toContain("<plan>");
    expect(mid.isBuilding).toBe(true);
    expect(mid.completedSteps).toBe(1);
    expect(mid.steps).toEqual([
      { id: "plan-0", label: "Define task data models", status: "done" },
      { id: "plan-1", label: "Implement CRUD endpoints", status: "active" },
      { id: "plan-2", label: "Add in-memory persistence", status: "pending" },
    ]);

    const finished = `${pythonStreaming}\n# @step: Add in-memory persistence\nTASKS = []\n\`\`\`\n\nAll done!`;
    const done = splitChatAndArtifact(finished, false, "en");
    expect(done.isBuilding).toBe(false);
    expect(done.completedSteps).toBe(3);
    expect(done.afterText).toBe("All done!");
    expect(done.steps.every((s) => s.status === "done")).toBe(true);
  });

  it("extracts live streaming open fences and separates chat prose from project code", () => {
    const partial =
      "دارم فرم ورود می‌سازم...\n\n```html index.html\n<!-- @step: ساخت ساختار پایه -->\n<!doctype html><title>Login</title>\n<!-- @step: استایل کارت -->\n<style>body{color:#fff}";
    const streamRes = extractStreamingProjectFiles(partial);
    expect(streamRes.inProgressFile).toBe("index.html");
    expect(streamRes.files).toHaveLength(1);
    expect(streamRes.files[0]?.path).toBe("index.html");

    const midSplit = splitChatAndArtifact(partial, true, "fa");
    expect(midSplit.beforeText).toBe("دارم فرم ورود می‌سازم...");
    expect(midSplit.afterText).toBe("");
    expect(midSplit.isBuilding).toBe(true);
    expect(midSplit.title).toBe("Login");
    expect(midSplit.steps).toEqual([
      { id: "step-0", label: "ساخت ساختار پایه", status: "done" },
      { id: "step-1", label: "استایل کارت", status: "active" },
    ]);

    const done = `${partial}</style>\n\`\`\`\n\nآماده شد!`;
    const doneSplit = splitChatAndArtifact(done, false, "fa");
    expect(doneSplit.isBuilding).toBe(false);
    expect(doneSplit.beforeText).toBe("دارم فرم ورود می‌سازم...");
    expect(doneSplit.afterText).toBe("آماده شد!");
    expect(doneSplit.steps.every((s) => s.status === "done")).toBe(true);
  });
});
