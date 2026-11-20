// layout feature: CornerMenu; change its UI/flow here and keep related state/API calls in sync.
import { Menu } from "lucide-react";
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
.cm-scrim{position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:35}
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
.cm-card{position:absolute;left:0;top:0;width:0;height:0;opacity:0;overflow:hidden;pointer-events:none;will-change:width,height,border-radius,left,top}
.cm-cont{position:absolute;padding:14px 10px 12px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;
  transform-origin:center center;will-change:transform,opacity,filter;color:var(--foreground);font:inherit}
.cm-cont::-webkit-scrollbar{display:none}
.cm-brand{display:flex;align-items:center;gap:10px;padding:2px 10px 11px;margin-bottom:4px;border-bottom:1px solid var(--border)}
.cm-brand-name{font-size:13px;font-weight:600;letter-spacing:-.01em;color:var(--foreground);white-space:nowrap}
.cm-brand-sub{display:block;font-size:10px;font-weight:400;color:var(--faint);white-space:nowrap}
.cm-sec{padding:0 10px;margin:14px 0 6px;color:var(--faint);font-size:10.5px;font-weight:500;letter-spacing:.06em;text-transform:uppercase}
.cm-sec:first-child{margin-top:2px}
.cm-row{display:flex;align-items:center;gap:4px;width:100%}
.cm-item{display:flex;align-items:center;gap:12px;flex:1;min-width:0;height:40px;padding:0 10px;border:0;border-radius:10px;
  background:none;cursor:pointer;text-align:left;color:inherit;font:inherit;text-decoration:none;transition:background .15s}
.cm-item:hover{background:color-mix(in oklab,var(--foreground) 7%,transparent)}
.cm-item[aria-current="true"]{background:color-mix(in oklab,var(--foreground) 10%,transparent)}
.cm-item:focus-visible{outline:2px solid var(--ring,var(--primary));outline-offset:-2px}
.cm-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cm-more{display:grid;place-items:center;width:30px;height:30px;flex:none;border:0;border-radius:8px;background:none;color:var(--faint);cursor:pointer;opacity:0;transition:background .15s,opacity .15s,color .15s}
.cm-row:hover .cm-more,.cm-row:focus-within .cm-more,.cm-more[aria-expanded="true"]{opacity:1}
.cm-more:hover,.cm-more[aria-expanded="true"]{background:color-mix(in oklab,var(--foreground) 10%,transparent);color:var(--foreground)}
.cm-more:focus-visible{outline:2px solid var(--ring,var(--primary));outline-offset:-1px;opacity:1}
.cm-more svg{width:16px;height:16px}
.cm-pop{position:absolute;right:6px;top:calc(100% - 2px);z-index:5;min-width:168px;padding:6px;border-radius:12px;border:1px solid var(--border);background:var(--surface-1);box-shadow:0 18px 36px -16px rgba(0,0,0,.45)}
.cm-pop-item{display:flex;align-items:center;gap:10px;width:100%;height:34px;padding:0 8px;border:0;border-radius:8px;background:none;cursor:pointer;text-align:left;color:inherit;font:inherit}
.cm-pop-item:hover{background:color-mix(in oklab,var(--foreground) 8%,transparent)}
.cm-pop-item:focus-visible{outline:2px solid var(--ring,var(--primary));outline-offset:-2px}
.cm-pop-item svg{width:15px;height:15px;color:var(--muted-foreground)}
.cm-chip{width:28px;height:28px;border-radius:9px;display:grid;place-items:center;flex:none;transition:background .2s,box-shadow .2s}
.cm-chip svg{width:18px;height:18px;fill:none;stroke:var(--muted-foreground);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;transition:stroke .2s}
.cm-item:hover .cm-chip,.cm-item:focus-visible .cm-chip,.cm-item:active .cm-chip{
  background:linear-gradient(145deg,hsl(var(--cm-h) 90% 64%),hsl(var(--cm-h) 80% 42%));
  box-shadow:0 0 14px hsl(var(--cm-h) 90% 55% / .5),inset 0 1px 0 rgba(255,255,255,.4)}
