// layout feature: CornerMenu; change its UI/flow here and keep related state/API calls in sync.
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import * as React from "react";
import { attachOutsideDismiss } from "@/lib/outsideDismiss";
import { cn } from "@/lib/utils";

/**
 * CornerMenu — a round button in the top-left corner that morphs into a card
 * of navigation items and grows downward.
 *
 * The open/close animation, 30 fps keyframe tables (`OPEN` / `CLOSE`),
 * `sample()`, `applyM()`, scrim opacity sync, and queued toggle behavior are
 * rebuilt verbatim from the reference prototype (`Sidebar v2.html`).
 *
 * Keep the layout LTR everywhere — Persian labels keep RTL reading direction
 * (`rtl` class / `dir="rtl"`) inside an LTR row, never mirrored.
 */

export type CornerIconComponent = React.ComponentType<{
  className?: string;
  strokeWidth?: string | number;
}>;

/** Exact SVG icons from Sidebar v2.html */
export function SidebarTriggerGlyph({ className }: { className?: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 7h16M4 12h16M4 17h10" />
    </svg>
  );
}

export function SidebarNewIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

export function SidebarSearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

export function SidebarProjectsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </svg>
  );
}

export function SidebarConnectionsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="6" cy="5" r="2.5" />
      <circle cx="6" cy="19" r="2.5" />
      <circle cx="18" cy="12" r="2.5" />
      <path d="M6 7.5v9M8.3 6.2c5 .5 7.2 2.3 7.2 3.8" />
    </svg>
  );
}

