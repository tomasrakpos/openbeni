// Non-blocking docked studio cards built with the exact site design system:
// - <MenuFrame> (exact corner-menu border, gradient, specular highlight & 20px radius)
// - <Tabs>/<TabsList>/<TabsTrigger> (exact sliding-pill nav from Theme/Language switcher)
// - <GlassButton> (exact liquid glass action button synced to Violet / Ember)
// - In-frame <StudioColorStudio> (zero native OS/browser color dialogs)
import { AnimatePresence, motion } from "framer-motion";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  Code2,
  CopyPlus,
  CornerLeftUp,
  Eye,
  EyeOff,
  Italic,
  Layers,
  Minus,
  PencilRuler,
  Plus,
  RotateCcw,
  Sparkles,
  Strikethrough,
  Trash2,
  Underline,
  WandSparkles,
  X,
} from "lucide-react";
import * as React from "react";
import { GlassButton } from "@/components/ui/glass-button";
import { MenuFrame } from "@/components/ui/menu-frame";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StudioCodeStudio } from "@/features/preview/StudioCodeStudio";
import { StudioColorStudio } from "@/features/preview/StudioColorStudio";
import type {
  AlignItemsKind,
  BorderStyleKind,
  CodeInjectMode,
  CursorKind,
  DirKind,
  DisplayModeKind,
  ElementStylePatch,
  FillModeKind,
  FlexDirKind,
  JustifyKind,
  OverflowKind,
  SelectedElementInfo,
  ShadowPreset,
  TextShadowPreset,
  TextTransformKind,
} from "@/features/preview/previewBridge";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const GRADIENT_PRESETS: { name: string; from: string; to: string; angle: number }[] = [
  { name: "Violet", from: "#9b72ff", to: "#7c4dff", angle: 135 },
  { name: "Ember", from: "#ffa066", to: "#e0531a", angle: 135 },
  { name: "Ocean", from: "#38bdf8", to: "#2563eb", angle: 135 },
  { name: "Mint", from: "#34d399", to: "#059669", angle: 135 },
  { name: "Rose", from: "#fb7185", to: "#db2777", angle: 135 },
  { name: "Night", from: "#334155", to: "#0f172a", angle: 160 },
];

type ActiveColorTarget =
  | null
  | {
      kind: "bg" | "text" | "border" | "gradFrom" | "gradTo";
      title: string;
      initial: string;
      allowTransparent?: boolean;
    };

/**
 * Custom sleek − / + numeric stepper with press-and-hold repeat and clean local
 * typing draft (zero ugly native browser spinners).
 */
const StudioStepper = React.memo(function StudioStepper({
  value,
  min,
  max,
  step = 1,
  unit = "px",
  placeholder,
  onChange,
}: {
  value: number | null;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  placeholder?: string;
  onChange: (next: number) => void;
}) {
  const [draft, setDraft] = React.useState(value === null ? "" : String(value));
  const [editing, setEditing] = React.useState(false);
  const holdTimerRef = React.useRef<number | null>(null);
  const holdIntervalRef = React.useRef<number | null>(null);
  const valueRef = React.useRef(value);
  valueRef.current = value;

  React.useEffect(() => {
    if (!editing) setDraft(value === null ? "" : String(value));
  }, [value, editing]);

  const stopHold = React.useCallback(() => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (holdIntervalRef.current !== null) {
      window.clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
  }, []);

  React.useEffect(() => stopHold, [stopHold]);

  const bump = React.useCallback(
    (dir: 1 | -1) => {
      const base = valueRef.current ?? Math.max(min, 0);
      const raw = base + dir * step;
      const decimals = step < 1 ? 1 : 0;
      const rounded = Number(Math.max(min, Math.min(max, raw)).toFixed(decimals));
      valueRef.current = rounded;
      setDraft(String(rounded));
      onChange(rounded);
    },
    [min, max, step, onChange],
  );

  const startHold = (dir: 1 | -1) => {
    stopHold();
    bump(dir);
    holdTimerRef.current = window.setTimeout(() => {
      holdIntervalRef.current = window.setInterval(() => bump(dir), 55);
    }, 300);
  };

  const commitDraft = () => {
    setEditing(false);
    const cleaned = draft.trim();
    const n = parseFloat(cleaned);
    if (Number.isFinite(n)) {
      const clamped = Math.max(min, Math.min(max, n));
      setDraft(String(clamped));
      onChange(clamped);
    } else {
      setDraft(value === null ? "" : String(value));
    }
  };

  return (
    <div className="inline-flex h-7 items-center overflow-hidden rounded-[9px] border border-[var(--border-strong)] bg-[color-mix(in_oklab,var(--surface-2)_82%,transparent)]">
      <button
        type="button"
        aria-label="-"
        onPointerDown={(e) => {
          e.preventDefault();
          startHold(-1);
        }}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        onPointerCancel={stopHold}
        className="grid h-full w-6 shrink-0 place-items-center text-[var(--muted-foreground)] transition-colors hover:bg-[color-mix(in_oklab,var(--foreground)_9%,transparent)] hover:text-foreground active:bg-[var(--primary-soft)] active:text-[var(--primary)]"
      >
        <Minus className="size-3" />
      </button>
      <div className="flex items-center px-1">
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          placeholder={placeholder ?? "auto"}
          onFocus={() => setEditing(true)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitDraft();
              e.currentTarget.blur();
            }
          }}
          onChange={(e) => {
            const raw = e.target.value;
            setDraft(raw);
            if (raw.trim() === "" || raw.trim() === "-") return;
            const n = parseFloat(raw);
            if (Number.isFinite(n)) {
              onChange(Math.max(min, Math.min(max, n)));
            }
          }}
          className="w-[42px] bg-transparent text-center font-mono text-[11px] tabular-nums text-foreground outline-none placeholder:text-[10px] placeholder:text-[var(--faint)]"
        />
        {unit ? <span className="pr-0.5 text-[9px] text-[var(--faint)]">{unit}</span> : null}
      </div>
      <button
        type="button"
        aria-label="+"
        onPointerDown={(e) => {
          e.preventDefault();
          startHold(1);
        }}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        onPointerCancel={stopHold}
        className="grid h-full w-6 shrink-0 place-items-center text-[var(--muted-foreground)] transition-colors hover:bg-[color-mix(in_oklab,var(--foreground)_9%,transparent)] hover:text-foreground active:bg-[var(--primary-soft)] active:text-[var(--primary)]"
      >
        <Plus className="size-3" />
      </button>
    </div>
  );
});

