/**
 * Shared types for the backend 4-Skill Intelligence System:
 * 1. `chat`          — Natural human conversation (tone-mirrored, zero AI slop)
 * 2. `web_builder`   — Elite website/UI design + image/screenshot analysis + live web/photo references
 * 3. `game_builder`  — 2D & 3D WebGL/Canvas game studio (lighting, smooth 60fps physics, dual controls)
 * 4. `deep_research` — Multi-angle live web search + first-principles analytical synthesis
 */

export type SkillId = "chat" | "web_builder" | "game_builder" | "deep_research";

export type SkillMode = "auto" | SkillId;

export type SkillRouteSource = "manual" | "heuristic" | "ai" | "existing_project";

export interface SkillSearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

export interface SkillImageResult {
  title: string;
  url: string;
  width?: number;
  height?: number;
  source: string;
}

export interface SkillEnv {
  TAVILY_API_KEY?: string;
  SERPER_API_KEY?: string;
  BRAVE_SEARCH_API_KEY?: string;
  UNSPLASH_ACCESS_KEY?: string;
  PEXELS_API_KEY?: string;
}

export interface SkillMessage {
  role: string;
  content: string;
  hasImages?: boolean;
}

export interface SkillExecutionContext {
  skillId: SkillId;
  source: SkillRouteSource;
  confidence: "high" | "low";
  needsPreview: boolean;
  previewCategory: "website" | "game" | "app" | "ui" | "project" | "none";
  reason: string;
  /** Live web references fetched by the backend (for web_builder / deep_research). */
  webSources: SkillSearchResult[];
  /** Verified HTTPS reference photos fetched by the backend (for web_builder). */
  imageAssets: SkillImageResult[];
  /** Composed system instruction tailored to the selected skill + live context. */
  systemPrompt: string;
}

export function isSkillId(value: unknown): value is SkillId {
  return (
    value === "chat" ||
    value === "web_builder" ||
    value === "game_builder" ||
    value === "deep_research"
  );
}

export function normalizeSkillMode(value: unknown): SkillMode {
  if (isSkillId(value)) return value;
  return "auto";
}
