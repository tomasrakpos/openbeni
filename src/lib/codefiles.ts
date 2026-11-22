// Shared logic codefiles; change this helper here and update callers if its contract changes.
import { PREVIEW_STUDIO_BRIDGE_SCRIPT } from "@/features/preview/previewBridge";
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

export interface ArtifactBuildStep {
  id: string;
  label: string;
  status: "done" | "active" | "pending";
}

export interface StreamingProjectExtraction {
  files: VirtualFile[];
  /** Non-null when the model is mid-stream inside an unclosed code fence. */
  inProgressFile: string | null;
}

export interface ChatArtifactSplit {
  /** Clean prose appearing before the project plan/code (never raw code or <plan> tags). */
  beforeText: string;
  /** Clean prose appearing after the project code blocks (never raw code). */
  afterText: string;
  /** Extracted project files (including any currently streaming open fence). */
  files: VirtualFile[];
  /** True when code or plan is actively streaming. */
  isBuilding: boolean;
  /** Whether a <plan> block or code fence (open or closed) has started in this message. */
  hasCode: boolean;
  /** Display title extracted from HTML <title> or primary filename. */
  title: string;
  /** Live total line count across extracted files. */
  totalLines: number;
  /** Live human-readable build steps (pending → active → done). */
  steps: ArtifactBuildStep[];
  /** Count of completed tasks. */
  completedSteps: number;
}

function blocksToVirtualFiles(blocks: CodeBlock[]): VirtualFile[] {
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

export function extractProjectFiles(markdown: string): VirtualFile[] {
  return blocksToVirtualFiles(extractCodeBlocks(markdown));
}

/**
 * Streaming-aware project file extractor.
 * Parses all completed fenced blocks PLUS a currently open trailing fence
 * (e.g. ```html index.html\n<!doctype... without closing ``` yet) so the
 * preview workspace and files tab update live while the model is streaming.
 */
export function extractStreamingProjectFiles(markdown: string): StreamingProjectExtraction {
  const blocks: CodeBlock[] = [];
  let cursor = 0;
  FENCE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCE.exec(markdown)) !== null) {
    const info = match[1] ?? "";
    const content = match[2] ?? "";
    const parsed = filenameFromInfo(info);
    const filename = parsed.filename ?? filenameFromComment(content);
    const language = parsed.language ?? (filename ? languageFromExtension(filename) : "text");
    blocks.push({ language: LANGUAGE_ALIASES[language] ?? language, filename, content });
    cursor = match.index + match[0].length;
  }

  let inProgressFile: string | null = null;
  const tail = markdown.slice(cursor);
  const openFence = /```([^\n`]*)(?:\n([\s\S]*))?$/.exec(tail);
  if (openFence) {
    const info = openFence[1] ?? "";
    const content = openFence[2] ?? "";
    const parsed = filenameFromInfo(info);
    const filename = parsed.filename ?? filenameFromComment(content);
    const language = parsed.language ?? (filename ? languageFromExtension(filename) : "text");
    const normLang = LANGUAGE_ALIASES[language] ?? language;
    const block: CodeBlock = { language: normLang, filename, content };
    blocks.push(block);
    inProgressFile = (block.filename ?? DEFAULT_NAMES[block.language] ?? `snippet-${blocks.length}.txt`).replace(
      /^\.?\//,
      "",
    );
  }

  return { files: blocksToVirtualFiles(blocks), inProgressFile };
}

/**
 * Extracts explicit `@step:` task markers in ANY programming language's native
 * comment syntax:
 * - HTML/XML:  `<!-- @step: ... -->`
 * - CSS/C:     `/* @step: ... *\/`
 * - JS/TS/Go/Rust/Java/C++/Swift/PHP: `// @step: ...`
 * - Python/Ruby/Bash/YAML/R:          `# @step: ...`
 * - SQL/Lua/Haskell:                  `-- @step: ...`
 */