const StudioSliderField = React.memo(function StudioSliderField({
  label,
  value,
  sliderValue,
  min,
  max,
  step = 1,
  unit = "px",
  presets,
  onChange,
}: {
  label: string;
  value: number | null;
  sliderValue: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  presets?: { label: string; active?: boolean; onClick: () => void }[];
  onChange: (next: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[10.5px] font-medium text-[var(--muted-foreground)]">
            {label}
          </span>
          {presets?.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={p.onClick}
              className={cn(
                "rounded-[6px] px-1.5 py-0.5 text-[9.5px] font-medium transition-colors",
                p.active
                  ? "bg-[var(--primary-soft)] text-[var(--primary)]"
                  : "bg-[color-mix(in_oklab,var(--foreground)_7%,transparent)] text-[var(--faint)] hover:text-foreground",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <StudioStepper
          value={value}
          min={min}
          max={max}
          step={step}
          unit={unit}
          onChange={onChange}
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.max(min, Math.min(max, sliderValue))}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="oh-studio-range"
      />
    </div>
  );
});

const StudioSectionCard = React.memo(function StudioSectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2.5 rounded-[14px] border border-[var(--border)] bg-[color-mix(in_oklab,var(--foreground)_4%,transparent)] p-2.5">
      <h4 className="text-[10px] font-semibold tracking-wider text-[var(--faint)] uppercase">
        {title}
      </h4>
      {children}
    </section>
  );
});

const ColorTriggerButton = React.memo(function ColorTriggerButton({
  label,
  color,
  onClick,
}: {
  label: string;
  color: string;
  onClick: () => void;
}) {
  const isTransparent = !color || color === "transparent";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-[10px] border border-[var(--border-strong)] bg-[color-mix(in_oklab,var(--surface-2)_75%,transparent)] px-2 py-1.5 text-left transition-colors hover:border-[var(--primary)]/50 hover:bg-[var(--surface-2)]"
    >
      <span
        className="size-5 shrink-0 rounded-[6px] border border-[var(--border-strong)] shadow-xs"
        style={{
          background: isTransparent
            ? "repeating-conic-gradient(#808080 0% 25%, transparent 0% 50%) 50% / 8px 8px"
            : color,
        }}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[10px] font-medium text-[var(--muted-foreground)]">
          {label}
        </span>
        <span className="block truncate font-mono text-[10px] uppercase text-foreground">
          {isTransparent ? "transparent" : color}
        </span>
      </span>
    </button>
  );
});

/**
 * Docked AI Element Prompt Card inside <MenuFrame> — matches corner menu frame
 * and sits below the live preview so the selected element stays 100% visible.
 */
