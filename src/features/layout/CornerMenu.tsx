// layout feature: CornerMenu; change its UI/flow here and keep related state/API calls in sync.
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown, Menu } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * CornerMenu — a round button in the top-left corner that morphs into a card
 * of navigation items and grows downward.
 *
 * The motion tables below are copied from the reference prototype (frame
 * numbers, positions, scales and sibling values unchanged). `sample()` reads
 * between keyframes and `applyM()` maps one sampled frame onto the card, its
 * content and the trigger icon.
 *
 * The content itself is generic: pass `sections` from props or a config module.
 * Keep the layout LTR everywhere — Persian labels are rendered with `dir=auto`
 * inside an LTR row, never mirrored.
 */

type IconComponent = React.ComponentType<{ className?: string; strokeWidth?: string | number }>;

export interface CornerMenuItem {
  id: string;
  label: string;
  icon?: IconComponent;
  /** URL to navigate to. Rendered as an anchor instead of a button. */
  href?: string;
  /** Action to run. The menu closes first, then this fires. */
  onClick?: () => void;
  /** Highlight as the current destination. */
  active?: boolean;
  /** Hue (0â€“360) for the hover glow. Defaults to the brand violet. */
  hue?: number;
  /** Trailing three-dots menu actions for this item (e.g. chat pin/rename/delete). */
  menuItems?: CornerMenuItem[];
  /** Accessible label for the trailing menu trigger. */
  menuLabel?: string;
  /** Optional inline expandable submenu panel rendered below this item. */
  submenu?: React.ReactNode;
}

export interface CornerMenuSection {
  id: string;
  /** Optional small heading above the group. */
  title?: string;
  items: CornerMenuItem[];
}

export interface CornerMenuProps {
  sections: CornerMenuSection[];
  /** Accessible name of the trigger and the menu. */
  label?: string;
  className?: string;
  /** Which edge of the trigger the card grows from. Defaults to the left one. */
  anchor?: "left" | "right";
  /** Icon inside the round trigger. Defaults to the hamburger. */
  icon?: IconComponent;
  /** Optional brand row pinned above the items, e.g. the site logo. */
  header?: React.ReactNode;
  /** Optional pinned footer below the scrollable items (e.g. AccountCard). */
  footer?: React.ReactNode | ((close: () => void) => React.ReactNode);
  /** Control the open animation from another trigger while keeping this menu's anchor. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Hide the built-in trigger when another button controls the menu. */
  hideTrigger?: boolean;
}

const Z = [0, 0, 0, 0, 0, 1];
const BT = [1, 1, 0, 0, 0, 1];
const F = [313, 73, 869, 668, 75, 75, 1, 0, 1, 0, 1];
const K = (f: number, a: number[], b: number[]) => [f, ...a, ...b];

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

/** Linear interpolation between the two keyframes around `f`. */
function sample(k: number[][], f: number) {
  let i = 0;
  while (i < k.length - 2 && f >= k[i + 1][0]) i += 1;
  const a = k[i];
  const b = k[i + 1];
  const t = Math.max(0, Math.min(1, (f - a[0]) / (b[0] - a[0])));
  return a.map((x, j) => x + (b[j] - x) * t);
}

const FRAME_MS = 30;
const TRIGGER_SIZE = 44;

/**
 * Open corner menus share the viewport scrim, so only one may be open at a
 * time. Each mounted menu registers a closer here; opening one closes the rest.
 */
const openCoordinators = new Map<string, () => void>();

function closeOtherCornerMenus(selfId: string) {
  for (const [id, close] of openCoordinators) {
    if (id !== selfId) close();
  }
}