function extractExplicitSteps(content: string): string[] {
  const steps: string[] = [];
  const regex =
    /(?:<!--\s*@step:\s*([^>]*?)\s*-->|\/\*\s*@step:\s*([^*]*?)\s*\*\/|(?:^|\n)\s*(?:\/\/|#|--)\s*@step:\s*([^\n]+))/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(content)) !== null) {
    const label = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (label && !steps.includes(label)) steps.push(label);
  }
  return steps;
}

/**
 * Extracts planned tasks from `<plan>...</plan>` (both complete and currently
 * streaming open `<plan>` blocks) and returns the cleaned prose without tags.
 */
function extractPlanBlock(
  prose: string,
  isStreaming: boolean,
): { cleaned: string; plannedTasks: string[]; hasPlan: boolean; planClosed: boolean } {
  const openMatch = /<plan\b[^>]*>/i.exec(prose);
  if (!openMatch) {
    // Prevent partial `<p`, `<pl`, `<pla`, `<plan` from flickering at stream tail.
    const cleaned = isStreaming
      ? prose.replace(/<\/?p(?:l(?:a(?:n)?)?)?$/i, "").replace(/`{1,2}$/, "").trimEnd()
      : prose.trim();
    return { cleaned, plannedTasks: [], hasPlan: false, planClosed: false };
  }

  const startIdx = openMatch.index;
  const bodyStart = startIdx + openMatch[0].length;
  const rest = prose.slice(bodyStart);
  const closeMatch = /<\/plan\s*>/i.exec(rest);
  const planClosed = Boolean(closeMatch);
  const planBody = closeMatch ? rest.slice(0, closeMatch.index) : rest;
  const afterPlan = closeMatch ? rest.slice(closeMatch.index + closeMatch[0].length) : "";

  const lines = planBody.split(/\r?\n/);
  const plannedTasks: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i] ?? "";
    // Skip a half-streamed last line if the <plan> tag isn't closed yet and has < 3 chars.
    const cleanedLine = rawLine
      .replace(/^\s*(?:[-*•+]|\d+[.)]|\[\s*[xX ]?\s*\])\s*/, "")
      .replace(/<\/?p(?:l(?:a(?:n)?)?)?$/i, "")
      .trim();
    if (!cleanedLine) continue;
    if (!planClosed && isStreaming && i === lines.length - 1 && cleanedLine.length < 3) continue;
    if (!plannedTasks.includes(cleanedLine)) plannedTasks.push(cleanedLine);
  }

  const beforePlan = prose.slice(0, startIdx).trim();
  const trailingProse = afterPlan
    .replace(isStreaming ? /`{1,2}$/ : /$^/, "")
    .trim();
  const cleaned = [beforePlan, trailingProse].filter(Boolean).join("\n\n").trim();

  return { cleaned, plannedTasks, hasPlan: true, planClosed };
}

function normalizeStepKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[`'"()[\]{}.,:;!?،؛\-–—_/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function deriveBuildSteps(
  plannedTasks: string[],
  files: VirtualFile[],
  inProgressFile: string | null,
  isBuilding: boolean,
  hasCode: boolean,
  lang: "en" | "fa",
): ArtifactBuildStep[] {
  const combined = files.map((f) => f.content).join("\n");
  const explicit = extractExplicitSteps(combined);

  // Case 1: Model provided a dynamic `<plan>...</plan>` tailored to the user's request.
  if (plannedTasks.length > 0) {
    if (!isBuilding) {
      // Finished building: mark all planned tasks (+ any extra executed steps) done.
      const seen = new Set(plannedTasks.map(normalizeStepKey));
      const all = [...plannedTasks];
      for (const step of explicit) {
        const key = normalizeStepKey(step);
        if (!seen.has(key)) {
          seen.add(key);
          all.push(step);
        }
      }
      return all.map((label, idx) => ({
        id: `plan-${idx}`,
        label,
        status: "done",
      }));
    }

    // Streaming live: figure out which planned task is currently active!
    let activeIdx = -1;
    if (explicit.length > 0) {
      const latestStep = explicit[explicit.length - 1] ?? "";
      const latestKey = normalizeStepKey(latestStep);
      const exactMatch = plannedTasks.findIndex((task) => {
        const taskKey = normalizeStepKey(task);
        return (
          taskKey === latestKey ||
          (taskKey.length > 4 && latestKey.includes(taskKey)) ||
          (latestKey.length > 4 && taskKey.includes(latestKey))
        );
      });
      activeIdx =
        exactMatch >= 0
          ? exactMatch
          : Math.min(plannedTasks.length - 1, explicit.length - 1);
    } else if (hasCode) {
      activeIdx = 0;
    }

    const steps: ArtifactBuildStep[] = plannedTasks.map((label, idx) => {
      if (activeIdx === -1) {
        // Still streaming the `<plan>` list itself before code begins.
        return {
          id: `plan-${idx}`,
          label,
          status: idx === plannedTasks.length - 1 ? "active" : "pending",
        };
      }
      if (idx < activeIdx) return { id: `plan-${idx}`, label, status: "done" };
      if (idx === activeIdx) return { id: `plan-${idx}`, label, status: "active" };
      return { id: `plan-${idx}`, label, status: "pending" };
    });

    // If the model emitted an extra step beyond its original plan, surface it cleanly.
    const plannedKeys = new Set(plannedTasks.map(normalizeStepKey));
    explicit.forEach((step, idx) => {
      const key = normalizeStepKey(step);
      const matchesAny =
        plannedKeys.has(key) ||
        plannedTasks.some((t) => {
          const tk = normalizeStepKey(t);
          return (tk.length > 4 && key.includes(tk)) || (key.length > 4 && tk.includes(key));
        });
      if (!matchesAny && explicit.length > plannedTasks.length) {
        steps.push({
          id: `extra-${idx}`,
          label: step,
          status: idx === explicit.length - 1 ? "active" : "done",
        });
      }
    });

    return steps;
  }

  // Case 2: Model emitted `@step:` markers directly inside the code without `<plan>`.
  if (explicit.length > 0) {
    return explicit.map((label, idx) => ({
      id: `step-${idx}`,
      label,
      status: isBuilding && idx === explicit.length - 1 ? "active" : "done",
    }));
  }

  // Case 3: Graceful fallback for any model that writes plain code without markers.
  const rawSteps: string[] = [];
  const isFa = lang === "fa";

  if (files.length === 0) {
    rawSteps.push(isFa ? "برنامه‌ریزی ساختار و اجزای پروژه" : "Planning layout and components");
  } else {
    for (const file of files) {
      const lower = file.content.toLowerCase();
      if (file.language === "html" || file.path.endsWith(".html")) {
        rawSteps.push(isFa ? `ساخت ساختار اصلی صفحه (${file.path})` : `Creating page structure (${file.path})`);
        if (lower.includes("<style")) {
          rawSteps.push(isFa ? "طراحی استایل، رنگ‌ها و چیدمان ریسپانسیو" : "Styling layout, theme, and responsive UI");
        }
        if (lower.includes("<body")) {
          rawSteps.push(isFa ? "پیاده‌سازی اجزای رابط کاربری" : "Building interactive UI elements");
        }
        if (lower.includes("<script")) {
          rawSteps.push(isFa ? "افزودن منطق و تعامل‌های صفحه" : "Adding interactive logic and handlers");
        }
      } else if (file.language === "css" || file.path.endsWith(".css")) {
        rawSteps.push(isFa ? `تنظیم استایل‌ها (${file.path})` : `Writing styles (${file.path})`);
      } else {
        rawSteps.push(isFa ? `ساخت فایل ${file.path}` : `Writing ${file.path}`);
      }
    }
  }

  const unique = Array.from(new Set(rawSteps));
  return unique.map((label, idx) => ({
    id: `auto-${idx}`,
    label,
    status: (isBuilding || Boolean(inProgressFile)) && idx === unique.length - 1 ? "active" : "done",
  }));
}

function extractArtifactTitle(files: VirtualFile[], lang: "en" | "fa"): string {
  for (const file of files) {
    if (file.language === "html" || file.path.endsWith(".html")) {
      const match = /<title[^>]*>([^<]+)<\/title>/i.exec(file.content);
      const raw = match?.[1]?.trim();
      if (raw) return raw;
    }
  }
  if (files[0]?.path) return files[0].path;
  return lang === "fa" ? "پیش‌نمایش پروژه" : "Project Preview";
}

/**
 * Splits a project-building assistant reply into clean conversational prose
 * (before & after) and structured workspace artifact data so raw code fences
 * and `<plan>` tags never pollute the chat stream.
 */
export function splitChatAndArtifact(
  markdown: string,
  isStreaming: boolean,
  lang: "en" | "fa" = "en",
): ChatArtifactSplit {
  const { files, inProgressFile } = extractStreamingProjectFiles(markdown);

  // Locate first fence start and last closed fence end.
  const firstFenceIdx = markdown.indexOf("```");
  const hasFence = firstFenceIdx !== -1;

  const rawBefore = hasFence ? markdown.slice(0, firstFenceIdx) : markdown;
  const { cleaned: beforeText, plannedTasks, hasPlan } = extractPlanBlock(rawBefore, isStreaming);

  let afterText = "";
  if (hasFence && !inProgressFile) {
    FENCE.lastIndex = 0;
    let lastEnd = firstFenceIdx;
    let match: RegExpExecArray | null;
    while ((match = FENCE.exec(markdown)) !== null) {
      lastEnd = match.index + match[0].length;
    }
    afterText = markdown.slice(lastEnd).trim();
  }

  const hasCode = hasFence || hasPlan;
  const totalLines = files.reduce(
    (sum, f) => sum + (f.content ? f.content.split("\n").length : 0),
    0,
  );
  const isBuilding =
    isStreaming && (Boolean(inProgressFile) || !hasFence || files.length === 0 || !afterText);
  const title = extractArtifactTitle(files, lang);
  const steps = deriveBuildSteps(plannedTasks, files, inProgressFile, isBuilding, hasFence, lang);
  const completedSteps = steps.filter((s) => s.status === "done").length;

  return {
    beforeText,
    afterText,
    files,
    isBuilding,
    hasCode,
    title,
    totalLines,
    steps,
    completedSteps,
  };
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
  var postPager=function(msg){try{msg.__ohPager=true;parent.postMessage(msg,"*")}catch(e){}};
  var sx=0,sy=0,lx=0,lt=0,vx=0,st=0,mode="";
  function canScrollLeft(el){
    while(el&&el!==document.documentElement){
      var s=getComputedStyle(el);
      if((s.overflowX==="auto"||s.overflowX==="scroll")&&el.scrollWidth>el.clientWidth+2&&el.scrollLeft>2)return true;
      el=el.parentElement;
    }
    return (document.scrollingElement&&document.scrollingElement.scrollLeft>2);
  }
  function begin(m,x,y,t){
    if(t&&t.closest&&t.closest("input,textarea,select,[contenteditable=true]"))return;
    mode=m;sx=lx=x;sy=y;lt=Date.now();vx=0;st=1;
  }
  function move(x,y,ev){
    if(!st)return;
    var dx=x-sx,dy=y-sy;
    if(st===1){
      if(Math.hypot(dx,dy)<6)return;
      if(Math.abs(dy)>Math.abs(dx)||dx<=0||canScrollLeft(ev.target)){st=0;return;}
      st=2;postPager({phase:"start"});
    }
    if(st===2){
      if(ev.cancelable)ev.preventDefault();
      var now=Date.now(),dt=Math.max(1,now-lt);
      vx=vx*0.4+((x-lx)/dt)*0.6;lx=x;lt=now;
      postPager({phase:"move",dx:dx});
    }
  }
  function finish(cancel){
    if(st===2)postPager({phase:"end",dx:lx-sx,vx:vx,cancel:!!cancel});
    st=0;mode="";
  }
  window.addEventListener("touchstart",function(e){if(e.touches.length===1){var t=e.touches[0];begin("t",t.clientX,t.clientY,e.target)}else if(st===2)finish(true)},{passive:true});
  window.addEventListener("touchmove",function(e){if(mode==="t"&&e.touches.length===1){var t=e.touches[0];move(t.clientX,t.clientY,e)}},{passive:false});
  window.addEventListener("touchend",function(){if(mode==="t")finish(false)},{passive:true});
  window.addEventListener("touchcancel",function(){if(mode==="t")finish(true)},{passive:true});
  window.addEventListener("mousedown",function(e){if(e.button===0)begin("m",e.clientX,e.clientY,e.target)});
  window.addEventListener("mousemove",function(e){if(mode==="m")move(e.clientX,e.clientY,e)});
  window.addEventListener("mouseup",function(){if(mode==="m")finish(false)});
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

  // keep the console hook and studio bridge first in <head> when possible
  const injectedHead = `${CONSOLE_SNIPPET}${PREVIEW_STUDIO_BRIDGE_SCRIPT}`;
  if (/<head[^>]*>/i.test(output)) {
    output = output.replace(/<head([^>]*)>/i, `<head$1>${injectedHead}`);
  } else {
    output = `${injectedHead}${output}`;
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
      html: `${CONSOLE_SNIPPET}${PREVIEW_STUDIO_BRIDGE_SCRIPT}<div style="${fonts}"><div style="max-width:720px;width:100%">
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
    html: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${body}${CONSOLE_SNIPPET}${PREVIEW_STUDIO_BRIDGE_SCRIPT}<script>${js}</script></body></html>`,
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
