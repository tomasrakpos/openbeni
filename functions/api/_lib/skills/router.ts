/**
 * Hybrid Automatic + Manual 4-Skill Router & Execution Orchestrator.
 *
 * Routes every conversation turn to the best-fit backend skill:
 * 1. `chat`          — Natural human conversation (tone-mirrored)
 * 2. `web_builder`   — Elite website/UI builder (+ screenshot analysis + live web/photo references)
 * 3. `game_builder`  — 2D & 3D WebGL/Canvas game studio
 * 4. `deep_research` — Multi-angle live web search + first-principles deep analysis
 *
 * Supports:
 * - Automatic routing (`skillMode: "auto"`): fast bilingual EN/FA heuristics +
 *   lightweight AI fallback for ambiguous messages.
 * - Manual override (`skillMode: "chat" | "web_builder" | "game_builder" | "deep_research"`):
 *   honors the user's explicit selection immediately.
 */
import {
  analyzePreviewIntentHeuristic,
  type PreviewAiJudge,
  type PreviewCategory,
} from "../previewIntent";
import { composeSkillSystemPrompt } from "./definitions";
import {
  extractWebTopicQuery,
  runDeepResearch,
  searchReferenceImages,
  searchWeb,
} from "./webSearch";
import {
  isSkillId,
  normalizeSkillMode,
  type SkillEnv,
  type SkillExecutionContext,
  type SkillId,
  type SkillImageResult,
  type SkillMessage,
  type SkillMode,
  type SkillRouteSource,
  type SkillSearchResult,
} from "./types";

const DEEP_RESEARCH_STRONG_PATTERNS: RegExp[] = [
  // Explicit web search / live info lookup (EN & FA)
  /\b(search\s+(the\s+)?(web|internet|online|google)|look\s+up\s+(online|the\s+latest)|latest\s+(news|updates?|release|benchmarks?|stats|prices?)|current\s+(price|status|rate|version)|find\s+sources?)\b/i,
  /(?:سرچ\s*کن|جستجو\s*کن|توی?\s*اینترنت|در\s*اینترنت|آخرین\s*(?:اخبار|خبر|نسخه|آمار|قیمت)|قیمت\s*(?:روز|امروز|لحظه‌ای)|منابع\s*معتبر)/,
  // Deep research / rigorous analysis / multi-factor comparison (EN & FA)
  /\b(deep\s*(research|dive|analysis|think(?:ing)?)|comprehensive\s+(analysis|comparison|report|review|guide)|in[-\s]?depth\s+(analysis|comparison|look|breakdown)|first[-\s]?principles|trade[-\s]?offs?|benchmark\s+comparison|pros\s+and\s+cons\s+of|research\s+(paper|report|this|about)|analyze\s+in\s+detail|step[-\s]?by[-\s]?step\s+proof)\b/i,
  /(?:تحقیق\s*(?:عمیق|کامل|جامع)|تحلیل\s*(?:عمیق|دقیق|جامع|فنی|تخصصی|کامل)|بررسی\s*(?:عمیق|جامع|کامل|تخصصی|دقیق)|مقایسه\s*(?:کامل|دقیق|جامع|عمیق)|مزایا\s*و\s*معایب|ریشه‌ای\s*بررسی|فکر\s*عمیق|استدلال\s*عمیق)/,
];

const COMPLEX_QUESTION_SIGNALS: RegExp =
  /\b(compare|versus|vs\.?|architecture|strategy|economic|geopolitic|scientific|quantum|algorithm|theorem|prove|diagnose|root\s*cause|evaluate|impact\s+of|why\s+does|how\s+does\s+.+\s+work)\b|(?:مقایسه|معماری|استراتژی|اقتصادی|علمی|الگوریتم|اثبات|علت\s*اصلی|ارزیابی|تأثیر|تاثیر|تفاوت\s*(?:عمیق|اساسی|دقیق))/i;

const IMAGE_BUILD_SIGNAL: RegExp =
  /\b(recreate|replicate|clone|build|code|turn\s+this\s+into|convert\s+to\s+(html|css|react|code|website|ui)|make\s+this\s+(page|site|ui|design)|from\s+this\s+(image|screenshot|photo|design))\b|(?:از\s*روی\s*(?:این\s*)?(?:عکس|تصویر|اسکرین‌شات|طرح)|شبیه\s*(?:این\s*)?(?:عکس|تصویر|طرح)|این\s*(?:طرح|عکس|تصویر)\s*رو\s*(?:بساز|کد|طراحی|پیاده))/i;