const CSS = `
.cm-scrim{position:fixed;inset:0;background:transparent;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);opacity:0;visibility:hidden;pointer-events:none;z-index:35;will-change:opacity;transition:opacity 280ms cubic-bezier(.22,1,.36,1),visibility 0s linear 280ms}
.cm-scrim[data-open="true"]{opacity:1;visibility:visible;transition:opacity 280ms cubic-bezier(.22,1,.36,1),visibility 0s linear 0s}
.cm-root{position:relative;width:44px;height:44px;z-index:40;flex:none}
.cm-root-proxy{position:absolute}
.cm-trigger{position:absolute;inset:0;display:grid;place-items:center;padding:0;border-radius:9999px;cursor:pointer;
  border:1px solid var(--border-strong,var(--border));
  background:color-mix(in oklab,var(--surface-1) 72%,transparent);
  color:var(--foreground);backdrop-filter:blur(12px) saturate(1.4);-webkit-backdrop-filter:blur(12px) saturate(1.4);
  box-shadow:0 8px 22px -14px rgba(0,0,0,.7),inset 0 1px 0 color-mix(in oklab,var(--foreground) 10%,transparent);
  transition:background .15s,border-color .15s}
.cm-trigger:hover{background:color-mix(in oklab,var(--surface-2) 88%,transparent)}
.cm-trigger:focus-visible{outline:2px solid var(--ring,var(--primary));outline-offset:2px}
.cm-trigger-proxy{opacity:0!important;pointer-events:none!important}
.cm-icon{display:grid;place-items:center;will-change:transform,opacity,filter}
.cm-card{position:absolute;left:0;top:0;width:0;height:0;opacity:0;visibility:hidden;overflow:hidden;pointer-events:none;contain:layout style;will-change:transform,width,height,border-radius,opacity}
.cm-cont{position:absolute;left:0;top:0;padding:14px 10px 12px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;
  contain:layout style paint;transform-origin:center center;will-change:transform,opacity,filter;color:var(--foreground);font:inherit}
.cm-cont::-webkit-scrollbar{display:none}
.cm-cont-footer{display:flex;flex-direction:column;overflow:visible}
.cm-scroll{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none}
.cm-scroll::-webkit-scrollbar{display:none}
.cm-footer{flex:none;position:relative;z-index:20;padding-top:10px;margin-top:6px;border-top:1px solid var(--border)}
.cm-brand{display:flex;align-items:center;gap:10px;padding:2px 10px 11px;margin-bottom:4px;border-bottom:1px solid var(--border)}
.cm-brand-name{font-size:13px;font-weight:600;letter-spacing:-.01em;color:var(--foreground);white-space:nowrap}
.cm-brand-sub{display:block;font-size:10px;font-weight:400;color:var(--faint);white-space:nowrap}
.cm-sec{padding:0 10px;margin:14px 0 6px;color:var(--faint);font-size:10.5px;font-weight:500;letter-spacing:.06em;text-transform:uppercase}
.cm-sec:first-child{margin-top:2px}
.cm-row-group{margin-bottom:6px;border-radius:12px;border:1px solid color-mix(in oklab,var(--foreground) 10%,transparent);
  background:color-mix(in oklab,var(--foreground) 6.5%,transparent);
  transition:background .16s ease,border-color .16s ease}
.cm-row-group:last-child{margin-bottom:0}
.cm-row-group:hover{background:color-mix(in oklab,var(--foreground) 9.5%,transparent);border-color:color-mix(in oklab,var(--foreground) 15%,transparent)}
.cm-row-group[data-active="true"],.cm-row-group[data-actions-open="true"]{
  background:color-mix(in oklab,var(--foreground) 12%,transparent);
  border-color:color-mix(in oklab,var(--foreground) 19%,transparent)}
.cm-row{display:flex;align-items:center;gap:2px;width:100%}
.cm-item{display:flex;align-items:center;gap:12px;flex:1;min-width:0;height:40px;padding:0 10px;border:0;border-radius:10px;
  background:none;cursor:pointer;text-align:left;color:inherit;font:inherit;text-decoration:none;transition:background .15s}
.cm-item:hover{background:color-mix(in oklab,var(--foreground) 7%,transparent)}
.cm-item[aria-current="true"]{background:color-mix(in oklab,var(--foreground) 10%,transparent)}
.cm-row-group .cm-item,.cm-row-group .cm-item:hover,.cm-row-group .cm-item[aria-current="true"]{background:none}
.cm-item:focus-visible{outline:2px solid var(--ring,var(--primary));outline-offset:-2px}
.cm-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cm-more{display:grid;place-items:center;width:30px;height:30px;margin-right:5px;flex:none;border:0;border-radius:8px;background:none;
  color:var(--muted-foreground);cursor:pointer;opacity:.68;transition:background .15s ease,opacity .15s ease,color .15s ease}
.cm-row-group:hover .cm-more,.cm-more:hover,.cm-more[aria-expanded="true"]{opacity:1}
.cm-more:hover{background:color-mix(in oklab,var(--foreground) 10%,transparent);color:var(--foreground)}
.cm-more[aria-expanded="true"]{background:color-mix(in oklab,var(--foreground) 14%,transparent);color:var(--foreground)}
.cm-more:focus-visible{outline:2px solid var(--ring,var(--primary));outline-offset:-1px;opacity:1}
.cm-more svg{width:15px;height:15px;transition:transform .22s cubic-bezier(.16,1,.3,1)}
.cm-more[aria-expanded="true"] svg{transform:rotate(90deg)}
.cm-actions-tray{display:flex;align-items:center;gap:4px;margin:0 6px 6px;padding:4px;border-radius:9px;
  border:1px solid color-mix(in oklab,var(--foreground) 10%,transparent);
  background:color-mix(in oklab,var(--surface-1) 76%,transparent);
  box-shadow:inset 0 1px 0 color-mix(in oklab,var(--foreground) 6%,transparent)}
.cm-action-btn{display:flex;align-items:center;justify-content:center;gap:5px;flex:1;min-width:0;height:30px;padding:0 7px;border:0;border-radius:7px;
  background:none;cursor:pointer;color:var(--foreground);font:inherit;font-size:11.5px;white-space:nowrap;
  transition:background .14s ease,color .14s ease}
.cm-action-btn:hover{background:color-mix(in oklab,var(--foreground) 9%,transparent)}
.cm-action-btn:active{transform:scale(.97)}
.cm-action-btn[data-danger="true"]{color:var(--destructive)}
.cm-action-btn[data-danger="true"]:hover{background:var(--destructive-soft)}
.cm-action-btn[data-danger="true"] svg{color:var(--destructive)}
.cm-action-btn:focus-visible{outline:2px solid var(--ring,var(--primary));outline-offset:-1px}
.cm-action-btn svg{width:13px;height:13px;flex:none;color:var(--muted-foreground)}
.cm-action-btn span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cm-chip{width:28px;height:28px;border-radius:9px;display:grid;place-items:center;flex:none;transition:background .2s,box-shadow .2s}
.cm-chip svg{width:18px;height:18px;fill:none;stroke:var(--muted-foreground);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;transition:stroke .2s}
.cm-chev{width:15px;height:15px;flex:none;color:var(--faint);transition:transform .2s ease}
.cm-item[aria-expanded="true"] .cm-chev{transform:rotate(180deg)}
.cm-subpanel{margin:2px 6px 6px;padding:6px 8px 8px;border-radius:12px;background:color-mix(in oklab,var(--foreground) 4%,transparent);border:1px solid var(--border)}
.cm-item:hover .cm-chip,.cm-item:focus-visible .cm-chip,.cm-item:active .cm-chip{
  background:linear-gradient(145deg,hsl(var(--cm-h) 90% 64%),hsl(var(--cm-h) 80% 42%));
  box-shadow:0 0 14px hsl(var(--cm-h) 90% 55% / .5),inset 0 1px 0 rgba(255,255,255,.4)}
.cm-item:hover .cm-chip svg,.cm-item:focus-visible .cm-chip svg,.cm-item:active .cm-chip svg{stroke:#fff}
@media(prefers-reduced-motion:reduce){
  .cm-trigger,.cm-item,.cm-chip,.cm-chip svg{transition:none}
}
`;

