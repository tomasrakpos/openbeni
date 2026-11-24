// Startup in-memory skill metadata registry + lazy content reader.
// Works seamlessly in both Node (tests / Vite dev) and Cloudflare Pages Functions (env.ASSETS).

import {
  DESIGN_MD_INDEX,
  SKILLS_CONFIG,
  SKILLS_METADATA_INDEX,
} from "./skillsIndex.generated";
import { estimateTokens, parseSkillFrontmatter } from "./frontmatter";
import type {
  DesignMdIndexEntry,
  SkillCategory,
  SkillConfig,
  SkillContentReader,
  SkillMetadata,
  SkillRuntimeEnv,
} from "./types";

export interface SkillRegistry {
  config: SkillConfig;
  skills: SkillMetadata[];
  byId: Map<string, SkillMetadata>;
  designMdIndex: DesignMdIndexEntry[];
}

let cachedStartupRegistry: SkillRegistry | null = null;

/**
 * Returns the startup in-memory skill registry (frontmatter metadata only).
 */
export function getSkillRegistry(): SkillRegistry {
  if (!cachedStartupRegistry) {
    const byId = new Map<string, SkillMetadata>();
    for (const item of SKILLS_METADATA_INDEX) {
      byId.set(item.id, item);
    }
    cachedStartupRegistry = {
      config: SKILLS_CONFIG,
      skills: SKILLS_METADATA_INDEX,
      byId,
      designMdIndex: DESIGN_MD_INDEX,
    };
  }
  return cachedStartupRegistry;
}

/**
 * Lists skills assigned to a category (including cross-category skills via extraCategories),
 * sorted by priority ascending (1 = highest priority).
 */
export function listSkillsForCategory(
  category: SkillCategory,
  registry: SkillRegistry = getSkillRegistry()
): SkillMetadata[] {
  return registry.skills
    .filter(
      (s) =>
        s.category === category ||
        (Array.isArray(s.extraCategories) && s.extraCategories.includes(category))
    )
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

export function getSkillMetadata(
  skillId: string,
  registry: SkillRegistry = getSkillRegistry()
): SkillMetadata | undefined {
  return registry.byId.get(skillId);
}

/**
 * Prevents path traversal when resolving relative paths inside /skills.
 */
export function sanitizeSkillRelativePath(relPath: string): string | null {
  const cleaned = relPath.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!cleaned || cleaned.includes("..") || cleaned.includes("\0")) {
    return null;
  }
  if (!/^[A-Za-z0-9_./-]+$/.test(cleaned)) {
    return null;
  }
  return cleaned;
}

/**
 * Reads a skill's unmodified SKILL.md (or a specific reference file under references/).
 */
export async function loadSkillFile(
  skillId: string,
  reader: SkillContentReader,
  referencePath?: string,
  registry: SkillRegistry = getSkillRegistry()
): Promise<{ content: string; path: string } | null> {
  const meta = registry.byId.get(skillId);
  if (!meta) return null;

  if (!referencePath) {
    const content = await reader.readRelative(meta.skillPath);
    if (content === null) return null;
    return { content, path: meta.skillPath };
  }

  const normalizedRef = sanitizeSkillRelativePath(referencePath);
  if (!normalizedRef) return null;
  const fullRef = normalizedRef.startsWith("references/")
    ? normalizedRef
    : `references/${normalizedRef}`;

  // Only allow reading listed references belonging to this skill
  if (!meta.references.includes(fullRef)) {
    return null;
  }

  const relPath = `${meta.id}/${fullRef}`;
  const content = await reader.readRelative(relPath);
  if (content === null) return null;
  return { content, path: relPath };
}

/**
 * Matches a single brand DESIGN.md entry from awesome-design-md when the user
 * mentions a known brand name (e.g. "Stripe", "Linear", "Apple", "Vercel").
 * Returns at most ONE entry — never bulk-loads.
 */
