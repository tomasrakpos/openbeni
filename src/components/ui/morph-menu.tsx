// Reusable UI primitive morph-menu; adjust its default appearance and behavior here.
import { Check } from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/*
 * MorphMenu — a menu that grows out of its trigger instead of popping in from
 * an arbitrary corner.
 *
 * The frame tables below are copied unchanged from the reference recording
 * (30fps). Only the geometry is mapped onto the real trigger/card rectangle, so
 * the same overshoot, corner split and content blur play at any position and in
 * either text direction. Motion is driven with requestAnimationFrame (the same
 * approach as the reference) so no dependency is added.
 *
 * Frame columns:
 * [frame, left, top, right, bottom, radius, bottomRadius, contentScale,
 *  contentBlur, contentOpacity, itemBlur, cardOpacity, ring, plusOpacity,
 *  plusBlur, plusX, plusY, plusScale]
 */
const REF_START = [97, 692, 545, 836, 689, 72, 72, 0.5, 8, 0, 0, 0];
const REF_FINAL = [313, 73, 869, 668, 75, 75, 1, 0, 1, 0, 1];
const BT = [1, 1, 0, 0, 0, 1];
const Z = [0, 0, 0, 0, 0, 1];
const K = (frame: number, a: number[], b: number[]) => [frame, ...a, ...b];

const OPEN: number[][] = [
  K(97, [692, 545, 836, 689, 72, 72, 0.5, 8, 0, 0, 0], BT),
  K(98, [692, 545, 836, 689, 72, 72, 0.5, 8, 0, 0, 0], [0, 0.85, 1.5, 0, 0, 1.2]),
  K(99, [581, 361, 805, 604, 112, 14, 0.69, 8, 0.5, 0, 1], [0, 0, 2, 0, 0, 1.2]),
  K(100, [474, 196, 833, 580, 180, 30, 1.06, 7, 0.6, 0, 1], Z),
  K(101, [394, 87, 852, 560, 230, 70, 1.19, 6, 0.75, 0, 1], Z),
  K(102, [337, 41, 862, 588, 250, 110, 1.21, 5, 0.85, 9, 1], Z),
  K(103, [314, 31, 869, 620, 170, 125, 1.19, 3.2, 0.95, 7, 1], Z),
  K(104, [302, 39, 872, 646, 115, 110, 1.12, 0.9, 1, 2.5, 1], Z),
  K(105, [299, 50, 872, 661, 95, 95, 1.06, 0, 1, 0, 1], Z),
  K(106, [301, 60, 872, 669, 85, 85, 1.03, 0, 1, 0, 1], Z),
  K(107, [304, 67, 871, 672, 80, 80, 1.01, 0, 1, 0, 1], Z),
  K(108, [308, 73, 870, 671, 76, 76, 1, 0, 1, 0, 1], Z),
  K(110, [311, 74, 870, 671, 75, 75, 1, 0, 1, 0, 1], Z),
  K(112, [312, 74, 870, 669, 75, 75, 1, 0, 1, 0, 1], Z),
  K(114, [313, 73, 869, 668, 75, 75, 1, 0, 1, 0, 1], Z),
];

const CLOSE: number[][] = [
  K(132, [313, 73, 869, 668, 75, 75, 1, 0, 1, 0, 1], Z),
  K(133, [319, 65, 868, 648, 75, 75, 1.02, 0, 1, 0, 1], Z),
  K(134, [369, 67, 857, 580, 100, 75, 1.08, 4, 0.75, 0, 1], Z),
  K(135, [441, 145, 845, 590, 115, 40, 1, 5, 0.38, 0, 1], Z),
  K(136, [518, 255, 831, 621, 120, 25, 0.75, 6, 0.18, 0, 1], [0, 0.25, 3, -20, 6, 1.1]),
  K(137, [585, 360, 818, 663, 116, 18, 0.5, 6, 0.06, 0, 1], [0, 0.5, 2.5, -16, 10, 1.1]),
  K(138, [640, 447, 808, 675, 85, 20, 0.35, 6, 0, 0, 1], [0, 0.8, 1.5, -11, 18, 1.05]),
  K(139, [679, 509, 802, 688, 70, 30, 0.3, 0, 0, 0, 1], [0, 1, 0.8, -6, 10, 1.03]),
  K(140, [692, 548, 836, 692, 72, 72, 0.3, 0, 0, 0, 1], [0.6, 1, 0.4, 0, 0, 1]),
  K(141, [692, 545, 836, 689, 72, 72, 0.3, 0, 0, 0, 0], BT),
  K(144, [692, 545, 836, 689, 72, 72, 0.3, 0, 0, 0, 0], BT),
];

