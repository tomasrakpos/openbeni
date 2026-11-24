// Public entry point for the external skills subsystem.

import {
  classifyRequestCategory,
  type ClassifierCaller,
  type ClassifierTransportCredentials,
} from "./classifier";
import {
  buildModeASystemPrompt,
  buildModeBSystemPrompt,
  buildReadSkillToolDefinition,
  executeReadSkillTool,
  injectSkillSystemPrompt,
  SKILL_INJECTION_MARKER,
  type SkillToolDefinition,
} from "./injection";
import {
  clearSkillContentCache,
  createAssetsSkillReader,
  createNodeSkillReader,
  createRuntimeSkillReader,
  getSkillMetadata,
  getSkillRegistry,
  listSkillsForCategory,
  loadRegistryFromDisk,
  loadSkillFile,
  matchDesignMdBrand,
  type SkillRegistry,
} from "./registry";
import {
  detectGameEngine,
  resolveInjectionMode,
  resolveMaxSkillTokens,
  selectSkillsForCategory,
} from "./selector";
import type {
  ClassificationResult,
  ProviderFormat,
  SkillCategory,
  SkillChatMessage,
  SkillContentReader,
  SkillInjectionMode,
  SkillMode,
  SkillRuntimeEnv,
  SkillSelectionResult,
} from "./types";

export {
  buildModeASystemPrompt,
  buildModeBSystemPrompt,
  buildReadSkillToolDefinition,
  classifyRequestCategory,
  clearSkillContentCache,
  createAssetsSkillReader,
  createNodeSkillReader,
  createRuntimeSkillReader,
  detectGameEngine,
  executeReadSkillTool,
  getSkillMetadata,
  getSkillRegistry,
  injectSkillSystemPrompt,
  listSkillsForCategory,
  loadRegistryFromDisk,
  loadSkillFile,
  matchDesignMdBrand,
  resolveInjectionMode,
  resolveMaxSkillTokens,
  selectSkillsForCategory,
  SKILL_INJECTION_MARKER,
};

export * from "./frontmatter";
export * from "./modeBRunner";
export * from "./types";
export type {
  ClassifierCaller,
  ClassifierTransportCredentials,
  SkillRegistry,
  SkillToolDefinition,
};

export interface ResolvedSkillExecution {
  classification: ClassificationResult;
  selection: SkillSelectionResult;
  /** True when the UI should open / enable the live website or game preview panel. */
  needsPreview: boolean;
  /** Mode A direct system prompt (always available as default and as Mode B fallback). */
  modeASystemPrompt: string;
  /** Mode B lightweight metadata prompt (used when selection.mode === "tool"). */
  modeBSystemPrompt: string;
  /** Mode B `read_skill` tool definition (used when selection.mode === "tool"). */
  readSkillTool: SkillToolDefinition | null;
}

export interface ResolveSkillExecutionOptions {
  messages: SkillChatMessage[];
  skillMode?: SkillMode | string;
  env?: SkillRuntimeEnv;
  requestUrl?: string;
  providerFormat?: ProviderFormat | string;
  model?: string;
  supportsTools?: boolean;
  explicitInjectionMode?: SkillInjectionMode;
  maxTokensOverride?: number;
  fallbackClassifierCredentials?: ClassifierTransportCredentials | null;
  callClassifier?: ClassifierCaller;
  reader?: SkillContentReader;
  registry?: SkillRegistry;
  logger?: (message: string) => void;
}

export const ELEMENT_EDIT_MARKER = "[OPENBENI_ELEMENT_EDIT]";

export const SURGICAL_ELEMENT_EDIT_SYSTEM_PROMPT = [
  SKILL_INJECTION_MARKER,
  "Active task: SURGICAL IN-PLACE ELEMENT EDIT on an existing web/app project.",
  "CRITICAL RULES — FOLLOW STRICTLY:",
  "1. The user already has a complete working project (provided in the conversation / current project files). DO NOT rebuild, redesign, or replace it with a different design.",
  "2. Preserve the ENTIRE existing page — its exact background, color palette, theme, layout, structure, typography, copy, spacing, animations, CSS, JavaScript, and every unrelated element — verbatim.",
  "3. Apply ONLY the minimal, surgical change requested by the user to the specifically selected target element (identified by its selector and outerHTML).",
  "4. Return the complete updated project file(s) in standard fenced code blocks preserving the exact existing filenames (e.g. ```html index.html) so the live preview updates cleanly in place with ONLY that element changed.",
].join("\n");

