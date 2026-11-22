/**
 * Universal Project-Builder & Dynamic Task-Planning System Prompt.
 *
 * Automatically injected by the backend (`/api/chat`) whenever the preview-intent
 * classifier determines that the user is building or editing a website, web app,
 * game, UI component, or interactive project.
 *
 * Works across ALL AI models (OpenAI, Claude, Gemini, DeepSeek, Qwen, Ollama, etc.)
 * and ALL programming languages (HTML/CSS/JS, React/TSX, Vue, Python, Node, Go,
 * Rust, SQL, Canvas/Three.js, etc.).
 *
 * Protocol summary:
 * 1. Brief human opening (1–2 sentences) in the user's own language.
 * 2. `<plan>...</plan>` block containing 3–6 concrete, request-specific tasks
 *    tailored dynamically to exactly what the user asked for.
 * 3. Fenced code block(s) with explicit filenames (` ```html index.html `,
 *    ` ```tsx App.tsx `, ` ```python main.py `, etc.), placing a native-comment
 *    `@step: <task label>` marker right before each task's implementation so
 *    the UI updates task progress (pending → active → done) live as tokens stream.
 * 4. Brief human wrap-up (1–2 sentences) inviting the user to inspect the live
 *    preview or request edits.
 */
import type { PreviewCategory, PreviewIntentMessage } from "./previewIntent";

export const PROJECT_BUILDER_MARKER = "[OPENHARNESS_PROJECT_BUILDER_V1]";

function detectUserLanguage(messages: PreviewIntentMessage[]): "fa" | "en" | "auto" {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?.role !== "user") continue;
    const text = m.content.trim();
    if (!text) continue;
    if (/[\u0600-\u06FF]/.test(text)) return "fa";
    if (/[a-zA-Z]/.test(text)) return "en";
  }
  return "auto";
}

function categoryHint(category: PreviewCategory): string {
  switch (category) {
    case "game":
      return "The user is building an interactive game. Ensure smooth controls (keyboard + touch/pointer), responsive viewport scaling, clear score/state HUD, and replayability.";
    case "website":
      return "The user is building a website or landing page. Ensure cohesive typography, responsive mobile-first layout, clear hierarchy, and polished visual craft.";
    case "app":
      return "The user is building an interactive application or tool. Ensure working state management, realistic interactive flows, validation, and responsive UX.";
    case "ui":
      return "The user is building a UI screen or component. Ensure clean visual hierarchy, accessible controls, realistic interactive states, and mobile responsiveness.";
    default:
      return "The user is building or updating a software/web project. Deliver clean, runnable, well-structured code tailored directly to their request.";
  }
}

export function buildProjectBuilderSystemPrompt(
  category: PreviewCategory,
  messages: PreviewIntentMessage[],
): string {
  const lang = detectUserLanguage(messages);
  const langRule =
    lang === "fa"
      ? "Write all conversational text, `<plan>` tasks, and `@step:` labels in natural, concise Persian (فارسی) matching the user's message."
      : lang === "en"
        ? "Write all conversational text, `<plan>` tasks, and `@step:` labels in natural, concise English matching the user's message."
        : "Write all conversational text, `<plan>` tasks, and `@step:` labels in the exact same language as the user's latest message.";

  return [
    PROJECT_BUILDER_MARKER,
    "You are operating inside a live project workspace with a side-by-side Preview & Files panel.",
    "The user does NOT read raw code inside the chat bubble — all fenced code blocks are routed automatically to the live Preview & Files workspace, while your `<plan>` and `@step:` markers power the live task tracker in the UI.",
    "",
    categoryHint(category),
    "",
    "Follow this exact response structure whenever creating or editing project code:",
    `1. Language: ${langRule}`,
    "2. Opening (1–2 short sentences): Briefly state what you are building or updating in friendly, natural human language. Do NOT explain code line-by-line or paste inline code snippets in the prose.",
    "3. Dynamic Task Plan: Immediately after the opening, output a `<plan>` block with 3 to 6 concrete, user-specific tasks tailored strictly to this request (never generic boilerplate):",
    "<plan>",
    "- First specific task for this project",
    "- Second specific task for this project",
    "- Third specific task for this project",
    "</plan>",
    "4. Task-by-Task Implementation: Write complete, runnable code in fenced blocks with explicit filenames (e.g. ```html index.html, ```css styles.css, ```js app.js, ```tsx App.tsx, ```python main.py, etc.).",
    "   - For web pages, games, and interactive UIs, prefer a complete self-contained `index.html` (or clean `index.html` + `styles.css` + `app.js`) so the live sandboxed preview renders immediately with zero missing dependencies.",
    "   - Right before implementing each planned task inside the code, place a single comment marker using the language's native comment syntax matching the task label:",
    "     • HTML: `<!-- @step: <task label> -->`",
    "     • JS / TS / TSX / Go / Rust / Java / C / C++: `// @step: <task label>`",
    "     • CSS / SCSS: `/* @step: <task label> */`",
    "     • Python / Ruby / Bash / YAML: `# @step: <task label>`",
    "     • SQL / Lua: `-- @step: <task label>`",
    "   - Emit each `@step:` marker in the same order as `<plan>` so every task transitions smoothly from pending → active → completed in real time.",
    "5. Closing (1–2 short sentences): After the final closing code fence, briefly summarize what is ready and invite the user to open the preview card or swipe to test it.",
  ].join("\n");
}

/**
 * Injects the project-builder system prompt into a chat message array without
 * duplicating it or overwriting any existing user/app system prompt.
 */
export function injectProjectBuilderPrompt<T extends { role: string; content: unknown }>(
  messages: T[],
  category: PreviewCategory,
  plainMessages: PreviewIntentMessage[],
): T[] {
  const alreadyInjected = messages.some(
    (m) =>
      m.role === "system" &&
      typeof m.content === "string" &&
      m.content.includes(PROJECT_BUILDER_MARKER),
  );
  if (alreadyInjected) return messages;

  const instruction = buildProjectBuilderSystemPrompt(category, plainMessages);
  const existingSystemIdx = messages.findIndex(
    (m) => m.role === "system" && typeof m.content === "string",
  );

  if (existingSystemIdx >= 0) {
    return messages.map((m, idx) =>
      idx === existingSystemIdx
        ? { ...m, content: `${String(m.content).trim()}\n\n${instruction}` }
        : m,
    );
  }

  return [{ role: "system", content: instruction } as T, ...messages];
}
