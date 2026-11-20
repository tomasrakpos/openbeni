// Shared logic codefiles; change this helper here and update callers if its contract changes.
import type { VirtualFile } from "@/lib/types";

export interface CodeBlock {
  language: string;
  filename?: string;
  content: string;
}

const FENCE = /```([^\n`]*)\n([\s\S]*?)```/g;

const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  md: "markdown",
  c: "c",
  h: "c",
  cpp: "cpp",
  "c++": "cpp",
  hpp: "cpp",
  cs: "csharp",
  go: "go",
  java: "java",
  php: "php",
  sql: "sql",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  json: "json",
  txt: "text",
  text: "text",
  plaintext: "text",
};

export function languageFromExtension(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return LANGUAGE_ALIASES[ext] ?? ext ?? "text";
}

function filenameFromInfo(info: string): { language?: string; filename?: string } {
  const tokens = info.trim().split(/\s+/).filter(Boolean);
  let filename: string | undefined;
  let language: string | undefined;
  for (const token of tokens) {
    if (/[./]/.test(token) && !/^https?:/i.test(token) && /\.[a-z0-9]{1,8}$/i.test(token)) {
      filename = token.replace(/^["'`]|["'`]$/g, "");
    } else if (!language) {
      language = token.toLowerCase();
    }
  }
  return { language, filename };
}

function filenameFromComment(content: string): string | undefined {
  const firstLines = content.split("\n").slice(0, 2).join("\n");
  const html = /<!--\s*(?:file(?:name)?\s*[:=]\s*)?([\w./@-]+\.[a-z0-9]{1,8})\s*-->/i.exec(firstLines);
  if (html?.[1]) return html[1];
  const line = /^\s*(?:\/\/|#|--|;|\/\*)\s*(?:file(?:name)?\s*[:=]\s*)?([\w./@-]+\.[a-z0-9]{1,8})\s*(?:\*\/)?\s*$/im.exec(
    firstLines,
  );
  return line?.[1];
}

export function extractCodeBlocks(markdown: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  FENCE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCE.exec(markdown)) !== null) {
    const info = match[1] ?? "";
    const content = match[2] ?? "";
    const parsed = filenameFromInfo(info);
    const filename = parsed.filename ?? filenameFromComment(content);
    const language = parsed.language ?? (filename ? languageFromExtension(filename) : "text");
    blocks.push({ language: LANGUAGE_ALIASES[language] ?? language, filename, content });
  }
  return blocks;
}

const DEFAULT_NAMES: Record<string, string> = {
  html: "index.html",
  css: "styles.css",
  javascript: "script.js",
  jsx: "App.jsx",
  tsx: "App.tsx",
  typescript: "index.ts",
  json: "data.json",
  python: "main.py",
  bash: "script.sh",
  sql: "query.sql",
  markdown: "README.md",
  text: "notes.txt",
};