function extractLastUserText(messages: SkillChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m || m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      return m.content
        .map((part) => (part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : ""))
        .join("\n");
    }
  }
  return "";
}

export function isSurgicalElementEditRequest(messages: SkillChatMessage[]): boolean {
  return extractLastUserText(messages).includes(ELEMENT_EDIT_MARKER);
}

/**
 * Full end-to-end resolution:
 * 1. Detect surgical in-place element edits first (skip full-page redesign skills so existing design stays intact)
 * 2. Classify request category (website | game | chat | deep_thinking | other)
 * 3. Select targeted skills within token budget (core + selective, engine-scoped, lazy refs)
 * 4. Prepare Mode A (default direct injection) and Mode B (read_skill tool + Mode A fallback)
 */
export async function resolveSkillExecution(
  options: ResolveSkillExecutionOptions
): Promise<ResolvedSkillExecution> {
  // Surgical in-place element edit: never inject greenfield redesign skills (e.g. taste-skill /
  // impeccable / DESIGN.md) that tell the model to replace colors, layout, or rebuild from scratch.
  if (isSurgicalElementEditRequest(options.messages)) {
    const classification: ClassificationResult = {
      category: "website",
      confidence: 1,
      source: "manual",
    };
    const selection: SkillSelectionResult = {
      category: "website",
      mode: "direct",
      selected: [],
      candidateMetadata: [],
      totalTokens: 0,
      maxTokens: 0,
      skippedDueToBudget: [],
    };
    return {
      classification,
      selection,
      needsPreview: true,
      modeASystemPrompt: SURGICAL_ELEMENT_EDIT_SYSTEM_PROMPT,
      modeBSystemPrompt: "",
      readSkillTool: null,
    };
  }

  const registry = options.registry || getSkillRegistry();
  const reader =
    options.reader ||
    createRuntimeSkillReader({
      env: options.env,
      requestUrl: options.requestUrl,
    });

  const classification = await classifyRequestCategory({
    messages: options.messages,
    skillMode: options.skillMode,
    env: options.env,
    fallbackCredentials: options.fallbackClassifierCredentials,
    callClassifier: options.callClassifier,
    logger: options.logger,
  });

  const selection = await selectSkillsForCategory({
    category: classification.category,
    messages: options.messages,
    reader,
    env: options.env,
    providerFormat: options.providerFormat,
    model: options.model,
    supportsTools: options.supportsTools,
    explicitMode: options.explicitInjectionMode,
    maxTokensOverride: options.maxTokensOverride,
    registry,
  });

  const modeASystemPrompt = buildModeASystemPrompt(selection);
  const modeBSystemPrompt =
    selection.mode === "tool" ? buildModeBSystemPrompt(selection) : "";
  const readSkillTool =
    selection.mode === "tool" && selection.candidateMetadata.length > 0
      ? buildReadSkillToolDefinition(selection.candidateMetadata)
      : null;

  return {
    classification,
    selection,
    needsPreview:
      classification.category === "website" || classification.category === "game",
    modeASystemPrompt,
    modeBSystemPrompt,
    readSkillTool,
  };
}

/**
 * Standard, privacy-safe HTTP response headers reporting the active skill category & selection.
 */
export function skillResponseHeaders(
  resolved: ResolvedSkillExecution,
  effectiveMode?: SkillInjectionMode
): Record<string, string> {
  const mode = effectiveMode || resolved.selection.mode;
  const names = resolved.selection.selected.map((s) => s.id).join(",");
  return {
    "X-Skill-Category": resolved.classification.category,
    "X-Skill-Id": resolved.classification.category,
    "X-Skill-Source": resolved.classification.source,
    "X-Skill-Mode": mode,
    "X-Skill-Names": names,
    "X-Skill-Tokens": String(resolved.selection.totalTokens),
    "X-Preview-Intent": resolved.needsPreview ? "1" : "0",
    "X-Preview-Category":
      resolved.classification.category === "game"
        ? "game"
        : resolved.classification.category === "website"
          ? "website"
          : "none",
  };
}