let stylesInjected = false;
function ensureCornerMenuStyles() {
  if (stylesInjected || typeof document === "undefined") return;
  const existing = document.getElementById("cm-styles");
  if (existing) {
    existing.textContent = CSS;
  } else {
    const tag = document.createElement("style");
    tag.id = "cm-styles";
    tag.textContent = CSS;
    document.head.appendChild(tag);
  }
  stylesInjected = true;
}

export const CornerMenu = React.memo(function CornerMenu({
  sections,
  label,
  className,
  anchor = "left",
  icon: TriggerIcon = Menu,
  header,
  footer,
  open,
  onOpenChange,
  hideTrigger = false,
}: CornerMenuProps) {
  const [expanded, setExpanded] = React.useState(false);
  const reducedMotion = useReducedMotion();
  const menuId = React.useId();
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const cardRef = React.useRef<HTMLDivElement | null>(null);
  const contRef = React.useRef<HTMLDivElement | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const iconRef = React.useRef<HTMLSpanElement | null>(null);
  const scrimRef = React.useRef<HTMLDivElement | null>(null);
  const stateRef = React.useRef<"closed" | "opening" | "open" | "closing">("closed");
  const animRef = React.useRef<{ kind: "open" | "close"; t0: number } | null>(null);
  const rafRef = React.useRef(0);
  const sizeRef = React.useRef({ width: 300, height: 600 });
  const openPropRef = React.useRef(open);
  openPropRef.current = open;
  const onOpenChangeRef = React.useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const anchorRef = React.useRef(anchor);
  anchorRef.current = anchor;
  const hideTriggerRef = React.useRef(hideTrigger);
  hideTriggerRef.current = hideTrigger;
  const hasFooterRef = React.useRef(Boolean(footer));
  hasFooterRef.current = Boolean(footer);
  const resetSubmenusRef = React.useRef<() => void>(() => undefined);
  const apiRef = React.useRef<{
    toggle: () => void;
    open: () => void;
    close: () => void;
    syncOpen: (open: boolean) => void;
  }>({
    toggle: () => undefined,
    open: () => undefined,
    close: () => undefined,
    syncOpen: () => undefined,
  });

  React.useLayoutEffect(() => {
    ensureCornerMenuStyles();
  }, []);

  React.useEffect(() => {
    const root = rootRef.current;
    const card = cardRef.current;
    const cont = contRef.current;
    const trigger = triggerRef.current;
    const icon = iconRef.current;
    const scrim = scrimRef.current;
    if (!root || !card || !cont || !trigger || !icon || !scrim) return;

    // Cache last trigger/icon values so unchanged frames skip expensive
    // style recalculations on the backdrop-filtered trigger button.
    let lastBgPct = -1;
    let lastBorderPct = -1;
    let lastIconBlur = -1;
    let lastContBlur = -1;
    let lastHl = -1;

    const setOpen = (isOpen: boolean) => {
      setExpanded(isOpen);
      card.style.pointerEvents = isOpen ? "auto" : "none";
      scrim.style.pointerEvents = isOpen ? "auto" : "none";
      if (isOpen) scrim.dataset.open = "true";
      else delete scrim.dataset.open;
      card.inert = !isOpen;
    };

    // The card grows downward from this trigger, so the content box is capped
    // by the space actually below it (keeps the same 300/640 limits as before).
    const measure = () => {
      const top = root.getBoundingClientRect().top;
      const budget = Math.max(320, window.innerHeight - Math.max(16, top) - 16);
      const width = Math.min(300, window.innerWidth - 32);
      const height = Math.min(640, budget);
      sizeRef.current = { width, height };
      cont.style.width = `${width}px`;
      cont.style.height = `${height}px`;
    };

    const applyM = (v: number[]) => {
      const L = v[1];
      const T = 734 - v[4];
      const R = v[3];
      const B = 734 - v[2];
      const s = v[7];
      const co = v[11];
      const { width: FW, height: FH } = sizeRef.current;
      const k = FW / 556;
      const ky = FH / 595;
      const w = Math.max(6, TRIGGER_SIZE + (FW - TRIGGER_SIZE) * ((R - L - 144) / 412));
      const h = Math.max(6, TRIGGER_SIZE + (FH - TRIGGER_SIZE) * ((B - T - 144) / 451));
      const a = v[5] * 0.3;
      const b = v[6] * 0.3;
      // The reference grows the card rightwards from the trigger. On the right
      // edge the same motion is mirrored so the card keeps its trigger edge
      // anchored while it unfolds.
      const drift = -(R - 836) * k * 0.3;
      const cardX = anchorRef.current === "right" ? TRIGGER_SIZE - (drift + w) : drift;
      const cardY = (T - 45) * ky * 0.5;
      card.style.visibility = co > 0.005 ? "visible" : "hidden";
      card.style.transform = `translate3d(${cardX.toFixed(2)}px, ${cardY.toFixed(2)}px, 0)`;
      card.style.width = `${w.toFixed(2)}px`;
      card.style.height = `${h.toFixed(2)}px`;
      card.style.borderRadius = `${b.toFixed(2)}px ${a.toFixed(2)}px ${a.toFixed(2)}px ${a.toFixed(2)}px`;
      card.style.opacity = String(co);
      const hl = Math.round(Math.min(1, v[9]) * co * 20) / 20;
      if (hl !== lastHl) {
        lastHl = hl;
        card.style.setProperty("--hl", String(hl));
      }

      const contX = w / 2 - FW / 2;
      const contY = h / 2 - FH / 2;
      cont.style.transform = `translate3d(${contX.toFixed(2)}px, ${contY.toFixed(2)}px, 0) scale(${s})`;
      const contBlur = v[8] > 0.05 ? Math.round(v[8] * 5) / 10 : 0;
      if (contBlur !== lastContBlur) {
        lastContBlur = contBlur;
        cont.style.filter = contBlur > 0 ? `blur(${contBlur}px)` : "none";
      }
      cont.style.opacity = String(Math.max(0, Math.min(1, (s - 0.3) * 2)));

      const bgPct = Math.round(72 * v[12]);
      if (bgPct !== lastBgPct) {
        lastBgPct = bgPct;
        trigger.style.background = `color-mix(in oklab, var(--surface-1) ${bgPct}%, transparent)`;
      }
      const borderPct = Math.round(100 * v[12]);
      if (borderPct !== lastBorderPct) {
        lastBorderPct = borderPct;
        trigger.style.borderColor = `color-mix(in oklab, var(--border-strong, var(--border)) ${borderPct}%, transparent)`;
      }
      icon.style.opacity = String(v[13]);
      const iconBlur = v[14] > 0.05 ? Math.round(v[14] * 5) / 10 : 0;
      if (iconBlur !== lastIconBlur) {
        lastIconBlur = iconBlur;
        icon.style.filter = iconBlur > 0 ? `blur(${iconBlur}px)` : "none";
      }
      icon.style.transform = `translate3d(${(v[15] * 0.5).toFixed(2)}px, ${(-v[16] * 0.5).toFixed(2)}px, 0) scale(${v[17]})`;
    };

    const focusFirstItem = () => {
      const first = cont.querySelector<HTMLElement>("[data-corner-item]");
      first?.focus({ preventScroll: true });
    };

    const tick = (now: number) => {
      rafRef.current = 0;
      const anim = animRef.current;
      if (!anim) return;
      const k = anim.kind === "open" ? OPEN : CLOSE;
      const f = k[0][0] + ((now - anim.t0) / 1000) * (1000 / FRAME_MS);
      if (f >= k[k.length - 1][0]) {
        applyM(k[k.length - 1]);
        const isOpen = anim.kind === "open";
        stateRef.current = isOpen ? "open" : "closed";
        const allowOverflow = isOpen && hasFooterRef.current;
        card.style.overflow = allowOverflow ? "visible" : "hidden";
        card.style.contain = allowOverflow ? "style" : "layout style";
        setOpen(isOpen);
        animRef.current = null;
        if (isOpen) focusFirstItem();
        else if (!hideTriggerRef.current) trigger.focus({ preventScroll: true });
      } else {
        applyM(sample(k, f));
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    const start = (kind: "open" | "close") => {
      const now = performance.now();
      let startProgress = 0;
      // Smoothly reverse mid-flight when user clicks rapidly during open/close.
      if (animRef.current && animRef.current.kind !== kind) {
        const prevK = animRef.current.kind === "open" ? OPEN : CLOSE;
        const prevSpan = (prevK[prevK.length - 1][0] - prevK[0][0]) * FRAME_MS;
        const elapsed = Math.max(0, Math.min(prevSpan, now - animRef.current.t0));
        const prevProgress = prevSpan > 0 ? elapsed / prevSpan : 1;
        startProgress = Math.max(0, Math.min(0.95, 1 - prevProgress));
      }

      if (kind === "open") {
        measure();
      } else {
        // Synchronously clear nested menus and blur inside content so nothing
        // can ever stay stuck open or focused after rapid open/close.
        resetSubmenusRef.current();
        if (document.activeElement instanceof HTMLElement && cont.contains(document.activeElement)) {
          document.activeElement.blur();
        }
      }

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = 0;
        }
        animRef.current = null;
        const k = kind === "open" ? OPEN : CLOSE;
        applyM(k[k.length - 1]);
        const isOpen = kind === "open";
        stateRef.current = isOpen ? "open" : "closed";
        const allowOverflow = isOpen && hasFooterRef.current;
        card.style.overflow = allowOverflow ? "visible" : "hidden";
        card.style.contain = allowOverflow ? "style" : "layout style";
        setOpen(isOpen);
        if (isOpen) focusFirstItem();
        return;
      }

      card.style.overflow = "hidden";
      card.style.contain = "layout style";
      const nextK = kind === "open" ? OPEN : CLOSE;
      const nextSpan = (nextK[nextK.length - 1][0] - nextK[0][0]) * FRAME_MS;
      animRef.current = { kind, t0: now - startProgress * nextSpan };
      stateRef.current = kind === "open" ? "opening" : "closing";
      if (kind === "open") {
        card.style.visibility = "visible";
        setOpen(true);
      } else {
        setOpen(false);
      }
      if (!rafRef.current) rafRef.current = requestAnimationFrame(tick);
    };

    const show = () => {
      if (stateRef.current === "open" || stateRef.current === "opening") return;
      closeOtherCornerMenus(menuId);
      start("open");
    };

    const hide = () => {
      if (stateRef.current === "closed" || stateRef.current === "closing") return;
      start("close");
    };

    const toggle = () => {
      const currentlyOpen = stateRef.current === "open" || stateRef.current === "opening";
      if (openPropRef.current !== undefined) {
        onOpenChangeRef.current?.(!currentlyOpen);
        return;
      }
      if (currentlyOpen) hide();
      else show();
    };

    const close = () => {
      if (openPropRef.current !== undefined) {
        onOpenChangeRef.current?.(false);
        return;
      }
      hide();
    };

    apiRef.current = { toggle, open: show, close, syncOpen: (open) => (open ? show() : hide()) };
    openCoordinators.set(menuId, close);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (stateRef.current !== "open" && stateRef.current !== "opening") return;
      event.preventDefault();
      close();
    };

    const onResize = () => {
      if (stateRef.current === "open" || stateRef.current === "opening") {
        measure();
        if (stateRef.current === "open") applyM(OPEN[OPEN.length - 1]);
      }
    };

    const onScrim = () => {
      if (stateRef.current === "open" || stateRef.current === "opening") close();
    };

    measure();
    applyM(OPEN[0]);
    setOpen(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    scrim.addEventListener("click", onScrim);

    return () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      animRef.current = null;
      openCoordinators.delete(menuId);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
      scrim.removeEventListener("click", onScrim);
    };
  }, []);

  React.useEffect(() => {
    if (open === undefined) return;
    apiRef.current.syncOpen(open);
  }, [open]);

  const [openActionId, setOpenActionId] = React.useState<string | null>(null);
  const [openSubmenuId, setOpenSubmenuId] = React.useState<string | null>(null);
  resetSubmenusRef.current = () => {
    setOpenActionId(null);
    setOpenSubmenuId(null);
  };

  React.useEffect(() => {
    if (!expanded) {
      setOpenActionId(null);
      setOpenSubmenuId(null);
    }
  }, [expanded]);

  const activate = (item: CornerMenuItem) => {
    setOpenActionId(null);
    apiRef.current.close();
    item.onClick?.();
  };

  const runItemAction = (item: CornerMenuItem) => {
    setOpenActionId(null);
    apiRef.current.close();
    item.onClick?.();
  };

  const renderedSections = sections.map((section) => (
    <div key={section.id} role="group" aria-label={section.title ?? section.id}>
      {section.title ? <div className="cm-sec">{section.title}</div> : null}
      {section.items.map((item) => {
        const Icon = item.icon;
        const content = (
          <>
            <span className="cm-chip" style={{ "--cm-h": item.hue ?? 262 } as React.CSSProperties}>
              {Icon ? <Icon strokeWidth={1.6} /> : null}
            </span>
            <span className="cm-label" dir="auto" style={{ textAlign: "left" }}>
              {item.label}
            </span>
          </>
        );

        if (item.menuItems?.length) {
          const isTrayOpen = openActionId === item.id;
          return (
            <div
              key={item.id}
              className="cm-row-group"
              data-active={item.active ? "true" : undefined}
              data-actions-open={isTrayOpen ? "true" : undefined}
            >
              <div className="cm-row">
                <button
                  type="button"
                  role="menuitem"
                  data-corner-item=""
                  aria-current={item.active ? "true" : undefined}
                  className="cm-item"
                  onClick={() => activate(item)}
                >
                  {content}
                </button>
                <button
                  type="button"
                  className="cm-more"
                  aria-label={item.menuLabel ?? "More"}
                  aria-expanded={isTrayOpen}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenActionId(isTrayOpen ? null : item.id);
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <circle cx="5" cy="12" r="1.9" />
                    <circle cx="12" cy="12" r="1.9" />
                    <circle cx="19" cy="12" r="1.9" />
                  </svg>
                </button>
              </div>
              <AnimatePresence initial={false}>
                {isTrayOpen ? (
                  <motion.div
                    key={`${item.id}-actions`}
                    role="group"
                    aria-label={item.menuLabel ?? "More"}
                    initial={reducedMotion ? { opacity: 0 } : { height: 0, opacity: 0, y: -4 }}
                    animate={reducedMotion ? { opacity: 1 } : { height: "auto", opacity: 1, y: 0 }}
                    exit={reducedMotion ? { opacity: 0 } : { height: 0, opacity: 0, y: -4 }}
                    transition={
                      reducedMotion
                        ? { duration: 0.1 }
                        : { duration: 0.22, ease: [0.16, 1, 0.3, 1] }
                    }
                    style={{ overflow: "hidden" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="cm-actions-tray">
                      {item.menuItems.map((action) => {
                        const AIcon = action.icon;
                        return (
                          <button
                            key={action.id}
                            type="button"
                            role="menuitem"
                            data-danger={action.hue === 0 ? "true" : undefined}
                            className="cm-action-btn"
                            title={action.label}
                            onClick={() => runItemAction(action)}
                          >
                            {AIcon ? <AIcon strokeWidth={1.7} /> : null}
                            <span dir="auto">{action.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          );
        }

        if (item.submenu) {
          const subOpen = openSubmenuId === item.id;
          return (
            <div key={item.id}>
              <button
                type="button"
                role="menuitem"
                data-corner-item=""
                aria-expanded={subOpen}
                className="cm-item"
                onClick={() => setOpenSubmenuId((cur) => (cur === item.id ? null : item.id))}
              >
                {content}
                <ChevronDown className="cm-chev" aria-hidden="true" />
              </button>
              <AnimatePresence initial={false}>
                {subOpen ? (
                  <motion.div
                    key={`${item.id}-sub`}
                    initial={reducedMotion ? { opacity: 0 } : { height: 0, opacity: 0, y: -4 }}
                    animate={reducedMotion ? { opacity: 1 } : { height: "auto", opacity: 1, y: 0 }}
                    exit={reducedMotion ? { opacity: 0 } : { height: 0, opacity: 0, y: -4 }}
                    transition={
                      reducedMotion
                        ? { duration: 0.1 }
                        : { duration: 0.24, ease: [0.16, 1, 0.3, 1] }
                    }
                    style={{ overflow: "hidden" }}
                  >
                    <div className="cm-subpanel">{item.submenu}</div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          );
        }

        if (item.href) {
          return (
            <a
              key={item.id}
              href={item.href}
              role="menuitem"
              data-corner-item=""
              aria-current={item.active ? "true" : undefined}
              className="cm-item"
              onClick={() => apiRef.current.close()}
            >
              {content}
            </a>
          );
        }
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            data-corner-item=""
            aria-current={item.active ? "true" : undefined}
            className="cm-item"
            onClick={() => activate(item)}
          >
            {content}
          </button>
        );
      })}
    </div>
  ));

  const renderedFooter = typeof footer === "function" ? footer(() => apiRef.current.close()) : footer;

  return (
    <>
      <div ref={scrimRef} className="cm-scrim" aria-hidden="true" />
      <div ref={rootRef} className={cn("cm-root", hideTrigger && "cm-root-proxy", className)} dir="ltr">
        <button
          ref={triggerRef}
          type="button"
          className={cn("cm-trigger", hideTrigger && "cm-trigger-proxy")}
          tabIndex={hideTrigger ? -1 : undefined}
          aria-hidden={hideTrigger || undefined}
          aria-label={label ?? "Menu"}
          aria-haspopup="menu"
          aria-expanded={expanded}
          aria-controls={menuId}
          onClick={() => apiRef.current.toggle()}
        >
          <span ref={iconRef} className="cm-icon" aria-hidden="true">
            <TriggerIcon className="size-5" strokeWidth={2} />
          </span>
        </button>
        <div
          ref={cardRef}
          id={menuId}
          role="menu"
          aria-label={label ?? "Menu"}
          className="cm-card cm-surface"
        >
          <div
            ref={contRef}
            className={cn("cm-cont", footer && "cm-cont-footer")}
            dir="ltr"
            onClick={() => {
              if (openActionId) setOpenActionId(null);
            }}
          >
            {header ? <div className="cm-brand">{header}</div> : null}
            {footer ? (
              <>
                <div className="cm-scroll">{renderedSections}</div>
                <div className="cm-footer">{renderedFooter}</div>
              </>
            ) : (
              renderedSections
            )}
          </div>
        </div>
      </div>
    </>
  );
});
