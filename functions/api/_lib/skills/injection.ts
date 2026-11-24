// Provider-agnostic skill injection (Mode A: direct system prompt injection, default;
// Mode B: read_skill(name) tool for tool-capable models with automatic fallback to Mode A).

import { truncateToTokenBudget } from "./frontmatter";
import {
  getSkillRegistry,
  loadSkillFile,
  type SkillRegistry,
} from "./registry";
import type {
  SkillChatMessage,
  SkillContentReader,
  SkillMetadata,
  SkillSelectionResult,
} from "./types";

export const SKILL_INJECTION_MARKER = "[OPENBENI_SKILLS_V2]";

export interface SkillToolDefinition {
  name: "read_skill";
  description: string;
  parameters: {
    type: "object";
    properties: {
      name: {
        type: "string";
        description: string;
      };
      reference: {
        type: "string";
        description: string;
      };
    };
    required: ["name"];
  };
}

/**
 * Standard, provider-agnostic tool schema for Mode B (`read_skill`).
 * Adapted cleanly to OpenAI, Anthropic, and Gemini tool formats in upstream.ts.
 */
export function buildReadSkillToolDefinition(
  candidates: SkillMetadata[]
): SkillToolDefinition {
  const names = candidates.map((c) => c.id).join(", ");
  return {
    name: "read_skill",
    description:
      "Read the full SKILL.md instructions (or an optional file under references/) for a specific skill by name. " +
      (names ? `Available skills for this request: ${names}.` : "Pass the exact skill folder name."),
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Exact skill id (e.g. 'taste-skill', 'impeccable', 'godot-2d-movement').",
        },
        reference: {
          type: "string",
          description:
            "Optional relative reference file path inside the skill's references/ folder (e.g. 'references/motion.md' or 'references/stripe/DESIGN.md'). Omit to read SKILL.md.",
        },
      },
      required: ["name"],
    },
  };
}

/**
 * Mode A (default): Builds a provider-agnostic system prompt block containing
 * the unmodified content of the selected skills, ordered by priority.
 */
export function buildModeASystemPrompt(selection: SkillSelectionResult): string {
  if (selection.selected.length === 0) return "";

  const headerLines = [
    SKILL_INJECTION_MARKER,
    `Active skill category: ${selection.category}` +
      (selection.detectedEngine ? ` (engine: ${selection.detectedEngine})` : "") +
      (selection.matchedDesignBrand
        ? ` (brand reference: ${selection.matchedDesignBrand})`
        : ""),
  ];

  if (selection.category === "website" && selection.selected.length > 1) {
    headerLines.push(
      "Priority order: Follow earlier skills first if any guidelines overlap (taste-skill and impeccable take precedence over add-on skills)."
    );
  }

  headerLines.push(
    "Note: Do NOT attempt to run local shell/CLI commands mentioned inside external skill documents; apply their design, architecture, and code principles directly in your response."
  );

  const blocks = selection.selected.map((doc, idx) => {
    const label = doc.referenceLoaded
      ? `${doc.id} (${doc.referenceLoaded})`
      : `${doc.id} (priority ${doc.priority})`;
    return [
      `===== SKILL ${idx + 1}: ${label} =====`,
      doc.content,
      `===== END SKILL: ${doc.id} =====`,
    ].join("\n");
  });

  return `${headerLines.join("\n")}\n\n${blocks.join("\n\n")}`;
}

/**
 * Mode B (optional for tool-capable models): Injects ONLY lightweight skill metadata
 * and instructs the model to call `read_skill(name)` for the skills it needs.
 */
export function buildModeBSystemPrompt(selection: SkillSelectionResult): string {
  if (selection.candidateMetadata.length === 0) return "";

  const list = selection.candidateMetadata
    .map((m) => {
      const refHint =
        m.references.length > 0
          ? ` | refs: ${m.references.slice(0, 4).join(", ")}${m.references.length > 4 ? ` (+${m.references.length - 4} more)` : ""}`
          : "";
      return `- \`${m.id}\` (priority ${m.priority}${m.core ? ", core" : ""}${m.engine ? `, engine: ${m.engine}` : ""}): ${m.description || m.name}${refHint}`;
    })
    .join("\n");

  const brandHint = selection.matchedDesignBrand
    ? `\nMatched brand reference available via read_skill(name="awesome-design-md", reference="references/${selection.matchedDesignBrand}/DESIGN.md").`
    : "";

  return [
    SKILL_INJECTION_MARKER,
    `Active skill category: ${selection.category}` +
      (selection.detectedEngine ? ` (engine: ${selection.detectedEngine})` : ""),
    "You have access to the `read_skill(name, reference?)` tool to load full skill instructions on demand.",
    "Before producing your final answer, call `read_skill` for the highest-priority relevant skill(s) below (start with core skills when present). Do not run any shell or browser CLI commands.",
    "",
    "Available skills:",
    list,
    brandHint,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Injects a skill system prompt block into a standard message array without
 * duplicating if already present, and without provider-specific formatting.
 */
export function injectSkillSystemPrompt<T extends SkillChatMessage>(
  messages: T[],
  systemBlock: string
): T[] {
  if (!systemBlock.trim()) return messages;

  const alreadyInjected = messages.some(
    (m) =>
      m.role === "system" &&
      typeof m.content === "string" &&
      m.content.includes(SKILL_INJECTION_MARKER)
  );
  if (alreadyInjected) return messages;

  const firstSystemIdx = messages.findIndex((m) => m.role === "system");
  if (firstSystemIdx !== -1 && typeof messages[firstSystemIdx].content === "string") {
    const copy = [...messages];
    const existing = String(copy[firstSystemIdx].content || "").trim();
    copy[firstSystemIdx] = {
      ...copy[firstSystemIdx],
      content: existing ? `${existing}\n\n${systemBlock}` : systemBlock,
    };
    return copy;
  }

  return [
    { role: "system", content: systemBlock } as T,
    ...messages,
  ];
}

/**
 * Executes a `read_skill` tool call safely within the remaining token budget.
 * Only reads files under `/skills/<id>/SKILL.md` or `/skills/<id>/references/*`.
 */
export async function executeReadSkillTool(options: {
  name: string;
  reference?: string;
  reader: SkillContentReader;
  remainingTokenBudget: number;
  registry?: SkillRegistry;
}): Promise<{ ok: boolean; content: string; tokensUsed: number }> {
  const registry = options.registry || getSkillRegistry();
  const skillName = typeof options.name === "string" ? options.name.trim() : "";
  const refPath =
    typeof options.reference === "string" && options.reference.trim()
      ? options.reference.trim()
      : undefined;

  if (!skillName) {
    return {
      ok: false,
      content: "Error: 'name' parameter is required for read_skill.",
      tokensUsed: 0,
    };
  }

  if (options.remainingTokenBudget <= 64) {
    return {
      ok: false,
      content: "Skill token budget exhausted for this request. Proceed with already-loaded skills.",
      tokensUsed: 0,
    };
  }

  const loaded = await loadSkillFile(skillName, options.reader, refPath, registry);
  if (!loaded) {
    return {
      ok: false,
      content: `Skill or reference not found: ${skillName}${refPath ? ` (${refPath})` : ""}`,
      tokensUsed: 0,
    };
  }

  const clipped = truncateToTokenBudget(loaded.content, options.remainingTokenBudget);
  return {
    ok: true,
    content: clipped.text,
    tokensUsed: clipped.tokens,
  };
}
