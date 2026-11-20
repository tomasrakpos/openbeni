// Reusable UI primitive prompt-composer; adjust its default appearance and behavior here.
import * as React from "react";
import { gsap } from "gsap";
import { ArrowUp, Loader2, Paperclip } from "lucide-react";
import { LiquidGlassPanel } from "@/components/ui/liquid-glass-panel";
import { MorphMenu, type MorphMenuItem } from "@/components/ui/morph-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/*
 * Prompt Composer: the liquid-glass prompt box of an AI app builder. The
 * placeholder types example prompts out and deletes them again; platform
 * chips are a radio group; the model picker is a real menu (arrow keys,
 * Escape); attachments go through a real file input and show as removable
 * chips; the send button breathes once there is something to send. Enter
 * sends, Shift + Enter breaks the line.
 *
 * Adapted for OpenHarness:
 * - No Next.js directives; plain React 18 + Vite.
 * - Simulated build log is opt-in (`simulate`, default false) and unused by the app.
 * - Models are controlled real rows (`PromptComposerModel`) instead of strings.
 * - Attachments are controlled real `Attachment` rows, not file-name strings.
 * - Platform chips are hidden unless `showPlatforms` is set (OpenHarness is not an app builder).
 * - Colours come from the app design tokens, so light/dark and RTL work.
 */

export type ComposerIcon =
  | "spark"
  | "eye"
  | "code"
  | "chat"
  | "phone"
  | "rocket"
  | "window"
  | "bars"
  | "game"
  | "bolt";

export type ComposerAccent = "app" | "ice" | "ember" | "lime";

export type ComposerPlatform = {
  label: string;
  icon: ComposerIcon;
};

export type PromptComposerModel = {
  /** Stable row id of the model. */
  id: string;
  label: string;
  /** Secondary line in the menu, e.g. the provider name. */
  note?: string;
};

export type PromptComposerAttachment = {
  id: string;
  name: string;
  /** Optional badge, e.g. the attachment kind. */
  kind?: string;
};

export type ComposerSubmit = {
  prompt: string;
  modelId: string;
  platform: string;
  files: string[];
};

export interface PromptComposerProps {
  /** Example prompts the placeholder types out, one after another. */
  prompts?: string[];
  /** Shown instead of the typing examples while the field has focus. */
  placeholder?: string;
  platforms?: ComposerPlatform[];
  /** Hide the app-builder platform chips. Default: false (hidden). */
  showPlatforms?: boolean;
  models?: PromptComposerModel[];
  /** Controlled selected model row id. */
  modelId?: string;
  onModelChange?: (modelId: string) => void;
  /** One line under each model in the menu. Overrides `note` when present. */
  modelNotes?: string[];
  /** Steps of the demo build log (only used when `simulate` is on). */
  buildSteps?: string[];
  /** Play the build log and preview after sending. Off by default. */
  simulate?: boolean;
  /** The keyboard hint under the box. */
  hint?: boolean;
  hintText?: React.ReactNode;
  accent?: ComposerAccent;
  /** Pending attachments belonging to the active chat. */
  attachments?: PromptComposerAttachment[];
  attachPending?: boolean;
  onAttach?: (files: File[]) => void | Promise<void>;
  onRemoveAttachment?: (id: string) => void;
  /** Increment to focus the textarea (used by the global shortcut). */
  focusSignal?: number;
  /** Controlled prompt text. Omit to let the composer own it. */
  value?: string;
  onChange?: (text: string) => void;
  /** True while a response is streaming: the send button becomes Stop. */
  streaming?: boolean;
  onStop?: () => void;
  stopLabel?: string;
  /**
   * Controls rendered at the start of the left action row, before the built-in
   * attach button (e.g. the microphone). Keep them 32×32 for a compact row.
   */
  leadingActions?: React.ReactNode;
  /**
   * Controls rendered after the built-in attach button, still in the left
   * action row (e.g. the settings / parameters menu).
   */
  trailingActions?: React.ReactNode;
  /**
   * Compact control rendered on the right, immediately before the model pill
   * (e.g. the reasoning / intelligence level picker).
   */
  modelLeading?: React.ReactNode;
  disabled?: boolean;
  labels?: {
    form?: string;
    input?: string;
    attach?: string;
    model?: string;
    remove?: string;
    send?: string;
    platforms?: string;
    files?: string;
  };
  onSubmit?: (submission: ComposerSubmit) => void;
  className?: string;
}

const DEFAULT_PROMPTS = [
  "A habit tracker with streaks, gentle reminders and a weekly recap...",
  "A booking app for a small yoga studio, with class passes and a waitlist...",
  "A shared grocery list that sorts itself by supermarket aisle...",
  "A dashboard for my store's daily sales, refunds and best sellers...",
];

const DEFAULT_PLATFORMS: ComposerPlatform[] = [
  { label: "Mobile app", icon: "phone" },
  { label: "Web app", icon: "window" },
  { label: "Dashboard", icon: "bars" },
  { label: "Game", icon: "game" },
];