export const AiElementPromptPopover = React.memo(function AiElementPromptPopover({
  element,
  submitting,
  onSubmit,
  onClose,
}: {
  element: SelectedElementInfo;
  containerSize?: { w: number; h: number };
  submitting: boolean;
  onSubmit: (instruction: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [prompt, setPrompt] = React.useState("");
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    setPrompt("");
    const id = window.setTimeout(() => textareaRef.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [element.selectionKey]);

  const handleSend = () => {
    const clean = prompt.trim();
    if (!clean || submitting) return;
    onSubmit(clean);
  };

  return (
    <motion.div
      key={`ai-dock-${element.selectionKey}`}
      dir="ltr"
      initial={{ opacity: 0, height: 0, y: 8 }}
      animate={{ opacity: 1, height: "auto", y: 0 }}
      exit={{ opacity: 0, height: 0, y: 8 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className="shrink-0 overflow-hidden px-2 pb-2"
    >
      <MenuFrame style={{ "--hl": 0.9 } as React.CSSProperties}>
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
          <span className="grid size-6 shrink-0 place-items-center rounded-[8px] bg-[var(--primary-soft)] text-[var(--primary)]">
            <WandSparkles className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <span className="block truncate font-mono text-[10.5px] font-semibold text-foreground">
              {element.label}
            </span>
            {element.text ? (
              <span dir="auto" className="block truncate text-[10px] text-[var(--muted-foreground)]">
                “{element.text.slice(0, 48)}”
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="grid size-6 shrink-0 place-items-center rounded-[7px] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--surface-2)] hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>

        <div className="p-2.5">
          <textarea
            ref={textareaRef}
            dir="auto"
            rows={2}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder={t("preview.studio.aiPlaceholder")}
            className="w-full resize-none rounded-[12px] border border-[var(--border)] bg-[color-mix(in_oklab,var(--foreground)_4.5%,transparent)] px-2.5 py-2 text-[12px] leading-relaxed text-foreground outline-none placeholder:text-[var(--faint)] focus:border-[var(--primary)]"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="truncate text-[10px] text-[var(--faint)]">
              {t("preview.studio.aiHint")}
            </span>
            <GlassButton
              variant="pill"
              active={prompt.trim().length > 0}
              disabled={!prompt.trim() || submitting}
              onClick={handleSend}
            >
              <span>{t("preview.studio.aiApply")}</span>
              <ArrowUp className="size-3.5" />
            </GlassButton>
          </div>
        </div>
      </MenuFrame>
    </motion.div>
  );
});

/**
 * Docked Visual Direct Inspector inside <MenuFrame> — uses site-native <Tabs>
 * sliding nav pills everywhere, in-frame <StudioColorStudio>, in-frame
 * <StudioCodeStudio> (HTML/CSS/JS with 1-click Paste), and 6 rich sections.
 */
export const ManualElementInspectorPopover = React.memo(function ManualElementInspectorPopover({
  element,
  onPatch,
  onReset,
  onSelectParent,
  onReorder,
  onInjectCode,
  onDuplicate,
  onDelete,
  onSave,
  onClose,
}: {
  element: SelectedElementInfo;
  containerSize?: { w: number; h: number };
  onPatch: (patch: ElementStylePatch) => void;
  onReset: () => void;
  onSelectParent: () => void;
  onReorder: (dir: "up" | "down") => void;
  onInjectCode: (mode: CodeInjectMode, code: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = React.useState(false);
  const [colorPicker, setColorPicker] = React.useState<ActiveColorTarget>(null);
  const [codeStudioOpen, setCodeStudioOpen] = React.useState(false);

  const [text, setText] = React.useState(element.text);
  const [align, setAlign] = React.useState<"left" | "center" | "right">(element.styles.align);
  const [dir, setDir] = React.useState<DirKind>(element.styles.dir);
  const [displayMode, setDisplayMode] = React.useState<DisplayModeKind>(element.styles.displayMode);
  const [flexDir, setFlexDir] = React.useState<FlexDirKind>(element.styles.flexDirection);
  const [justifyContent, setJustifyContent] = React.useState<JustifyKind>(element.styles.justifyContent);
  const [alignItems, setAlignItems] = React.useState<AlignItemsKind>(element.styles.alignItems);
  const [overflow, setOverflow] = React.useState<OverflowKind>(element.styles.overflow);
  const [cursor, setCursor] = React.useState<CursorKind>(element.styles.cursor);
  const [gapPx, setGapPx] = React.useState(element.styles.gapPx);
  const [widthPx, setWidthPx] = React.useState<number | null>(element.styles.widthPx);
  const [widthMode, setWidthMode] = React.useState<"px" | "auto" | "full" | "fit">(
    element.styles.width === "100%"
      ? "full"
      : element.styles.width === "fit-content"
        ? "fit"
        : element.styles.width === "auto"
          ? "auto"
          : "px",
  );
  const [heightPx, setHeightPx] = React.useState<number | null>(element.styles.heightPx);
  const [heightMode, setHeightMode] = React.useState<"px" | "auto">(
    element.styles.height === "auto" ? "auto" : "px",
  );
  const [paddingX, setPaddingX] = React.useState(element.styles.paddingX);
  const [paddingY, setPaddingY] = React.useState(element.styles.paddingY);
  const [marginTop, setMarginTop] = React.useState(element.styles.marginTop);
  const [marginBottom, setMarginBottom] = React.useState(element.styles.marginBottom);
  const [marginLeft, setMarginLeft] = React.useState(element.styles.marginLeft);
  const [marginRight, setMarginRight] = React.useState(element.styles.marginRight);
  const [offsetX, setOffsetX] = React.useState(element.styles.offsetX);
  const [offsetY, setOffsetY] = React.useState(element.styles.offsetY);
  const [rotateDeg, setRotateDeg] = React.useState(element.styles.rotateDeg);
  const [scalePct, setScalePct] = React.useState(element.styles.scalePct);
  const [skewXDeg, setSkewXDeg] = React.useState(element.styles.skewXDeg);
  const [zIndex, setZIndex] = React.useState(element.styles.zIndex);

  const [fontSize, setFontSize] = React.useState(element.styles.fontSizePx);
  const [fontWeight, setFontWeight] = React.useState(element.styles.fontWeight);
  const [lineHeight, setLineHeight] = React.useState(element.styles.lineHeight);
  const [letterSpacing, setLetterSpacing] = React.useState(element.styles.letterSpacingPx);
  const [italic, setItalic] = React.useState(element.styles.italic);
  const [underline, setUnderline] = React.useState(element.styles.underline);
  const [strikethrough, setStrikethrough] = React.useState(element.styles.strikethrough);
  const [textTransform, setTextTransform] = React.useState<TextTransformKind>(element.styles.textTransform);
  const [textShadow, setTextShadow] = React.useState<TextShadowPreset>(element.styles.textShadow);

  const [fillMode, setFillMode] = React.useState<FillModeKind>(element.styles.fillMode);
  const [bgColor, setBgColor] = React.useState(element.styles.backgroundColor);
  const [gradFrom, setGradFrom] = React.useState(element.styles.gradientFrom);
  const [gradTo, setGradTo] = React.useState(element.styles.gradientTo);
  const [gradAngle, setGradAngle] = React.useState(element.styles.gradientAngle);
  const [textColor, setTextColor] = React.useState(element.styles.color);
  const [opacityPct, setOpacityPct] = React.useState(element.styles.opacityPct);
  const [radius, setRadius] = React.useState(element.styles.borderRadiusPx);
  const [borderWidth, setBorderWidth] = React.useState(element.styles.borderWidthPx);
  const [borderStyle, setBorderStyle] = React.useState<BorderStyleKind>(element.styles.borderStyle);
  const [borderColor, setBorderColor] = React.useState(element.styles.borderColor);
  const [shadowPreset, setShadowPreset] = React.useState<ShadowPreset>(element.styles.shadowPreset);
  const [backdropBlur, setBackdropBlur] = React.useState(element.styles.backdropBlurPx);
  const [brightnessPct, setBrightnessPct] = React.useState(element.styles.brightnessPct);
  const [contrastPct, setContrastPct] = React.useState(element.styles.contrastPct);
  const [saturatePct, setSaturatePct] = React.useState(element.styles.saturatePct);
  const [hueRotateDeg, setHueRotateDeg] = React.useState(element.styles.hueRotateDeg);
  const [grayscalePct, setGrayscalePct] = React.useState(element.styles.grayscalePct);
  const [hidden, setHidden] = React.useState(element.styles.hidden);
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    setColorPicker(null);
    setCodeStudioOpen(false);
    setText(element.text);
    setAlign(element.styles.align);
    setDir(element.styles.dir);
    setDisplayMode(element.styles.displayMode);
    setFlexDir(element.styles.flexDirection);
    setJustifyContent(element.styles.justifyContent);
    setAlignItems(element.styles.alignItems);
    setOverflow(element.styles.overflow);
    setCursor(element.styles.cursor);
    setGapPx(element.styles.gapPx);
    setWidthPx(element.styles.widthPx);
    setWidthMode(
      element.styles.width === "100%"
        ? "full"
        : element.styles.width === "fit-content"
          ? "fit"
          : element.styles.width === "auto"
            ? "auto"
            : "px",
    );
    setHeightPx(element.styles.heightPx);
    setHeightMode(element.styles.height === "auto" ? "auto" : "px");
    setPaddingX(element.styles.paddingX);
    setPaddingY(element.styles.paddingY);
    setMarginTop(element.styles.marginTop);
    setMarginBottom(element.styles.marginBottom);
    setMarginLeft(element.styles.marginLeft);
    setMarginRight(element.styles.marginRight);
    setOffsetX(element.styles.offsetX);
    setOffsetY(element.styles.offsetY);
    setRotateDeg(element.styles.rotateDeg);
    setScalePct(element.styles.scalePct);
    setSkewXDeg(element.styles.skewXDeg);
    setZIndex(element.styles.zIndex);
    setFontSize(element.styles.fontSizePx);
    setFontWeight(element.styles.fontWeight);
    setLineHeight(element.styles.lineHeight);
    setLetterSpacing(element.styles.letterSpacingPx);
    setItalic(element.styles.italic);
    setUnderline(element.styles.underline);
    setStrikethrough(element.styles.strikethrough);
    setTextTransform(element.styles.textTransform);
    setTextShadow(element.styles.textShadow);
    setFillMode(element.styles.fillMode);
    setBgColor(element.styles.backgroundColor);
    setGradFrom(element.styles.gradientFrom);
    setGradTo(element.styles.gradientTo);
    setGradAngle(element.styles.gradientAngle);
    setTextColor(element.styles.color);
    setOpacityPct(element.styles.opacityPct);
    setRadius(element.styles.borderRadiusPx);
    setBorderWidth(element.styles.borderWidthPx);
    setBorderStyle(element.styles.borderStyle);
    setBorderColor(element.styles.borderColor);
    setShadowPreset(element.styles.shadowPreset);
    setBackdropBlur(element.styles.backdropBlurPx);
    setBrightnessPct(element.styles.brightnessPct);
    setContrastPct(element.styles.contrastPct);
    setSaturatePct(element.styles.saturatePct);
    setHueRotateDeg(element.styles.hueRotateDeg);
    setGrayscalePct(element.styles.grayscalePct);
    setHidden(element.styles.hidden);
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [element.selectionKey]);

  const emit = React.useCallback(
    (patch: ElementStylePatch) => {
      setDirty(true);
      onPatch(patch);
    },
    [onPatch],
  );

  const applyColorTarget = (target: NonNullable<ActiveColorTarget>, cssColor: string) => {
    if (target.kind === "bg") {
      setBgColor(cssColor);
      const nextMode: FillModeKind = cssColor === "transparent" ? "transparent" : "solid";
      setFillMode(nextMode);
      emit({ fillMode: nextMode, backgroundColor: cssColor });
    } else if (target.kind === "text") {
      setTextColor(cssColor);
      emit({ color: cssColor });
    } else if (target.kind === "border") {
      setBorderColor(cssColor);
      if (borderWidth === 0) {
        setBorderWidth(1);
        emit({ borderWidthPx: 1, borderStyle, borderColor: cssColor });
      } else {
        emit({ borderColor: cssColor });
      }
    } else if (target.kind === "gradFrom") {
      setGradFrom(cssColor);
      setFillMode("gradient");
      emit({ fillMode: "gradient", gradientFrom: cssColor, gradientTo: gradTo, gradientAngle: gradAngle });
    } else if (target.kind === "gradTo") {
      setGradTo(cssColor);
      setFillMode("gradient");
      emit({ fillMode: "gradient", gradientFrom: gradFrom, gradientTo: cssColor, gradientAngle: gradAngle });
    }
  };

  const weightTabValue = String(
    [300, 400, 500, 600, 700, 800].reduce((best, cur) =>
      Math.abs(cur - fontWeight) < Math.abs(best - fontWeight) ? cur : best,
    ),
  );

  return (
    <motion.div
      key="manual-dock"
      dir="ltr"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: expanded ? "54%" : "42%" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className="flex min-h-[225px] max-h-[60%] shrink-0 flex-col px-2 pb-2"
    >
      <MenuFrame
        className="flex min-h-0 flex-1 flex-col text-foreground"
        style={{ "--hl": 0.9 } as React.CSSProperties}
      >
        <AnimatePresence mode="wait" initial={false}>
          {codeStudioOpen ? (
            <StudioCodeStudio
              key={`code-${element.selectionKey}`}
              elementLabel={element.label}
              currentOuterHtml={element.outerHtml}
              onApply={(injectMode, code) => {
                setDirty(true);
                onInjectCode(injectMode, code);
                setCodeStudioOpen(false);
              }}
              onCancel={() => setCodeStudioOpen(false)}
            />
          ) : colorPicker ? (
            <StudioColorStudio
              key={`color-${colorPicker.kind}`}
              title={colorPicker.title}
              value={colorPicker.initial}
              allowTransparent={colorPicker.allowTransparent}
              onChange={(css) => applyColorTarget(colorPicker, css)}
              onConfirm={(css) => {
                applyColorTarget(colorPicker, css);
                setColorPicker(null);
              }}
              onCancel={() => {
                applyColorTarget(colorPicker, colorPicker.initial);
                setColorPicker(null);
              }}
            />
          ) : (
            <motion.div
              key="inspector-main"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
            >
              {/* Sticky Header */}
              <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--border)] px-3 py-2">
                <span className="grid size-6 shrink-0 place-items-center rounded-[8px] bg-[var(--primary-soft)] text-[var(--primary)]">
                  <PencilRuler className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] font-semibold text-foreground">
                  {element.label}
                </span>
                <button
                  type="button"
                  onClick={() => setCodeStudioOpen(true)}
                  title={t("preview.studio.openCode")}
                  className="inline-flex h-6 shrink-0 items-center gap-1 rounded-[7px] border border-[var(--primary)]/35 bg-[var(--primary-soft)] px-2 text-[10px] font-semibold text-[var(--primary)] transition-colors hover:bg-[color-mix(in_oklab,var(--primary)_22%,transparent)]"
                >
                  <Code2 className="size-3" />
                  <span>{t("preview.studio.codeBtn")}</span>
                </button>
                {element.styles.hasParent ? (
                  <button
                    type="button"
                    onClick={onSelectParent}
                    aria-label={t("preview.studio.selectParent")}
                    title={t("preview.studio.selectParent")}
                    className="grid size-6 shrink-0 place-items-center rounded-[7px] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--surface-2)] hover:text-foreground"
                  >
                    <CornerLeftUp className="size-3.5" />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  aria-label={expanded ? t("preview.studio.compact") : t("preview.studio.expand")}
                  title={expanded ? t("preview.studio.compact") : t("preview.studio.expand")}
                  className="grid size-6 shrink-0 place-items-center rounded-[7px] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--surface-2)] hover:text-foreground"
                >
                  {expanded ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={t("common.close")}
                  className="grid size-6 shrink-0 place-items-center rounded-[7px] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--surface-2)] hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </div>

              {/* Scrollable 6-section Pro Visual Inspector */}
              <div
                className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain p-2.5 text-[11px]"
                style={{ contain: "layout style" }}
              >
                {/* 1. Content & Layer Actions */}
                <StudioSectionCard title={t("preview.studio.secContent")}>
                  {element.hasEditableText ? (
                    <label className="block space-y-1">
                      <span className="block text-[10px] font-medium text-[var(--muted-foreground)]">
                        {t("preview.studio.fieldText")}
                      </span>
                      <input
                        type="text"
                        dir="auto"
                        value={text}
                        onChange={(e) => {
                          setText(e.target.value);
                          emit({ text: e.target.value });
                        }}
                        className="h-8 w-full rounded-[10px] border border-[var(--border-strong)] bg-[color-mix(in_oklab,var(--surface-1)_80%,transparent)] px-2.5 text-[12px] text-foreground outline-none focus:border-[var(--primary)]"
                      />
                    </label>
                  ) : null}

                  <div className="space-y-1">
                    <span className="block text-[10px] font-medium text-[var(--muted-foreground)]">
                      {t("preview.studio.fieldVisibility")}
                    </span>
                    <Tabs
                      value={hidden ? "hidden" : "visible"}
                      onValueChange={(v) => {
                        const next = v === "hidden";
                        setHidden(next);
                        emit({ hidden: next });
                      }}
                    >
                      <TabsList className="w-full">
                        <TabsTrigger value="visible" className="flex-1 text-[10.5px]">
                          <Eye className="size-3" />
                          <span>{t("preview.studio.visible")}</span>
                        </TabsTrigger>
                        <TabsTrigger value="hidden" className="flex-1 text-[10.5px]">
                          <EyeOff className="size-3" />
                          <span>{t("preview.studio.hidden")}</span>
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-1.5 pt-0.5">
                    <div className="flex items-center gap-1.5">
                      <Layers className="size-3 text-[var(--faint)]" />
                      <span className="text-[10px] font-medium text-[var(--muted-foreground)]">
                        {t("preview.studio.fieldLayer")}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <StudioStepper
                        value={zIndex}
                        min={-10}
                        max={999}
                        unit="z"
                        onChange={(n) => {
                          setZIndex(n);
                          emit({ zIndex: n });
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => onReorder("up")}
                        title={t("preview.studio.moveUp")}
                        aria-label={t("preview.studio.moveUp")}
                        className="grid size-7 place-items-center rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface-2)] text-foreground transition-colors hover:border-[var(--primary)]/50"
                      >
                        <ArrowUp className="size-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onReorder("down")}
                        title={t("preview.studio.moveDown")}
                        aria-label={t("preview.studio.moveDown")}
                        className="grid size-7 place-items-center rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface-2)] text-foreground transition-colors hover:border-[var(--primary)]/50"
                      >
                        <ArrowDown className="size-3" />
                      </button>
                      <button
                        type="button"
                        onClick={onDuplicate}
                        title={t("preview.studio.duplicate")}
                        className="inline-flex h-7 items-center gap-1 rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface-2)] px-2 text-[10px] font-medium text-foreground transition-colors hover:border-[var(--primary)]/50"
                      >
                        <CopyPlus className="size-3" />
                        <span>{t("preview.studio.duplicate")}</span>
                      </button>
                    </div>
                  </div>

                  {/* Quick Script / Glass Effect Shortcuts */}
                  <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                    <button
                      type="button"
                      onClick={() => setCodeStudioOpen(true)}
                      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--primary)]/40 bg-[var(--primary-soft)] px-2.5 text-[10.5px] font-semibold text-[var(--primary)] transition-colors hover:bg-[color-mix(in_oklab,var(--primary)_22%,transparent)]"
                    >
                      <Code2 className="size-3.5" />
                      <span>{t("preview.studio.openCode")}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFillMode("solid");
                        setBgColor("rgba(255, 255, 255, 0.14)");
                        setBackdropBlur(16);
                        setBorderWidth(1);
                        setBorderColor("rgba(255, 255, 255, 0.28)");
                        setRadius((r) => (r < 12 ? 16 : r));
                        setShadowPreset("medium");
                        emit({
                          fillMode: "solid",
                          backgroundColor: "rgba(255, 255, 255, 0.14)",
                          backdropBlurPx: 16,
                          borderWidthPx: 1,
                          borderStyle: "solid",
                          borderColor: "rgba(255, 255, 255, 0.28)",
                          borderRadiusPx: radius < 12 ? 16 : radius,
                          shadowPreset: "medium",
                        });
                      }}
                      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface-2)] px-2.5 text-[10.5px] font-medium text-foreground transition-colors hover:border-[var(--primary)]/40"
                    >
                      <Sparkles className="size-3.5 text-[var(--primary)]" />
                      <span>{t("preview.studio.glassPreset")}</span>
                    </button>
                  </div>
                </StudioSectionCard>

                {/* 2. Position & Transform */}
                <StudioSectionCard title={t("preview.studio.secLayout")}>
                  <div className="space-y-1">
                    <span className="block text-[10px] font-medium text-[var(--muted-foreground)]">
                      {t("preview.studio.fieldAlign")}
                    </span>
                    <Tabs
                      value={align}
                      onValueChange={(v) => {
                        const next = v as "left" | "center" | "right";
                        setAlign(next);
                        setOffsetX(0);
                        setMarginLeft(0);
                        setMarginRight(0);
                        emit({ align: next, offsetX: 0 });
                      }}
                    >
                      <TabsList className="w-full">
                        <TabsTrigger
                          value="left"
                          className="flex-1 text-[10.5px]"
                          onClick={() => {
                            if (align === "left") {
                              setOffsetX(0);
                              setMarginLeft(0);
                              setMarginRight(0);
                              emit({ align: "left", offsetX: 0 });
                            }
                          }}
                        >
                          <AlignLeft className="size-3" />
                          <span>{t("preview.studio.alignLeft")}</span>
                        </TabsTrigger>
                        <TabsTrigger
                          value="center"
                          className="flex-1 text-[10.5px]"
                          onClick={() => {
                            if (align === "center") {
                              setOffsetX(0);
                              setMarginLeft(0);
                              setMarginRight(0);
                              emit({ align: "center", offsetX: 0 });
                            }
                          }}
                        >
                          <AlignCenter className="size-3" />
                          <span>{t("preview.studio.alignCenter")}</span>
                        </TabsTrigger>
                        <TabsTrigger
                          value="right"
                          className="flex-1 text-[10.5px]"
                          onClick={() => {
                            if (align === "right") {
                              setOffsetX(0);
                              setMarginLeft(0);
                              setMarginRight(0);
                              emit({ align: "right", offsetX: 0 });
                            }
                          }}
                        >
                          <AlignRight className="size-3" />
                          <span>{t("preview.studio.alignRight")}</span>
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>

                  <StudioSliderField
                    label={t("preview.studio.fieldOffsetX")}
                    value={offsetX}
                    sliderValue={offsetX}
                    min={-200}
                    max={200}
                    presets={
                      offsetX !== 0
                        ? [{ label: "0", onClick: () => { setOffsetX(0); emit({ offsetX: 0 }); } }]
                        : undefined
                    }
                    onChange={(n) => {
                      setOffsetX(n);
                      emit({ offsetX: n });
                    }}
                  />

                  <StudioSliderField
                    label={t("preview.studio.fieldOffsetY")}
                    value={offsetY}
                    sliderValue={offsetY}
                    min={-200}
                    max={200}
                    presets={
                      offsetY !== 0
                        ? [{ label: "0", onClick: () => { setOffsetY(0); emit({ offsetY: 0 }); } }]
                        : undefined
                    }
                    onChange={(n) => {
                      setOffsetY(n);
                      emit({ offsetY: n });
                    }}
                  />

                  <StudioSliderField
                    label={t("preview.studio.fieldRotate")}
                    value={rotateDeg}
                    sliderValue={rotateDeg}
                    min={-180}
                    max={180}
                    unit="°"
                    presets={
                      rotateDeg !== 0
                        ? [{ label: "0°", onClick: () => { setRotateDeg(0); emit({ rotateDeg: 0 }); } }]
                        : undefined
                    }
                    onChange={(n) => {
                      setRotateDeg(n);
                      emit({ rotateDeg: n });
                    }}
                  />

                  <StudioSliderField
                    label={t("preview.studio.fieldScale")}
                    value={scalePct}
                    sliderValue={scalePct}
                    min={40}
                    max={200}
                    unit="%"
                    presets={
                      scalePct !== 100
                        ? [{ label: "100%", onClick: () => { setScalePct(100); emit({ scalePct: 100 }); } }]
                        : undefined
                    }
                    onChange={(n) => {
                      setScalePct(n);
                      emit({ scalePct: n });
                    }}
                  />

                  <StudioSliderField
                    label={t("preview.studio.fieldSkew")}
                    value={skewXDeg}
                    sliderValue={skewXDeg}
                    min={-30}
                    max={30}
                    unit="°"
                    presets={
                      skewXDeg !== 0
                        ? [{ label: "0°", onClick: () => { setSkewXDeg(0); emit({ skewXDeg: 0 }); } }]
                        : undefined
                    }
                    onChange={(n) => {
                      setSkewXDeg(n);
                      emit({ skewXDeg: n });
                    }}
                  />
                </StudioSectionCard>

                {/* 3. Size, Layout & Spacing */}
                <StudioSectionCard title={t("preview.studio.secSize")}>
                  <StudioSliderField
                    label={t("preview.studio.fieldWidth")}
                    value={widthMode === "px" ? widthPx : null}
                    sliderValue={widthPx ?? 160}
                    min={20}
                    max={1200}
                    step={4}
                    presets={[
                      {
                        label: "Auto",
                        active: widthMode === "auto",
                        onClick: () => {
                          setWidthMode("auto");
                          emit({ width: "auto" });
                        },
                      },
                      {
                        label: "100%",
                        active: widthMode === "full",
                        onClick: () => {
                          setWidthMode("full");
                          emit({ width: "100%" });
                        },
                      },
                      {
                        label: "Fit",
                        active: widthMode === "fit",
                        onClick: () => {
                          setWidthMode("fit");
                          emit({ width: "fit-content" });
                        },
                      },
                    ]}
                    onChange={(n) => {
                      setWidthMode("px");
                      setWidthPx(n);
                      emit({ width: `${n}px` });
                    }}
                  />

                  <StudioSliderField
                    label={t("preview.studio.fieldHeight")}
                    value={heightMode === "px" ? heightPx : null}
                    sliderValue={heightPx ?? 48}
                    min={20}
                    max={900}
                    step={4}
                    presets={[
                      {
                        label: "Auto",
                        active: heightMode === "auto",
                        onClick: () => {
                          setHeightMode("auto");
                          emit({ height: "auto" });
                        },
                      },
                    ]}
                    onChange={(n) => {
                      setHeightMode("px");
                      setHeightPx(n);
                      emit({ height: `${n}px` });
                    }}
                  />

                  <div className="space-y-1">
                    <span className="block text-[10px] font-medium text-[var(--muted-foreground)]">
                      {t("preview.studio.fieldDisplay")}
                    </span>
                    <Tabs
                      value={displayMode}
                      onValueChange={(v) => {
                        const next = v as DisplayModeKind;
                        setDisplayMode(next);
                        emit({ displayMode: next });
                      }}
                    >
                      <TabsList className="w-full">
                        <TabsTrigger value="block" className="flex-1 text-[10px]">Block</TabsTrigger>
                        <TabsTrigger value="flex" className="flex-1 text-[10px]">Flex</TabsTrigger>
                        <TabsTrigger value="grid" className="flex-1 text-[10px]">Grid</TabsTrigger>
                        <TabsTrigger value="inline-block" className="flex-1 text-[10px]">Inline</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>

                  {displayMode === "flex" || displayMode === "grid" ? (
                    <div className="space-y-2">
                      {displayMode === "flex" ? (
                        <Tabs
                          value={flexDir}
                          onValueChange={(v) => {
                            const next = v as FlexDirKind;
                            setFlexDir(next);
                            emit({ flexDirection: next });
                          }}
                        >
                          <TabsList className="w-full">
                            <TabsTrigger value="row" className="flex-1 text-[10px]">
                              {t("preview.studio.flexRow")}
                            </TabsTrigger>
                            <TabsTrigger value="column" className="flex-1 text-[10px]">
                              {t("preview.studio.flexCol")}
                            </TabsTrigger>
                          </TabsList>
                        </Tabs>
                      ) : null}
                      <Tabs
                        value={justifyContent}
                        onValueChange={(v) => {
                          const next = v as JustifyKind;
                          setJustifyContent(next);
                          emit({ justifyContent: next });
                        }}
                      >
                        <TabsList className="w-full">
                          <TabsTrigger value="flex-start" className="flex-1 px-1 text-[9.5px]">{t("preview.studio.justifyStart")}</TabsTrigger>
                          <TabsTrigger value="center" className="flex-1 px-1 text-[9.5px]">{t("preview.studio.alignCenter")}</TabsTrigger>
                          <TabsTrigger value="flex-end" className="flex-1 px-1 text-[9.5px]">{t("preview.studio.justifyEnd")}</TabsTrigger>
                          <TabsTrigger value="space-between" className="flex-1 px-1 text-[9.5px]">{t("preview.studio.justifyBetween")}</TabsTrigger>
                        </TabsList>
                      </Tabs>
                      <Tabs
                        value={alignItems}
                        onValueChange={(v) => {
                          const next = v as AlignItemsKind;
                          setAlignItems(next);
                          emit({ alignItems: next });
                        }}
                      >
                        <TabsList className="w-full">
                          <TabsTrigger value="stretch" className="flex-1 px-1 text-[9.5px]">Stretch</TabsTrigger>
                          <TabsTrigger value="flex-start" className="flex-1 px-1 text-[9.5px]">Top</TabsTrigger>
                          <TabsTrigger value="center" className="flex-1 px-1 text-[9.5px]">Mid</TabsTrigger>
                          <TabsTrigger value="flex-end" className="flex-1 px-1 text-[9.5px]">Bot</TabsTrigger>
                        </TabsList>
                      </Tabs>
                    </div>
                  ) : null}

                  <div className="space-y-1">
                    <span className="block text-[10px] font-medium text-[var(--muted-foreground)]">
                      {t("preview.studio.fieldOverflow")}
                    </span>
                    <Tabs
                      value={overflow}
                      onValueChange={(v) => {
                        const next = v as OverflowKind;
                        setOverflow(next);
                        emit({ overflow: next });
                      }}
                    >
                      <TabsList className="w-full">
                        <TabsTrigger value="visible" className="flex-1 text-[10px]">{t("preview.studio.overflowVisible")}</TabsTrigger>
                        <TabsTrigger value="hidden" className="flex-1 text-[10px]">{t("preview.studio.overflowHidden")}</TabsTrigger>
                        <TabsTrigger value="auto" className="flex-1 text-[10px]">{t("preview.studio.overflowScroll")}</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>

                  <div className="space-y-1">
                    <span className="block text-[10px] font-medium text-[var(--muted-foreground)]">
                      {t("preview.studio.fieldCursor")}
                    </span>
                    <Tabs
                      value={cursor}
                      onValueChange={(v) => {
                        const next = v as CursorKind;
                        setCursor(next);
                        emit({ cursor: next });
                      }}
                    >
                      <TabsList className="w-full">
                        <TabsTrigger value="auto" className="flex-1 text-[10px]">{t("preview.studio.cursorAuto")}</TabsTrigger>
                        <TabsTrigger value="pointer" className="flex-1 text-[10px]">{t("preview.studio.cursorPointer")}</TabsTrigger>
                        <TabsTrigger value="grab" className="flex-1 text-[10px]">{t("preview.studio.cursorGrab")}</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>

                  <StudioSliderField
                    label={t("preview.studio.fieldGap")}
                    value={gapPx}
                    sliderValue={gapPx}
                    min={0}
                    max={80}
                    onChange={(n) => {
                      setGapPx(n);
                      emit({ gapPx: n });
                    }}
                  />

                  <StudioSliderField
                    label={t("preview.studio.fieldPaddingX")}
                    value={paddingX}
                    sliderValue={paddingX}
                    min={0}
                    max={140}
                    onChange={(n) => {
                      setPaddingX(n);
                      emit({ paddingX: n });
                    }}
                  />

                  <StudioSliderField
                    label={t("preview.studio.fieldPaddingY")}
                    value={paddingY}
                    sliderValue={paddingY}
                    min={0}
                    max={140}
                    onChange={(n) => {
                      setPaddingY(n);
                      emit({ paddingY: n });
                    }}
                  />

                  <StudioSliderField
                    label={t("preview.studio.fieldMarginTop")}
                    value={marginTop}
                    sliderValue={marginTop}
                    min={-60}
                    max={140}
                    onChange={(n) => {
                      setMarginTop(n);
                      emit({ marginTop: n });
                    }}
                  />

                  <StudioSliderField
                    label={t("preview.studio.fieldMarginBottom")}
                    value={marginBottom}
                    sliderValue={marginBottom}
                    min={-60}
                    max={140}
                    onChange={(n) => {
                      setMarginBottom(n);
                      emit({ marginBottom: n });
                    }}
                  />

                  <StudioSliderField
                    label={t("preview.studio.fieldMarginLeft")}
                    value={marginLeft}
                    sliderValue={marginLeft}
                    min={-60}
                    max={140}
                    onChange={(n) => {
                      setMarginLeft(n);
                      emit({ marginLeft: n });
                    }}
                  />

                  <StudioSliderField
                    label={t("preview.studio.fieldMarginRight")}
                    value={marginRight}
                    sliderValue={marginRight}
                    min={-60}
                    max={140}
                    onChange={(n) => {
                      setMarginRight(n);
                      emit({ marginRight: n });
                    }}
                  />
                </StudioSectionCard>

                {/* 4. Typography */}
                <StudioSectionCard title={t("preview.studio.secTypography")}>
                  <StudioSliderField
                    label={t("preview.studio.fieldFontSize")}
                    value={fontSize}
                    sliderValue={fontSize}
                    min={8}
                    max={96}
                    onChange={(n) => {
                      setFontSize(n);
                      emit({ fontSizePx: n });
                    }}
                  />

                  <div className="space-y-1">
                    <span className="block text-[10px] font-medium text-[var(--muted-foreground)]">
                      {t("preview.studio.fieldWeight")}
                    </span>
                    <Tabs
                      value={weightTabValue}
                      onValueChange={(v) => {
                        const n = parseInt(v, 10);
                        setFontWeight(n);
                        emit({ fontWeight: n });
                      }}
                    >
                      <TabsList className="w-full">
                        {["300", "400", "500", "600", "700", "800"].map((w) => (
                          <TabsTrigger key={w} value={w} className="flex-1 px-1 font-mono text-[10px]">
                            {w}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </Tabs>
                  </div>

                  <StudioSliderField
                    label={t("preview.studio.fieldLineHeight")}
                    value={lineHeight}
                    sliderValue={lineHeight}
                    min={0.8}
                    max={3}
                    step={0.1}
                    unit="×"
                    onChange={(n) => {
                      setLineHeight(n);
                      emit({ lineHeight: n });
                    }}
                  />

                  <StudioSliderField
                    label={t("preview.studio.fieldLetterSpacing")}
                    value={letterSpacing}
                    sliderValue={letterSpacing}
                    min={-3}
                    max={16}
                    step={0.5}
                    onChange={(n) => {
                      setLetterSpacing(n);
                      emit({ letterSpacingPx: n });
                    }}
                  />

                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-pressed={italic}
                        onClick={() => {
                          const next = !italic;
                          setItalic(next);
                          emit({ italic: next });
                        }}
                        className={cn(
                          "grid size-7 place-items-center rounded-[8px] border transition-colors",
                          italic
                            ? "border-[var(--primary)]/50 bg-[var(--primary-soft)] text-[var(--primary)]"
                            : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted-foreground)] hover:text-foreground",
                        )}
                      >
                        <Italic className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-pressed={underline}
                        onClick={() => {
                          const next = !underline;
                          setUnderline(next);
                          emit({ underline: next });
                        }}
                        className={cn(
                          "grid size-7 place-items-center rounded-[8px] border transition-colors",
                          underline
                            ? "border-[var(--primary)]/50 bg-[var(--primary-soft)] text-[var(--primary)]"
                            : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted-foreground)] hover:text-foreground",
                        )}
                      >
                        <Underline className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-pressed={strikethrough}
                        onClick={() => {
                          const next = !strikethrough;
                          setStrikethrough(next);
                          emit({ strikethrough: next });
                        }}
                        className={cn(
                          "grid size-7 place-items-center rounded-[8px] border transition-colors",
                          strikethrough
                            ? "border-[var(--primary)]/50 bg-[var(--primary-soft)] text-[var(--primary)]"
                            : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted-foreground)] hover:text-foreground",
                        )}
                      >
                        <Strikethrough className="size-3.5" />
                      </button>
                    </div>
                    <Tabs
                      value={textTransform}
                      onValueChange={(v) => {
                        const next = v as TextTransformKind;
                        setTextTransform(next);
                        emit({ textTransform: next });
                      }}
                    >
                      <TabsList>
                        <TabsTrigger value="none" className="px-2 font-mono text-[10px]">Aa</TabsTrigger>
                        <TabsTrigger value="uppercase" className="px-2 font-mono text-[10px]">AA</TabsTrigger>
                        <TabsTrigger value="lowercase" className="px-2 font-mono text-[10px]">aa</TabsTrigger>
                        <TabsTrigger value="capitalize" className="px-2 font-mono text-[10px]">Ab</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>

                  <div className="space-y-1">
                    <span className="block text-[10px] font-medium text-[var(--muted-foreground)]">
                      {t("preview.studio.fieldDir")}
                    </span>
                    <Tabs
                      value={dir}
                      onValueChange={(v) => {
                        const next = v as DirKind;
                        setDir(next);
                        emit({ dir: next });
                      }}
                    >
                      <TabsList className="w-full">
                        <TabsTrigger value="auto" className="flex-1 text-[10px]">Auto</TabsTrigger>
                        <TabsTrigger value="rtl" className="flex-1 text-[10px]">RTL</TabsTrigger>
                        <TabsTrigger value="ltr" className="flex-1 text-[10px]">LTR</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>

                  <div className="space-y-1">
                    <span className="block text-[10px] font-medium text-[var(--muted-foreground)]">
                      {t("preview.studio.fieldTextShadow")}
                    </span>
                    <Tabs
                      value={textShadow}
                      onValueChange={(v) => {
                        const next = v as TextShadowPreset;
                        setTextShadow(next);
                        emit({ textShadow: next });
                      }}
                    >
                      <TabsList className="w-full">
                        <TabsTrigger value="none" className="flex-1 text-[10px]">{t("preview.studio.shadowNone")}</TabsTrigger>
                        <TabsTrigger value="soft" className="flex-1 text-[10px]">{t("preview.studio.shadowSoft")}</TabsTrigger>
                        <TabsTrigger value="strong" className="flex-1 text-[10px]">{t("preview.studio.shadowStrong")}</TabsTrigger>
                        <TabsTrigger value="glow" className="flex-1 text-[10px]">{t("preview.studio.shadowGlow")}</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>
                </StudioSectionCard>

                {/* 5. Fill, Gradient & Colors (all open In-Frame StudioColorStudio!) */}
                <StudioSectionCard title={t("preview.studio.secColors")}>
                  <Tabs
                    value={fillMode}
                    onValueChange={(v) => {
                      const next = v as FillModeKind;
                      setFillMode(next);
                      if (next === "transparent") {
                        emit({ fillMode: "transparent", backgroundColor: "transparent" });
                      } else if (next === "gradient") {
                        emit({
                          fillMode: "gradient",
                          gradientFrom: gradFrom,
                          gradientTo: gradTo,
                          gradientAngle: gradAngle,
                        });
                      } else {
                        const solid = bgColor === "transparent" ? "#7c4dff" : bgColor;
                        setBgColor(solid);
                        emit({ fillMode: "solid", backgroundColor: solid });
                      }
                    }}
                  >
                    <TabsList className="w-full">
                      <TabsTrigger value="solid" className="flex-1 text-[10px]">
                        {t("preview.studio.fillSolid")}
                      </TabsTrigger>
                      <TabsTrigger value="gradient" className="flex-1 text-[10px]">
                        {t("preview.studio.fillGradient")}
                      </TabsTrigger>
                      <TabsTrigger value="transparent" className="flex-1 text-[10px]">
                        {t("preview.studio.transparent")}
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>

                  {fillMode === "gradient" ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <ColorTriggerButton
                          label={t("preview.studio.gradStart")}
                          color={gradFrom}
                          onClick={() =>
                            setColorPicker({
                              kind: "gradFrom",
                              title: t("preview.studio.gradStart"),
                              initial: gradFrom,
                            })
                          }
                        />
                        <ColorTriggerButton
                          label={t("preview.studio.gradEnd")}
                          color={gradTo}
                          onClick={() =>
                            setColorPicker({
                              kind: "gradTo",
                              title: t("preview.studio.gradEnd"),
                              initial: gradTo,
                            })
                          }
                        />
                      </div>
                      <StudioSliderField
                        label={t("preview.studio.gradAngle")}
                        value={gradAngle}
                        sliderValue={gradAngle}
                        min={0}
                        max={360}
                        unit="°"
                        onChange={(n) => {
                          setGradAngle(n);
                          emit({
                            fillMode: "gradient",
                            gradientFrom: gradFrom,
                            gradientTo: gradTo,
                            gradientAngle: n,
                          });
                        }}
                      />
                      <div className="grid grid-cols-6 gap-1.5">
                        {GRADIENT_PRESETS.map((gp) => (
                          <button
                            key={gp.name}
                            type="button"
                            title={gp.name}
                            onClick={() => {
                              setGradFrom(gp.from);
                              setGradTo(gp.to);
                              setGradAngle(gp.angle);
                              emit({
                                fillMode: "gradient",
                                gradientFrom: gp.from,
                                gradientTo: gp.to,
                                gradientAngle: gp.angle,
                              });
                            }}
                            className="h-6 rounded-[7px] border border-[var(--border-strong)] transition-transform hover:scale-105"
                            style={{
                              background: `linear-gradient(${gp.angle}deg, ${gp.from}, ${gp.to})`,
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <ColorTriggerButton
                      label={t("preview.studio.fieldBgColor")}
                      color={fillMode === "transparent" ? "transparent" : bgColor}
                      onClick={() =>
                        setColorPicker({
                          kind: "bg",
                          title: t("preview.studio.fieldBgColor"),
                          initial: fillMode === "transparent" ? "transparent" : bgColor,
                          allowTransparent: true,
                        })
                      }
                    />
                  )}

                  <ColorTriggerButton
                    label={t("preview.studio.fieldTextColor")}
                    color={textColor}
                    onClick={() =>
                      setColorPicker({
                        kind: "text",
                        title: t("preview.studio.fieldTextColor"),
                        initial: textColor,
                      })
                    }
                  />
                </StudioSectionCard>

                {/* 6. Border, Shadow & Visual Effects */}
                <StudioSectionCard title={t("preview.studio.secEffects")}>
                  <StudioSliderField
                    label={t("preview.studio.fieldOpacity")}
                    value={opacityPct}
                    sliderValue={opacityPct}
                    min={0}
                    max={100}
                    unit="%"
                    onChange={(n) => {
                      setOpacityPct(n);
                      emit({ opacityPct: n });
                    }}
                  />

                  <StudioSliderField
                    label={t("preview.studio.fieldRadius")}
                    value={radius}
                    sliderValue={Math.min(80, radius)}
                    min={0}
                    max={80}
                    presets={[
                      {
                        label: t("preview.studio.pill"),
                        active: radius >= 999,
                        onClick: () => {
                          setRadius(999);
                          emit({ borderRadiusPx: 999 });
                        },
                      },
                    ]}
                    onChange={(n) => {
                      setRadius(n);
                      emit({ borderRadiusPx: n });
                    }}
                  />

                  <StudioSliderField
                    label={t("preview.studio.fieldBorderWidth")}
                    value={borderWidth}
                    sliderValue={borderWidth}
                    min={0}
                    max={16}
                    onChange={(n) => {
                      setBorderWidth(n);
                      emit({ borderWidthPx: n, borderColor, borderStyle });
                    }}
                  />

                  {borderWidth > 0 ? (
                    <div className="space-y-2">
                      <Tabs
                        value={borderStyle}
                        onValueChange={(v) => {
                          const next = v as BorderStyleKind;
                          setBorderStyle(next);
                          emit({ borderStyle: next });
                        }}
                      >
                        <TabsList className="w-full">
                          <TabsTrigger value="solid" className="flex-1 text-[10px]">
                            {t("preview.studio.borderSolid")}
                          </TabsTrigger>
                          <TabsTrigger value="dashed" className="flex-1 text-[10px]">
                            {t("preview.studio.borderDashed")}
                          </TabsTrigger>
                          <TabsTrigger value="dotted" className="flex-1 text-[10px]">
                            {t("preview.studio.borderDotted")}
                          </TabsTrigger>
                        </TabsList>
                      </Tabs>
                      <ColorTriggerButton
                        label={t("preview.studio.fieldBorderColor")}
                        color={borderColor}
                        onClick={() =>
                          setColorPicker({
                            kind: "border",
                            title: t("preview.studio.fieldBorderColor"),
                            initial: borderColor,
                          })
                        }
                      />
                    </div>
                  ) : null}

                  <div className="space-y-1">
                    <span className="block text-[10px] font-medium text-[var(--muted-foreground)]">
                      {t("preview.studio.fieldShadow")}
                    </span>
                    <Tabs
                      value={shadowPreset}
                      onValueChange={(v) => {
                        const next = v as ShadowPreset;
                        setShadowPreset(next);
                        emit({ shadowPreset: next });
                      }}
                    >
                      <TabsList className="w-full">
                        <TabsTrigger value="none" className="flex-1 px-1 text-[9.5px]">{t("preview.studio.shadowNone")}</TabsTrigger>
                        <TabsTrigger value="soft" className="flex-1 px-1 text-[9.5px]">{t("preview.studio.shadowSoft")}</TabsTrigger>
                        <TabsTrigger value="medium" className="flex-1 px-1 text-[9.5px]">{t("preview.studio.shadowMed")}</TabsTrigger>
                        <TabsTrigger value="strong" className="flex-1 px-1 text-[9.5px]">{t("preview.studio.shadowStrong")}</TabsTrigger>
                        <TabsTrigger value="glow" className="flex-1 px-1 text-[9.5px]">{t("preview.studio.shadowGlow")}</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>

                  <StudioSliderField
                    label={t("preview.studio.fieldBlur")}
                    value={backdropBlur}
                    sliderValue={backdropBlur}
                    min={0}
                    max={32}
                    onChange={(n) => {
                      setBackdropBlur(n);
                      emit({ backdropBlurPx: n });
                    }}
                  />

                  <StudioSliderField
                    label={t("preview.studio.fieldBrightness")}
                    value={brightnessPct}
                    sliderValue={brightnessPct}
                    min={50}
                    max={160}
                    unit="%"
                    presets={
                      brightnessPct !== 100
                        ? [{ label: "100%", onClick: () => { setBrightnessPct(100); emit({ brightnessPct: 100 }); } }]
                        : undefined
                    }
                    onChange={(n) => {
                      setBrightnessPct(n);
                      emit({ brightnessPct: n });
                    }}
                  />

                  <StudioSliderField
                    label={t("preview.studio.fieldContrast")}
                    value={contrastPct}
                    sliderValue={contrastPct}
                    min={50}
                    max={160}
                    unit="%"
                    presets={
                      contrastPct !== 100
                        ? [{ label: "100%", onClick: () => { setContrastPct(100); emit({ contrastPct: 100 }); } }]
                        : undefined
                    }
                    onChange={(n) => {
                      setContrastPct(n);
                      emit({ contrastPct: n });
                    }}
                  />

                  <StudioSliderField
                    label={t("preview.studio.fieldSaturate")}
                    value={saturatePct}
                    sliderValue={saturatePct}
                    min={0}
                    max={200}
                    unit="%"
                    presets={
                      saturatePct !== 100
                        ? [{ label: "100%", onClick: () => { setSaturatePct(100); emit({ saturatePct: 100 }); } }]
                        : undefined
                    }
                    onChange={(n) => {
                      setSaturatePct(n);
                      emit({ saturatePct: n });
                    }}
                  />

                  <StudioSliderField
                    label={t("preview.studio.fieldHueRotate")}
                    value={hueRotateDeg}
                    sliderValue={hueRotateDeg}
                    min={0}
                    max={360}
                    unit="°"
                    presets={
                      hueRotateDeg !== 0
                        ? [{ label: "0°", onClick: () => { setHueRotateDeg(0); emit({ hueRotateDeg: 0 }); } }]
                        : undefined
                    }
                    onChange={(n) => {
                      setHueRotateDeg(n);
                      emit({ hueRotateDeg: n });
                    }}
                  />

                  <StudioSliderField
                    label={t("preview.studio.fieldGrayscale")}
                    value={grayscalePct}
                    sliderValue={grayscalePct}
                    min={0}
                    max={100}
                    unit="%"
                    presets={
                      grayscalePct !== 0
                        ? [{ label: "0%", onClick: () => { setGrayscalePct(0); emit({ grayscalePct: 0 }); } }]
                        : undefined
                    }
                    onChange={(n) => {
                      setGrayscalePct(n);
                      emit({ grayscalePct: n });
                    }}
                  />
                </StudioSectionCard>
              </div>

              {/* Sticky Footer */}
              <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--border)] px-3 py-2">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      onReset();
                      setDirty(false);
                    }}
                    className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--surface-2)] hover:text-foreground"
                  >
                    <RotateCcw className="size-3" />
                    <span>{t("preview.studio.reset")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={onDelete}
                    title={t("preview.studio.deleteElement")}
                    aria-label={t("preview.studio.deleteElement")}
                    className="grid size-8 place-items-center rounded-full text-[var(--destructive)] transition-colors hover:bg-[var(--destructive-soft)]"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                <GlassButton variant="pill" active={dirty} onClick={onSave}>
                  <Check className="size-3.5" />
                  <span>{t("preview.studio.save")}</span>
                </GlassButton>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </MenuFrame>
    </motion.div>
  );
});