export function extractProjectFiles(markdown: string): VirtualFile[] {
  const blocks = extractCodeBlocks(markdown);
  const used = new Map<string, number>();
  const files: VirtualFile[] = [];
  blocks.forEach((block, index) => {
    let path = (block.filename ?? DEFAULT_NAMES[block.language] ?? `snippet-${index + 1}.txt`).replace(/^\.?\//, "");
    if (used.has(path)) {
      const next = (used.get(path) ?? 1) + 1;
      used.set(path, next);
      const dot = path.lastIndexOf(".");
      path = dot > 0 ? `${path.slice(0, dot)}-${next}${path.slice(dot)}` : `${path}-${next}`;
    } else {
      used.set(path, 1);
    }
    files.push({ path, language: block.language, content: block.content });
  });
  return files;
}

const CONSOLE_SNIPPET = `<script>
(function(){
  var send=function(type,args){try{parent.postMessage({__apiset:true,type:type,args:args},"*")}catch(e){}};
  ["log","warn","error","info","debug"].forEach(function(m){
    var original=console[m];
    console[m]=function(){var args=Array.prototype.slice.call(arguments).map(function(a){try{return typeof a==="string"?a:JSON.stringify(a)}catch(e){return String(a)}});send(m,args);if(original)original.apply(console,arguments)};
  });
  window.addEventListener("error",function(e){send("error",[e.message+" ("+e.filename+":"+e.lineno+")"])});
  window.addEventListener("unhandledrejection",function(e){send("error",["Unhandled rejection: "+String(e.reason)])});
})();
</script>`;

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inlineAssets(html: string, files: VirtualFile[]): string {
  const byPath = new Map(files.map((f) => [f.path.replace(/^\.?\//, ""), f]));
  const lookup = (href: string) => byPath.get(href.replace(/^\.?\//, ""));

  let output = html.replace(
    /<link\b[^>]*href=["']([^"']+)["'][^>]*>/gi,
    (tag, href: string) => {
      const file = lookup(href);
      if (!file || file.language !== "css") return tag;
      return `<style>\n${file.content}\n</style>`;
    },
  );

  output = output.replace(
    /<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi,
    (tag, attrs: string, src: string) => {
      const file = lookup(src);
      if (!file) return tag;
      return `<script${attrs}>${file.content}</script>`;
    },
  );

  // keep the console hook first in <head> when possible
  if (/<head[^>]*>/i.test(output)) {
    output = output.replace(/<head([^>]*)>/i, `<head$1>${CONSOLE_SNIPPET}`);
  } else {
    output = `${CONSOLE_SNIPPET}${output}`;
  }

  return output;
}

export function buildPreviewHtml(files: VirtualFile[]): { html: string; entry?: string; runnable: boolean } {
  if (files.length === 0) {
    return { html: "", runnable: false };
  }
  const entry = files.find((f) => f.path === "index.html") ?? files.find((f) => f.language === "html");
  if (entry) {
    return { html: inlineAssets(entry.content, files), entry: entry.path, runnable: true };
  }

  const css = files.filter((f) => f.language === "css").map((f) => f.content).join("\n");
  const js = files.filter((f) => f.language === "javascript").map((f) => f.content).join("\n");
  const jsx = files.filter((f) => f.language === "jsx" || f.language === "tsx" || f.language === "typescript");
  const fonts =
    "font-family:Inter,system-ui,-apple-system,sans-serif;margin:0;background:#0b0e15;color:#e9edf9;min-height:100vh;display:grid;place-items:center;padding:2rem;";

  if (jsx.length > 0) {
    const previewCode = escapeHtml(jsx[0]?.content.slice(0, 4000) ?? "");
    return {
      entry: jsx[0]?.path,
      runnable: false,
      html: `${CONSOLE_SNIPPET}<div style="${fonts}"><div style="max-width:720px;width:100%">
        <div style="font:600 13px Inter,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#8b7bff;margin-bottom:12px">JSX source</div>
        <h1 style="font-size:20px;margin:0 0 8px">This block needs a build step</h1>
        <p style="color:#939bb1;font-size:13px;line-height:1.6;margin:0 0 16px">Preview runs plain HTML, CSS and JS in a sandbox. JSX/TSX is shown as source — export the project or ask the model for a single HTML file to preview it live.</p>
        <pre style="background:#141824;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:16px;overflow:auto;font:12px/1.6 'JetBrains Mono',monospace;color:#c6cddf">${previewCode}</pre>
      </div></div>`,
    };
  }

  const body = js || css
    ? `<div id="app"></div>`
    : `<div style="${fonts}"><p style="color:#939bb1;font-size:13px">No runnable HTML, CSS or JS found in this response.</p></div>`;

  return {
    entry: files[0]?.path,
    runnable: true,
    html: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${body}${CONSOLE_SNIPPET}<script>${js}</script></body></html>`,
  };
}

export function fileTree(files: VirtualFile[]): { name: string; path: string; children: TreeNode[]; file?: VirtualFile }[] {
  interface MutableNode {
    name: string;
    path: string;
    children: Map<string, MutableNode>;
    file?: VirtualFile;
  }
  const root = new Map<string, MutableNode>();
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let level = root;
    let acc = "";
    parts.forEach((part, index) => {
      acc = acc ? `${acc}/${part}` : part;
      const isLeaf = index === parts.length - 1;
      let node = level.get(part);
      if (!node) {
        node = { name: part, path: acc, children: new Map() };
        level.set(part, node);
      }
      if (isLeaf) node.file = file;
      level = node.children;
    });
  }
  const convert = (map: Map<string, MutableNode>): TreeNode[] =>
    [...map.values()]
      .sort((a, b) => (a.file ? 1 : 0) - (b.file ? 1 : 0) || a.name.localeCompare(b.name))
      .map((node) => ({
        name: node.name,
        path: node.path,
        children: convert(node.children),
        file: node.file,
      }));
  return convert(root);
}

export interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  file?: VirtualFile;
}
