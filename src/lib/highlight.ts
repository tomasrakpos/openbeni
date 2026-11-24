// Shared logic highlight; change this helper here and update callers if its contract changes.
import type { HighlighterCore } from "shiki/core";

const LANG_LOADERS = {
  typescript: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  bash: () => import("shiki/langs/bash.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  php: () => import("shiki/langs/php.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
} as const;

type HighlightLang = keyof typeof LANG_LOADERS | "text";

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLangs = new Set<string>(["text"]);
const cache = new Map<string, string>();

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    // Loaded on first code block using the pure-JS RegExp engine (zero WASM,
    // works under strict production CSP `script-src 'self'`, and avoids
    // bundling 250+ unused Shiki grammars).
    highlighterPromise = Promise.all([
      import("shiki/core"),
      import("shiki/engine/javascript"),
      import("shiki/themes/github-dark-default.mjs"),
      import("shiki/themes/github-light.mjs"),
    ])
      .then(([{ createHighlighterCore }, { createJavaScriptRegexEngine }, darkTheme, lightTheme]) =>
        createHighlighterCore({
          themes: [darkTheme.default, lightTheme.default],
          langs: [],
          engine: createJavaScriptRegexEngine({ forgiving: true }),
        }),
      )
      .catch((err) => {
        highlighterPromise = null;
        throw err;
      });
  }
  return highlighterPromise;
}

function normalizeLang(lang: string): HighlightLang {
  const value = (lang || "text").toLowerCase();
  const map: Record<string, HighlightLang> = {
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
  const normalized = (map[value] ?? value) as HighlightLang;
  return normalized === "text" || normalized in LANG_LOADERS ? normalized : "text";
}

export async function highlightCode(code: string, language: string, theme?: "dark" | "light"): Promise<string> {
  const lang = normalizeLang(language);
  const mode = theme ?? (document.documentElement.classList.contains("dark") ? "dark" : "light");
  const key = `${mode}:${lang}:${code.length}:${code.slice(0, 64)}:${code.slice(-32)}`;
  const cached = cache.get(key);
  if (cached) return cached;
  try {
    const highlighter = await getHighlighter();
    if (lang !== "text" && !loadedLangs.has(lang)) {
      const mod = await LANG_LOADERS[lang]();
      await highlighter.loadLanguage(mod.default);
      loadedLangs.add(lang);
    }
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