const GAME_STRONG_SIGNAL: RegExp =
  /\b(3d\s+game|2d\s+game|three\.?js|webgl\s+game|arcade|shooter|racing\s+game|platformer|rpg|snake\s+game|tetris|chess|pong|breakout|flappy|roguelike|tower\s+defense|game\s+engine)\b|(?:بازی\s*(?:سه‌بعدی|سه\s*بعدی|دوبعدی|دو\s*بعدی|آنلاین|تحت\s*وب|ماشین|جنگی|تفنگی|فکری|پازل|مار|دوز|شطرنج|آرکید)|گیم\s*(?:بساز|طراحی|سه‌بعدی|سه\s*بعدی))/i;

const SKILL_ROUTER_AI_PROMPT =
  'You are a strict skill router. Classify the user\'s latest request into EXACTLY ONE skill:\n' +
  '- "web_builder": building/designing/editing a website, landing page, web app, dashboard, or UI component.\n' +
  '- "game_builder": building/designing/editing a playable 2D or 3D video game.\n' +
  '- "deep_research": complex analytical questions, in-depth comparisons, technical/scientific/financial deep dives, or live web research/fact lookup.\n' +
  '- "chat": ordinary conversation, greetings, casual talk, quick simple questions, translation, or short writing.\n' +
  'Respond with ONLY compact JSON: {"skill":"chat"|"web_builder"|"game_builder"|"deep_research"}';

export interface SkillRouteDecision {
  skillId: SkillId;
  source: SkillRouteSource;
  confidence: "high" | "low";
  needsPreview: boolean;
  previewCategory: PreviewCategory;
  reason: string;
}

function lastUserMessage(messages: SkillMessage[]): SkillMessage | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?.role === "user" && (m.content.trim() || m.hasImages)) return m;
  }
  return null;
}

export function routeSkillHeuristic(
  messages: SkillMessage[],
  requestedMode: SkillMode = "auto",
): SkillRouteDecision {
  const mode = normalizeSkillMode(requestedMode);

  // 1. Manual pin overrides automatic routing immediately.
  if (mode !== "auto") {
    const previewCategory: PreviewCategory =
      mode === "game_builder"
        ? "game"
        : mode === "web_builder"
          ? "website"
          : "none";
    return {
      skillId: mode,
      source: "manual",
      confidence: "high",
      needsPreview: mode === "web_builder" || mode === "game_builder",
      previewCategory,
      reason: `manual_${mode}`,
    };
  }

  const latest = lastUserMessage(messages);
  if (!latest) {
    return {
      skillId: "chat",
      source: "heuristic",
      confidence: "high",
      needsPreview: false,
      previewCategory: "none",
      reason: "empty_lobby",
    };
  }

  const text = latest.content.trim();
  const hasImages = Boolean(latest.hasImages);

  // 2. If user attached a UI screenshot/image and asks to recreate/build it -> web_builder.
  if (hasImages && (!text || IMAGE_BUILD_SIGNAL.test(text))) {
    return {
      skillId: "web_builder",
      source: "heuristic",
      confidence: "high",
      needsPreview: true,
      previewCategory: "ui",
      reason: "image_to_website",
    };
  }

  // 3. Strong explicit game signal -> game_builder.
  if (GAME_STRONG_SIGNAL.test(text)) {
    const preview = analyzePreviewIntentHeuristic(messages);
    if (preview.needsPreview || /(?:بساز|طراحی|درست\s*کن|بنویس|build|create|make|code|develop)/i.test(text)) {
      return {
        skillId: "game_builder",
        source: "heuristic",
        confidence: "high",
        needsPreview: true,
        previewCategory: "game",
        reason: "build_game",
      };
    }
  }

  // 4. Delegate build/project check to our proven bilingual preview-intent classifier.
  const preview = analyzePreviewIntentHeuristic(messages);
  if (preview.needsPreview && preview.confidence === "high") {
    const isGame = preview.category === "game";
    return {
      skillId: isGame ? "game_builder" : "web_builder",
      source: preview.source === "existing_project" ? "existing_project" : "heuristic",
      confidence: "high",
      needsPreview: true,
      previewCategory: preview.category,
      reason: preview.reason,
    };
  }

  // 5. Explicit deep research / web search / rigorous analysis -> deep_research.
  if (DEEP_RESEARCH_STRONG_PATTERNS.some((re) => re.test(text))) {
    return {
      skillId: "deep_research",
      source: "heuristic",
      confidence: "high",
      needsPreview: false,
      previewCategory: "none",
      reason: "deep_research_signal",
    };
  }

  // 6. Long, complex analytical questions -> deep_research.
  if (text.length >= 160 && COMPLEX_QUESTION_SIGNALS.test(text)) {
    return {
      skillId: "deep_research",
      source: "heuristic",
      confidence: "high",
      needsPreview: false,
      previewCategory: "none",
      reason: "complex_analytical_query",
    };
  }

  // 7. Ambiguous build or medium-complex question -> mark low confidence so AI judge can refine.
  if (preview.confidence === "low" || (text.length >= 70 && COMPLEX_QUESTION_SIGNALS.test(text))) {
    return {
      skillId: "chat",
      source: "heuristic",
      confidence: "low",
      needsPreview: false,
      previewCategory: "none",
      reason: "ambiguous_intent",
    };
  }

  // 8. Default: natural human chat.
  return {
    skillId: "chat",
    source: "heuristic",
    confidence: "high",
    needsPreview: false,
    previewCategory: "none",
    reason: "natural_chat",
  };
}

