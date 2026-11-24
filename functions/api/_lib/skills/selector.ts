// Targeted skill selection, game-engine filtering, single-brand DESIGN.md lookup,
// lazy references handling, and strict per-request token budget enforcement.

import { estimateTokens, truncateToTokenBudget } from "./frontmatter";
import {
  getSkillRegistry,
  listSkillsForCategory,
  loadSkillFile,
  matchDesignMdBrand,
  type SkillRegistry,
} from "./registry";
import {
  extractPlainText,
  type LoadedSkillDocument,
  type ProviderFormat,
  type SkillCategory,
  type SkillChatMessage,
  type SkillContentReader,
  type SkillInjectionMode,
  type SkillMetadata,
  type SkillRuntimeEnv,
  type SkillSelectionResult,
} from "./types";

const ENGINE_PATTERNS: Array<{ engine: string; regex: RegExp }> = [
  { engine: "godot", regex: /\b(?:godot|gdscript|tscn|tres|characterbody2d|characterbody3d|node2d|node3d)\b/i },
  { engine: "unity", regex: /\b(?:unity|unity3d|monobehaviour|scriptableobject|navmesh|urp|hdrp|prefab)\b/i },
  { engine: "unreal", regex: /\b(?:unreal|ue5|ue4|uproperty|ufunction|niagara|blueprints?\s+unreal|unreal\s+engine)\b/i },
  { engine: "threejs", regex: /\b(?:three\.?js|react-three-fiber|@react-three\/fiber|r3f|drei|webgl\s+3d|3d\s+browser\s+game)\b/i },
  { engine: "phaser", regex: /\b(?:phaser|phaser3|arcade\s+physics)\b/i },
  { engine: "pixijs", regex: /\b(?:pixi\.?js|pixijs)\b/i },
  { engine: "roblox", regex: /\b(?:roblox|luau|roblox\s+studio|datastore)\b/i },
  { engine: "bevy", regex: /\b(?:bevy|bevy_ecs|rust\s+ecs\s+game)\b/i },
  { engine: "pygame", regex: /\b(?:pygame|python\s+2d\s+game)\b/i },
  { engine: "love2d", regex: /\b(?:love2d|l[öo]ve2d|lua\s+game)\b/i },
  { engine: "defold", regex: /\b(?:defold)\b/i },
  { engine: "ebitengine", regex: /\b(?:ebitengine|ebiten)\b/i },
];

/**
 * Detects the requested game engine from recent user messages.
 * Defaults to "web" when no native engine is mentioned.
 */
export function detectGameEngine(queryText: string): string {
  for (const { engine, regex } of ENGINE_PATTERNS) {
    if (regex.test(queryText)) return engine;
  }
  return "web";
}

/**
 * Resolves the configured max token budget per request (env overrides config).
 */
export function resolveMaxSkillTokens(
  env?: SkillRuntimeEnv,
  explicitOverride?: number,
  registry: SkillRegistry = getSkillRegistry()
): number {
  if (typeof explicitOverride === "number" && Number.isFinite(explicitOverride) && explicitOverride > 0) {
    return Math.floor(explicitOverride);
  }
  const envVal = Number(env?.SKILL_MAX_TOKENS);
  if (Number.isFinite(envVal) && envVal >= 200) {
    return Math.floor(envVal);
  }
  return registry.config.defaults.maxTokensPerRequest;
}

/**
 * Resolves whether to use Mode A ("direct") or Mode B ("tool") for a given
 * provider format and model id, configurable via skills.config.json and env.
 */
