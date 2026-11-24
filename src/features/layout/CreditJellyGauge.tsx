// layout feature: CreditJellyGauge — Apple Tahoe LiquidGlass 0-100 credit pill
// seated beneath the floating AppNav bar, with real-time streaming drain and
// the CornerMenu center-anchored morph animation into a matching LiquidGlass card.
import { ChevronDown, Coins, KeyRound, Lock, Zap } from "lucide-react";
import * as React from "react";
import { LiquidGlass } from "@/components/ui/apple-tahoe-liquid-glass-button";
import { WaterRippleFill } from "@/components/ui/water-ripple-image";
import { useT } from "@/lib/i18n";
import { attachOutsideDismiss } from "@/lib/outsideDismiss";
import { loadAuthPanel } from "@/lib/preload";
import { JellyStretchEngine, useJellyStretch } from "@/lib/useJellyStretch";
import { cn } from "@/lib/utils";
import { DEFAULT_SIGNUP_CREDITS, useAuthStore } from "@/stores/auth";
import { useChatsStore } from "@/stores/chats";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";

const JELLY_CSS_ID = "credit-jelly-gauge-css";

/* Exact CornerMenu morph keyframe tables so the credit drawer opens/closes
   with the same elastic feel, unfolded symmetrically from the center. */
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

const FRAME_MS = 21;
const FINAL_CARD_RADIUS = 22;
const SAMPLE_BUF = new Array<number>(18).fill(0);

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

/**
 * Cuts a rounded-rect cutout out of the viewport scrim where the glass card
 * sits so the backdrop around the menu dims cleanly while the card itself
 * refracts the real un-darkened page behind it instead of turning black.
 */
function scrimCutoutClip(
  rect: Pick<DOMRect, "left" | "top" | "right" | "bottom" | "width" | "height">,
  radius: number,
): string {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const x1 = Math.max(0, rect.left);
  const y1 = Math.max(0, rect.top);
  const x2 = Math.min(vw, rect.right);
  const y2 = Math.min(vh, rect.bottom);
  const r = Math.min(radius, (x2 - x1) / 2, (y2 - y1) / 2);
  if (x2 <= x1 || y2 <= y1) return "";
  const pts: string[] = [];
  const arc = (cx: number, cy: number, a0: number, a1: number, steps = 6) => {
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      pts.push(`${(cx + r * Math.cos(a)).toFixed(1)}px ${(cy + r * Math.sin(a)).toFixed(1)}px`);
    }
  };
  // Inner hole wound clockwise; combined with evenodd against the outer screen box.
  arc(x2 - r, y1 + r, -Math.PI / 2, 0);
  arc(x2 - r, y2 - r, 0, Math.PI / 2);
  arc(x1 + r, y2 - r, Math.PI / 2, Math.PI);
  arc(x1 + r, y1 + r, Math.PI, Math.PI * 1.5);
  pts.push(pts[0]!);
  return `polygon(evenodd, 0px 0px, ${vw}px 0px, ${vw}px ${vh}px, 0px ${vh}px, 0px 0px, ${pts.join(", ")})`;
}

const JELLY_CSS = `
.cj-scrim {
  position: fixed;
  inset: 0;
  background: #000;
  opacity: 0;
  pointer-events: none;
  z-index: 35;
  display: none;
}
.cj-anchor {
  position: relative;
  display: inline-flex;
  justify-content: center;
}
/* Mirror PromptComposer's ppc-stage: no transform, filter, opacity, or
   will-change on the stage so Chromium keeps the real SVG backdrop-filter
   refraction and outer 2px rim light alive. */
.cj-pill-stage {
  position: relative;
  display: inline-flex;
  border-radius: 9999px;
}
.cj-pill {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 25px;
  padding: 2.5px 9px 2.5px 4px;
  border: 0;
  border-radius: 9999px;
  background: transparent;
  cursor: pointer;
  user-select: none;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
}
.cj-pill:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.cj-track {
  position: relative;
  overflow: hidden;
  border-radius: 999px;
  isolation: isolate;
}
.cj-track-mini {
  width: 142px;
  height: 15px;
}
@media (min-width: 640px) {
  .cj-track-mini {
    width: 164px;
  }
}
.cj-track-lg {
  width: 100%;
  height: 30px;
  border-radius: 999px;
}
.cj-bubble {
  position: absolute;
  top: 1px;
  bottom: 1px;
  left: 1px;
  border-radius: inherit;
  overflow: hidden;
  pointer-events: none;
  transform-origin: left center;
}
.cj-bubble-gloss {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background: radial-gradient(125% 155% at 28% 0%, rgba(255, 255, 255, 0.55), rgba(255, 255, 255, 0) 56%);
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.85),
    inset 0 0 0 1px rgba(255, 255, 255, 0.36);
}
.cj-bubble[data-draining="true"] {
  animation: cjJellyBreath 1.1s ease-in-out infinite;
}
@keyframes cjJellyBreath {
  0%, 100% { transform: scaleY(1); }
  50% { transform: scaleY(0.955); }
}
.cj-card {
  position: absolute;
  left: 0;
  top: 0;
  visibility: hidden;
  overflow: hidden;
  pointer-events: none;
  z-index: 44;
  background: transparent;
}
.cj-card-glass-host {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 0;
  pointer-events: none;
}
.cj-cont {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 1;
  padding: 16px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: none;
  color: var(--foreground);
}
.cj-cont::-webkit-scrollbar {
  display: none;
}
@media (prefers-reduced-motion: reduce) {
  .cj-bubble[data-draining="true"] {
    animation: none !important;
  }
}
`;