export function SidebarAutoIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/** Deterministic hue (0-359) from a label, identical to Sidebar v2.html. */
export function sidebarHue(label: string): number {
  let h = 0;
  for (const c of label) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

const isPersianText = (text: string) => /[\u0600-\u06FF]/.test(text);

export interface CornerMenuItem {
  id: string;
  label: string;
  icon?: CornerIconComponent;
  /** Single-character project tile (`.pt` from Sidebar v2.html). */
  tile?: string;
  /** Minimal glowing dot indicator (`.dot` from Sidebar v2.html) for chat rows. */
  dot?: boolean;
  /** Row visual variant: compact `chat` row with gradient fade mask, or muted `more` row. */
  variant?: "default" | "chat" | "more";
  /** URL to navigate to. Rendered as an anchor instead of a button. */
  href?: string;
  /** Action to run. Closes the menu first unless `keepOpen` is true. */
  onClick?: () => void;
  /** Keep the menu open when clicking this item (e.g. inline search toggle, "Show all"). */
  keepOpen?: boolean;
  /** Highlight as the current destination. */
  active?: boolean;
  /** Hue (0–360) for the hover glow. Defaults to deterministic hue from label or 262. */
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
  /** Empty-state text shown when `items` is empty (e.g. during inline search). */
  emptyText?: string;
}

export interface CornerMenuProps {
  sections: CornerMenuSection[];
  /** Accessible name of the trigger and the menu. */
  label?: string;
  className?: string;
  /** Which edge of the trigger the card grows from. Defaults to the left one. */
  anchor?: "left" | "right";
  /** Icon inside the round trigger. Defaults to the Sidebar v2.html 3-line glyph. */
  icon?: CornerIconComponent;
  /** Optional brand row pinned above the items, e.g. the site logo. */
  header?: React.ReactNode;
  /** Optional pinned footer below the scrollable items (e.g. AccountCard). */
  footer?: React.ReactNode | ((close: () => void) => React.ReactNode);
  /** Control the open animation from another trigger while keeping this menu's anchor. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Hide the built-in trigger when another button controls the menu. */
  hideTrigger?: boolean;
  /** Inline search box (`.sbox` from Sidebar v2.html) rendered below the first section. */
  searchOpen?: boolean;
  onSearchOpenChange?: (open: boolean) => void;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  searchPlaceholder?: string;
}

const Z = [0, 0, 0, 0, 0, 1];
const BT = [1, 1, 0, 0, 0, 1];
const F = [313, 73, 869, 668, 75, 75, 1, 0, 1, 0, 1];
const K = (f: number, a: number[], b: number[]) => [f, ...a, ...b];

const OPEN: number[][] = [
  K(97.5, [692, 545, 836, 689, 72, 72, 0.5, 8, 0, 0, 0], BT),
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
  K(109.5, F, Z),
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
];

const SAMPLE_BUF = new Array<number>(18).fill(0);

/** Allocation-free linear keyframe sampler. */
function sample(k: number[][], f: number) {
  let i = 0;
  while (i < k.length - 2 && f >= k[i + 1][0]) i += 1;
  const a = k[i];
  const b = k[i + 1];
  const t = Math.max(0, Math.min(1, (f - a[0]) / (b[0] - a[0])));
  for (let j = 0; j < a.length; j += 1) {
    SAMPLE_BUF[j] = a[j] + (b[j] - a[j]) * t;
  }
  return SAMPLE_BUF;
}

/** Snappy 42 fps playback rate with 48px trigger geometry. */
const FPS = 42;
const TRIGGER_SIZE = 48;

const openCoordinators = new Map<string, () => void>();

function closeOtherCornerMenus(selfId: string) {
  for (const [id, close] of openCoordinators) {
    if (id !== selfId) close();
  }
}

const CSS = `
.cm-scrim{position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:35;cursor:pointer;touch-action:manipulation;display:none}
.cm-root{position:relative;width:48px;height:48px;z-index:40;flex:none}
.cm-root-proxy{position:absolute}
.cm-trigger{position:absolute;inset:0;display:grid;place-items:center;padding:0;border-radius:50%;cursor:pointer;
  border:1px solid var(--border-strong,var(--border));
  background:color-mix(in oklab,var(--foreground) 5%,transparent);
  color:var(--foreground)}
.cm-trigger:focus-visible{outline:2px solid #8f84ff;outline-offset:-2px}
.cm-trigger-proxy{opacity:0!important;pointer-events:none!important}
.cm-icon{display:grid;place-items:center}
.cm-card{position:absolute;left:0;top:0;opacity:0;overflow:hidden;pointer-events:none;display:none;
  border:1px solid var(--border-strong,var(--border));
  background:linear-gradient(180deg,color-mix(in oklab,var(--foreground) 6%,transparent),color-mix(in oklab,var(--foreground) 1.5%,transparent)),var(--surface-1);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.22),0 24px 48px rgba(0,0,0,.45)}
.cm-cont{position:absolute;left:0;top:0;padding:14px 10px 12px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;
  color:var(--foreground);font:inherit}
.cm-cont::-webkit-scrollbar{display:none}
.cm-cont-footer{display:flex;flex-direction:column;overflow:visible}
.cm-scroll{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none}
.cm-scroll::-webkit-scrollbar{display:none}
.cm-footer{flex:none;position:relative;z-index:20;padding-top:10px;margin-top:6px;border-top:1px solid var(--border)}
.cm-brand{display:flex;align-items:center;gap:10px;padding:2px 10px 11px;margin-bottom:4px;border-bottom:1px solid var(--border)}
.cm-nav{display:flex;flex-direction:column;gap:2px}
.cm-sec{margin:18px 0 6px;padding:0 10px;color:var(--muted-foreground);font-size:13px;font-weight:400}
.cm-sec:first-child{margin-top:4px}
.cm-row-wrap{border-radius:10px;transition:background .15s}
.cm-row-wrap[data-actions-open="true"]{background:color-mix(in oklab,var(--foreground) 7%,transparent)}
.cm-row{display:flex;align-items:center;gap:2px;width:100%}
.cm-item{display:flex;align-items:center;gap:12px;flex:1;min-width:0;width:100%;height:40px;padding:0 10px;border:0;border-radius:10px;
  background:none;cursor:pointer;text-align:left;color:inherit;font:inherit;font-size:14.5px;line-height:1.4;text-decoration:none;transition:background .15s}
.cm-item:hover{background:color-mix(in oklab,var(--foreground) 6%,transparent)}
.cm-item[aria-current="true"]{background:color-mix(in oklab,var(--foreground) 9%,transparent)}
.cm-item:focus-visible{outline:2px solid #8f84ff;outline-offset:-2px}
.cm-item-chat{height:36px}
.cm-item-more{color:var(--muted-foreground);height:34px;font-size:13.5px}
.cm-item-more:hover{color:var(--foreground)}
.cm-label{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cm-label-rtl{direction:rtl;text-align:left}
.cm-item-chat .cm-label{text-overflow:clip;-webkit-mask-image:linear-gradient(to right,#000 calc(100% - 28px),transparent);mask-image:linear-gradient(to right,#000 calc(100% - 28px),transparent)}
.cm-item-chat .cm-label-rtl{-webkit-mask-image:linear-gradient(to right,transparent,#000 28px);mask-image:linear-gradient(to right,transparent,#000 28px);text-align:right}
/* Plain by default, coloured + glowing only on hover / focus / press (exact Sidebar v2.html) */
.cm-chip{width:28px;height:28px;border-radius:9px;display:grid;place-items:center;flex:none;transition:background .2s,box-shadow .2s}
.cm-chip svg{width:18px;height:18px;stroke:var(--muted-foreground);fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;transition:stroke .2s}
.cm-pt{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;font-size:12px;font-weight:600;flex:none;
  background:color-mix(in oklab,var(--foreground) 8%,var(--surface-2));color:var(--muted-foreground);border:1px solid var(--border);
  transition:background .2s,box-shadow .2s,color .2s,border-color .2s}
.cm-dot{width:7px;height:7px;border-radius:50%;margin:0 10px 0 7px;flex:none;background:var(--muted-foreground);opacity:.6;
  transition:background .2s,box-shadow .2s,opacity .2s}
.cm-item:hover .cm-chip,.cm-item:focus-visible .cm-chip,.cm-item:active .cm-chip{
  background:linear-gradient(145deg,hsl(var(--cm-h) 90% 64%),hsl(var(--cm-h) 80% 42%));
  box-shadow:0 0 14px hsl(var(--cm-h) 90% 55% / .5),inset 0 1px 0 rgba(255,255,255,.4)}
.cm-item:hover .cm-chip svg,.cm-item:focus-visible .cm-chip svg,.cm-item:active .cm-chip svg{stroke:#fff}
.cm-item:hover .cm-pt,.cm-item:focus-visible .cm-pt,.cm-item:active .cm-pt{
  background:linear-gradient(145deg,hsl(var(--cm-h) 80% 58%),hsl(var(--cm-h) 70% 38%));
  border-color:transparent;color:#fff;box-shadow:0 0 12px hsl(var(--cm-h) 85% 55% / .4)}
.cm-item:hover .cm-dot,.cm-item:focus-visible .cm-dot,.cm-item:active .cm-dot{
  background:hsl(var(--cm-h) 90% 62%);opacity:1;box-shadow:0 0 10px hsl(var(--cm-h) 90% 60% / .8)}
/* Inline search box (exact Sidebar v2.html .sbox) */
.cm-sbox{margin:6px 0 4px}
.cm-sbox input{width:100%;height:38px;border-radius:10px;border:1px solid var(--border-strong,var(--border));
  background:transparent;color:var(--foreground);padding:0 12px;outline:none;font:inherit;font-size:13.5px}
.cm-sbox input::placeholder{color:var(--muted-foreground)}
.cm-sbox input:focus{border-color:#8f84ff}
.cm-empty{padding:6px 10px;color:var(--muted-foreground);font-size:13px}
/* Compact trailing three-dots & expandable actions tray */
.cm-more{display:grid;place-items:center;width:28px;height:28px;margin-right:4px;flex:none;border:0;border-radius:8px;background:none;
  color:var(--muted-foreground);cursor:pointer;opacity:0;transition:background .15s ease,opacity .15s ease,color .15s ease}
.cm-row-wrap:hover .cm-more,.cm-row-wrap:focus-within .cm-more,.cm-more:hover,.cm-more[aria-expanded="true"]{opacity:.85}
.cm-more:hover{background:color-mix(in oklab,var(--foreground) 10%,transparent);color:var(--foreground);opacity:1}
.cm-more[aria-expanded="true"]{background:color-mix(in oklab,var(--foreground) 14%,transparent);color:var(--foreground);opacity:1}
.cm-more:focus-visible{outline:2px solid #8f84ff;outline-offset:-1px;opacity:1}
.cm-more svg{width:14px;height:14px;transition:transform .22s cubic-bezier(.16,1,.3,1)}
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
.cm-action-btn:focus-visible{outline:2px solid #8f84ff;outline-offset:-1px}
.cm-action-btn svg{width:13px;height:13px;flex:none;color:var(--muted-foreground)}
.cm-action-btn span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cm-chev{width:15px;height:15px;flex:none;color:var(--muted-foreground);transition:transform .2s ease}
.cm-item[aria-expanded="true"] .cm-chev{transform:rotate(180deg)}
.cm-subpanel{margin:2px 6px 6px;padding:6px 8px 8px;border-radius:12px;background:color-mix(in oklab,var(--foreground) 4%,transparent);border:1px solid var(--border)}
@media(prefers-reduced-motion:reduce){
  .cm-item,.cm-chip,.cm-chip svg,.cm-pt,.cm-dot,.cm-more,.cm-chev{transition:none!important}
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
  icon: TriggerIcon = SidebarTriggerGlyph,
  header,
  footer,
  open,
  onOpenChange,
  hideTrigger = false,
  searchOpen = false,
  onSearchOpenChange,
  searchQuery = "",
  onSearchQueryChange,
  searchPlaceholder,
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
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);

  const stateRef = React.useRef<"closed" | "opening" | "open" | "closing">("closed");
  const animRef = React.useRef<{ kind: "open" | "close"; t0: number } | null>(null);
  const queuedRef = React.useRef(false);
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
  const searchOpenRef = React.useRef(searchOpen);
  searchOpenRef.current = searchOpen;
  const onSearchOpenChangeRef = React.useRef(onSearchOpenChange);
  onSearchOpenChangeRef.current = onSearchOpenChange;
  const onSearchQueryChangeRef = React.useRef(onSearchQueryChange);
  onSearchQueryChangeRef.current = onSearchQueryChange;
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
    if (searchOpen) {
      requestAnimationFrame(() => searchInputRef.current?.focus({ preventScroll: true }));
    }
  }, [searchOpen]);

  React.useEffect(() => {
    const root = rootRef.current;
    const card = cardRef.current;
    const cont = contRef.current;
    const trigger = triggerRef.current;
    const icon = iconRef.current;
    const scrim = scrimRef.current;
    if (!root || !card || !cont || !trigger || !icon || !scrim) return;

    const setOpenDom = (isOpen: boolean) => {
      trigger.setAttribute("aria-expanded", String(isOpen));
      card.style.pointerEvents = isOpen ? "auto" : "none";
      scrim.style.pointerEvents = isOpen ? "auto" : "none";
      card.inert = !isOpen;
    };

    const setOpen = (isOpen: boolean) => {
      setOpenDom(isOpen);
      setExpanded(isOpen);
    };

    let measured = false;
    let settledDrift = 0;
    let settledTop = 0;
    let lastTriggerAlpha = -1;

    const measure = () => {
      const top = root.getBoundingClientRect().top;
      const width = Math.min(300, window.innerWidth - 32);
      const height = Math.min(640, Math.max(320, window.innerHeight - Math.max(32, top + 20)));
      sizeRef.current = { width, height };
      const k = width / 556;
      const ky = height / 595;
      // Match the exact settled open position of keyframe F so transform settles at identity.
      settledDrift = -(F[2] - 836) * k * 0.3;
      settledTop = (734 - F[3] - 45) * ky * 0.5;
      const isRight = anchorRef.current === "right";
      card.style.left = `${isRight ? TRIGGER_SIZE - (settledDrift + width) : settledDrift}px`;
      card.style.top = `${settledTop}px`;
      card.style.width = `${width}px`;
      card.style.height = `${height}px`;
      card.style.borderRadius = "22.5px";
      card.style.transformOrigin = isRight ? "100% 0%" : "0% 0%";
      cont.style.width = `${width}px`;
      cont.style.height = `${height}px`;
      measured = true;
    };

    /** GPU-composited frame mapper: only mutates transform & opacity per frame (0 layout/blur/shadow reflows). */
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
      const drift = -(R - 836) * k * 0.3;
      const isRight = anchorRef.current === "right";
      const tx = isRight ? -(drift - settledDrift) : drift - settledDrift;
      const ty = (T - 45) * ky * 0.5 - settledTop;
      const sx = Math.max(0.08, w / Math.max(1, FW));
      const sy = Math.max(0.08, h / Math.max(1, FH));

      card.style.transform = `translate3d(${tx.toFixed(2)}px,${ty.toFixed(2)}px,0) scale(${sx.toFixed(4)},${sy.toFixed(4)})`;
      card.style.opacity = String(co);
      scrim.style.opacity = String(0.45 * co);
      cont.style.opacity = String(Math.max(0, Math.min(1, (s - 0.3) * 2)));

      const ta = v[12];
      if (ta !== lastTriggerAlpha) {
        lastTriggerAlpha = ta;
        trigger.style.opacity = String(ta);
      }
      icon.style.opacity = String(v[13]);
      icon.style.transform = `translate3d(${(v[15] * 0.5).toFixed(2)}px,${(-v[16] * 0.5).toFixed(2)}px,0) scale(${v[17].toFixed(4)})`;
    };

    const settleVisuals = (isOpen: boolean) => {
      card.style.willChange = "";
      card.style.contain = "";
      scrim.style.willChange = "";
      if (isOpen) {
        card.style.display = "block";
        scrim.style.display = "block";
        card.style.transform = "";
        card.style.opacity = "1";
        cont.style.opacity = "1";
        card.style.overflow = hasFooterRef.current ? "visible" : "hidden";
      } else {
        card.style.overflow = "hidden";
        card.style.display = "none";
        scrim.style.display = "none";
        card.style.transform = "";
        icon.style.transform = "";
      }
    };

    const focusFirstItem = () => {
      const first = cont.querySelector<HTMLElement>("[data-corner-item]");
      first?.focus({ preventScroll: true });
    };

    const start = (kind: "open" | "close") => {
      if (kind === "open") {
        if (!measured) measure();
        card.style.display = "block";
        scrim.style.display = "block";
      } else {
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
        settleVisuals(isOpen);
        setOpen(isOpen);
        if (isOpen) focusFirstItem();
        return;
      }

      card.style.overflow = "hidden";
      card.style.willChange = "transform, opacity";
      card.style.contain = "layout style paint";
      scrim.style.willChange = "opacity";
      animRef.current = { kind, t0: performance.now() };
      stateRef.current = kind === "open" ? "opening" : "closing";
      if (kind === "open") {
        // Update DOM interactivity immediately without triggering a React re-render on frame 1.
        setOpenDom(true);
      } else {
        card.style.pointerEvents = "none";
        scrim.style.pointerEvents = "none";
      }
      if (!rafRef.current) rafRef.current = requestAnimationFrame(tick);
    };

    const tick = (now: number) => {
      rafRef.current = 0;
      const anim = animRef.current;
      if (!anim) return;
      const k = anim.kind === "open" ? OPEN : CLOSE;
      const f = k[0][0] + ((now - anim.t0) / 1000) * FPS;
      if (f >= k[k.length - 1][0]) {
        applyM(k[k.length - 1]);
        const isOpen = anim.kind === "open";
        stateRef.current = isOpen ? "open" : "closed";
        settleVisuals(isOpen);
        setOpen(isOpen);
        animRef.current = null;
        if (isOpen) {
          focusFirstItem();
        } else {
          if (searchOpenRef.current) {
            onSearchOpenChangeRef.current?.(false);
            onSearchQueryChangeRef.current?.("");
          }
          if (!hideTriggerRef.current) trigger.focus({ preventScroll: true });
        }
        if (queuedRef.current) {
          queuedRef.current = false;
          toggleInternal();
        }
      } else {
        applyM(sample(k, f));
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    const toggleInternal = () => {
      if (animRef.current) {
        queuedRef.current = true;
        return;
      }
      if (stateRef.current === "closed") {
        closeOtherCornerMenus(menuId);
        start("open");
      } else if (stateRef.current === "open") {
        start("close");
      }
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
      if (openPropRef.current !== undefined) {
        const currentlyOpen = stateRef.current === "open" || stateRef.current === "opening";
        onOpenChangeRef.current?.(!currentlyOpen);
        return;
      }
      toggleInternal();
    };

    const close = () => {
      if (openPropRef.current !== undefined) {
        onOpenChangeRef.current?.(false);
        return;
      }
      if (stateRef.current === "open") {
        start("close");
      } else if (stateRef.current === "opening") {
        queuedRef.current = true;
      }
    };

    apiRef.current = { toggle, open: show, close, syncOpen: (isOpen) => (isOpen ? show() : hide()) };
    openCoordinators.set(menuId, close);

    const onKeyDown = (event: KeyboardEvent) => {
      if (stateRef.current !== "open") return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (searchOpenRef.current && onSearchOpenChangeRef.current) {
          onSearchOpenChangeRef.current(false);
          onSearchQueryChangeRef.current?.("");
        } else {
          close();
        }
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k" &&
        onSearchOpenChangeRef.current
      ) {
        event.preventDefault();
        onSearchOpenChangeRef.current(true);
        requestAnimationFrame(() => searchInputRef.current?.focus({ preventScroll: true }));
      }
    };

    const onResize = () => {
      if (stateRef.current === "open") {
        measure();
        settleVisuals(true);
      } else {
        measured = false;
      }
    };

    const onScrim = () => {
      if (stateRef.current === "open" || stateRef.current === "opening") close();
    };

    const detachOutside = attachOutsideDismiss({
      isActive: () => stateRef.current === "open" || stateRef.current === "opening",
      isInside: (target, path) =>
        card.contains(target) ||
        trigger.contains(target) ||
        Boolean(path && (path.includes(card) || path.includes(trigger))),
      onDismiss: close,
    });

    measure();
    applyM(OPEN[0]);
    settleVisuals(false);
    setOpen(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    scrim.addEventListener("click", onScrim);

    return () => {
      detachOutside();
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      animRef.current = null;
      queuedRef.current = false;
      openCoordinators.delete(menuId);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
      scrim.removeEventListener("click", onScrim);
    };
  }, [menuId]);

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
    if (!item.keepOpen) {
      apiRef.current.close();
    }
    item.onClick?.();
  };

  const runItemAction = (item: CornerMenuItem) => {
    setOpenActionId(null);
    apiRef.current.close();
    item.onClick?.();
  };

  const renderLead = (item: CornerMenuItem) => {
    if (item.icon) {
      const Icon = item.icon;
      return (
        <span className="cm-chip">
          <Icon strokeWidth={1.6} />
        </span>
      );
    }
    if (item.tile) {
      return <span className="cm-pt">{item.tile}</span>;
    }
    if (item.dot) {
      return <span className="cm-dot" />;
    }
    return null;
  };

  const renderedSections = sections.map((section, sectionIdx) => (
    <React.Fragment key={section.id}>
      <div role="group" aria-label={section.title ?? section.id}>
        {section.title ? <div className="cm-sec">{section.title}</div> : null}
        <div className="cm-nav">
          {section.items.length === 0 && section.emptyText ? (
            <div className="cm-empty" dir="auto">
              {section.emptyText}
            </div>
          ) : (
            section.items.map((item) => {
              const itemHue = item.hue ?? sidebarHue(item.label);
              const rtl = isPersianText(item.label);
              const itemClass = cn(
                "cm-item",
                item.variant === "chat" && "cm-item-chat",
                item.variant === "more" && "cm-item-more",
              );
              const itemStyle = { "--cm-h": itemHue } as React.CSSProperties;
              const content = (
                <>
                  {renderLead(item)}
                  <span className={cn("cm-label", rtl && "cm-label-rtl")} dir={rtl ? "rtl" : "ltr"}>
                    {item.label}
                  </span>
                </>
              );

              if (item.menuItems?.length) {
                const isTrayOpen = openActionId === item.id;
                return (
                  <div
                    key={item.id}
                    className="cm-row-wrap"
                    data-actions-open={isTrayOpen ? "true" : undefined}
                  >
                    <div className="cm-row">
                      <button
                        type="button"
                        role="menuitem"
                        data-corner-item=""
                        aria-current={item.active ? "true" : undefined}
                        className={itemClass}
                        style={itemStyle}
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
                      className={itemClass}
                      style={itemStyle}
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
                    className={itemClass}
                    style={itemStyle}
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
                  className={itemClass}
                  style={itemStyle}
                  onClick={() => activate(item)}
                >
                  {content}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Inline search box (`.sbox` from Sidebar v2.html) right after the top nav section */}
      {sectionIdx === 0 && searchOpen && onSearchQueryChange ? (
        <div className="cm-sbox">
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            autoComplete="off"
            dir="auto"
          />
        </div>
      ) : null}
    </React.Fragment>
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
          className="cm-card"
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
