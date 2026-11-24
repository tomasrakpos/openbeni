// Reusable UI primitive corner-menu; adjust its default appearance and behavior here.
import * as React from "react";
import { attachOutsideDismiss } from "@/lib/outsideDismiss";
import "./corner-menu.css";

/*
 * CornerMenu — a round trigger in the top-left corner that morphs into the menu
 * card and unfolds downwards.
 *
 * The keyframe tables (OPEN / CLOSE) and `sample()` are kept verbatim from the
 * reference recording (30 fps); none of the numbers were touched. Only the
 * mapping onto the live card is local, because the reference was measured for a
 * 300x640 card and a 48x48 trigger. Colour, glass and type come from this
 * project's tokens, and the whole surface is pinned to LTR so a Persian (RTL)
 * interface does not mirror it.
 *
 * Frame columns:
 * [frame, left, top, right, bottom, radius, bottomRadius, contentScale,
 *  contentBlur, contentOpacity, itemBlur, cardOpacity, triggerRing,
 *  iconOpacity, iconBlur, iconX, iconY, iconScale]
 */
const Z = [0, 0, 0, 0, 0, 1];
const BT = [1, 1, 0, 0, 0, 1];

const F = [313, 73, 869, 668, 75, 75, 1, 0, 1, 0, 1];
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
  K(114, F, Z),
];

const CLOSE: number[][] = [
  K(132, F, Z),
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

/** Exact copy of the reference sampler. */
function sample(k: number[][], f: number): number[] {
  let i = 0;
  while (i < k.length - 2 && f >= k[i + 1][0]) i++;
  const a = k[i];
  const b = k[i + 1];
  const t = Math.max(0, Math.min(1, (f - a[0]) / (b[0] - a[0])));
  return a.map((x, j) => x + (b[j] - x) * t);
}

export type CornerMenuItem = {
  id: string;
  /** Row text. Persian is fine; the row stays left-aligned either way. */
  label: string;
  /** Leading icon. Plain grey by default, coloured and glowing on hover. */
  icon?: React.ReactNode;
  /** Navigation target. Ignored when `onSelect` is also provided. */
  href?: string;
  onSelect?: () => void;
  /** Trailing hint, e.g. `⌘K`. */
  hint?: string;
  /** Which token the hover glow uses. Defaults to `primary`. */
  tint?: "primary" | "accent";
  /** Marks the row as the current destination. */
  active?: boolean;
  disabled?: boolean;
};

export type CornerMenuProps = {
  items: CornerMenuItem[];
  /** Optional caption inside the card. */
  heading?: string;
  /** Accessible name of the trigger and of the menu. */
  label?: string;
  /** Card width in CSS pixels (clamped to the viewport). */
  width?: number;
  /** Card height in CSS pixels (clamped to the viewport). */
  height?: number;
  /**
   * `fixed` pins the trigger to the viewport corner (the reference behaviour).
   * `inline` places it in the nearest positioned ancestor instead, which is how
   * it is mounted inside the app shell so it clears the sidebar and header.
   */
  position?: "fixed" | "inline";
  /** Distance of the trigger from the container's top/left edges. */
  inset?: number;
  className?: string;
};

const CARD_W = 300;
const CARD_H = 600;
const BTN = 48;
/* The design box the reference frames were measured in. */
const REF_W = 556;
const REF_H = 595;

const TRIGGER_ART = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M4 7h16M4 12h16M4 17h10" />
  </svg>
);