function ensureJellyCss(): void {
  if (typeof document === "undefined") return;
  const existing = document.getElementById(JELLY_CSS_ID);
  if (existing) {
    existing.textContent = JELLY_CSS;
    return;
  }
  const style = document.createElement("style");
  style.id = JELLY_CSS_ID;
  style.textContent = JELLY_CSS;
  document.head.appendChild(style);
}

function hslToRgb01(hDeg: number, sPct: number, lPct: number): [number, number, number] {
  const h = (((hDeg % 360) + 360) % 360) / 360;
  const s = sPct / 100;
  const l = lPct / 100;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

/** Smoothly maps credit percentage (100% -> 0%) from emerald green -> orange -> red. */
function creditHue(percent: number): number {
  const t = Math.max(0, Math.min(1, percent / 100));
  if (t >= 0.5) {
    // 50%..100% -> orange-amber (36°) up to vivid emerald green (142°)
    return 36 + ((t - 0.5) / 0.5) * 106;
  }
  // 0%..50% -> crimson red (2°) up to orange-amber (36°)
  return 2 + (t / 0.5) * 34;
}

function waterPalette(percent: number) {
  const hue = creditHue(percent);
  const h1 = Math.max(0, hue - 8);
  const h2 = Math.min(155, hue + 8);
  return {
    colorA: hslToRgb01(h1, 80, 40),
    colorB: hslToRgb01(h2, 86, 54),
    colorDeep: hslToRgb01(h1, 82, 26),
  };
}

function jellyBubbleStyle(percent: number): React.CSSProperties {
  const hue = creditHue(percent);
  const h1 = Math.max(0, hue - 8);
  const h2 = Math.min(155, hue + 8);
  return {
    width: `calc(${percent.toFixed(2)}% - 2px)`,
    background: [
      "radial-gradient(125% 155% at 28% 0%, rgba(255, 255, 255, 0.72), rgba(255, 255, 255, 0) 56%)",
      `linear-gradient(90deg, hsla(${h1.toFixed(1)}, 80%, 42%, 0.68) 0%, hsla(${hue.toFixed(1)}, 84%, 50%, 0.82) 62%, hsla(${h2.toFixed(1)}, 86%, 58%, 0.88) 100%)`,
    ].join(", "),
    boxShadow: [
      "inset 0 1px 1px rgba(255, 255, 255, 0.9)",
      `inset 0 -2px 6px hsla(${h1.toFixed(1)}, 85%, 28%, 0.34)`,
      "inset 0 0 0 1px rgba(255, 255, 255, 0.44)",
      `0 4px 14px -5px hsla(${hue.toFixed(1)}, 85%, 40%, 0.58)`,
    ].join(", "),
  };
}

export function CreditJellyGauge({ hidden = false }: { hidden?: boolean }) {
  const t = useT();
  const signedIn = useAuthStore((s) => s.signedIn);
  const authReady = useAuthStore((s) => s.ready);
  const profile = useAuthStore((s) => s.profile);
  const user = useAuthStore((s) => s.user);
  const tokens = useAuthStore((s) => s.tokens);
  const loadTokens = useAuthStore((s) => s.loadTokens);
  const streaming = useChatsStore((s) => s.streaming);
  const theme = useSettingsStore((s) => s.settings.theme);
  const view = useUiStore((s) => s.view);
  const wizardOpen = useUiStore((s) => s.wizardOpen);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const authOpen = useUiStore((s) => s.authOpen);
  const paletteOpen = useUiStore((s) => s.paletteOpen);
  const searchOpen = useUiStore((s) => s.searchOpen);
  const navSearchOpen = useUiStore((s) => s.navSearchOpen);
  const setAuthOpen = useUiStore((s) => s.setAuthOpen);
  const setAuthGateOpen = useUiStore((s) => s.setAuthGateOpen);

  const [expanded, setExpanded] = React.useState(false);
  const [cardDims, setCardDims] = React.useState({ width: 344, height: 320 });

  const layerRef = React.useRef<HTMLDivElement | null>(null);
  const anchorRef = React.useRef<HTMLDivElement | null>(null);
  const pillStageRef = React.useRef<HTMLDivElement | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const guestStageRef = React.useRef<HTMLDivElement | null>(null);
  const guestTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const cardRef = React.useRef<HTMLDivElement | null>(null);
  const glassHostRef = React.useRef<HTMLDivElement | null>(null);
  const contRef = React.useRef<HTMLDivElement | null>(null);
  const scrimRef = React.useRef<HTMLDivElement | null>(null);
  const miniWaterControlRef = React.useRef<((paused: boolean) => void) | null>(null);

  const manageBtnJellyRef = useJellyStretch<HTMLButtonElement>();

  const stateRef = React.useRef<"closed" | "opening" | "open" | "closing">("closed");
  const animRef = React.useRef<{ kind: "open" | "close"; t0: number } | null>(null);
  const queuedRef = React.useRef(false);
  const closeQueuedRef = React.useRef(false);
  const morphRafRef = React.useRef(0);
  const sizeRef = React.useRef({ width: 344, height: 320, triggerW: 218, triggerH: 25 });
  const apiRef = React.useRef<{ toggle: () => void; close: () => void }>({
    toggle: () => undefined,
    close: () => undefined,
  });

  React.useEffect(() => {
    ensureJellyCss();
  }, []);

  const baseCredits = profile?.credits ?? 0;
  const maxCredits = Math.max(DEFAULT_SIGNUP_CREDITS, baseCredits);

  // Smooth real-time displayed credit value that drains fluidly while the model
  // streams a response, then settles seamlessly onto the deducted balance.
  const [displayedCredits, setDisplayedCredits] = React.useState(baseCredits);
  const displayedRef = React.useRef(baseCredits);
  const streamingRef = React.useRef(streaming);
  streamingRef.current = streaming;
  const baseCreditsRef = React.useRef(baseCredits);
  baseCreditsRef.current = baseCredits;

  React.useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();

    const step = (now: number) => {
      const dt = Math.min(0.06, Math.max(0.004, (now - lastTime) / 1000));
      lastTime = now;

      const s = streamingRef.current;
      const base = baseCreditsRef.current;

      let target = base;
      if (s && base > 0) {
        const chars = s.content.length + s.reasoning.length;
        const elapsedSec = Math.max(0, (Date.now() - s.startedAt) / 1000);
        const timeDrain = 0.2 * (1 - Math.exp(-elapsedSec / 2.2));
        const contentDrain = 0.76 * (1 - Math.exp(-chars / 380));
        const liveDrain = Math.min(0.96, timeDrain + contentDrain);
        target = Math.max(0, base - liveDrain);
      }

      const cur = displayedRef.current;
      const diff = target - cur;
      const speed = s ? 7.5 : 9.5;
      const next = Math.abs(diff) < 0.0015 && !s ? target : cur + diff * Math.min(1, dt * speed);
      displayedRef.current = next;
      setDisplayedCredits(next);

      if (s || Math.abs(target - next) > 0.0015) {
        rafId = requestAnimationFrame(step);
      }
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [baseCredits, streaming?.messageId, Boolean(streaming)]);

  // CornerMenu-matched center-anchored morph engine.
  // Re-bind whenever the signed-in DOM mounts (including after `hidden` flips
  // true -> false when inline search opens and closes) so refs never go stale.
  const isSignedInReady = signedIn && Boolean(profile);
  const isGaugeMounted = !hidden && isSignedInReady;
  const isGuestMounted = !hidden && authReady && !isSignedInReady;

  React.useEffect(() => {
    if (!isGuestMounted) return;
    const stage = guestStageRef.current;
    const btn = guestTriggerRef.current;
    if (!stage || !btn) return;
    const engine = new JellyStretchEngine(btn, stage);
    return () => engine.destroy();
  }, [isGuestMounted]);

  React.useEffect(() => {
    if (!isGaugeMounted) {
      cancelAnimationFrame(morphRafRef.current);
      morphRafRef.current = 0;
      animRef.current = null;
      queuedRef.current = false;
      closeQueuedRef.current = false;
      stateRef.current = "closed";
      setExpanded(false);
      return;
    }
    const layer = layerRef.current;
    const anchor = anchorRef.current;
    const pillStage = pillStageRef.current;
    const trigger = triggerRef.current;
    const card = cardRef.current;
    const glassHost = glassHostRef.current;
    const cont = contRef.current;
    const scrim = scrimRef.current;
    if (!layer || !anchor || !pillStage || !trigger || !card || !glassHost || !cont || !scrim) return;

    let measured = false;
    let settledTop = 0;

    const setOpenDom = (isOpen: boolean) => {
      trigger.setAttribute("aria-expanded", String(isOpen));
      card.style.pointerEvents = isOpen ? "auto" : "none";
      // Keep scrim pointer-events: none so page scrolling is never blocked;
      // outside pointerdown closes the card smoothly instead.
      scrim.style.pointerEvents = "none";
      card.inert = !isOpen;
    };

    const setOpen = (isOpen: boolean) => {
      setOpenDom(isOpen);
      React.startTransition(() => setExpanded(isOpen));
    };

    const measure = () => {
      const rect = anchor.getBoundingClientRect();
      const triggerW = pillStage.offsetWidth || 218;
      const triggerH = pillStage.offsetHeight || 25;
      const width = Math.min(344, window.innerWidth - 32);
      cont.style.width = `${width}px`;
      cont.style.height = "auto";
      const naturalH = Math.ceil(cont.scrollHeight) || 310;
      const budget = Math.max(240, window.innerHeight - Math.max(20, rect.top) - 20);
      const height = Math.min(naturalH, budget);
      cont.style.height = `${height}px`;
      glassHost.style.width = `${width}px`;
      glassHost.style.height = `${height}px`;
      settledTop = Math.max(0, (734 - F[3] - 45) * (height / 595) * 0.45);
      card.style.left = `${((triggerW - width) / 2).toFixed(2)}px`;
      card.style.top = `${settledTop.toFixed(2)}px`;
      card.style.width = `${width}px`;
      card.style.height = `${height}px`;
      card.style.borderRadius = `${FINAL_CARD_RADIUS}px`;
      card.style.transformOrigin = "50% 0%";
      sizeRef.current = { width, height, triggerW, triggerH };
      measured = true;
      setCardDims((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };

    const updateScrimCutout = (radius: number, active: boolean) => {
      if (!active) {
        scrim.style.clipPath = "";
        return;
      }
      scrim.style.clipPath = scrimCutoutClip(card.getBoundingClientRect(), radius);
    };

    // Jelly stretch physics on both the closed credit pill and the opened
    // credit drawer card, coordinated with the CornerMenu morph lifecycle so
    // neither animation ever fights the other.
    const pillJelly = new JellyStretchEngine(trigger, pillStage, {
      enabled: true,
    });
    const cardJelly = new JellyStretchEngine(card, card, {
      enabled: false,
      bounce: 0.55,
      softness: 0.95,
      dragReachX: 20,
      dragReachY: 16,
      dragStretch: 0.0045,
      dragBreak: 90,
      ignoreInteractiveChildren: true,
      onFrame: () => {
        if (stateRef.current === "open") {
          updateScrimCutout(FINAL_CARD_RADIUS, true);
        }
      },
    });

    const clearSettledInlineLocks = (isOpen: boolean) => {
      card.style.willChange = "";
      card.style.contain = "";
      scrim.style.willChange = "";
      if (isOpen) {
        // Keep card visible with no inline opacity/transform and overflow:visible
        // so Chromium renders the Apple Tahoe SVG refraction and 2px outer rim.
        layer.style.zIndex = "42";
        scrim.style.display = "block";
        scrim.style.opacity = "0.38";
        card.style.visibility = "visible";
        card.style.transform = "";
        card.style.opacity = "";
        card.style.overflow = "visible";
        cont.style.opacity = "";
        pillStage.style.visibility = "hidden";
        pillStage.style.opacity = "";
        updateScrimCutout(FINAL_CARD_RADIUS, true);
        pillJelly.updateOptions({ enabled: false });
        cardJelly.updateOptions({
          enabled: true,
          bounce: 0.55,
          softness: 0.95,
          dragReachX: 20,
          dragReachY: 16,
          dragStretch: 0.0045,
          dragBreak: 90,
          ignoreInteractiveChildren: true,
          onFrame: () => {
            if (stateRef.current === "open") {
              updateScrimCutout(FINAL_CARD_RADIUS, true);
            }
          },
        });
      } else {
        cardJelly.updateOptions({ enabled: false });
        layer.style.zIndex = "10";
        card.style.visibility = "hidden";
        card.style.transform = "";
        card.style.opacity = "";
        card.style.overflow = "hidden";
        scrim.style.opacity = "0";
        scrim.style.clipPath = "";
        scrim.style.display = "none";
        // Restore pillStage with NO inline opacity so its LiquidGlass
        // backdrop-filter refracts at full crispness in the closed state.
        pillStage.style.visibility = "";
        pillStage.style.opacity = "";
        pillStage.style.pointerEvents = "auto";
        pillJelly.updateOptions({ enabled: true });
        miniWaterControlRef.current?.(false);
      }
    };

    /** GPU-composited frame mapper: only mutates transform & opacity (0 layout/blur/clip-path thrashing). */
    const applyM = (v: number[]) => {
      const L = v[1];
      const T = 734 - v[4];
      const R = v[3];
      const B = 734 - v[2];
      const s = v[7];
      const co = v[11];
      const { width: FW, height: FH, triggerW: TW, triggerH: TH } = sizeRef.current;
      const ky = FH / 595;
      const progW = Math.max(0, (R - L - 144) / 412);
      const progH = Math.max(0, (B - T - 144) / 451);
      const w = Math.max(TW * 0.7, TW + (FW - TW) * progW);
      const h = Math.max(TH, TH + (FH - TH) * progH);
      const cardTop = Math.max(0, (T - 45) * ky * 0.45);
      const sx = Math.max(0.08, w / Math.max(1, FW));
      const sy = Math.max(0.08, h / Math.max(1, FH));
      const ty = cardTop - settledTop;

      card.style.visibility = co > 0.005 ? "visible" : "hidden";
      card.style.overflow = "hidden";
      card.style.transform = `translate3d(0,${ty.toFixed(2)}px,0) scale(${sx.toFixed(4)},${sy.toFixed(4)})`;
      card.style.opacity = co < 0.999 ? String(co) : "";
      scrim.style.opacity = String(0.38 * co);
      cont.style.opacity = String(Math.max(0, Math.min(1, (s - 0.3) * 2)));

      pillStage.style.visibility = v[13] <= 0.01 ? "hidden" : "visible";
      pillStage.style.opacity = String(v[13]);
      pillStage.style.pointerEvents = co > 0.1 ? "none" : "auto";
    };

    const tick = (now: number) => {
      morphRafRef.current = 0;
      const anim = animRef.current;
      if (!anim) return;
      const k = anim.kind === "open" ? OPEN : CLOSE;
      const f = k[0][0] + ((now - anim.t0) / 1000) * (1000 / FRAME_MS);
      if (f >= k[k.length - 1][0]) {
        applyM(k[k.length - 1]);
        const isOpen = anim.kind === "open";
        stateRef.current = isOpen ? "open" : "closed";
        clearSettledInlineLocks(isOpen);
        setOpen(isOpen);
        if (isOpen) void loadTokens();
        animRef.current = null;
        if (isOpen && closeQueuedRef.current) {
          closeQueuedRef.current = false;
          start("close");
          return;
        }
        if (queuedRef.current) {
          queuedRef.current = false;
          toggle();
        }
      } else {
        applyM(sample(k, f));
        morphRafRef.current = requestAnimationFrame(tick);
      }
    };

    const start = (kind: "open" | "close") => {
      pillJelly.updateOptions({ enabled: false });
      cardJelly.updateOptions({ enabled: false });
      // Pause mini-pill WebGL shader during the morph so 0 WebGL shaders compete with GPU compositing.
      miniWaterControlRef.current?.(true);
      if (kind === "open") {
        layer.style.zIndex = "42";
        scrim.style.display = "block";
        scrim.style.clipPath = "";
        if (!measured) measure();
      } else {
        scrim.style.clipPath = "";
      }
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const k = kind === "open" ? OPEN : CLOSE;
        applyM(k[k.length - 1]);
        const isOpen = kind === "open";
        stateRef.current = isOpen ? "open" : "closed";
        clearSettledInlineLocks(isOpen);
        setOpen(isOpen);
        if (isOpen) void loadTokens();
        return;
      }
      card.style.willChange = "transform, opacity";
      card.style.contain = "layout style paint";
      scrim.style.willChange = "opacity";
      animRef.current = { kind, t0: performance.now() };
      stateRef.current = kind === "open" ? "opening" : "closing";
      if (kind === "open") {
        // Flip DOM interactivity immediately; defer React state + network fetch until settled.
        setOpenDom(true);
      } else {
        card.style.pointerEvents = "none";
        scrim.style.pointerEvents = "none";
      }
      if (!morphRafRef.current) morphRafRef.current = requestAnimationFrame(tick);
    };

    const show = () => {
      if (animRef.current && morphRafRef.current) {
        queuedRef.current = true;
        return;
      }
      animRef.current = null;
      if (stateRef.current !== "open" || card.style.visibility !== "visible") {
        stateRef.current = "closed";
        closeQueuedRef.current = false;
        queuedRef.current = false;
        start("open");
      }
    };

    const hide = () => {
      if (animRef.current && morphRafRef.current) {
        if (animRef.current.kind === "open") closeQueuedRef.current = true;
        return;
      }
      animRef.current = null;
      if (stateRef.current === "open" || stateRef.current === "opening") start("close");
    };

    const toggle = () => {
      // Self-heal if DOM visibility ever drifted out of sync with stateRef.
      if (!animRef.current && stateRef.current === "open" && card.style.visibility !== "visible") {
        stateRef.current = "closed";
      }
      if (!morphRafRef.current && animRef.current) {
        animRef.current = null;
        stateRef.current = card.style.visibility === "visible" ? "open" : "closed";
      }
      if (stateRef.current === "closed") show();
      else if (stateRef.current === "open") hide();
      else queuedRef.current = true;
    };

    apiRef.current = { toggle, close: hide };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (stateRef.current !== "open" && stateRef.current !== "opening") return;
      event.preventDefault();
      hide();
    };

    const onResize = () => {
      if (stateRef.current === "open") {
        measure();
        clearSettledInlineLocks(true);
      } else {
        measured = false;
      }
    };

    const detachOutside = attachOutsideDismiss({
      isActive: () => stateRef.current === "open" || stateRef.current === "opening",
      isInside: (target, path) => anchor.contains(target) || Boolean(path && path.includes(anchor)),
      onDismiss: hide,
    });

    measure();
    applyM(OPEN[0]);
    clearSettledInlineLocks(false);
    setOpen(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);

    return () => {
      detachOutside();
      pillJelly.destroy();
      cardJelly.destroy();
      cancelAnimationFrame(morphRafRef.current);
      morphRafRef.current = 0;
      animRef.current = null;
      queuedRef.current = false;
      closeQueuedRef.current = false;
      stateRef.current = "closed";
      apiRef.current = { toggle: () => undefined, close: () => undefined };
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
    };
  }, [isGaugeMounted, loadTokens]);

  // Close the credit card cleanly whenever a modal opens or the user switches view.
  React.useEffect(() => {
    if (wizardOpen || settingsOpen || authOpen || paletteOpen || searchOpen || navSearchOpen) {
      apiRef.current.close();
    }
  }, [wizardOpen, settingsOpen, authOpen, paletteOpen, searchOpen, navSearchOpen]);

  React.useEffect(() => {
    apiRef.current.close();
  }, [view]);

  if (hidden || (!authReady && !signedIn)) return null;

  const tone: "dark" | "light" = theme === "dark" ? "dark" : "light";
  const isDraining = Boolean(streaming && baseCredits > 0);
  const clampedCredits = Math.max(0, Math.min(maxCredits, displayedCredits));
  const percent = maxCredits > 0 ? Math.max(0, Math.min(100, (clampedCredits / maxCredits) * 100)) : 0;
  const hue = creditHue(percent);
  const accentColor = tone === "dark" ? `hsl(${hue.toFixed(1)} 82% 62%)` : `hsl(${hue.toFixed(1)} 78% 40%)`;
  const bubbleStyle = jellyBubbleStyle(percent);
  const palette = waterPalette(percent);
  const usedCredits = Math.max(0, maxCredits - clampedCredits);
  const streamedChars = streaming ? streaming.content.length + streaming.reasoning.length : 0;

  if (!signedIn || !profile) {
    return (
      <div className="pointer-events-none absolute inset-x-0 top-[calc(100%+7px)] z-10 flex justify-center">
        <div ref={guestStageRef} className="cj-pill-stage pointer-events-auto">
          <LiquidGlass
            className="absolute inset-0 z-0 pointer-events-none"
            style={{ borderRadius: 9999 }}
            aria-hidden="true"
            material="clear"
            appearance={tone}
            refraction={22}
            bezel={12}
            blur={2}
            saturation={1.4}
            brightness={1.05}
            dispersion={0}
            fallbackBlur={10}
            mode="auto"
            interactive={false}
            motion="full"
            fluid={false}
          />
          <button
            ref={guestTriggerRef}
            type="button"
            onClick={() => setAuthGateOpen(true)}
            className={cn(
              "cj-pill text-[11px] font-medium",
              tone === "dark" ? "text-[#F1F7FF]" : "text-[#0B132B]",
            )}
            title={t("auth.signInGetCredits")}
          >
            <span
              dir="ltr"
              className={cn(
                "cj-track h-[15px] w-[52px]",
                tone === "dark" ? "bg-white/[0.06]" : "bg-black/[0.06]",
              )}
            />
            <span className="inline-flex items-center gap-1.5 pe-1">
              <Lock className="size-3 text-[var(--primary)]" />
              <span className="whitespace-nowrap">{t("auth.signInGetCredits")}</span>
            </span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div ref={scrimRef} className="cj-scrim" aria-hidden="true" />
      <div
        ref={layerRef}
        className="pointer-events-none absolute inset-x-0 top-[calc(100%+7px)] z-10 flex justify-center"
      >
        <div ref={anchorRef} className="cj-anchor pointer-events-auto">
          {/* Closed pill using the exact same stage + LiquidGlass sibling pattern as PromptComposer */}
          <div ref={pillStageRef} className="cj-pill-stage">
            <LiquidGlass
              className="absolute inset-0 z-0 pointer-events-none"
              style={{ borderRadius: 9999 }}
              aria-hidden="true"
              material="clear"
              appearance={tone}
              refraction={22}
              bezel={12}
              blur={2}
              saturation={1.4}
              brightness={1.05}
              dispersion={0}
              fallbackBlur={10}
              mode="auto"
              interactive={false}
              motion="full"
              fluid={false}
            />
            <button
              ref={triggerRef}
              type="button"
              aria-expanded={expanded}
              aria-haspopup="dialog"
              aria-label={t("auth.creditsDetails")}
              onMouseEnter={() => void loadAuthPanel()}
              onClick={() => apiRef.current.toggle()}
              className={cn(
                "cj-pill",
                tone === "dark" ? "text-[#F1F7FF]" : "text-[#0B132B]",
              )}
            >
              {/* Clean 0-100 water-ripple credit bar */}
              <span
                dir="ltr"
                className={cn(
                  "cj-track cj-track-mini",
                  tone === "dark" ? "bg-white/[0.08]" : "bg-black/[0.06]",
                )}
              >
                {percent > 0.25 ? (
                  <span
                    className="cj-bubble"
                    data-draining={isDraining ? "true" : "false"}
                    style={bubbleStyle}
                  >
                    <WaterRippleFill
                      colorA={palette.colorA}
                      colorB={palette.colorB}
                      colorDeep={palette.colorDeep}
                      scale={5.2}
                      illumination={isDraining ? 0.38 : 0.28}
                      surfaceDistortion={0.05}
                      waterDistortion={0.03}
                      speed={isDraining ? 2.2 : 1.0}
                      active={!expanded}
                      controlRef={miniWaterControlRef}
                    />
                    <span className="cj-bubble-gloss" aria-hidden="true" />
                  </span>
                ) : null}
              </span>

              {/* Live numeric readout */}
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold tabular-nums leading-none">
                {isDraining ? (
                  <span
                    className="size-1.5 animate-pulse rounded-full"
                    style={{
                      backgroundColor: accentColor,
                      boxShadow: `0 0 8px ${accentColor}`,
                    }}
                  />
                ) : (
                  <Coins className="size-3" style={{ color: accentColor }} />
                )}
                <span dir="ltr">
                  {isDraining ? clampedCredits.toFixed(2) : Math.round(clampedCredits)}
                  <span className="opacity-55">/{maxCredits}</span>
                </span>
                <ChevronDown
                  className={cn(
                    "size-3 opacity-60 transition-transform duration-200",
                    expanded && "rotate-180 opacity-95",
                  )}
                />
              </span>
            </button>
          </div>

          {/* Center-morphed details card with persistent Apple Tahoe LiquidGlass material */}
          <div
            ref={cardRef}
            role="dialog"
            aria-label={t("auth.creditsDetails")}
            className="cj-card"
          >
            <div
              ref={glassHostRef}
              className="cj-card-glass-host"
              style={{ width: cardDims.width, height: cardDims.height }}
              aria-hidden="true"
            >
              <LiquidGlass
                className="absolute inset-0 z-0 pointer-events-none"
                style={{ borderRadius: FINAL_CARD_RADIUS }}
                aria-hidden="true"
                material="clear"
                appearance={tone}
                refraction={32}
                bezel={32}
                blur={2}
                saturation={1.4}
                brightness={1.05}
                dispersion={0}
                fallbackBlur={10}
                mode="auto"
                interactive={false}
                motion="full"
                fluid={false}
              />
            </div>
            <div ref={contRef} className="cj-cont">
              {/* Header row */}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] opacity-70">
                    <Coins className="size-3.5" style={{ color: accentColor }} />
                    {t("auth.creditsLabel")}
                  </div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span dir="ltr" className="text-[22px] font-bold tracking-tight tabular-nums leading-none">
                      {isDraining ? clampedCredits.toFixed(2) : Number(baseCredits.toFixed(2))}
                      <span className="text-[13px] font-medium opacity-55"> / {Number(maxCredits.toFixed(2))}</span>
                    </span>
                    <span
                      dir="ltr"
                      className="rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums"
                      style={{
                        backgroundColor: `hsla(${hue.toFixed(1)}, 82%, 50%, 0.18)`,
                        color: accentColor,
                      }}
                    >
                      {Math.round(percent)}%
                    </span>
                  </div>
                </div>

                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-medium",
                    isDraining
                      ? "border-amber-400/40 bg-amber-500/15 text-amber-600 dark:text-amber-300"
                      : tone === "dark"
                        ? "border-white/15 bg-white/8 text-white/80"
                        : "border-black/10 bg-black/5 text-slate-700",
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      isDraining
                        ? "animate-pulse bg-amber-400"
                        : baseCredits > 0
                          ? "bg-emerald-500"
                          : "bg-red-500",
                    )}
                  />
                  {isDraining
                    ? t("auth.creditsDraining")
                    : baseCredits > 0
                      ? t("auth.creditsReady")
                      : "0%"}
                </span>
              </div>

              {/* Clean large 0-100 liquid jelly meter */}
              <div className="mt-3.5" dir="ltr">
                <div
                  className={cn(
                    "cj-track cj-track-lg border",
                    tone === "dark"
                      ? "border-white/15 bg-white/[0.06]"
                      : "border-black/10 bg-black/[0.05]",
                  )}
                >
                  {percent > 0.25 ? (
                    <span
                      className="cj-bubble"
                      data-draining={isDraining ? "true" : "false"}
                      style={bubbleStyle}
                    >
                      {expanded ? (
                        <WaterRippleFill
                          colorA={palette.colorA}
                          colorB={palette.colorB}
                          colorDeep={palette.colorDeep}
                          scale={4.4}
                          illumination={isDraining ? 0.38 : 0.28}
                          surfaceDistortion={0.05}
                          waterDistortion={0.03}
                          speed={isDraining ? 2.2 : 1.0}
                        />
                      ) : null}
                      <span className="cj-bubble-gloss" aria-hidden="true" />
                    </span>
                  ) : null}
                </div>

                <div className="mt-1.5 flex items-center justify-between px-1 text-[10px] font-medium tabular-nums opacity-55">
                  <span>0%</span>
                  <span>25%</span>
                  <span>50%</span>
                  <span>75%</span>
                  <span>100%</span>
                </div>
              </div>

              {/* Telemetry stats */}
              <div className="mt-3.5 grid grid-cols-2 gap-2">
                <div
                  className={cn(
                    "rounded-xl border px-3 py-2",
                    tone === "dark"
                      ? "border-white/12 bg-white/[0.05]"
                      : "border-black/8 bg-black/[0.03]",
                  )}
                >
                  <div className="flex items-center gap-1 text-[10.5px] opacity-65">
                    <Zap className="size-3 text-amber-500" />
                    {t("auth.creditsUsed")}
                  </div>
                  <div dir="ltr" className="mt-0.5 text-[13px] font-semibold tabular-nums">
                    {isDraining ? usedCredits.toFixed(2) : Number(Math.max(0, maxCredits - baseCredits).toFixed(2))} / {Number(maxCredits.toFixed(2))}
                  </div>
                  {isDraining && streamedChars > 0 ? (
                    <div dir="ltr" className="text-[10px] text-amber-500 tabular-nums">
                      ~{Math.max(1, Math.round(streamedChars / 4))} tok
                    </div>
                  ) : null}
                </div>

                <div
                  className={cn(
                    "rounded-xl border px-3 py-2",
                    tone === "dark"
                      ? "border-white/12 bg-white/[0.05]"
                      : "border-black/8 bg-black/[0.03]",
                  )}
                >
                  <div className="flex items-center gap-1 text-[10.5px] opacity-65">
                    <KeyRound className="size-3 text-[var(--primary)]" />
                    {t("auth.tokensTitle")}
                  </div>
                  <div className="mt-0.5 text-[13px] font-semibold tabular-nums">
                    {tokens.length}
                  </div>
                </div>
              </div>

              {/* Hint */}
              <p className="mt-3 text-[11px] leading-relaxed opacity-70">
                {baseCredits > 0 ? t("auth.creditsHint") : t("auth.creditsEmpty")}
              </p>

              <div
                className={cn(
                  "mt-3 flex items-center justify-between gap-2 border-t pt-3",
                  tone === "dark" ? "border-white/12" : "border-black/10",
                )}
              >
                <div className="min-w-0">
                  <div className="truncate text-[11.5px] font-medium">
                    {user?.name || user?.email || t("auth.account")}
                  </div>
                  {user?.email && user?.name ? (
                    <div className="truncate text-[10.5px] opacity-60">{user.email}</div>
                  ) : null}
                </div>

                <button
                  ref={manageBtnJellyRef}
                  type="button"
                  onClick={() => {
                    apiRef.current.close();
                    setAuthOpen(true);
                  }}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors",
                    tone === "dark"
                      ? "border-white/18 bg-white/12 text-white hover:bg-white/20"
                      : "border-black/12 bg-black/8 text-slate-900 hover:bg-black/14",
                  )}
                >
                  <KeyRound className="size-3" />
                  {t("auth.creditsManage")}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