export function matchDesignMdBrand(
  query: string,
  registry: SkillRegistry = getSkillRegistry()
): DesignMdIndexEntry | null {
  const lower = query.toLowerCase();
  if (!lower.trim()) return null;

  // Prefer exact word-boundary brand match (longest brand name first to match "bmw-m" before "bmw")
  const sorted = [...registry.designMdIndex].sort(
    (a, b) => b.brand.length - a.brand.length
  );

  for (const entry of sorted) {
    const brand = entry.brand.toLowerCase();
    // Skip very short ambiguous tokens like "hp", "x.ai", "cal" unless explicitly styled
    if (brand.length <= 3) {
      const explicitPattern = new RegExp(
        `(?:like|style|design|brand|theme|inspired by)\\s+${escapeRegex(brand)}\\b|\\b${escapeRegex(brand)}\\s+(?:style|design|theme|landing|site|website)`,
        "i"
      );
      if (explicitPattern.test(lower)) return entry;
      continue;
    }
    const tokenPattern = new RegExp(`\\b${escapeRegex(brand)}\\b`, "i");
    if (tokenPattern.test(lower)) {
      return entry;
    }
    // Also match hyphenated brands written with spaces (e.g. "bmw m")
    if (brand.includes("-")) {
      const spaced = brand.replace(/-/g, " ");
      if (new RegExp(`\\b${escapeRegex(spaced)}\\b`, "i").test(lower)) {
        return entry;
      }
    }
  }

  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// =========================================================================
// Content Readers (Node filesystem & Cloudflare Pages ASSETS)
// =========================================================================

const contentCache = new Map<string, string>();

export function clearSkillContentCache(): void {
  contentCache.clear();
}

/**
 * Node filesystem reader (used in tests, scripts, and Vite dev server).
 * Uses dynamic import("node:fs/promises") so Cloudflare Workers bundling never breaks.
 */
export function createNodeSkillReader(skillsRootDir?: string): SkillContentReader {
  return {
    async readRelative(relativePath: string): Promise<string | null> {
      const safe = sanitizeSkillRelativePath(relativePath);
      if (!safe) return null;
      const cacheKey = `node:${skillsRootDir || "default"}:${safe}`;
      const hit = contentCache.get(cacheKey);
      if (hit !== undefined) return hit;

      try {
        const fsMod = "node:fs/promises";
        const pathMod = "node:path";
        const fs = await import(/* @vite-ignore */ fsMod);
        const path = await import(/* @vite-ignore */ pathMod);
        const root = skillsRootDir || path.resolve(process.cwd(), "skills");
        const full = path.resolve(root, safe);
        if (!full.startsWith(path.resolve(root))) return null;
        const text = await fs.readFile(full, "utf8");
        contentCache.set(cacheKey, text);
        return text;
      } catch {
        return null;
      }
    },
  };
}

/**
 * Cloudflare Pages static asset reader (reads /_skills/<relativePath> via env.ASSETS.fetch).
 */
export function createAssetsSkillReader(
  assets: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> },
  origin: string
): SkillContentReader {
  return {
    async readRelative(relativePath: string): Promise<string | null> {
      const safe = sanitizeSkillRelativePath(relativePath);
      if (!safe) return null;
      const cacheKey = `assets:${safe}`;
      const hit = contentCache.get(cacheKey);
      if (hit !== undefined) return hit;

      try {
        const url = new URL(`/_skills/${safe}`, origin);
        const res = await assets.fetch(url.toString());
        if (!res.ok) return null;
        // Reject SPA fallback HTML (`/* /index.html 200`) if a skill asset is missing.
        const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
        if (contentType.includes("text/html")) return null;
        const text = await res.text();
        contentCache.set(cacheKey, text);
        return text;
      } catch {
        return null;
      }
    },
  };
}

/**
 * Creates the appropriate SkillContentReader for the active runtime:
 * - Cloudflare Pages Functions -> env.ASSETS (/dist/_skills/*)
 * - Node (Vitest / local dev server) -> direct read from /skills on disk
 */
export function createRuntimeSkillReader(options?: {
  env?: SkillRuntimeEnv;
  requestUrl?: string;
  skillsRootDir?: string;
}): SkillContentReader {
  const assets = options?.env?.ASSETS;
  const origin = (() => {
    try {
      return options?.requestUrl ? new URL(options.requestUrl).origin : "https://openbeni.local";
    } catch {
      return "https://openbeni.local";
    }
  })();

  const nodeReader = createNodeSkillReader(options?.skillsRootDir);
  if (!assets) return nodeReader;

  const assetsReader = createAssetsSkillReader(assets, origin);
  return {
    async readRelative(relativePath: string): Promise<string | null> {
      const fromAssets = await assetsReader.readRelative(relativePath);
      if (fromAssets !== null) return fromAssets;
      return nodeReader.readRelative(relativePath);
    },
  };
}

/**
 * Dynamically scans a /skills directory + skills.config.json directly from disk (Node only).
 * Proves that dropping a new folder into /skills and adding its category to skills.config.json
 * immediately registers the skill without code changes.
 */
export async function loadRegistryFromDisk(
  skillsRootDir: string
): Promise<SkillRegistry> {
  const fsMod = "node:fs/promises";
  const pathMod = "node:path";
  const fs = await import(/* @vite-ignore */ fsMod);
  const path = await import(/* @vite-ignore */ pathMod);

  const configRaw = await fs.readFile(
    path.join(skillsRootDir, "skills.config.json"),
    "utf8"
  );
  const rawConfig = JSON.parse(configRaw) as SkillConfig & {
    skills: Record<
      string,
      {
        category?: SkillCategory;
        extraCategories?: SkillCategory[];
        priority?: number;
        core?: boolean;
        engine?: string;
        tags?: string[];
      }
    >;
  };

  const dirEntries = await fs.readdir(skillsRootDir, { withFileTypes: true });
  const skills: SkillMetadata[] = [];
  const byId = new Map<string, SkillMetadata>();

  for (const ent of dirEntries) {
    if (!ent.isDirectory()) continue;
    const skillMdPath = path.join(skillsRootDir, ent.name, "SKILL.md");
    let raw: string;
    try {
      raw = await fs.readFile(skillMdPath, "utf8");
    } catch {
      continue;
    }
    const { frontmatter } = parseSkillFrontmatter(raw);
    const cfg = rawConfig.skills?.[ent.name] || {};
    const meta: SkillMetadata = {
      id: ent.name,
      name: frontmatter.name || ent.name,
      description: String(frontmatter.description || "").slice(0, 320),
      license: frontmatter.license || undefined,
      category: cfg.category || "other",
      extraCategories: cfg.extraCategories,
      priority: typeof cfg.priority === "number" ? cfg.priority : 100,
      core: Boolean(cfg.core),
      engine: cfg.engine,
      tags: Array.isArray(cfg.tags) ? cfg.tags : [],
      estimatedTokens: estimateTokens(raw),
      skillPath: `${ent.name}/SKILL.md`,
      references: [],
    };
    skills.push(meta);
    byId.set(meta.id, meta);
  }

  return {
    config: {
      version: rawConfig.version,
      defaults: rawConfig.defaults,
      providerModes: rawConfig.providerModes,
      modelModes: rawConfig.modelModes,
      categoryPriorityNotes: rawConfig.categoryPriorityNotes,
    },
    skills,
    byId,
    designMdIndex: DESIGN_MD_INDEX,
  };
}