export function resolveInjectionMode(options: {
  providerFormat?: ProviderFormat | string;
  model?: string;
  env?: SkillRuntimeEnv;
  explicitMode?: SkillInjectionMode;
  supportsTools?: boolean;
  registry?: SkillRegistry;
}): SkillInjectionMode {
  const registry = options.registry || getSkillRegistry();
  const canUseTools =
    options.supportsTools !== false &&
    options.providerFormat !== "custom";

  let desired: SkillInjectionMode = registry.config.defaults.mode || "direct";

  // 1. Config providerModes & modelModes
  const fmt = (options.providerFormat || "").toLowerCase();
  if (fmt && registry.config.providerModes?.[fmt]) {
    desired = registry.config.providerModes[fmt]!;
  }
  const modelKey = (options.model || "").trim();
  if (modelKey && registry.config.modelModes?.[modelKey]) {
    desired = registry.config.modelModes[modelKey];
  }

  // 2. Env default mode overrides config defaults
  const envDefault =
    typeof options.env?.SKILL_DEFAULT_MODE === "string"
      ? options.env.SKILL_DEFAULT_MODE.trim().toLowerCase()
      : "";
  if (envDefault === "direct" || envDefault === "tool") {
    desired = envDefault;
  }

  // 3. Env SKILL_PROVIDER_MODES JSON override (e.g. '{"openai":"tool","anthropic":"tool"}')
  if (typeof options.env?.SKILL_PROVIDER_MODES === "string" && options.env.SKILL_PROVIDER_MODES.trim()) {
    try {
      const parsed = JSON.parse(options.env.SKILL_PROVIDER_MODES) as Record<string, string>;
      if (fmt && (parsed[fmt] === "direct" || parsed[fmt] === "tool")) {
        desired = parsed[fmt] as SkillInjectionMode;
      }
    } catch {
      // ignore malformed env json
    }
  }

  // 4. Env SKILL_MODEL_MODES JSON override
  if (typeof options.env?.SKILL_MODEL_MODES === "string" && options.env.SKILL_MODEL_MODES.trim()) {
    try {
      const parsed = JSON.parse(options.env.SKILL_MODEL_MODES) as Record<string, string>;
      if (modelKey && (parsed[modelKey] === "direct" || parsed[modelKey] === "tool")) {
        desired = parsed[modelKey] as SkillInjectionMode;
      }
    } catch {
      // ignore malformed env json
    }
  }

  // 5. Explicit per-call override (useful for tests)
  if (options.explicitMode === "direct" || options.explicitMode === "tool") {
    desired = options.explicitMode;
  }

  // Automatic fallback to Mode A if provider/model does not support tools
  if (desired === "tool" && !canUseTools) {
    return "direct";
  }

  return desired;
}

/**
 * Scores a skill's relevance against the user's recent messages using its id,
 * tags, and frontmatter description.
 */
function scoreSkillRelevance(meta: SkillMetadata, queryLower: string, words: Set<string>): number {
  let score = 0;

  // Direct id or name mention
  const idParts = meta.id.toLowerCase().split(/[-_]/).filter((p) => p.length >= 2);
  if (queryLower.includes(meta.id.toLowerCase())) {
    score += 30;
  }
  for (const part of idParts) {
    if (words.has(part)) score += 6;
  }

  // Tag matches
  for (const tag of meta.tags) {
    const t = tag.toLowerCase();
    if (t.length < 2) continue;
    if (words.has(t)) {
      score += 8;
    } else if (t.includes("-") && queryLower.includes(t.replace(/-/g, " "))) {
      score += 10;
    } else if (t.length >= 4 && queryLower.includes(t)) {
      score += 4;
    }
  }

  // Description keyword matches
  const descWords = meta.description
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4);
  let descHits = 0;
  for (const dw of descWords) {
    if (words.has(dw)) {
      descHits++;
      if (descHits <= 4) score += 2;
    }
  }

  // Slight tie-breaker favoring higher-priority skills
  score += Math.max(0, (100 - meta.priority) * 0.02);
  return score;
}

function tokenizeQuery(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9+#.]+/)
      .filter((w) => w.length >= 2)
  );
}

function buildRecentUserQuery(messages: SkillChatMessage[], maxUserTurns = 4): string {
  const userTexts = messages
    .filter((m) => m.role === "user")
    .slice(-maxUserTurns)
    .map((m) => extractPlainText(m.content).trim())
    .filter(Boolean);
  return userTexts.join("\n");
}

export interface SelectSkillsOptions {
  category: SkillCategory;
  messages: SkillChatMessage[];
  reader: SkillContentReader;
  env?: SkillRuntimeEnv;
  providerFormat?: ProviderFormat | string;
  model?: string;
  supportsTools?: boolean;
  explicitMode?: SkillInjectionMode;
  maxTokensOverride?: number;
  registry?: SkillRegistry;
}

/**
 * Selects the targeted skills for a classified category, enforces engine isolation
 * for `game`, indexes single-brand `DESIGN.md` matches for `website`, keeps
 * `references/` lazy, and strictly enforces the per-request token budget.
 */
