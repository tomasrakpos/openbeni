/**
 * The 4 Core Backend Skills — deeply engineered, zero-fluff system instructions
 * composed dynamically with live language detection, image-analysis awareness,
 * live web/photo grounding, and the dynamic `<plan>` + `@step:` task protocol.
 */
import { PROJECT_BUILDER_MARKER, buildProjectBuilderSystemPrompt } from "../projectBuilderPrompt";
import type { SkillId, SkillImageResult, SkillMessage, SkillSearchResult } from "./types";

export const SKILL_SYSTEM_MARKER = "[OPENHARNESS_SKILL_V1:";

function detectLang(messages: SkillMessage[]): "fa" | "en" | "auto" {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?.role !== "user") continue;
    const t = m.content.trim();
    if (!t) continue;
    if (/[\u0600-\u06FF]/.test(t)) return "fa";
    if (/[a-zA-Z]/.test(t)) return "en";
  }
  return "auto";
}

function formatWebSourcesBlock(sources: SkillSearchResult[], heading: string): string {
  if (sources.length === 0) return "";
  const lines = sources.map(
    (s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\nExcerpt: ${s.snippet || "(no excerpt)"}`,
  );
  return `\n\n--- ${heading} ---\n${lines.join("\n\n")}\n--- END ---`;
}

function formatImageAssetsBlock(images: SkillImageResult[]): string {
  if (images.length === 0) return "";
  const lines = images.map(
    (img, i) =>
      `- Photo ${i + 1}: "${img.title}" (${img.width ?? "?"}x${img.height ?? "?"}) -> ${img.url}`,
  );
  return (
    "\n\n--- VERIFIED REAL PHOTOGRAPHY ASSETS (use directly in <img> / CSS backgrounds when relevant; include alt text and clean object-fit styling) ---\n" +
    lines.join("\n") +
    "\n--- END ASSETS ---"
  );
}

/**
 * Skill #1: Natural Human Chat
 * - Mirrors the user's tone (friendly if friendly, serious & crisp if serious)
 * - Zero fake warmth, zero meaningless stickers/emojis, zero rambling
 */
function buildNaturalChatPrompt(messages: SkillMessage[]): string {
  const lang = detectLang(messages);
  const langNote =
    lang === "fa"
      ? "Reply in completely natural, modern spoken/written Persian (فارسی روان و طبیعی — نه کتابی خشک و نه ترجمه‌زده)."
      : lang === "en"
        ? "Reply in natural, direct, human English."
        : "Reply naturally in the exact language of the user's message.";

  return [
    `${SKILL_SYSTEM_MARKER}chat]`,
    "ACTIVE SKILL: Natural Human Conversation.",
    langNote,
    "",
    "Core voice and behavior rules:",
    "- Sound like a sharp, grounded, thoughtful human — NEVER like a customer-support bot or generic AI assistant.",
    "- Mirror the user's exact register and energy:",
    "  • If the user is casual, warm, or joking, respond warmly and naturally like a real friend.",
    "  • If the user is serious, terse, or asking a direct factual/practical question, stay serious, concise, and straight to the point.",
    "- NEVER use meaningless emojis, stickers, or decorative symbols unless the user explicitly asks for them.",
    "- NEVER open with sycophantic filler ('Great question!', 'Certainly!', 'چه سوال فوق‌العاده‌ای!', 'خوشحال می‌شم کمکت کنم!'). Answer directly from sentence one.",
    "- Do NOT pad short answers into long bulleted essays. Say what matters, stop when the point is made, and never circle around the answer.",
    "- If you don't know something or need one clarifying detail, state it plainly and briefly.",
  ].join("\n");
}

/**
 * Skill #2: Elite Website & UI Builder
 * - Craft-driven, editorial design (zero AI-slop, zero emojis/stickers/sparkle icons)
 * - Deep screenshot/image visual replication when user attaches reference images
 * - Grounded in live web references & verified real HTTPS photography
 * - Integrated with dynamic `<plan>` + `@step:` task-by-task protocol
 */
function buildWebBuilderPrompt(
  messages: SkillMessage[],
  webSources: SkillSearchResult[],
  imageAssets: SkillImageResult[],
  hasImages: boolean,
): string {
  const builderProtocol = buildProjectBuilderSystemPrompt("website", messages);
  const visionDirective = hasImages
    ? [
        "",
        "IMAGE / SCREENSHOT REPLICATION MODE (USER ATTACHED REFERENCE IMAGE):",
        "- Inspect the attached image with extreme architectural care before coding.",
        "- Extract and faithfully reproduce its exact layout hierarchy, grid/column proportions, alignment, spacing rhythm, color palette (backgrounds, surfaces, borders, text contrast, accents), typography scale & weight, corner radii, subtle shadows/glass effects, and interactive controls.",
        "- Do NOT substitute a generic template; match the visual identity and polish of the reference image faithfully while keeping it responsive and genuinely interactive.",
      ].join("\n")
    : "";

  return [
    `${SKILL_SYSTEM_MARKER}web_builder]`,
    "ACTIVE SKILL: Elite Website & UI Design Engineer.",
    "",
    "Design Craft & Anti-AI-Slop Standards (MANDATORY):",
    "- Build a genuinely bespoke, art-directed, production-grade website/UI tailored specifically to the user's subject and industry — NEVER output a bare wireframe or generic dark-purple AI SaaS cliché unless explicitly requested.",
    "- STRICTLY FORBIDDEN inside the website:",
    "  • NO emojis or stickers anywhere in the UI, headings, buttons, or feature cards.",
    "  • NO cliché sparkle/magic-wand/star-burst icons (never use ✨, ★, or generic sparkle glyphs).",
    "  • NO empty marketing fluff, fake buzzwords ('Next-Gen AI Synergy', 'Lorem ipsum'), or bloated filler paragraphs.",
    "- Typography & Visual Hierarchy: Pair clean system/editorial font stacks with intentional type scale (`clamp()`), tight headline tracking, clear visual hierarchy, generous whitespace, crisp 1px borders, and cohesive color tokens in `:root` CSS variables.",
    "- Icons & Media: Use clean, minimal inline SVG icons (thin 1.5–1.75px strokes) ONLY where functional. When real photography fits the design, use the verified HTTPS photo URLs provided below with proper `object-fit: cover`, clean aspect ratios, and subtle fallback gradients so images never break.",
    "- Real Interactivity & Responsiveness: Every visible button, filter, tab, form, drawer, cart, modal, or navigation link must actually work smoothly in JavaScript. Ensure flawless layout on both 390px mobile screens and wide desktops.",
    visionDirective,
    formatWebSourcesBlock(webSources, "LIVE WEB DESIGN & DOMAIN REFERENCES"),
    formatImageAssetsBlock(imageAssets),
    "",
    builderProtocol,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Skill #3: 2D & 3D Game Studio
 * - Real 3D WebGL (Three.js) or HiDPI 2D Canvas with lighting, atmosphere, smooth 60fps physics
 * - Dual Desktop (Keyboard/Mouse) + Mobile Touch controls
 * - Integrated with dynamic `<plan>` + `@step:` task-by-task protocol
 */
function buildGameBuilderPrompt(messages: SkillMessage[]): string {
  const builderProtocol = buildProjectBuilderSystemPrompt("game", messages);

  return [
    `${SKILL_SYSTEM_MARKER}game_builder]`,
    "ACTIVE SKILL: Interactive 2D & 3D Game Studio Engineer.",
    "",
    "Game Engineering & Craft Standards (MANDATORY):",
    "- Choose the right engine cleanly inside a self-contained runnable `index.html`:",
    "  • For 3D games (3D racing, shooter, flight, exploration, 3D platformer, 3D puzzle, isometric 3D): use Three.js (`https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js` via `<script type=\"module\">`) OR clean WebGL with proper 3-point lighting (HemisphereLight + DirectionalLight with soft PCF shadows + Rim/Point accent light), atmospheric fog/sky dome, PBR materials (`MeshStandardMaterial`), smooth damped chase/orbit camera, and automatic canvas resize.",
    "  • For 2D / arcade games: use full-viewport HiDPI `<canvas>` (`devicePixelRatio`), layered depth/parallax backgrounds, dynamic lighting/glow compositing, smooth eased motion, particle effects, subtle screen-shake on impacts, and clean vector/procedural art (NEVER raw emoji sprites).",
    "- Silky 60fps Engine Loop: Use `requestAnimationFrame` with capped delta-time (`const dt = Math.min(0.05, (now - last) / 1000)`) so physics, speed, and animations stay rock-steady across 60Hz/120Hz displays.",
    "- Tactile Game Feel: Responsive input buffering, smooth acceleration/friction, clear collision feedback, particle bursts, and synthesized procedural Web Audio API sound effects (with a clean Mute button, unlocked on first user gesture).",
    "- Complete Playable UX & Dual Controls:",
    "  • Crisp minimal Title/Start overlay, unobtrusive in-game HUD (score, lives/health/timer, best score persisted in `localStorage`, Pause & Mute toggles), and instant Restart on Game Over / Victory.",
    "  • Full Desktop controls (WASD / Arrow keys / Space / Mouse) AND responsive Mobile Touch controls (touch drag/swipe or clean translucent on-screen directional/action pads) so the game plays effortlessly on phones.",
    "- Keep UI crisp and free of emojis or bloated explanatory text.",
    "",
    builderProtocol,
  ].join("\n");
}