export function CornerMenu({
  items,
  heading,
  label = "Menu",
  width = CARD_W,
  height = CARD_H,
  position = "fixed",
  inset = 16,
  className,
}: CornerMenuProps) {
  const uid = React.useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const cardId = `${uid}-card`;

  const [open, setOpen] = React.useState(false);
  /** Kept mounted while the closing animation runs. */
  const [present, setPresent] = React.useState(false);

  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const cardRef = React.useRef<HTMLDivElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const scrimRef = React.useRef<HTMLDivElement | null>(null);
  const iconRef = React.useRef<HTMLSpanElement | null>(null);

  const sizeRef = React.useRef({ w: CARD_W, h: CARD_H });
  /** Mirrors `open` for the animation loop. */
  const openRef = React.useRef(false);
  const queuedRef = React.useRef<boolean | null>(null);
  const animRef = React.useRef<number | null>(null);
  const stateRef = React.useRef<"closed" | "opening" | "open" | "closing">("closed");

  const startRef = React.useRef<(kind: "open" | "close") => void>(() => {});

  const reduced = React.useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  /**
   * Write one reference frame onto the DOM — the same mapping as `applyM` in the
   * reference: edges become sizes, radii keep the design's `.3x` average, and
   * the trigger ring/icon read the trailing six columns.
   */
  const applyFrame = React.useCallback((v: number[]) => {
    const card = cardRef.current;
    const content = contentRef.current;
    const trigger = triggerRef.current;
    const icon = iconRef.current;
    if (!card || !content || !trigger || !icon) return;

    const { w: FW, h: FH } = sizeRef.current;
    const L = v[1];
    const R = v[3];
    const T = 734 - v[4];
    const B = 734 - v[2];
    const scale = v[7];
    const cardOpacity = v[11];

    const k = FW / REF_W;
    const ky = FH / REF_H;
    const w = Math.max(6, BTN + (FW - BTN) * ((R - L - 144) / 412));
    const h = Math.max(6, BTN + (FH - BTN) * ((B - T - 144) / 451));
    const a = v[5] * 0.3;
    const b = v[6] * 0.3;

    card.style.left = `${-(R - 836) * k * 0.3}px`;
    card.style.top = `${(T - 45) * ky * 0.5}px`;
    card.style.width = `${w}px`;
    card.style.height = `${h}px`;
    card.style.borderRadius = `${b}px ${a}px ${a}px ${a}px`;
    card.style.opacity = String(cardOpacity);
    card.style.setProperty("--hl", String(Math.min(1, v[9]) * cardOpacity));
    card.style.pointerEvents = cardOpacity >= 0.5 ? "auto" : "none";

    if (scrimRef.current) {
      scrimRef.current.style.opacity = String(0.45 * cardOpacity);
      scrimRef.current.style.pointerEvents = openRef.current ? "auto" : "none";
    }

    content.style.left = `${w / 2 - FW / 2}px`;
    content.style.top = `${h / 2 - FH / 2}px`;
    content.style.width = `${FW}px`;
    content.style.height = `${FH}px`;
    content.style.transform = `scale(${scale})`;
    content.style.filter = v[8] > 0.05 ? `blur(${v[8] * 0.5}px)` : "none";
    content.style.opacity = String(Math.max(0, Math.min(1, (scale - 0.3) * 2)));

    // The ring keeps the reference alpha but takes the project's foreground
    // token, so it reads on the light theme as well as the dark one.
    trigger.style.setProperty("--ohc-tbg", String(0.05 * v[12]));
    trigger.style.setProperty("--ohc-tborder", String(0.1 * v[12]));

    icon.style.opacity = String(v[13]);
    icon.style.filter = `blur(${v[14] * 0.5}px)`;
    icon.style.transform = `translate(${v[15] * 0.5}px, ${-v[16] * 0.5}px) scale(${v[17]})`;
  }, []);

  const finish = React.useCallback((next: "open" | "close") => {
    animRef.current = null;
    stateRef.current = next === "open" ? "open" : "closed";
    openRef.current = next === "open";
    setOpen(next === "open");

    if (next === "close") {
      if (cardRef.current?.contains(document.activeElement)) {
        triggerRef.current?.focus({ preventScroll: true });
      }
      setPresent(false);
    } else {
      cardRef.current
        ?.querySelector<HTMLElement>(".ohc-item:not([aria-disabled='true'])")
        ?.focus({ preventScroll: true });
    }

    const queued = queuedRef.current;
    queuedRef.current = null;
    if (queued !== null && queued !== (next === "open")) {
      startRef.current(queued ? "open" : "close");
      return;
    }
    if (cardRef.current) cardRef.current.inert = next !== "open";
  }, []);

  const measure = React.useCallback(() => {
    const vw = window.visualViewport?.width ?? window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const margin = 16;
    sizeRef.current = {
      w: Math.max(180, Math.min(width, vw - inset - margin)),
      h: Math.max(160, Math.min(height, vh - inset - margin)),
    };
  }, [height, inset, width]);

  const start = React.useCallback(
    (kind: "open" | "close") => {
      if (kind === "open") measure();
      const frames = kind === "open" ? OPEN : CLOSE;
      const last = frames[frames.length - 1];

      if (reduced) {
        applyFrame(last);
        finish(kind);
        return;
      }

      const begun = performance.now();
      const duration = ((last[0] - frames[0][0]) / 30) * 1000;
      const from = frames[0][0];
      const to = last[0];
      stateRef.current = kind === "open" ? "opening" : "closing";
      if (kind === "close") openRef.current = false;

      // Paint frame 0 before the first rAF so the card cannot flash at its
      // natural size for one frame.
      applyFrame(frames[0]);

      const tick = (now: number) => {
        const progress = Math.min(1, (now - begun) / duration);
        if (progress >= 1) {
          applyFrame(last);
          finish(kind);
          return;
        }
        applyFrame(sample(frames, from + progress * (to - from)));
        animRef.current = requestAnimationFrame(tick);
      };

      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
      animRef.current = requestAnimationFrame(tick);
    },
    [applyFrame, finish, measure, reduced],
  );
  startRef.current = start;

  const requestOpen = React.useCallback((next: boolean) => {
    const phase = stateRef.current;
    if (next) {
      if (phase === "open" || phase === "opening") return;
      if (phase === "closing") {
        queuedRef.current = true;
        return;
      }
      openRef.current = true;
      // Mounting is all that happens here; the card has to exist before frame 0
      // can be written, so the animation starts from the effect below.
      setOpen(true);
      setPresent(true);
      return;
    }
    if (phase === "closed" || phase === "closing") return;
    if (phase === "opening") {
      queuedRef.current = false;
      return;
    }
    openRef.current = false;
    setOpen(false);
    startRef.current("close");
  }, []);

  const toggle = React.useCallback(() => {
    const phase = stateRef.current;
    if (phase === "opening") {
      queuedRef.current = false;
      return;
    }
    if (phase === "closing") {
      queuedRef.current = true;
      return;
    }
    requestOpen(phase !== "open");
  }, [requestOpen]);

  // Kick off the open animation once the card is mounted.
  React.useEffect(() => {
    if (!present || stateRef.current !== "closed") return;
    startRef.current("open");
  }, [present]);

  React.useEffect(() => {
    if (!cardRef.current) return;
    cardRef.current.inert = !open;
  }, [open, present]);

  // Escape closes and returns focus to the trigger.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      requestOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, requestOpen]);

  // Outside press closes reliably on mobile & desktop.
  React.useEffect(() => {
    if (!open) return;
    return attachOutsideDismiss({
      isInside: (target, path) =>
        Boolean(rootRef.current?.contains(target) || (path && rootRef.current && path.includes(rootRef.current))),
      onDismiss: () => requestOpen(false),
    });
  }, [open, requestOpen]);

  // Re-measure and snap to the final frame while open (rotation, keyboard).
  React.useEffect(() => {
    if (!open) return;
    const sync = () => {
      if (stateRef.current !== "open") return;
      measure();
      applyFrame(OPEN[OPEN.length - 1]);
    };
    const vv = window.visualViewport;
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    vv?.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
      vv?.removeEventListener("resize", sync);
    };
  }, [applyFrame, measure, open]);

  React.useEffect(
    () => () => {
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    },
    [],
  );

  const onItem = (item: CornerMenuItem) => (event: React.MouseEvent) => {
    if (item.disabled) {
      event.preventDefault();
      return;
    }
    // A row that only carries `href` navigates: close, then let the anchor run.
    if (item.href && !item.onSelect) {
      requestOpen(false);
      return;
    }
    event.preventDefault();
    item.onSelect?.();
    requestOpen(false);
  };

  const card = (
    <div ref={cardRef} id={cardId} role="menu" aria-label={label} className="ohc-card">
      <div ref={contentRef} className="ohc-content">
        {heading ? <p className="ohc-heading">{heading}</p> : null}
        <div className="ohc-list">
          {items.map((item) => {
            const body = (
              <>
                {item.icon ? (
                  <span className="ohc-chip" aria-hidden="true">
                    {item.icon}
                  </span>
                ) : null}
                <span className="ohc-label" dir="auto">
                  {item.label}
                </span>
                {item.hint ? <kbd className="ohc-hint">{item.hint}</kbd> : null}
              </>
            );
            const shared = {
              className: "ohc-item",
              role: "menuitem",
              "data-tint": item.tint === "accent" ? "accent" : "primary",
              "aria-current": item.active ? ("page" as const) : undefined,
              "aria-disabled": item.disabled || undefined,
              onClick: onItem(item),
            };
            return item.href && !item.onSelect ? (
              <a key={item.id} href={item.href} {...shared}>
                {body}
              </a>
            ) : (
              <button key={item.id} type="button" {...shared}>
                {body}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );

  return (
    <div ref={rootRef} className={className} style={{ "--ohc-inset": `${inset}px` } as React.CSSProperties}>
      <div ref={scrimRef} className="ohc-scrim" aria-hidden="true" />
      <div className="ohc-fab" dir="ltr" data-position={position}>
        <button
          ref={triggerRef}
          type="button"
          className="ohc-trigger"
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={cardId}
          onClick={toggle}
        >
          <span ref={iconRef} className="ohc-icon">
            {TRIGGER_ART}
          </span>
        </button>
        {present ? card : null}
      </div>
    </div>
  );
}