// Shared logic highlight; change this helper here and update callers if its contract changes.
import type { Highlighter } from "shiki";

const LANGS = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "json",
  "html",
  "css",
  "python",
  "bash",
  "markdown",
  "sql",
  "yaml",
  "rust",
  "go",
  "java",
  "php",
  "c",
  "cpp",
  "csharp",
  "diff",
  "scss",
  "text",
];

let highlighterPromise: Promise<Highlighter> | null = null;
const cache = new Map<string, string>();

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    // Loaded on first code block, not in the entry chunk.
    highlighterPromise = import("shiki")
      .then(({ createHighlighter }) =>
        createHighlighter({
          themes: ["github-dark-default", "github-light"],
          langs: LANGS,
        }),
      )
      .catch((err) => {
        highlighterPromise = null;
        throw err;
      });
  }
  return highlighterPromise;
}

function normalizeLang(lang: string): string {
  const value = (lang || "text").toLowerCase();
  const map: Record<string, string> = {
    js: "javascript",
    ts: "typescript",
    py: "python",
    sh: "bash",
    shell: "bash",
    yml: "yaml",
    md: "markdown",
    "c++": "cpp",
    cs: "csharp",
    plaintext: "text",
    htm: "html",
  };
  const normalized = map[value] ?? value;
  return LANGS.includes(normalized) ? normalized : "text";
}

export async function highlightCode(code: string, language: string, theme?: "dark" | "light"): Promise<string> {
  const lang = normalizeLang(language);
  const mode = theme ?? (document.documentElement.classList.contains("dark") ? "dark" : "light");
  const key = `${mode}:${lang}:${code.length}:${code.slice(0, 64)}:${code.slice(-32)}`;
  const cached = cache.get(key);
  if (cached) return cached;
  try {
    const highlighter = await getHighlighter();
    const html = highlighter.codeToHtml(code, {
      lang,
      theme: mode === "dark" ? "github-dark-default" : "github-light",
    });
    if (cache.size > 300) cache.clear();
    cache.set(key, html);
    return html;
  } catch {
    return `<pre><code>${code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre>`;
  }
}

export function currentThemeMode(): "dark" | "light" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}