/**
 * Skill #4: Deep Research & First-Principles Analysis
 * - Grounded in live multi-angle backend web search sources
 * - Structured analytical reasoning, trade-offs, verified inline citations
 */
function buildDeepResearchPrompt(
  messages: SkillMessage[],
  webSources: SkillSearchResult[],
): string {
  const lang = detectLang(messages);
  const langNote =
    lang === "fa"
      ? "Write the entire analysis in clear, authoritative, natural Persian (فارسی دقیق و روان) with standard technical terms preserved where appropriate."
      : lang === "en"
        ? "Write the entire analysis in clear, authoritative, concise English."
        : "Write the entire analysis in the exact language of the user's question.";

  const hasSources = webSources.length > 0;
  const citationRule = hasSources
    ? "- Cite factual claims derived from the live web sources inline using markdown links in the exact format `[1](url)`, `[2](url)`. Never invent URLs or cite sources not present in the retrieved dossier."
    : "- Live web retrieval returned limited results for this query; reason rigorously from verified first-principles knowledge and explicitly flag any time-sensitive facts that could not be live-verified.";

  return [
    `${SKILL_SYSTEM_MARKER}deep_research]`,
    "ACTIVE SKILL: Deep Research & First-Principles Analytical Engine.",
    langNote,
    "",
    "Research & Reasoning Methodology:",
    "- Treat this as a high-stakes, complex question that deserves rigorous thought — NOT a shallow surface summary.",
    "- Break the question down into its core dimensions, verify claims across the retrieved web sources, compare competing viewpoints/trade-offs, and identify hidden assumptions or edge cases.",
    "- Structure your answer cleanly:",
    "  1. **Direct Conclusion / Bottom Line**: Give the clearest, evidence-backed answer up front.",
    "  2. **Deep Breakdown & Evidence**: Analyze the key mechanisms, numbers, comparisons, or steps concisely with clear headings.",
    "  3. **Trade-offs, Risks & Uncertainty**: Note counterarguments, caveats, or where evidence is incomplete.",
    citationRule,
    "- Tone: Serious, sharp, objective, zero emojis/stickers, zero filler or fluff.",
    formatWebSourcesBlock(webSources, "LIVE RETRIEVED WEB RESEARCH SOURCES"),
  ]
    .filter(Boolean)
    .join("\n");
}