const DEFAULT_STEPS = [
  "Reading your idea",
  "Sketching the screens",
  "Writing components",
  "Wiring data and sign-in",
  "Polishing the details",
];

const ACCENTS: Record<ComposerAccent, { a1: string; a2: string; a3: string; glow: string; ink: string }> = {
  app: {
    a1: "color-mix(in oklab, var(--primary) 32%, white)",
    a2: "var(--primary)",
    a3: "var(--accent)",
    glow: "color-mix(in oklab, var(--primary) 42%, transparent)",
    ink: "var(--primary-foreground)",
  },
  ice: {
    a1: "#e8f6ff",
    a2: "#a9dcff",
    a3: "#5fb2f2",
    glow: "rgba(95, 178, 242, 0.42)",
    ink: "#06233a",
  },
  ember: {
    a1: "#fcc8a6",
    a2: "#f49d70",
    a3: "#e07a45",
    glow: "rgba(224, 122, 69, 0.42)",
    ink: "#3a1606",
  },
  lime: {
    a1: "#efffc4",
    a2: "#c4f26a",
    a3: "#8fcf2e",
    glow: "rgba(143, 207, 46, 0.38)",
    ink: "#1c2a05",
  },
};

const ICONS: Record<string, string> = {
  spark: "...#.../...#.../..###../#######/..###../...#.../...#...",
  eye: "......./..###../.#...#./#..#..#/.#...#./..###../.......",
  code: ".##.##./.#...#./#.....#/#.....#/#.....#/.#...#./.##.##.",
  chat: "#######/#.....#/#.#.#.#/#.....#/#######/.##..../.#.....",
  phone: ".#####./.#...#./.#...#./.#...#./.#####./.##.##./.#####.",
  rocket: "...#.../..###../..#.#../..###../.#####./#.###.#/..#.#..",
  window: "#######/#.#.#.#/#######/#.....#/#.....#/#.....#/#######",
  bars: "......#/....#.#/....#.#/..#.#.#/..#.#.#/#.#.#.#/#######",
  game: "...#.../...#.../..###../.#####./#######/#.#.#.#/#######",
  bolt: "....##./...##../..##.../.######/...##../..##.../.##....",
  check: "......./......#/.....#./#...#../.#.#.../..#..../.......",
  arrow: "...#.../..###../.#.#.#./#..#..#/...#.../...#.../...#...",
  clip: "..###../.#...#./.#.#.#./.#.#.#./.#.#.#./.#...#./..###..",
};

// #region app-name
const FILLER = new Set([
  "a",
  "an",
  "the",
  "app",
  "application",
  "for",
  "that",
  "with",
  "build",
  "make",
  "me",
  "my",
  "i",
  "want",
  "need",
  "please",
  "to",
  "of",
  "and",
  "simple",
  "small",
  "new",
  "create",
  "which",
  "where",
  "who",
  "lets",
  "let",
]);

/** Names the "built" app from its prompt: the first two meaningful words, capitalised. */
export function appNameFrom(prompt: string) {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w));
  if (!words.length) return "Untitled";
  return words
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
// #endregion app-name

const useIsoLayoutEffect = typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

