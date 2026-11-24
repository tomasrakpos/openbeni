// Zero-dependency YAML frontmatter parser and token estimator for SKILL.md files.

export interface ParsedSkillDocument {
  frontmatter: Record<string, string>;
  body: string;
}

export function parseSkillFrontmatter(raw: string): ParsedSkillDocument {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { frontmatter: {}, body: normalized };
  }
  const endIdx = normalized.indexOf("\n---", 4);
  if (endIdx === -1) {
    return { frontmatter: {}, body: normalized };
  }
  const fmBlock = normalized.slice(4, endIdx);
  const body = normalized.slice(endIdx + 4).replace(/^\s*\n/, "");
  const frontmatter: Record<string, string> = {};
  let currentKey: string | null = null;

  for (const line of fmBlock.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (match) {
      currentKey = match[1].trim();
      let val = match[2].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      frontmatter[currentKey] = val;
    } else if (currentKey && (line.startsWith("  ") || line.startsWith("\t"))) {
      const prev = frontmatter[currentKey] || "";
      frontmatter[currentKey] = prev ? `${prev} ${trimmed}` : trimmed;
    }
  }

  return { frontmatter, body };
}

/**
 * Fast, provider-agnostic token estimator (~4 chars/token for English/code,
 * slightly more conservative for non-Latin scripts).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let nonAscii = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) nonAscii++;
  }
  const ascii = text.length - nonAscii;
  return Math.max(1, Math.ceil(ascii / 4 + nonAscii / 2));
}

/**
 * Truncates text cleanly on a line boundary so estimated tokens stay strictly
 * within `maxTokens`.
 */
export function truncateToTokenBudget(
  text: string,
  maxTokens: number
): { text: string; tokens: number; truncated: boolean } {
  const current = estimateTokens(text);
  if (current <= maxTokens) {
    return { text, tokens: current, truncated: false };
  }
  if (maxTokens <= 16) {
    const slice = text.slice(0, Math.max(0, maxTokens * 3));
    return { text: slice, tokens: estimateTokens(slice), truncated: true };
  }

  const notice = "\n\n[Truncated to fit per-request skill token budget.]";
  const noticeTokens = estimateTokens(notice);
  const targetTokens = Math.max(1, maxTokens - noticeTokens);

  const lines = text.split("\n");
  const kept: string[] = [];
  let used = 0;

  for (const line of lines) {
    const lineTokens = estimateTokens(line + "\n");
    if (used + lineTokens > targetTokens) {
      if (kept.length === 0) {
        // Single long line fallback
        const charCap = Math.max(16, targetTokens * 3);
        kept.push(line.slice(0, charCap));
      }
      break;
    }
    kept.push(line);
    used += lineTokens;
  }

  let out = kept.join("\n").trimEnd() + notice;
  // Final safety clamp in case non-ASCII density made it slightly over
  while (estimateTokens(out) > maxTokens && out.length > notice.length + 16) {
    const bodyLen = Math.floor((out.length - notice.length) * 0.85);
    out = out.slice(0, Math.max(8, bodyLen)).trimEnd() + notice;
  }

  return {
    text: out,
    tokens: estimateTokens(out),
    truncated: true,
  };
}