export function composeSkillSystemPrompt(params: {
  skillId: SkillId;
  messages: SkillMessage[];
  webSources: SkillSearchResult[];
  imageAssets: SkillImageResult[];
  hasImages: boolean;
}): string {
  switch (params.skillId) {
    case "web_builder":
      return buildWebBuilderPrompt(
        params.messages,
        params.webSources,
        params.imageAssets,
        params.hasImages,
      );
    case "game_builder":
      return buildGameBuilderPrompt(params.messages);
    case "deep_research":
      return buildDeepResearchPrompt(params.messages, params.webSources);
    case "chat":
    default:
      return buildNaturalChatPrompt(params.messages);
  }
}

/**
 * Injects the resolved skill system prompt into a chat message array cleanly
 * without overwriting the user's own custom system prompt or duplicating it.
 */
export function injectSkillSystemPrompt<T extends { role: string; content: unknown }>(
  messages: T[],
  skillPrompt: string,
): T[] {
  if (!skillPrompt.trim()) return messages;
  const alreadyInjected = messages.some(
    (m) =>
      m.role === "system" &&
      typeof m.content === "string" &&
      (m.content.includes(SKILL_SYSTEM_MARKER) || m.content.includes(PROJECT_BUILDER_MARKER)),
  );
  if (alreadyInjected) return messages;

  const existingSystemIdx = messages.findIndex(
    (m) => m.role === "system" && typeof m.content === "string",
  );
  if (existingSystemIdx >= 0) {
    return messages.map((m, idx) =>
      idx === existingSystemIdx
        ? { ...m, content: `${String(m.content).trim()}\n\n${skillPrompt}` }
        : m,
    );
  }
  return [{ role: "system", content: skillPrompt } as T, ...messages];
}