.cm-item:hover .cm-chip svg,.cm-item:focus-visible .cm-chip svg,.cm-item:active .cm-chip svg{stroke:#fff}
@media(prefers-reduced-motion:reduce){
  .cm-trigger,.cm-item,.cm-chip,.cm-chip svg{transition:none}
}
`;

export function CornerMenu({
  sections,
  label,
  className,
  anchor = "left",
  icon: TriggerIcon = Menu,
  header,
  open,
  onOpenChange,
  hideTrigger = false,
}: CornerMenuProps) {
  const [expanded, setExpanded] = React.useState(false);
  const menuId = React.useId();
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const cardRef = React.useRef<HTMLDivElement | null>(null);
  const contRef = React.useRef<HTMLDivElement | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const iconRef = React.useRef<HTMLSpanElement | null>(null);
  const scrimRef = React.useRef<HTMLDivElement | null>(null);
  const stateRef = React.useRef<"closed" | "opening" | "open" | "closing">("closed");
  const animRef = React.useRef<{ kind: "open" | "close"; t0: number } | null>(null);
  const queuedRef = React.useRef(false);
  const closeQueuedRef = React.useRef(false);
  const rafRef = React.useRef(0);
  const sizeRef = React.useRef({ width: 300, height: 600 });
  const openPropRef = React.useRef(open);
  openPropRef.current = open;
  const onOpenChangeRef = React.useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const anchorRef = React.useRef(anchor);
  anchorRef.current = anchor;
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

  React.useEffect(() => {
    const root = rootRef.current;
    const card = cardRef.current;
    const cont = contRef.current;
    const trigger = triggerRef.current;
    const icon = iconRef.current;
    const scrim = scrimRef.current;
    if (!root || !card || !cont || !trigger || !icon || !scrim) return;

    const setOpen = (open: boolean) => {
      setExpanded(open);
      card.style.pointerEvents = open ? "auto" : "none";
      scrim.style.pointerEvents = open ? "auto" : "none";
      card.inert = !open;
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
      card.style.left =
        anchorRef.current === "right"
          ? `${TRIGGER_SIZE - (drift + w)}px`
          : `${drift}px`;
      card.style.top = `${(T - 45) * ky * 0.5}px`;
      card.style.width = `${w}px`;
      card.style.height = `${h}px`;
      card.style.borderRadius = `${b}px ${a}px ${a}px ${a}px`;
      card.style.opacity = String(co);
      card.style.setProperty("--hl", String(Math.min(1, v[9]) * co));
      scrim.style.opacity = String(0.45 * co);
      cont.style.left = `${w / 2 - FW / 2}px`;
      cont.style.top = `${h / 2 - FH / 2}px`;
      cont.style.transform = `scale(${s})`;
      cont.style.filter = v[8] > 0.05 ? `blur(${v[8] * 0.5}px)` : "none";
      cont.style.opacity = String(Math.max(0, Math.min(1, (s - 0.3) * 2)));
      trigger.style.background = `color-mix(in oklab, var(--surface-1) ${Math.round(72 * v[12])}%, transparent)`;
      trigger.style.borderColor = `color-mix(in oklab, var(--border-strong, var(--border)) ${Math.round(100 * v[12])}%, transparent)`;
      icon.style.opacity = String(v[13]);
      icon.style.filter = `blur(${v[14] * 0.5}px)`;
      icon.style.transform = `translate(${v[15] * 0.5}px, ${-v[16] * 0.5}px) scale(${v[17]})`;
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
        setOpen(isOpen);
        animRef.current = null;
        if (isOpen && closeQueuedRef.current) {
          closeQueuedRef.current = false;
          start("close");
          return;
        }
        if (isOpen) focusFirstItem();
        else trigger.focus({ preventScroll: true });
        if (queuedRef.current) {
          queuedRef.current = false;
          toggle();
        }
      } else {
        applyM(sample(k, f));
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    const start = (kind: "open" | "close") => {
      if (kind === "open") measure();
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const k = kind === "open" ? OPEN : CLOSE;
        applyM(k[k.length - 1]);
        stateRef.current = kind === "open" ? "open" : "closed";
        setOpen(kind === "open");
        if (kind === "open") focusFirstItem();
        return;
      }
      animRef.current = { kind, t0: performance.now() };
      stateRef.current = kind === "open" ? "opening" : "closing";
      if (kind === "open") setOpen(true);
      else {
        card.style.pointerEvents = "none";
        scrim.style.pointerEvents = "none";
      }
      if (!rafRef.current) rafRef.current = requestAnimationFrame(tick);
    };

    const show = () => {
      if (animRef.current) {
        queuedRef.current = true;
        return;
      }
      if (stateRef.current === "closed") {
        closeQueuedRef.current = false;
        closeOtherCornerMenus(menuId);
        start("open");
      }
    };

    const hide = () => {
      if (animRef.current) {
        if (animRef.current.kind === "open") closeQueuedRef.current = true;
        return;
      }
      if (stateRef.current === "open" || stateRef.current === "opening") start("close");
    };

    const toggle = () => {
      if (openPropRef.current !== undefined) {
        onOpenChangeRef.current?.(stateRef.current !== "open" && stateRef.current !== "opening");
        return;
      }
      if (stateRef.current === "closed") show();
      else if (stateRef.current === "open") hide();
      else queuedRef.current = true;
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
      if (stateRef.current !== "closed") {
        measure();
        applyM(OPEN[OPEN.length - 1]);
      }
    };

    const onScrim = () => {
      if (stateRef.current === "open") close();
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

  React.useEffect(() => {
    if (!expanded) setOpenActionId(null);
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

  return (
    <>
      <style>{CSS}</style>
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
          <div ref={contRef} className="cm-cont" dir="ltr">
            {header ? <div className="cm-brand">{header}</div> : null}
            {sections.map((section) => (
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
                    const open = openActionId === item.id;
                    return (
                      <div key={item.id} className="cm-row" style={{ position: "relative" }}>
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
                          aria-haspopup="menu"
                          aria-expanded={open}
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenActionId(open ? null : item.id);
                          }}
                        >
                          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <circle cx="5" cy="12" r="1.8" />
                            <circle cx="12" cy="12" r="1.8" />
                            <circle cx="19" cy="12" r="1.8" />
                          </svg>
                        </button>
                        {open ? (
                          <div className="cm-pop" role="menu" aria-label={item.menuLabel ?? "More"}>
                            {item.menuItems.map((action) => {
                              const AIcon = action.icon;
                              return (
                                <button
                                  key={action.id}
                                  type="button"
                                  role="menuitem"
                                  className="cm-pop-item"
                                  onClick={() => runItemAction(action)}
                                >
                                  {AIcon ? <AIcon strokeWidth={1.6} /> : null}
                                  <span dir="auto" style={{ textAlign: "left" }}>{action.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
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
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