export function parseAiSkillDecision(raw: string): SkillId | null {
  if (!raw || typeof raw !== "string") return null;
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const slice = start !== -1 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  try {
    const parsed = JSON.parse(slice) as { skill?: unknown };
    if (isSkillId(parsed.skill)) return parsed.skill;
    return null;
  } catch {
    return null;
  }
}

/**
 * Full backend skill resolution + live web/image grounding + tailored prompt composition.
 */
export async function resolveSkillExecution(options: {
  messages: SkillMessage[];
  skillMode?: SkillMode;
  env?: SkillEnv;
  aiJudge?: PreviewAiJudge;
  /** Set false in pure unit tests or fast-path probes that don't need live HTTP search. */
  enableLiveSearch?: boolean;
}): Promise<SkillExecutionContext> {
  const { messages, skillMode = "auto", env = {}, aiJudge, enableLiveSearch = true } = options;
  let decision = routeSkillHeuristic(messages, skillMode);

  // Refine ambiguous auto-routed messages via the lightweight AI judge.
  if (decision.confidence === "low" && aiJudge) {
    try {
      const recent = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-4)
        .map((m) => ({
          role: m.role,
          content: m.content.slice(0, 600),
        }));
      const raw = await Promise.race<string | null>([
        aiJudge([{ role: "system", content: SKILL_ROUTER_AI_PROMPT }, ...recent]),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2_500)),
      ]);
      const aiSkill = raw ? parseAiSkillDecision(raw) : null;
      if (aiSkill) {
        decision = {
          skillId: aiSkill,
          source: "ai",
          confidence: "high",
          needsPreview: aiSkill === "web_builder" || aiSkill === "game_builder",
          previewCategory:
            aiSkill === "game_builder"
              ? "game"
              : aiSkill === "web_builder"
                ? "website"
                : "none",
          reason: `ai_${aiSkill}`,
        };
      }
    } catch {
      // Keep safe heuristic fallback.
    }
  }

  const latest = lastUserMessage(messages);
  const queryText = latest?.content.trim() ?? "";
  const hasImages = messages.some((m) => m.role === "user" && m.hasImages);

  let webSources: SkillSearchResult[] = [];
  let imageAssets: SkillImageResult[] = [];

  if (enableLiveSearch && queryText) {
    if (decision.skillId === "deep_research") {
      webSources = await runDeepResearch(queryText, env);
    } else if (decision.skillId === "web_builder") {
      const topic = extractWebTopicQuery(queryText);
      const [refs, photos] = await Promise.all([
        searchWeb(`${topic} website design reference`, env, 3),
        searchReferenceImages(topic, env, 4),
      ]);
      webSources = refs;
      imageAssets = photos;
    }
  }

  const systemPrompt = composeSkillSystemPrompt({
    skillId: decision.skillId,
    messages,
    webSources,
    imageAssets,
    hasImages,
  });

  return {
    skillId: decision.skillId,
    source: decision.source,
    confidence: decision.confidence,
    needsPreview: decision.needsPreview,
    previewCategory: decision.previewCategory,
    reason: decision.reason,
    webSources,
    imageAssets,
    systemPrompt,
  };
}

/** HTTP response headers emitted on `/api/chat` and `/api/preview-intent`. */
export function skillResponseHeaders(ctx: SkillExecutionContext): Record<string, string> {
  return {
    "X-Skill-Id": ctx.skillId,
    "X-Skill-Source": ctx.source,
    "X-Skill-Search-Count": String(ctx.webSources.length + ctx.imageAssets.length),
    "X-Preview-Intent": ctx.needsPreview ? "1" : "0",
    "X-Preview-Category": ctx.previewCategory,
    "X-Preview-Source": ctx.source === "manual" ? "heuristic" : ctx.source,
  };
}