function useReducedMotion() {
  const [reduced, setReduced] = React.useState(false);
  useIsoLayoutEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/**
 * Follows the document's `dark` class so the glass material re-calibrates its
 * tone, rim and fill with the app theme (including "system", which the settings
 * store resolves onto <html>).
 */
function useDocumentDark() {
  const read = () =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const [dark, setDark] = React.useState(read);
  React.useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const sync = () => setDark(root.classList.contains("dark"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

function PixelIcon({ name }: { name: string }) {
  const rows = (ICONS[name] || ICONS.spark).split("/");
  const cells: number[][] = [];
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) if (r[x] === "#") cells.push([x, y]);
  });
  return (
    <svg className="ppc-icon" viewBox="0 0 7 7" aria-hidden="true" focusable="false">
      {cells.map(([x, y], i) => (
        <rect key={i} x={x + 0.08} y={y + 0.08} width={0.84} height={0.84} rx={0.12} />
      ))}
    </svg>
  );
}

export default function PromptComposer({
  prompts = DEFAULT_PROMPTS,
  placeholder = "Describe what you want to explore...",
  platforms = DEFAULT_PLATFORMS,
  showPlatforms = false,
  models = [],
  modelId,
  onModelChange,
  modelNotes,
  buildSteps = DEFAULT_STEPS,
  simulate = false,
  hint = false,
  hintText,
  accent = "app",
  attachments = [],
  attachPending = false,
  onAttach,
  onRemoveAttachment,
  focusSignal = 0,
  value,
  onChange,
  streaming = false,
  onStop,
  stopLabel,
  leadingActions,
  trailingActions,
  modelLeading,
  disabled = false,
  labels,
  onSubmit,
  className,
}: PromptComposerProps) {
  const reduced = useReducedMotion();
  const dark = useDocumentDark();
  const uid = React.useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const tone = ACCENTS[accent] || ACCENTS.app;

  const cardRef = React.useRef(null as HTMLFormElement | null);
  const inputRef = React.useRef(null as HTMLTextAreaElement | null);
  const fileRef = React.useRef(null as HTMLInputElement | null);
  const prevHeight = React.useRef(0);
  const buildTl = React.useRef(null as gsap.core.Timeline | null);

  const [internalPrompt, setInternalPrompt] = React.useState("");
  const prompt = value ?? internalPrompt;
  const updatePrompt = React.useCallback(
    (next: string) => {
      if (value === undefined) setInternalPrompt(next);
      onChange?.(next);
    },
    [value, onChange],
  );
  const [platform, setPlatform] = React.useState(0);
  const [internalModelId, setInternalModelId] = React.useState(models[0]?.id ?? "");
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [phase, setPhase] = React.useState("idle" as "idle" | "building" | "done");
  const [step, setStep] = React.useState(0);
  const [built, setBuilt] = React.useState({ name: "", platform: "", prompt: "" });
  const [typed, setTyped] = React.useState("");
  const [focused, setFocused] = React.useState(false);
  const [nudge, setNudge] = React.useState(false);

  const selectedModelId = modelId ?? internalModelId;
  const selectedIndex = Math.max(
    0,
    models.findIndex((model) => model.id === selectedModelId),
  );
  const selectedModel = models[selectedIndex];
  const note = (i: number) =>
    (modelNotes && modelNotes[i]) ||
    models[i]?.note ||
    (i === 0 ? "Fastest drafts" : i === models.length - 1 ? "Most careful" : "Balanced");

  // Keep the internal selection valid as real model rows load or change.
  React.useEffect(() => {
    if (models.length === 0) {
      if (internalModelId) setInternalModelId("");
      return;
    }
    if (models.some((model) => model.id === selectedModelId)) return;
    const first = models[0].id;
    if (modelId === undefined) setInternalModelId(first);
    onModelChange?.(first);
  }, [models, modelId, selectedModelId, internalModelId, onModelChange]);

  React.useEffect(() => {
    if (focusSignal > 0 && phase === "idle") inputRef.current?.focus({ preventScroll: true });
  }, [focusSignal, phase]);

  /*
   * Compact auto-grow: one line at rest, grows with the content up to 200px,
   * then scrolls internally. `field-sizing` alone is not enough because
   * Safari does not support it yet, so the height is measured here.
   */
  useIsoLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, 200);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > 200 ? "auto" : "hidden";
  }, [prompt, phase, disabled]);

  const chooseModel = (index: number) => {
    const model = models[index];
    if (!model) return;
    if (modelId === undefined) setInternalModelId(model.id);
    onModelChange?.(model.id);
    setMenuOpen(false);
  };

  const submit = (e?: { preventDefault: () => void }) => {
    if (e) e.preventDefault();
    if (streaming) return;
    const text = prompt.trim();
    if (!text || !selectedModel || disabled) {
      setNudge(true);
      window.setTimeout(() => setNudge(false), 500);
      inputRef.current?.focus();
      return;
    }
    onSubmit?.({
      prompt: text,
      modelId: selectedModel.id,
      platform: showPlatforms ? (platforms[platform]?.label ?? "") : "",
      files: attachments.map((file) => file.name),
    });
    if (!simulate) {
      updatePrompt("");
      return;
    }
    if (cardRef.current) prevHeight.current = cardRef.current.offsetHeight;
    setBuilt({
      name: appNameFrom(text),
      platform: platforms[platform]?.label || "App",
      prompt: text,
    });
    setStep(0);
    setPhase("building");
  };

  const reset = (keep: boolean) => {
    buildTl.current?.kill();
    if (cardRef.current) prevHeight.current = cardRef.current.offsetHeight;
    if (!keep) {
      updatePrompt("");
    }
    setPhase("idle");
    window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 30);
  };

  // the build log: one step at a time, then the preview
  React.useEffect(() => {
    if (phase !== "building") return;
    const tl = gsap.timeline();
    buildSteps.forEach((_, i) => tl.call(() => setStep(i + 1), undefined, (i + 1) * (reduced ? 0.35 : 0.72)));
    tl.call(
      () => {
        if (cardRef.current) prevHeight.current = cardRef.current.offsetHeight;
        setPhase("done");
      },
      undefined,
      "+=0.45",
    );
    buildTl.current = tl;
    return () => {
      tl.kill();
    };
  }, [phase, reduced, buildSteps]);

  // the card morphs between its three bodies instead of jumping
  useIsoLayoutEffect(() => {
    const card = cardRef.current;
    if (!card || !prevHeight.current) return;
    const from = prevHeight.current;
    prevHeight.current = 0;
    if (reduced) return;
    const kids = card.querySelectorAll(".ppc-enter");
    const tw = gsap.fromTo(
      card,
      { height: from },
      { height: card.offsetHeight, duration: 0.6, ease: "expo.out", clearProps: "height" },
    );
    const tk = gsap.fromTo(
      kids,
      { opacity: 0, y: 12, filter: "blur(6px)" },
      {
        opacity: 1,
        y: 0,
        filter: "blur(0px)",
        duration: 0.55,
        stagger: 0.05,
        ease: "power3.out",
        clearProps: "filter,transform",
      },
    );
    return () => {
      tw.kill();
      tk.kill();
    };
  }, [phase, reduced]);

  // the placeholder types the example prompts out
  const promptKey = prompts.join("|");
  React.useEffect(() => {
    if (!prompts.length) return;
    if (reduced) {
      setTyped(prompts[0]);
      return;
    }
    let i = 0;
    let n = 0;
    let back = false;
    let id = 0;
    const tick = () => {
      const full = prompts[i % prompts.length];
      if (!back) {
        n++;
        setTyped(full.slice(0, n));
        if (n >= full.length) {
          back = true;
          id = window.setTimeout(tick, 2200);
          return;
        }
        id = window.setTimeout(tick, 26 + Math.random() * 40);
      } else {
        n = Math.max(0, n - 3);
        setTyped(full.slice(0, n));
        if (n === 0) {
          back = false;
          i++;
          id = window.setTimeout(tick, 380);
          return;
        }
        id = window.setTimeout(tick, 14);
      }
    };
    id = window.setTimeout(tick, 900);
    return () => window.clearTimeout(id);
  }, [promptKey, reduced]);

  // the glass refracts the page behind it; no extra sheen layer

  const handleFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length) void onAttach?.(files);
  };

  const empty = !prompt;
  const canSend = !disabled && !!selectedModel && prompt.trim().length > 0;
  const ready = canSend || streaming;
  const ids = { input: uid + "-input" };
  const style = {
    "--ppc-a1": tone.a1,
    "--ppc-a2": tone.a2,
    "--ppc-a3": tone.a3,
    "--ppc-glow": tone.glow,
    "--ppc-ink": tone.ink,
  } as React.CSSProperties;

  const modelItems: MorphMenuItem[] = models.map((m, i) => ({
    id: m.id,
    label: m.label,
    meta: note(i),
    checked: selectedIndex === i,
    onSelect: () => chooseModel(i),
  }));

  return (
    <div className={"ppc-root" + (className ? " " + className : "")} style={style}>
      <style>{PPC_CSS}</style>
      <div className="ppc-stage">
        <LiquidGlassPanel
          className="ppc-glass"
          aria-hidden="true"
          appearance={dark ? "dark" : "light"}
          bezel={32}
          blur={3}
          brightness={dark ? 1.18 : 1}
          saturation={1.2}
          fallbackBlur={18}
        />
        <form
          ref={cardRef}
          className="ppc-card"
          data-phase={phase}
          data-nudge={nudge ? "true" : "false"}
          onSubmit={submit}
          aria-label={labels?.form ?? "Prompt"}
        >
        {phase === "idle" && (
          <>
            <div className="ppc-field ppc-enter">
              <label htmlFor={ids.input} className="ppc-sr">
                {labels?.input ?? "Describe what you want to explore"}
              </label>
              <textarea
                ref={inputRef}
                id={ids.input}
                className="ppc-input"
                rows={1}
                dir="auto"
                maxLength={32_000}
                value={prompt}
                disabled={disabled}
                onChange={(e) => updatePrompt(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
                }}
              />
              {empty && (
                <span className="ppc-ph" aria-hidden="true" dir="auto">
                  {focused || prompts.length === 0 ? placeholder : typed}
                  {!focused && prompts.length > 0 && <i className="ppc-caret" />}
                </span>
              )}
            </div>

            {attachments.length > 0 && (
              <ul className="ppc-files ppc-enter" aria-label={labels?.files ?? "Attached files"}>
                {attachments.map((file) => (
                  <li key={file.id} className="ppc-file">
                    <PixelIcon name="clip" />
                    <span title={file.name}>{file.name}</span>
                    <button
                      type="button"
                      aria-label={(labels?.remove ?? "Remove") + " " + file.name}
                      onClick={() => onRemoveAttachment?.(file.id)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="ppc-tools ppc-enter">
              <div className="ppc-left">
                {leadingActions}

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="ppc-action"
                      aria-label={labels?.attach ?? "Attach files"}
                      aria-busy={attachPending || undefined}
                      onClick={() => fileRef.current?.click()}
                    >
                      {attachPending ? (
                        <Loader2 className="ppc-spin" aria-hidden="true" />
                      ) : (
                        <Paperclip strokeWidth={1.75} aria-hidden="true" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{labels?.attach ?? "Attach files"}</TooltipContent>
                </Tooltip>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept="image/*,video/*,application/pdf,text/*,.md,.json,.csv,.yaml,.yml,.ts,.tsx,.js,.jsx,.py,.css,.html,.sql,.log"
                  className="ppc-sr"
                  tabIndex={-1}
                  onChange={handleFiles}
                />

                {trailingActions}

                {showPlatforms && (
                  <div className="ppc-chips" role="radiogroup" aria-label={labels?.platforms ?? "What are you building?"}>
                    {platforms.map((p, i) => (
                      <button
                        key={p.label}
                        type="button"
                        role="radio"
                        aria-checked={platform === i}
                        className="ppc-chip"
                        onClick={() => setPlatform(i)}
                      >
                        <PixelIcon name={p.icon} />
                        <span>{p.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="ppc-right">
                {modelLeading}
                <div className="ppc-model-wrap">
                  <MorphMenu
                    open={menuOpen}
                    onOpenChange={setMenuOpen}
                    items={modelItems}
                    label={labels?.model ?? "Model"}
                    align="end"
                    width={300}
                    trigger={(props) => (
                      <button
                        {...props}
                        type="button"
                        className="ppc-model"
                        aria-label={labels?.model ?? "Model"}
                        disabled={models.length === 0}
                      >
                        <PixelIcon name="bolt" />
                        <span dir="auto">{selectedModel?.label ?? "—"}</span>
                        <svg className="ppc-chev" viewBox="0 0 10 6" aria-hidden="true">
                          <path
                            d="M1 1l4 4 4-4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    )}
                  />
                </div>

                <button
                  type={streaming ? "button" : "submit"}
                  className="ppc-send"
                  data-mode={streaming ? "stop" : "send"}
                  data-ready={ready ? "true" : "false"}
                  aria-label={streaming ? (stopLabel ?? "Stop generating") : (labels?.send ?? "Send")}
                  disabled={!streaming && !canSend}
                  onClick={streaming ? onStop : undefined}
                >
                  {streaming ? (
                    <span className="ppc-stop-mark" aria-hidden="true" />
                  ) : (
                    <ArrowUp strokeWidth={2.2} aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>
          </>
        )}

        {phase === "building" && (
          <div className="ppc-build" role="status" aria-live="polite">
            <div className="ppc-build-head ppc-enter">
              <span className="ppc-build-title">Building {built.name}</span>
              <span className="ppc-build-pct">{Math.round((step / buildSteps.length) * 100)}%</span>
            </div>
            <div className="ppc-progress ppc-enter" aria-hidden="true">
              <span style={{ transform: "scaleX(" + step / buildSteps.length + ")" }} />
            </div>
            <ol className="ppc-steps">
              {buildSteps.map((s, i) => (
                <li
                  key={s}
                  className="ppc-step ppc-enter"
                  data-state={i < step ? "done" : i === step ? "active" : "todo"}
                >
                  <span className="ppc-step-mark" aria-hidden="true">
                    {i < step ? <PixelIcon name="check" /> : <i />}
                  </span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
            <div className="ppc-build-foot ppc-enter">
              <button type="button" className="ppc-ghost" onClick={() => reset(true)}>
                Stop
              </button>
            </div>
          </div>
        )}

        {phase === "done" && (
          <div className="ppc-done">
            <div className="ppc-done-copy">
              <span className="ppc-done-kicker ppc-enter">
                <PixelIcon name="check" /> Preview ready
              </span>
              <p className="ppc-done-title ppc-enter">{built.name}</p>
              <p className="ppc-done-prompt ppc-enter">{built.prompt}</p>
              <div className="ppc-done-actions ppc-enter">
                <button type="button" className="ppc-ghost" onClick={() => reset(true)}>
                  Refine prompt
                </button>
                <button type="button" className="ppc-solid" onClick={() => reset(false)}>
                  New app
                </button>
              </div>
            </div>
            <div
              className="ppc-device ppc-enter"
              data-kind={/mobile|phone/i.test(built.platform) ? "phone" : "screen"}
              aria-hidden="true"
            >
              <div className="ppc-device-top">
                <i />
                <span>{built.name}</span>
              </div>
              <div className="ppc-device-hero" />
              <div className="ppc-device-row">
                <i />
                <span />
              </div>
              <div className="ppc-device-row">
                <i />
                <span />
              </div>
              <div className="ppc-device-row">
                <i />
                <span />
              </div>
              <div className="ppc-device-tabs">
                <i />
                <i />
                <i />
              </div>
            </div>
          </div>
        )}
      </form>
      </div>
      {hint && (
        <div className="ppc-foot ppc-foot-solo">
          <p className="ppc-hint">
            {hintText ?? (
              <>
                <kbd>Enter</kbd> to send <span aria-hidden="true">/</span> <kbd>Shift</kbd> + <kbd>Enter</kbd>{" "}
                for a new line
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

const PPC_CSS = `
.ppc-root{
  --ppc-fg:var(--foreground);
  --ppc-mute:var(--muted-foreground);
  --ppc-faint:var(--faint);
  --ppc-line:var(--border);
  --ppc-line-strong:var(--border-strong);
  --ppc-surface:var(--surface-2);
  --ppc-hover:color-mix(in oklab,var(--foreground) 7%,transparent);
  /*
   * Match the message column. Kept slightly wider for more presence.
   */
  width:min(920px,100%);
  margin:0 auto;
  display:flex;
  flex-direction:column;
  align-items:center;
  gap:6px;
  color:var(--ppc-fg);
  font-family:inherit;
  -webkit-font-smoothing:antialiased;
  text-align:start;
  line-height:1.5;
}
.ppc-root :where(svg){display:block;max-width:none}
.ppc-root :where(button){font:inherit;color:inherit;background:none;border:0;padding:0;margin:0;cursor:pointer;-webkit-tap-highlight-color:transparent}
.ppc-root :where(button:disabled){cursor:not-allowed}
.ppc-root :where(p,ul,ol,li){margin:0;padding:0}
.ppc-root :where(ul,ol){list-style:none}
.ppc-root :where(button,textarea):focus-visible{outline:2px solid var(--ring);outline-offset:3px;border-radius:8px}
.ppc-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.ppc-icon{fill:currentColor}
.ppc-spacer{flex:1}

.ppc-stage{position:relative;width:100%}
/*
 * Apple Tahoe liquid glass (real refraction via backdrop-filter). It sits
 * behind the form so the lens samples the page (WarpGradient) rather than the
 * card's own paint, which is what makes the refraction real.
 */
.ppc-glass{
  position:absolute;inset:0;z-index:0;pointer-events:none;
  border-radius:20px;
}
.ppc-card{
  position:relative;
  z-index:1;
  width:100%;
  border-radius:20px;
  padding:8px 10px;
  background:transparent;
  box-shadow:none;
  transition:box-shadow .35s ease;
}
.ppc-card:focus-within{
  box-shadow:0 0 0 4px color-mix(in oklab,var(--primary) 10%,transparent);
}
/* light theme: the rim alone is too quiet on a white canvas, so add a hairline */
:root:not(.dark) .ppc-card{
  box-shadow:inset 0 0 0 1px color-mix(in oklab,var(--foreground) 8%,transparent);
}
:root:not(.dark) .ppc-card:focus-within{
  box-shadow:0 0 0 4px color-mix(in oklab,var(--primary) 12%,transparent);
}
.ppc-card[data-nudge="true"]{animation:ppc-nudge .45s cubic-bezier(.36,.07,.19,.97)}
@keyframes ppc-nudge{20%{transform:translateX(-7px)}40%{transform:translateX(6px)}60%{transform:translateX(-4px)}80%{transform:translateX(2px)}}
.ppc-field{position:relative;padding:2px 2px 0}
.ppc-input{
  display:block;width:100%;min-height:24px;max-height:200px;resize:none;border:0;outline:0;background:transparent;
  color:var(--ppc-fg);font:inherit;font-size:15px;line-height:1.5;letter-spacing:.005em;padding:0 2px;
  overflow-y:hidden;scrollbar-width:thin;
}
.ppc-input:disabled{opacity:.55}
.ppc-root .ppc-input:focus-visible{outline:none}
.ppc-ph{
  position:absolute;left:2px;right:2px;top:2px;font-size:15px;line-height:24px;color:var(--ppc-faint);pointer-events:none;
  overflow:hidden;white-space:nowrap;text-overflow:ellipsis;
}
.ppc-caret{
  display:inline-block;width:2px;height:1.05em;margin-inline-start:2px;vertical-align:-2px;
  background:var(--ppc-a2);animation:ppc-blink 1s steps(1) infinite;
}
@keyframes ppc-blink{50%{opacity:0}}

.ppc-files{display:flex;flex-wrap:wrap;gap:6px;margin:6px 2px 0}
.ppc-file{
  display:inline-flex;align-items:center;gap:6px;height:28px;padding-inline:9px 6px;border-radius:9px;font-size:12px;
  color:var(--ppc-mute);background:var(--ppc-surface);box-shadow:inset 0 0 0 1px var(--ppc-line);max-width:220px;
}
.ppc-file span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ppc-file .ppc-icon{width:11px;height:11px;fill:var(--ppc-a2);flex:none}
.ppc-file button{
  width:18px;height:18px;border-radius:6px;font-size:13px;line-height:1;color:var(--ppc-faint);
  display:grid;place-items:center;flex:none;
}
.ppc-file button:hover{background:var(--ppc-hover);color:var(--ppc-fg)}

.ppc-tools{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:2px}
.ppc-left{display:flex;align-items:center;gap:6px;min-width:0;flex:0 1 auto}
.ppc-chips{display:flex;flex-wrap:wrap;gap:6px;margin-inline-start:2px}
.ppc-chip{
  display:inline-flex;align-items:center;gap:7px;height:32px;padding-inline:9px 11px;border-radius:10px;font-size:12.5px;font-weight:500;
  color:var(--ppc-mute);background:var(--ppc-surface);box-shadow:inset 0 0 0 1px var(--ppc-line);
  transition:color .2s,background .2s,box-shadow .2s,transform .2s;
}
.ppc-chip .ppc-icon{width:12px;height:12px}
.ppc-chip:hover{color:var(--ppc-fg);background:var(--ppc-hover)}
.ppc-chip[aria-checked="true"]{color:var(--ppc-fg);box-shadow:inset 0 0 0 1px var(--ppc-line-strong)}
.ppc-chip[aria-checked="true"] .ppc-icon{fill:var(--ppc-a2)}
.ppc-chip:active{transform:scale(.96)}

.ppc-right{display:flex;align-items:center;gap:6px;flex:none;margin-inline-start:auto;min-width:0}
.ppc-model-wrap{position:relative;min-width:0}
.ppc-model{
  display:inline-flex;align-items:center;gap:6px;height:30px;padding-inline:9px;border-radius:9px;font-size:12.5px;
  color:var(--ppc-mute);transition:background .15s,color .15s;max-width:clamp(96px,30vw,190px);min-width:0;flex:0 1 auto;
}
.ppc-model span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ppc-model:hover,.ppc-model[aria-expanded="true"]{background:color-mix(in oklab,var(--foreground) 8%,transparent);color:var(--ppc-fg)}
.ppc-model .ppc-icon{width:10px;height:10px;fill:var(--ppc-a2);flex:none}
.ppc-chev{width:9px;height:6px;flex:none;transition:transform .3s}
.ppc-model[aria-expanded="true"] .ppc-chev{transform:rotate(180deg)}

.ppc-action{
  width:32px;height:32px;border-radius:10px;display:grid;place-items:center;flex:none;
  color:color-mix(in oklab,var(--foreground) 55%,transparent);
  transition:background .15s ease,color .15s ease,transform .15s ease;
}
.ppc-action svg{width:18px;height:18px;stroke:currentColor;fill:none}
.ppc-action:hover{background:color-mix(in oklab,var(--foreground) 10%,transparent);color:color-mix(in oklab,var(--foreground) 90%,transparent)}
.ppc-action:active{transform:scale(.94)}
.ppc-action:disabled{opacity:.4;cursor:not-allowed}
.ppc-action:disabled:hover{background:transparent;color:color-mix(in oklab,var(--foreground) 55%,transparent)}
.ppc-spin{animation:ppc-spin 1s linear infinite}
@keyframes ppc-spin{to{transform:rotate(360deg)}}

.ppc-send{
  position:relative;width:36px;height:36px;margin-inline-start:2px;border-radius:50%;display:grid;place-items:center;flex:none;
  background:linear-gradient(160deg,var(--ppc-a1),var(--ppc-a2) 48%,var(--ppc-a3));
  box-shadow:inset 0 1px 0 rgba(255,255,255,.55),0 4px 16px var(--ppc-glow);
  transition:transform .2s cubic-bezier(.16,1,.3,1),filter .2s,opacity .2s;
}
.ppc-send svg{width:17px;height:17px;color:var(--ppc-ink)}
.ppc-send[data-ready="false"]{filter:saturate(.35) brightness(.9);opacity:.55}
.ppc-send:disabled{cursor:not-allowed}
.ppc-send:hover:not(:disabled){transform:scale(1.06)}
.ppc-send:active:not(:disabled){transform:scale(.94)}
.ppc-send[data-mode="stop"]{
  background:var(--destructive);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.35),0 4px 18px color-mix(in oklab,var(--destructive) 42%,transparent);
}
.ppc-stop-mark{width:10px;height:10px;border-radius:2.5px;background:#fff}

.ppc-foot{display:flex;width:100%;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.ppc-foot-solo{justify-content:center}
.ppc-foot-extra{display:flex;align-items:center;gap:2px;min-width:0}
.ppc-tools-extra{flex:1;min-width:0}
.ppc-hint{font-size:12px;color:var(--ppc-faint);letter-spacing:.01em}
.ppc-hint kbd{
  font:inherit;font-size:11px;padding:1px 6px;border-radius:5px;background:var(--ppc-surface);
  box-shadow:inset 0 0 0 1px var(--ppc-line-strong);color:var(--ppc-mute);
}

.ppc-build{display:flex;flex-direction:column;gap:14px;padding-block:2px 0;padding-inline:0 6px}
.ppc-build-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.ppc-build-title{font-size:16px;font-weight:600;letter-spacing:-.01em}
.ppc-build-pct{font-size:13px;color:var(--ppc-a2);font-variant-numeric:tabular-nums}
.ppc-progress{height:4px;border-radius:4px;background:var(--ppc-surface);overflow:hidden}
.ppc-progress span{display:block;width:100%;height:4px;border-radius:4px;background:linear-gradient(90deg,var(--ppc-a3),var(--ppc-a1));transform-origin:0 50%;transition:transform .6s cubic-bezier(.16,1,.3,1)}
.ppc-steps{display:grid;gap:8px}
.ppc-step{display:flex;align-items:center;gap:10px;font-size:14px;color:var(--ppc-faint);transition:color .4s}
.ppc-step[data-state="active"]{color:var(--ppc-fg)}
.ppc-step[data-state="done"]{color:var(--ppc-mute)}
.ppc-step-mark{width:16px;height:16px;display:grid;place-items:center;flex:none}
.ppc-step-mark .ppc-icon{width:13px;height:13px;fill:var(--ppc-a2)}
.ppc-step-mark i{width:6px;height:6px;border-radius:1.5px;background:currentColor;opacity:.5}
.ppc-step[data-state="active"] .ppc-step-mark i{opacity:1;background:var(--ppc-a2);box-shadow:8px 0 0 -1px var(--ppc-a2),-8px 0 0 -1px var(--ppc-a2);animation:ppc-spin 1s steps(4) infinite}
.ppc-build-foot{display:flex;justify-content:flex-end}
.ppc-ghost,.ppc-solid{
  display:inline-grid;place-items:center;height:38px;padding-inline:16px;border-radius:11px;font-size:14px;font-weight:550;
  letter-spacing:-.005em;transition:background .2s,filter .2s,transform .2s;
}
.ppc-ghost{background:var(--ppc-surface);box-shadow:inset 0 0 0 1px var(--ppc-line)}
.ppc-ghost:hover{background:var(--ppc-hover)}
.ppc-solid{color:var(--ppc-ink);background:linear-gradient(160deg,var(--ppc-a1),var(--ppc-a2) 55%,var(--ppc-a3));box-shadow:inset 0 1px 0 rgba(255,255,255,.5),0 6px 20px var(--ppc-glow)}
.ppc-solid:hover{filter:brightness(1.06)}
.ppc-ghost:active,.ppc-solid:active{transform:translateY(1px)}

.ppc-done{display:grid;grid-template-columns:1fr auto;gap:22px;align-items:center}
.ppc-done-copy{display:flex;flex-direction:column;gap:8px;min-width:0}
.ppc-done-kicker{display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ppc-a2)}
.ppc-done-kicker .ppc-icon{width:12px;height:12px}
.ppc-done-title{font-size:26px;font-weight:650;letter-spacing:-.025em;line-height:1.1}
.ppc-done-prompt{font-size:13.5px;color:var(--ppc-mute);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ppc-done-actions{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
.ppc-device{
  width:150px;padding:10px;border-radius:20px;background:var(--ppc-surface);
  box-shadow:inset 0 0 0 1px var(--ppc-line-strong),0 16px 40px -18px rgba(0,0,0,.5);
  display:flex;flex-direction:column;gap:7px;transform:rotate(3deg);
}
.ppc-device[data-kind="screen"]{width:210px;border-radius:14px;transform:rotate(-2deg)}
.ppc-device-top{display:flex;align-items:center;gap:6px;font-size:10px;font-weight:600;color:var(--ppc-fg);white-space:nowrap;overflow:hidden}
.ppc-device-top i{width:12px;height:12px;border-radius:4px;flex:none;background:linear-gradient(160deg,var(--ppc-a1),var(--ppc-a3))}
.ppc-device-hero{height:46px;border-radius:9px;background:linear-gradient(120deg,var(--ppc-a3),var(--ppc-a1) 60%,var(--ppc-surface));opacity:.85}
.ppc-device-row{display:flex;align-items:center;gap:6px}
.ppc-device-row i{width:16px;height:16px;border-radius:5px;background:var(--ppc-hover);flex:none}
.ppc-device-row span{height:6px;flex:1;border-radius:3px;background:linear-gradient(90deg,var(--ppc-hover),var(--ppc-line-strong),var(--ppc-hover));background-size:200% 100%;animation:ppc-shim 1.8s linear infinite}
.ppc-device-row:nth-child(4) span{width:70%;flex:none}
@keyframes ppc-shim{to{background-position:-200% 0}}
.ppc-device-tabs{display:flex;justify-content:space-around;padding-top:6px;border-top:1px solid var(--ppc-line)}
.ppc-device-tabs i{width:10px;height:10px;border-radius:3px;background:var(--ppc-line-strong)}
.ppc-device-tabs i:first-child{background:var(--ppc-a2)}

@media (max-width:760px){
  .ppc-card{padding:7px 8px;border-radius:18px}
  .ppc-glass{border-radius:18px}
  .ppc-done{grid-template-columns:1fr}
  .ppc-device{justify-self:center}
  .ppc-hint{display:none}
}
@media (max-width:420px){
  .ppc-chip{height:30px;padding-inline:8px 9px;font-size:12px}
  .ppc-input,.ppc-ph{font-size:14.5px}
  .ppc-tools{gap:6px}
  .ppc-left{gap:6px}
  .ppc-right{gap:6px}
  .ppc-model{max-width:118px;padding-inline:7px}
}
@media (max-width:360px){
  .ppc-model{max-width:96px}
  .ppc-send{width:34px;height:34px}
}
@media (prefers-reduced-motion:reduce){
  .ppc-root *{animation:none;transition-duration:.01ms}
}
`;
