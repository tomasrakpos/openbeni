// Backend preview-intent classifier shared by `/api/chat` and `/api/preview-intent`.
// Determines whether a user's message asks to build/edit a previewable artifact
// (website, game, web app, UI component, interactive project) vs ordinary chat,
// web search, Q&A, translation, or conceptual questions.

export type PreviewCategory = "website" | "game" | "app" | "ui" | "project" | "none";

export interface PreviewIntentMessage {
  role: string;
  content: string;
}

export interface PreviewIntentResult {
  needsPreview: boolean;
  confidence: "high" | "medium" | "low";
  category: PreviewCategory;
  source: "ai" | "heuristic" | "existing_project";
  reason: string;
}

export type PreviewAiJudge = (promptMessages: PreviewIntentMessage[]) => Promise<string | null>;

const PREVIEW_CODE_FENCE = /```(?:html|htm|css|scss|js|javascript|jsx|tsx|svg|vue|svelte)\b/i;
const RAW_HTML_DOC = /<!doctype\s+html|<html[\s>]|<body[\s>]|<canvas[\s>]|<svg[\s>]/i;

const WEBSITE_ARTIFACT =
  /\b(website|web\s*site|web\s*page|webpage|landing\s*page|portfolio|homepage|home\s*page|storefront|e-?commerce|blog\s*site|online\s*shop|html\s*page|html\s*site)\b|(وب\s*سایت|وبسایت|سایت|صفحه\s*وب|لندینگ|فروشگاه\s*اینترنتی|فروشگاه\s*آنلاین|پورتفولیو|پرتفولیو|قالب\s*سایت|سایت\s*فروشگاهی|سایت\s*شخصی|سایت\s*شرکتی|سایت\s*معرفی|رزومه\s*آنلاین)/i;

const GAME_ARTIFACT =
  /\b(game|mini\s*game|minigame|arcade|snake|tetris|pong|flappy|chess|tic[\s-]*tac[\s-]*toe|sudoku|memory\s*game|platformer|shooter|puzzle\s*game|2d\s*game|3d\s*game|browser\s*game|html5\s*game|canvas\s*game|wordle|minesweeper|breakout|pacman|pac-man)\b|(بازی|گیم|مینی\s*گیم|بازی\s*مار|مار\s*بازی|بازی\s*دوز|شطرنج|تتریس|پازل|سودوکو|بازی\s*تحت\s*وب|بازی\s*آنلاین|بازی\s*آرکید)/i;

const APP_ARTIFACT =
  /\b(web\s*app|webapp|dashboard|admin\s*panel|calculator|todo\s*(?:app|list)|to-do\s*(?:app|list)|timer|stopwatch|pomodoro|clock\s*app|weather\s*app|chat\s*app|music\s*player|video\s*player|notes?\s*app|expense\s*tracker|kanban|calendar\s*app|quiz\s*app|converter|form\s*builder|paint\s*app|drawing\s*app|whiteboard|interactive\s*app|prototype|saas)\b|(اپلیکیشن|وب\s*اپ|داشبورد|پنل\s*مدیریت|پنل\s*کاربری|ماشین\s*حساب|تودو|لیست\s*کار|تایمر|کرنومتر|ساعت\s*دیجیتال|پلیر|تقویم\s*تعاملی|پروژه\s*تحت\s*وب|اپ\s*تحت\s*وب|نرم\s*افزار\s*تحت\s*وب)/i;

const UI_ARTIFACT =
  /\b(ui\s*component|navbar|nav\s*bar|sidebar|hero\s*section|pricing\s*(?:card|table|section)|login\s*(?:page|form)|sign[\s-]*up\s*(?:page|form)|modal|dialog|carousel|slider\s*component|accordion|tabs?\s*component|card\s*design|button\s*animation|css\s*animation|loading\s*spinner|svg\s*animation|chart|graph|visualization|frontend|front-end|react\s*(?:app|component|page)|html\s*(?:and|&|\+)?\s*css|tailwind\s*(?:page|card|ui|layout))\b|(رابط\s*کاربری|کامپوننت|صفحه\s*ورود|صفحه\s*ثبت\s*نام|فرم\s*ورود|فرم\s*تماس|نوار\s*ناوبری|اسلایدر|کارت\s*محصول|انیمیشن\s*css|فرانت\s*اند|صفحه\s*اصلی|منو\s*سایت|فوتر|هدر)/i;

const PROJECT_ARTIFACT =
  /\b(project|front-?end\s*project|web\s*project|interactive\s*demo|demo\s*page|live\s*preview|mockup|wireframe|template)\b|(پروژه|پروژه‌ای|پروژه\s*فرانت|پروژه\s*سایت|دمو\s*تعاملی|پیش\s*نمایش|پیشنمایش|قالب\s*آماده)/i;

const BUILD_ACTION =
  /\b(build|create|make|design|generate|develop|implement|code|write\s+(?:me\s+)?(?:a|an|the)|craft|prototype|redesign|scaffold|turn\s+this\s+into|give\s+me\s+(?:a|an)\s+(?:working|live|interactive|complete|full|simple|modern|responsive))\b|(بساز|بسازی|بسازید|ساخت|درست\s*کن|طراحی\s*کن|طراحی|کدشو\s*بزن|کدش\s*رو\s*بنویس|کدشو\s*بنویس|برام\s*بنویس|برام\s*بساز|برام\s*درست\s*کن|پیاده\s*سازی\s*کن|پیاده‌سازی\s*کن|تولید\s*کن|آماده\s*کن|ایجاد\s*کن)/i;

const NON_PREVIEW_INTENT =
  /\b(what\s+is|what\s+are|who\s+is|when\s+did|where\s+is|why\s+does|how\s+does|explain|define|meaning\s+of|difference\s+between|compare|search\s+(?:the\s+web|online|google|for)|look\s+up|find\s+(?:me\s+)?(?:news|info|information|articles)|latest\s+news|weather\s+in|price\s+of|translate|translation|summarize|summary|rewrite|proofread|grammar|essay|article|blog\s*post\s*about|story\s+about|poem|joke|recipe|recommend|best\s+movies|best\s+books|travel\s+itinerary|hello|hi\b|hey\b|how\s+are\s+you|thanks|thank\s+you)\b|(چیه|چیست|کیست|کجاست|چطور\s*کار\s*میکنه|چگونه\s*کار\s*میکند|توضیح\s*بده|توضیح\s*دهید|تفاوت|مقایسه\s*کن|سرچ\s*کن|جستجو\s*کن|تو\s*اینترنت|در\s*اینترنت|اخبار|خبر\s*جدید|آب\s*و\s*هوا|قیمت|ترجمه\s*کن|خلاصه\s*کن|بازنویسی|انشا|مقاله\s*درباره|داستان|شعر|جوک|دستور\s*پخت|پیشنهاد\s*بده|معرفی\s*کن|بهترین\s*فیلم|بهترین\s*کتاب|سلام|خوبی|چطوری|ممنون|مرسی|تشکر)/i;

const FOLLOWUP_EDIT_VERBS =
  /\b(change|update|modify|fix|adjust|add|remove|replace|make\s+it|switch|turn|increase|decrease|bigger|smaller|faster|slower|darker|lighter|responsive|color|background|font|button|score|level|sound|restart)\b|(عوض\s*کن|تغییر\s*بده|اضافه\s*کن|حذف\s*کن|درستش\s*کن|رنگشو|رنگش|بزرگتر|کوچیکتر|سریعتر|کندتر|ریسپانسیو|دکمه|امتیاز|مرحله|پس\s*زمینه|فونت)/i;

function normalizeText(value: string): string {
  return value.replace(/[\u200c\u200f\u200e]/g, " ").replace(/\s+/g, " ").trim();
}

function detectCategory(text: string): PreviewCategory {
  if (GAME_ARTIFACT.test(text)) return "game";
  if (WEBSITE_ARTIFACT.test(text)) return "website";
  if (APP_ARTIFACT.test(text)) return "app";
  if (UI_ARTIFACT.test(text)) return "ui";
  if (PROJECT_ARTIFACT.test(text)) return "project";
  return "none";
}

/**
 * Returns true if any previous assistant message in the thread already emitted
 * runnable HTML/CSS/JS/JSX/SVG project code.
 */
export function hasExistingPreviewCode(messages: PreviewIntentMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg || msg.role !== "assistant" || !msg.content) continue;
    if (PREVIEW_CODE_FENCE.test(msg.content) || RAW_HTML_DOC.test(msg.content)) {
      return true;
    }
  }
  return false;
}

/**
 * Fast, deterministic bilingual (`en` + `fa`) classifier.
 * High-confidence results resolve immediately in <1ms; ambiguous prompts return
 * `confidence: "medium"` or `"low"` so the backend AI judge can refine them.
 */
export function analyzePreviewIntentHeuristic(messages: PreviewIntentMessage[]): PreviewIntentResult {
  const userMessages = messages.filter((m) => m.role === "user" && m.content.trim().length > 0);
  const latestRaw = userMessages[userMessages.length - 1]?.content ?? "";
  const latest = normalizeText(latestRaw);

  if (!latest) {
    return {
      needsPreview: false,
      confidence: "high",
      category: "none",
      source: "heuristic",
      reason: "empty_prompt",
    };
  }

  // If this thread already contains generated project/preview code, keep the
  // preview workspace available for iterations and follow-up edits.
  if (hasExistingPreviewCode(messages)) {
    const existingCat = detectCategory(
      userMessages.map((m) => normalizeText(m.content)).join(" "),
    );
    return {
      needsPreview: true,
      confidence: "high",
      category: existingCat === "none" ? "project" : existingCat,
      source: "existing_project",
      reason: "existing_preview_code",
    };
  }

  const category = detectCategory(latest);
  const hasBuildVerb = BUILD_ACTION.test(latest);
  const hasNonPreview = NON_PREVIEW_INTENT.test(latest);
  const hasRawHtmlInUser = PREVIEW_CODE_FENCE.test(latestRaw) || RAW_HTML_DOC.test(latestRaw);

  // User pasted HTML/UI code asking to edit/fix/render it.
  if (hasRawHtmlInUser && (hasBuildVerb || FOLLOWUP_EDIT_VERBS.test(latest))) {
    return {
      needsPreview: true,
      confidence: "high",
      category: category === "none" ? "website" : category,
      source: "heuristic",
      reason: "user_html_edit",
    };
  }

  // Clear build verb + clear previewable artifact (website, game, app, UI, project).
  if (hasBuildVerb && category !== "none") {
    return {
      needsPreview: true,
      confidence: "high",
      category,
      source: "heuristic",
      reason: `build_${category}`,
    };
  }

  // Clear non-preview intent (search, Q&A, greeting, explanation, translation)
  // without a build verb -> definitely no preview needed.
  if (hasNonPreview && !hasBuildVerb) {
    return {
      needsPreview: false,
      confidence: "high",
      category: "none",
      source: "heuristic",
      reason: "conversational_or_search",
    };
  }

  // Short casual greetings / chit-chat with no artifact keywords.
  if (category === "none" && !hasBuildVerb && latest.length <= 80) {
    return {
      needsPreview: false,
      confidence: "high",
      category: "none",
      source: "heuristic",
      reason: "general_chat",
    };
  }

  // Ambiguous cases where an AI judge adds real value:
  // e.g. mentions a website/game/app without an explicit build verb ("فروشگاه آنلاین لباس؟"),
  // OR has a build verb without naming the exact artifact ("برام یه چیز تعاملی بساز").
  if (category !== "none" && !hasNonPreview) {
    // Direct noun requests like "snake game" or "landing page for coffee shop"
    const isQuestion = /[?؟]$/.test(latest);
    return {
      needsPreview: !isQuestion && latest.length <= 120,
      confidence: "medium",
      category,
      source: "heuristic",
      reason: isQuestion ? "ambiguous_artifact_question" : "artifact_mentioned",
    };
  }

  if (hasBuildVerb && !hasNonPreview) {
    return {
      needsPreview: false,
      confidence: "low",
      category: "none",
      source: "heuristic",
      reason: "ambiguous_build_without_artifact",
    };
  }

  return {
    needsPreview: false,
    confidence: "high",
    category: "none",
    source: "heuristic",
    reason: "default_chat",
  };
}

const VALID_CATEGORIES = new Set<PreviewCategory>([
  "website",
  "game",
  "app",
  "ui",
  "project",
  "none",
]);

/**
 * Parses strict JSON output from the backend AI intent classifier.
 */
export function parseAiIntentDecision(
  rawText: string | null | undefined,
): { needsPreview: boolean; category: PreviewCategory } | null {
  if (!rawText) return null;
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { preview?: unknown; needsPreview?: unknown; category?: unknown };
    const flag =
      typeof parsed.preview === "boolean"
        ? parsed.preview
        : typeof parsed.needsPreview === "boolean"
          ? parsed.needsPreview
          : null;
    if (flag === null) return null;
    const rawCat = typeof parsed.category === "string" ? parsed.category.toLowerCase().trim() : "none";
    const category: PreviewCategory = VALID_CATEGORIES.has(rawCat as PreviewCategory)
      ? (rawCat as PreviewCategory)
      : flag
        ? "project"
        : "none";
    return { needsPreview: flag, category: flag ? (category === "none" ? "project" : category) : "none" };
  } catch {
    return null;
  }
}

export function buildAiClassifierPrompt(latestUserMessage: string): PreviewIntentMessage[] {
  return [
    {
      role: "system",
      content:
        'You are a strict intent classifier for an AI workspace. Decide whether the user message asks to build, design, code, or edit a visual/interactive previewable project (website, web app, landing page, browser game, interactive UI component, dashboard, HTML/CSS/JS prototype). Return ONLY compact JSON with no extra text: {"preview":true|false,"category":"website"|"game"|"app"|"ui"|"project"|"none"}. Return preview:false for normal chat, web searches, Q&A, explanations, translations, essays, or conceptual programming questions.',
    },
    {
      role: "user",
      content: latestUserMessage.slice(0, 600),
    },
  ];
}

/**
 * Full backend preview-intent classifier:
 * 1. Resolves clear cases immediately via `analyzePreviewIntentHeuristic`.
 * 2. When ambiguous (`confidence !== "high"`) and `aiJudge` is available,
 *    delegates the final decision to the AI model with graceful fallback.
 */
export async function classifyPreviewIntent(options: {
  messages: PreviewIntentMessage[];
  aiJudge?: PreviewAiJudge;
}): Promise<PreviewIntentResult> {
  const heuristic = analyzePreviewIntentHeuristic(options.messages);
  if (heuristic.confidence === "high" || !options.aiJudge) {
    return heuristic;
  }

  const latestUser = [...options.messages]
    .reverse()
    .find((m) => m.role === "user" && m.content.trim().length > 0)?.content;
  if (!latestUser) return heuristic;

  try {
    const raw = await options.aiJudge(buildAiClassifierPrompt(latestUser));
    const decision = parseAiIntentDecision(raw);
    if (decision) {
      return {
        needsPreview: decision.needsPreview,
        confidence: "high",
        category: decision.category,
        source: "ai",
        reason: decision.needsPreview ? `ai_${decision.category}` : "ai_no_preview",
      };
    }
  } catch {
    // Gracefully fall back to heuristic if the quick AI judge times out or errors.
  }

  return heuristic;
}

export function previewIntentHeaders(result: PreviewIntentResult): Record<string, string> {
  return {
    "X-Preview-Intent": result.needsPreview ? "1" : "0",
    "X-Preview-Category": result.category,
    "X-Preview-Source": result.source,
  };
}
