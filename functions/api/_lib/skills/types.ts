// Core types for the provider-agnostic external skills system.

export type SkillCategory =
  | "website"
  | "game"
  | "chat"
  | "deep_thinking"
  | "other";

export type SkillMode = "auto" | SkillCategory;

/** Mode A = direct system prompt injection (default); Mode B = read_skill(name) tool. */
export type SkillInjectionMode = "direct" | "tool";

export type ProviderFormat = "openai" | "anthropic" | "gemini" | "custom";

export interface SkillMetadata {
  /** Folder name inside /skills/<id>/SKILL.md */
  id: string;
  /** Name parsed from YAML frontmatter (falls back to id). */
  name: string;
  /** Short description parsed from YAML frontmatter. */
  description: string;
  license?: string;
  category: SkillCategory;
  extraCategories?: SkillCategory[];
  /** Lower number = higher priority (1 is highest). */
  priority: number;
  core: boolean;
  /** Game engine or 3D runtime scope (e.g., godot, unity, unreal, web, threejs, phaser, general). */
  engine?: string;
  tags: string[];
  estimatedTokens: number;
  /** Relative path inside /skills (e.g. "taste-skill/SKILL.md"). */
  skillPath: string;
  /** Relative reference paths inside /skills/<id>/ (e.g. "references/motion.md"). */
  references: string[];
}

export interface DesignMdIndexEntry {
  brand: string;
  title: string;
  summary: string;
  /** Relative path inside /skills/awesome-design-md/ */
  ref_path: string;
}

export interface SkillConfigDefaults {
  mode: SkillInjectionMode;
  maxTokensPerRequest: number;
  maxSelectedSkills: Record<SkillCategory, number>;
  classifier: {
    model: string;
    timeoutMs: number;
    historyMessages: number;
    fallbackCategory: SkillCategory;
    minConfidence: number;
  };
}

export interface SkillConfig {
  version: number;
  defaults: SkillConfigDefaults;
  providerModes: Partial<Record<ProviderFormat | string, SkillInjectionMode>>;
  modelModes: Record<string, SkillInjectionMode>;
  categoryPriorityNotes?: Partial<Record<SkillCategory, string>>;
}

export interface SkillRuntimeEnv {
  SKILL_CLASSIFIER_MODEL?: string;
  SKILL_CLASSIFIER_BASE_URL?: string;
  SKILL_CLASSIFIER_API_KEY?: string;
  SKILL_CLASSIFIER_API_FORMAT?: string;
  SKILL_CLASSIFIER_TIMEOUT_MS?: string;
  SKILL_MAX_TOKENS?: string;
  SKILL_DEFAULT_MODE?: string;
  SKILL_PROVIDER_MODES?: string;
  SKILL_MODEL_MODES?: string;
  ASSETS?: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
  [key: string]: unknown;
}

export interface SkillChatMessage {
  role: string;
  content: unknown;
}

export interface ClassificationResult {
  category: SkillCategory;
  source: "manual" | "llm" | "fallback";
  confidence: number;
  model?: string;
  reason?: string;
}

export interface LoadedSkillDocument {
  id: string;
  name: string;
  category: SkillCategory;
  priority: number;
  core: boolean;
  engine?: string;
  content: string;
  tokens: number;
  truncated: boolean;
  referenceLoaded?: string;
}

export interface SkillSelectionResult {
  category: SkillCategory;
  detectedEngine?: string;
  matchedDesignBrand?: string;
  selected: LoadedSkillDocument[];
  candidateMetadata: SkillMetadata[];
  totalTokens: number;
  maxTokens: number;
  mode: SkillInjectionMode;
  skippedDueToBudget: string[];
}

export interface SkillContentReader {
  /** Read a relative path inside /skills, e.g. "taste-skill/SKILL.md". */
  readRelative(relativePath: string): Promise<string | null>;
}

export function isSkillCategory(value: unknown): value is SkillCategory {
  return (
    value === "website" ||
    value === "game" ||
    value === "chat" ||
    value === "deep_thinking" ||
    value === "other"
  );
}

export function normalizeSkillMode(value: unknown): SkillMode {
  if (typeof value !== "string") return "auto";
  const v = value.trim().toLowerCase();
  if (v === "auto" || isSkillCategory(v)) return v;
  return "auto";
}

export function extractPlainText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.text === "string") {
      parts.push(rec.text);
    } else if (rec.type === "input_text" && typeof rec.text === "string") {
      parts.push(rec.text);
    }
  }
  return parts.join("\n");
}