const OPEN_MS = ((OPEN[OPEN.length - 1][0] - OPEN[0][0]) / 30) * 1000;
const CLOSE_MS = ((CLOSE[CLOSE.length - 1][0] - CLOSE[0][0]) / 30) * 1000;
const FINAL_RADIUS = 28;

export type MorphMenuItem = {
  id: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  meta?: React.ReactNode;
  checked?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

export type MorphMenuTriggerProps = {
  ref: React.Ref<HTMLButtonElement>;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
  "aria-expanded": boolean;
  "aria-haspopup": "menu";
  "aria-controls": string;
  "data-morph-trigger": string;
};

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };

export type MorphMenuProps = {
  items: MorphMenuItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Render the real trigger. Spread every prop onto the button. */
  trigger: (props: MorphMenuTriggerProps) => React.ReactElement;
  /** Accessible name of the menu. */
  label: string;
  /** Optional small caption inside the card. */
  heading?: React.ReactNode;
  align?: "start" | "end" | "center";
  width?: number;
  sideOffset?: number;
  className?: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/** Map a reference track value onto the real start/end geometry. */
function track(value: number, fromA: number, fromB: number, toA: number, toB: number) {
  if (fromB === fromA) return toB;
  return toA + ((value - fromA) / (fromB - fromA)) * (toB - toA);
}

/** Linear sample between the two keyframes that surround the frame. */
function sample(frames: number[][], frame: number) {
  let i = 0;
  while (i < frames.length - 2 && frame >= frames[i + 1][0]) i++;
  const a = frames[i];
  const b = frames[i + 1];
  const t = clamp((frame - a[0]) / (b[0] - a[0]), 0, 1);
  return a.map((value, index) => value + (b[index] - value) * t);
}

function pressTransition(pressed: boolean) {
  return pressed ? "none" : "opacity 420ms cubic-bezier(.22,1,.36,1)";
}

function MorphMenuRow({
  item,
  onSelect,
}: {
  item: MorphMenuItem;
  onSelect: (item: MorphMenuItem) => void;
}) {
  const [pressed, setPressed] = React.useState(false);
  const timer = React.useRef<number>(0);

  React.useEffect(() => () => window.clearTimeout(timer.current), []);

  const select = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (item.disabled) return;
    setPressed(true);
    // A pointer click keeps the row dim long enough to read as a press; a
    // keyboard activation (detail === 0) stays immediate.
    const delay = event.detail === 0 ? 0 : 140;
    timer.current = window.setTimeout(() => {
      onSelect(item);
      setPressed(false);
    }, delay);
  };

  const radio = item.checked !== undefined;

  return (
    <button
      type="button"
      role={radio ? "menuitemradio" : "menuitem"}
      aria-checked={radio ? Boolean(item.checked) : undefined}
      aria-disabled={item.disabled || undefined}
      disabled={item.disabled}
      tabIndex={-1}
      onPointerDown={() => {
        if (!item.disabled) setPressed(true);
      }}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      onClick={select}
      className={cn(
        "flex min-h-11 w-full touch-manipulation items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left text-[13px] leading-5 transition-colors duration-150",
        "text-[var(--muted-foreground)] hover:bg-[var(--surface-2)] hover:text-foreground",
        "focus-visible:bg-[var(--surface-2)] focus-visible:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]",
        item.checked && "text-foreground",
        item.disabled && "pointer-events-none opacity-40",
      )}
      style={{ opacity: pressed ? 0.18 : 1, transition: pressTransition(pressed) }}
    >
      {item.icon ? (
        <span className="grid size-4 shrink-0 place-items-center text-[var(--faint)]" aria-hidden="true">
          {item.icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.meta ? (
        <span className="max-w-[45%] shrink-0 truncate text-[11px] text-[var(--faint)]">{item.meta}</span>
      ) : null}
      {item.checked ? (
        <Check size={14} strokeWidth={2} className="shrink-0 text-[var(--primary)]" aria-hidden="true" />
      ) : null}
    </button>
  );
}

export function MorphMenu({
  items,
  open,
  onOpenChange,
  trigger,
  label,
  heading,
  align = "end",
  width = 280,
  sideOffset = 10,
  className,
}: MorphMenuProps) {
  const uid = React.useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const menuId = `${uid}-menu`;

  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const cardRef = React.useRef<HTMLDivElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const listRef = React.useRef<HTMLDivElement | null>(null);

  const [mounted, setMounted] = React.useState(false);
  const rectsRef = React.useRef<{ start: Rect; end: Rect } | null>(null);
  const phaseRef = React.useRef<"closed" | "opening" | "open" | "closing">("closed");
  const animRef = React.useRef<number | null>(null);
  const queuedRef = React.useRef<boolean | null>(null);

  const reduced = React.useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  const startRef = React.useRef<(kind: "open" | "close") => void>(() => {});

  const applyFrame = React.useCallback((value: number[]) => {
    const card = cardRef.current;
    const content = contentRef.current;
    const list = listRef.current;
    const rects = rectsRef.current;
    if (!card || !content || !list || !rects) return;

    // Position and size are tracked independently. Mapping the reference's
    // absolute right/bottom edges directly onto the card makes the height go
    // negative during the overshoot frames (the reference bottom edge moves up
    // before settling), which used to collapse the card to a 2px line. Tracking
    // the reference *span* instead keeps width/height positive while preserving
    // the same overshoot.
    const left = track(value[1], REF_START[1], REF_FINAL[0], rects.start.left, rects.end.left);
    const top = track(value[2], REF_START[2], REF_FINAL[1], rects.start.top, rects.end.top);
    const widthPx = Math.max(
      2,
      track(
        value[3] - value[1],
        REF_START[3] - REF_START[1],
        REF_FINAL[2] - REF_FINAL[0],
        rects.start.width,
        rects.end.width,
      ),
    );
    const heightPx = Math.max(
      2,
      track(
        value[4] - value[2],
        REF_START[4] - REF_START[2],
        REF_FINAL[3] - REF_FINAL[1],
        rects.start.height,
        rects.end.height,
      ),
    );
    const half = Math.min(widthPx, heightPx) / 2;

    // Start from the trigger's real shape: a 30px pill begins as a 15px pill,
    // a round button begins as a circle. From there the reference overshoot
    // track drives the corners toward the card radius.
    const startRadius = Math.min(rects.start.width, rects.start.height) / 2;
    const topNorm = (value[5] - REF_START[5]) / (REF_FINAL[4] - REF_START[5]);
    const bottomNorm = (value[6] - REF_START[6]) / (REF_FINAL[5] - REF_START[6]);
    const radiusTop = clamp(startRadius + topNorm * (FINAL_RADIUS - startRadius), 0, half);
    const radiusBottom = clamp(startRadius + bottomNorm * (FINAL_RADIUS - startRadius), 0, half);

    card.style.visibility = "visible";
    card.style.opacity = String(value[11]);
    card.style.pointerEvents = value[11] >= 0.5 ? "auto" : "none";
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    card.style.width = `${widthPx}px`;
    card.style.height = `${heightPx}px`;
    card.style.borderRadius = `${radiusTop}px ${radiusTop}px ${radiusBottom}px ${radiusBottom}px`;

    // The reference fades the card itself in over the trigger. Until the card
    // is actually opaque, leave the trigger's label visible underneath so the
    // user never sees an empty dark box.
    if (triggerRef.current) {
      triggerRef.current.style.opacity = value[11] >= 0.5 ? "0" : "";
    }

    content.style.opacity = String(value[9]);
    content.style.transform = `scale(${value[7]})`;
    content.style.filter = `blur(${value[8]}px)`;
    list.style.filter = `blur(${value[10]}px)`;
  }, []);

  const finish = React.useCallback(
    (kind: "open" | "close") => {
      animRef.current = null;
      phaseRef.current = kind === "open" ? "open" : "closed";

      if (kind === "open") {
        const first =
          cardRef.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]') ??
          cardRef.current?.querySelector<HTMLElement>('[role="menuitem"], [role="menuitemradio"]');
        first?.focus({ preventScroll: true });
      } else {
        if (cardRef.current?.contains(document.activeElement)) {
          triggerRef.current?.focus({ preventScroll: true });
        }
        rectsRef.current = null;
      }

      const queued = queuedRef.current;
      queuedRef.current = null;
      if (queued !== null && (queued ? "open" : "close") !== kind) {
        if (kind === "close" && queued) {
          // Keep the card mounted for the queued re-open.
          startRef.current("open");
          return;
        }
        if (kind === "open" && !queued) {
          startRef.current("close");
          return;
        }
      }

      if (kind === "close") setMounted(false);
    },
    [],
  );

  const start = React.useCallback(
    (kind: "open" | "close") => {
      if (kind === "open") setMounted(true);
      if (!rectsRef.current) return;

      if (reduced) {
        applyFrame(kind === "open" ? OPEN[OPEN.length - 1] : CLOSE[CLOSE.length - 1]);
        phaseRef.current = kind === "open" ? "open" : "closed";
        queuedRef.current = null;
        if (kind === "close") {
          setMounted(false);
          rectsRef.current = null;
          triggerRef.current?.focus({ preventScroll: true });
        } else {
          finish("open");
        }
        return;
      }

      const frames = kind === "open" ? OPEN : CLOSE;
      const started = performance.now();
      const duration = kind === "open" ? OPEN_MS : CLOSE_MS;
      phaseRef.current = kind === "open" ? "opening" : "closing";

      // Paint the first frame synchronously so the trigger is covered in the
      // same layout pass that hides its label.
      applyFrame(frames[0]);

      const tick = (now: number) => {
        const progress = Math.min(1, (now - started) / duration);
        const frame = frames[0][0] + progress * (frames[frames.length - 1][0] - frames[0][0]);
        if (progress >= 1) {
          applyFrame(frames[frames.length - 1]);
          animRef.current = null;
          finish(kind);
          return;
        }
        applyFrame(sample(frames, frame));
        animRef.current = requestAnimationFrame(tick);
      };

      if (animRef.current) cancelAnimationFrame(animRef.current);
      animRef.current = requestAnimationFrame(tick);
    },
    [applyFrame, finish, reduced],
  );
  startRef.current = start;

  // The reference owns the trigger's visibility frame by frame (see
  // applyFrame), so this effect only sets touch behaviour and cleans up.
  React.useEffect(() => {
    const el = triggerRef.current;
    if (!el) return;
    el.style.touchAction = "manipulation";
    return () => {
      el.style.opacity = "";
      el.style.touchAction = "";
    };
  }, []);

  const measure = React.useCallback(() => {
    const card = cardRef.current;
    const triggerEl = triggerRef.current;
    if (!card || !triggerEl) return false;
    const trigger = triggerEl.getBoundingClientRect();
    const vv = window.visualViewport;
    const viewportWidth = vv?.width ?? window.innerWidth;
    const viewportHeight = vv?.height ?? window.innerHeight;
    const offsetX = vv?.offsetLeft ?? 0;
    const offsetY = vv?.offsetTop ?? 0;
    const margin = 12;
    const widthPx = Math.max(180, Math.min(width, viewportWidth - margin * 2));

    // Reset any leftover close frame before measuring the natural height.
    card.style.height = "auto";
    card.style.width = `${widthPx}px`;
    card.style.left = "0px";
    card.style.top = "0px";
    if (contentRef.current) {
      contentRef.current.style.opacity = "1";
      contentRef.current.style.transform = "none";
      contentRef.current.style.filter = "none";
    }
    if (listRef.current) listRef.current.style.filter = "none";

    const naturalHeight = card.offsetHeight;
    const maxHeight = Math.max(48, Math.round(viewportHeight * 0.72));
    const start: Rect = {
      left: trigger.left,
      top: trigger.top,
      right: trigger.right,
      bottom: trigger.bottom,
      width: trigger.width,
      height: trigger.height,
    };

    let left =
      align === "end"
        ? trigger.right - widthPx
        : align === "start"
          ? trigger.left
          : trigger.left + trigger.width / 2 - widthPx / 2;
    left = clamp(left, offsetX + margin, Math.max(offsetX + margin, offsetX + viewportWidth - widthPx - margin));

    // Pick a side that leaves the trigger clickable. The card is capped to the
    // space on that side and scrolls internally, so it never covers the button
    // that toggles it (a second click must always be able to close it).
    const above = trigger.top - sideOffset - (offsetY + margin);
    const below = offsetY + viewportHeight - margin - (trigger.bottom + sideOffset);
    let heightPx = Math.min(naturalHeight, maxHeight);
    let top: number;
    if (heightPx <= above) {
      top = trigger.top - sideOffset - heightPx;
    } else if (heightPx <= below) {
      top = trigger.bottom + sideOffset;
    } else if (above >= below) {
      heightPx = Math.max(48, Math.min(maxHeight, above));
      top = trigger.top - sideOffset - heightPx;
    } else {
      heightPx = Math.max(48, Math.min(maxHeight, below));
      top = trigger.bottom + sideOffset;
    }
    top = clamp(top, offsetY + margin, Math.max(offsetY + margin, offsetY + viewportHeight - heightPx - margin));

    rectsRef.current = {
      start,
      end: { left, top, right: left + widthPx, bottom: top + heightPx, width: widthPx, height: heightPx },
    };
    return true;
  }, [align, sideOffset, width]);

  // Recalculate on rotation, window resize and the mobile keyboard opening.
  React.useEffect(() => {
    if (!open) return;
    const update = () => {
      if (phaseRef.current !== "open") return;
      rectsRef.current = null;
      if (measure()) applyFrame(OPEN[OPEN.length - 1]);
    };
    const vv = window.visualViewport;
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
    };
  }, [open, measure, applyFrame]);

  // Drive the controlled `open` prop into the animation state machine.
  React.useLayoutEffect(() => {
    if (!open && !mounted) return;
    if (open && !cardRef.current) return;
    if (!rectsRef.current && !measure()) return;

    const target = open ? "open" : "close";
    const phase = phaseRef.current;

    if (phase === target) return;
    if (phase === "opening" && target === "close") {
      queuedRef.current = false;
      return;
    }
    if (phase === "closing" && target === "open") {
      queuedRef.current = true;
      return;
    }
    if (phase === "closed" && target === "close") {
      setMounted(false);
      return;
    }
    start(target);
  }, [open, mounted, measure, start]);

  // Open from the trigger: announce the state immediately, then animate.
  const toggle = React.useCallback(() => {
    if (open) {
      if (phaseRef.current === "opening") {
        queuedRef.current = false;
        return;
      }
      onOpenChange(false);
      return;
    }
    if (phaseRef.current === "closing") {
      queuedRef.current = true;
      return;
    }
    onOpenChange(true);
  }, [onOpenChange, open]);

  // Outside click closes.
  React.useEffect(() => {
    if (!open) return;
    const down = (event: PointerEvent) => {
      const target = event.target as Node;
      if (cardRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      onOpenChange(false);
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [open, onOpenChange]);

  // Escape closes and returns focus to the trigger.
  React.useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onOpenChange(false);
      triggerRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open, onOpenChange]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      onOpenChange(false);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nodes = Array.from(
      cardRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]') ?? [],
    ).filter((node) => !node.hasAttribute("disabled"));
    if (!nodes.length) return;
    const at = nodes.indexOf(document.activeElement as HTMLElement);
    let next = 0;
    if (event.key === "ArrowDown") next = at < 0 ? 0 : (at + 1) % nodes.length;
    if (event.key === "ArrowUp") next = at < 0 ? nodes.length - 1 : (at - 1 + nodes.length) % nodes.length;
    if (event.key === "End") next = nodes.length - 1;
    nodes[next]?.focus({ preventScroll: true });
  };

  const handleSelect = (item: MorphMenuItem) => {
    item.onSelect();
    onOpenChange(false);
  };

  const hidden = !open && !mounted;
  if (hidden && typeof document === "undefined") return null;


  const panel = (
    <div
      ref={cardRef}
      id={menuId}
      role="menu"
      aria-label={label}
      data-morph-menu=""
      onKeyDown={onKeyDown}
      className={cn(
        "fixed z-[80] overflow-hidden border border-[var(--border-strong)]",
        "bg-[color-mix(in_oklab,var(--surface-1)_99%,transparent)]",
        "shadow-[0_18px_50px_-20px_rgba(0,0,0,.55)] backdrop-blur-xl backdrop-saturate-150",
        className,
      )}
      style={{
        visibility: "hidden",
        borderTopLeftRadius: FINAL_RADIUS,
        borderTopRightRadius: FINAL_RADIUS,
        borderBottomRightRadius: FINAL_RADIUS,
        borderBottomLeftRadius: FINAL_RADIUS,
        touchAction: "manipulation",
        willChange: "left, top, width, height, border-radius",
      }}
    >
      <div
        ref={contentRef}
        className="flex h-full w-full flex-col p-1.5"
        style={{ transformOrigin: "center center", willChange: "transform, opacity, filter" }}
      >
        {heading ? (
          <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--faint)]">
            {heading}
          </p>
        ) : null}
        <div
          ref={listRef}
          className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain"
          style={{ touchAction: "pan-y" }}
        >
          {items.map((item) => (
            <MorphMenuRow key={item.id} item={item} onSelect={handleSelect} />
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <style>{`[data-morph-trigger]{position:relative;touch-action:manipulation}[data-morph-trigger]::after{content:"";position:absolute;inset:-7px 0;border-radius:999px}`}</style>
      {trigger({
        ref: triggerRef,
        onClick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          toggle();
        },
        onPointerDown: (event) => event.stopPropagation(),
        "aria-expanded": open,
        "aria-haspopup": "menu",
        "aria-controls": menuId,
        "data-morph-trigger": "",
      })}
      {typeof document !== "undefined" && (open || mounted) ? createPortal(panel, document.body) : null}
    </>
  );
}

export { OPEN_MS as MORPH_MENU_OPEN_MS, CLOSE_MS as MORPH_MENU_CLOSE_MS };