export async function selectSkillsForCategory(
  options: SelectSkillsOptions
): Promise<SkillSelectionResult> {
  const registry = options.registry || getSkillRegistry();
  const maxTokens = resolveMaxSkillTokens(
    options.env,
    options.maxTokensOverride,
    registry
  );
  const mode = resolveInjectionMode({
    providerFormat: options.providerFormat,
    model: options.model,
    env: options.env,
    explicitMode: options.explicitMode,
    supportsTools: options.supportsTools,
    registry,
  });

  const queryText = buildRecentUserQuery(options.messages);
  const queryLower = queryText.toLowerCase();
  const words = tokenizeQuery(queryText);
  const maxCount =
    registry.config.defaults.maxSelectedSkills[options.category] ?? 3;

  let candidateMetadata: SkillMetadata[] = [];
  let orderedQueue: SkillMetadata[] = [];
  let detectedEngine: string | undefined;
  let matchedDesignBrand: string | undefined;
  let matchedDesignRefPath: string | undefined;

  if (options.category === "website") {
    const allWebsite = listSkillsForCategory("website", registry);
    // Core skills ALWAYS first: taste-skill (P1), impeccable (P2)
    const cores = allWebsite.filter((s) => s.core);
    // Selective add-ons (exclude awesome-design-md meta-index from automatic full-body load; handled separately!)
    const addOns = allWebsite.filter(
      (s) => !s.core && s.id !== "awesome-design-md"
    );

    const scoredAddOns = addOns
      .map((meta) => ({
        meta,
        score: scoreSkillRelevance(meta, queryLower, words),
      }))
      .filter((x) => x.score >= 8)
      .sort((a, b) => b.score - a.score || a.meta.priority - b.meta.priority);

    // Check if user requested a specific brand style from awesome-design-md (load ONLY 1 matching DESIGN.md)
    const brandMatch = matchDesignMdBrand(queryText, registry);
    if (brandMatch) {
      matchedDesignBrand = brandMatch.brand;
      matchedDesignRefPath = brandMatch.ref_path;
    }

    const chosenAddOns = scoredAddOns
      .slice(0, Math.max(0, maxCount - cores.length))
      .map((x) => x.meta);

    orderedQueue = [...cores, ...chosenAddOns];
    // Candidate metadata exposed to Mode B tool discovery (compact top candidates, never bulk)
    candidateMetadata = [
      ...cores,
      ...scoredAddOns.slice(0, 8).map((x) => x.meta),
    ];
    const designIndexSkill = registry.byId.get("awesome-design-md");
    if (designIndexSkill && matchedDesignBrand) {
      candidateMetadata.push(designIndexSkill);
    }
  } else if (options.category === "game") {
    detectedEngine = detectGameEngine(queryText);
    const allGame = listSkillsForCategory("game", registry);

    // STRICT engine scoping: only skills matching detectedEngine + general discipline/genre skills.
    // Unrelated engines (e.g. Unity/Unreal when user asked for Godot) are completely excluded!
    const engineSkills = allGame.filter((s) => {
      if (detectedEngine === "web") {
        return s.engine === "web" || s.engine === "threejs" || s.engine === "phaser" || s.engine === "pixijs";
      }
      if (detectedEngine === "threejs") {
        return s.engine === "threejs" || s.engine === "web";
      }
      return s.engine === detectedEngine;
    });

    const generalSkills = allGame.filter((s) => s.engine === "general");

    const scoredEngine = engineSkills
      .map((meta) => ({
        meta,
        score: scoreSkillRelevance(meta, queryLower, words),
      }))
      .sort((a, b) => b.score - a.score || a.meta.priority - b.meta.priority);

    const scoredGeneral = generalSkills
      .map((meta) => ({
        meta,
        score: scoreSkillRelevance(meta, queryLower, words),
      }))
      .filter((x) => x.score >= 8)
      .sort((a, b) => b.score - a.score || a.meta.priority - b.meta.priority);

    // Prefer up to 2 engine-specific skills + 1 relevant genre/discipline skill
    const topEngine = scoredEngine.slice(0, Math.max(1, maxCount - 1)).map((x) => x.meta);
    const topGeneral = scoredGeneral.slice(0, 1).map((x) => x.meta);

    // If no general skill matched strongly, fill remaining slot with another engine skill
    if (topGeneral.length === 0 && scoredEngine.length > topEngine.length && topEngine.length < maxCount) {
      topEngine.push(scoredEngine[topEngine.length].meta);
    }

    orderedQueue = [...topEngine, ...topGeneral].slice(0, maxCount);
    candidateMetadata = [
      ...scoredEngine.slice(0, 8).map((x) => x.meta),
      ...scoredGeneral.slice(0, 4).map((x) => x.meta),
    ];
  } else if (options.category === "deep_thinking") {
    const dt = listSkillsForCategory("deep_thinking", registry).slice(0, maxCount);
    orderedQueue = dt;
    candidateMetadata = dt;
  } else {
    // "chat" and "other" -> natural-chat
    const chatSkills = listSkillsForCategory("chat", registry).slice(0, maxCount);
    orderedQueue = chatSkills;
    candidateMetadata = chatSkills;
  }

  // Load selected skills within strict token budget
  const selected: LoadedSkillDocument[] = [];
  const skippedDueToBudget: string[] = [];
  let usedTokens = 0;

  // Reserve a small budget slice for a single matched DESIGN.md when requested,
  // but NEVER starve core skills (taste-skill + impeccable always come first!).
  const reserveForBrand = matchedDesignBrand ? Math.min(2200, Math.floor(maxTokens * 0.18)) : 0;

  for (let i = 0; i < orderedQueue.length; i++) {
    const meta = orderedQueue[i];
    const remainingTotal = maxTokens - usedTokens;
    // Only hold brand reserve against non-core add-ons, never against core skills
    const effectiveRemaining =
      matchedDesignBrand && !meta.core
        ? Math.max(0, remainingTotal - reserveForBrand)
        : remainingTotal;

    if (effectiveRemaining <= 0) {
      skippedDueToBudget.push(meta.id);
      continue;
    }

    const loaded = await loadSkillFile(meta.id, options.reader, undefined, registry);
    if (!loaded) continue;

    const rawTokens = estimateTokens(loaded.content);
    const nextIsCore = i + 1 < orderedQueue.length && orderedQueue[i + 1].core;
    // If another core skill follows, ensure it keeps at least 32% of budget (up to its estimated need)
    const maxAllowedForThisCore =
      meta.core && nextIsCore && maxTokens >= 1200
        ? Math.max(
            Math.floor(maxTokens * 0.62),
            effectiveRemaining - Math.min(orderedQueue[i + 1].estimatedTokens + 100, Math.floor(maxTokens * 0.38))
          )
        : effectiveRemaining;

    if (rawTokens <= maxAllowedForThisCore) {
      selected.push({
        id: meta.id,
        name: meta.name,
        category: meta.category,
        priority: meta.priority,
        core: meta.core,
        engine: meta.engine,
        content: loaded.content,
        tokens: rawTokens,
        truncated: false,
      });
      usedTokens += rawTokens;
      continue;
    }

    // Budget enforcement:
    // - Always include the primary skill (index 0) or core skills if at least 300 tokens remain, truncated cleanly.
    // - Skip non-core add-ons that don't fit comfortably.
    const mustFitCore = i === 0 || (meta.core && effectiveRemaining >= 300);
    if (mustFitCore) {
      const sliceCap = Math.min(effectiveRemaining, maxAllowedForThisCore);
      const clipped = truncateToTokenBudget(loaded.content, sliceCap);
      selected.push({
        id: meta.id,
        name: meta.name,
        category: meta.category,
        priority: meta.priority,
        core: meta.core,
        engine: meta.engine,
        content: clipped.text,
        tokens: clipped.tokens,
        truncated: clipped.truncated,
      });
      usedTokens += clipped.tokens;
    } else {
      skippedDueToBudget.push(meta.id);
    }
  }

  // Lazy single-brand DESIGN.md load (ONLY if a specific brand matched and budget permits)
  if (matchedDesignBrand && matchedDesignRefPath) {
    const remaining = maxTokens - usedTokens;
    if (remaining >= 300) {
      const brandFile = await loadSkillFile(
        "awesome-design-md",
        options.reader,
        matchedDesignRefPath,
        registry
      );
      if (brandFile) {
        const clipped = truncateToTokenBudget(brandFile.content, remaining);
        selected.push({
          id: `awesome-design-md:${matchedDesignBrand}`,
          name: `DESIGN.md (${matchedDesignBrand})`,
          category: "website",
          priority: 90,
          core: false,
          content: clipped.text,
          tokens: clipped.tokens,
          truncated: clipped.truncated,
          referenceLoaded: matchedDesignRefPath,
        });
        usedTokens += clipped.tokens;
      }
    } else {
      skippedDueToBudget.push(`awesome-design-md:${matchedDesignBrand}`);
    }
  }

  return {
    category: options.category,
    detectedEngine,
    matchedDesignBrand,
    selected,
    candidateMetadata,
    totalTokens: usedTokens,
    maxTokens,
    mode,
    skippedDueToBudget,
  };
}
