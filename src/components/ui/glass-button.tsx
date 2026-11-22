// Reusable Orange Glass Button adapted from "Glass Button – Orange.html"
// for the chat composer controls (circular icon + compact pill variants).
import * as React from "react";
import { cn } from "@/lib/utils";

const GLASS_BTN_CSS_ID = "oh-orange-glass-button-css";

const GLASS_BTN_CSS = `
@property --ogb-angle-1 { syntax: "<angle>"; inherits: false; initial-value: -75deg; }
@property --ogb-angle-2 { syntax: "<angle>"; inherits: false; initial-value: -45deg; }

.ogb-wrap {
  --ogb-tint: oklch(0.65 0.24 289);
  --ogb-k: 1.3;
  --ogb-anim-time: 0.4s;
  --ogb-anim-ease: cubic-bezier(0.25, 1, 0.5, 1);
  --ogb-border-width: clamp(1px, 0.0625em, 2px);
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  min-width: 0;
  z-index: 2;
  border-radius: 9999px;
  vertical-align: middle;
  transform-style: preserve-3d;
  transition: transform var(--ogb-anim-time) var(--ogb-anim-ease);
}

:root[data-accent="ember"] .ogb-wrap {
  --ogb-tint: oklch(0.73 0.2 50);
}

.ogb-wrap.ogb-active {
  --ogb-k: 1.7;
}

.ogb-wrap:has(> .ogb-btn:active:not(:disabled)) {
  transform: rotateX(22deg);
}

.ogb-wrap > .ogb-shadow {
  --ogb-cutoff: 1.6em;
  position: absolute;
  width: calc(100% + var(--ogb-cutoff));
  height: calc(100% + var(--ogb-cutoff));
  top: calc(0% - var(--ogb-cutoff) / 2);
  left: calc(0% - var(--ogb-cutoff) / 2);
  border-radius: 9999px;
  pointer-events: none;
  filter: blur(clamp(2px, 0.125em, 10px));
  transition: filter var(--ogb-anim-time) var(--ogb-anim-ease);
  z-index: 0;
}

.ogb-wrap > .ogb-shadow::after {
  content: "";
  position: absolute;
  box-sizing: border-box;
  border-radius: 9999px;
  padding: 0.125em;
  width: calc(100% - var(--ogb-cutoff) - 0.2em);
  height: calc(100% - var(--ogb-cutoff) - 0.2em);
  top: calc(var(--ogb-cutoff) - 0.45em);
  left: calc(var(--ogb-cutoff) - 0.7em);
  opacity: 0.95;
  transition: all var(--ogb-anim-time) var(--ogb-anim-ease);
  background: linear-gradient(
    180deg,
    oklch(from var(--ogb-tint) l c h / calc(34% * var(--ogb-k))),
    oklch(from var(--ogb-tint) l c h / calc(14% * var(--ogb-k)))
  );
  -webkit-mask-image: linear-gradient(#000 0 0), linear-gradient(#000 0 0);
  mask-image: linear-gradient(#000 0 0), linear-gradient(#000 0 0);
  -webkit-mask-clip: content-box, border-box;
  mask-clip: content-box, border-box;
  -webkit-mask-origin: content-box, border-box;
  mask-origin: content-box, border-box;
  -webkit-mask-composite: xor;
  mask-composite: exclude;
}

.ogb-wrap > .ogb-btn {
  position: relative;
  z-index: 1;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  max-width: 100%;
  border: 0;
  padding: 0;
  margin: 0;
  font: inherit;
  border-radius: 9999px;
  isolation: isolate;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  -webkit-backdrop-filter: blur(clamp(2px, 0.16em, 6px));
  backdrop-filter: blur(clamp(2px, 0.16em, 6px));
  transition: all var(--ogb-anim-time) var(--ogb-anim-ease);
  background:
    linear-gradient(
      -75deg,
      oklch(from var(--ogb-tint) l c h / calc(20% * var(--ogb-k))),
      oklch(from var(--ogb-tint) l c h / calc(38% * var(--ogb-k))),
      oklch(from var(--ogb-tint) l c h / calc(20% * var(--ogb-k)))
    ),
    linear-gradient(
      -75deg,
      oklch(from var(--background) l c h / 6%),
      oklch(from var(--background) l c h / 20%),
      oklch(from var(--background) l c h / 6%)
    );
  box-shadow:
    inset 0 0.125em 0.125em oklch(from var(--foreground) l c h / 6%),
    inset 0 -0.125em 0.14em oklch(from var(--ogb-tint) l c h / calc(32% * var(--ogb-k))),
    0 0.22em 0.18em -0.1em oklch(from var(--ogb-tint) l c h / calc(36% * var(--ogb-k))),
    0 0 0.1em 0.2em inset oklch(from var(--background) l c h / 16%),
    0 0 oklch(from var(--background) l c h);
}

.ogb-wrap > .ogb-btn:hover:not(:disabled),
.ogb-wrap > .ogb-btn[aria-expanded="true"] {
  -webkit-backdrop-filter: blur(0.05em);
  backdrop-filter: blur(0.05em);
  box-shadow:
    inset 0 0.125em 0.125em oklch(from var(--foreground) l c h / 6%),
    inset 0 -0.125em 0.14em oklch(from var(--ogb-tint) l c h / calc(42% * var(--ogb-k))),
    0 0.16em 0.08em -0.08em oklch(from var(--ogb-tint) l c h / calc(42% * var(--ogb-k))),
    0 0 0.06em 0.12em inset oklch(from var(--background) l c h / 42%),
    0 0 oklch(from var(--background) l c h);
  transform: scale(0.975);
}

.ogb-wrap > .ogb-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ogb-wrap > .ogb-btn:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

.ogb-wrap > .ogb-btn > .ogb-inner {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 0;
  max-width: 100%;
  user-select: none;
  letter-spacing: -0.01em;
  color: oklch(from var(--foreground) l c h / 92%);
  text-shadow: 0 0.16em 0.06em oklch(from var(--foreground) l c h / 10%);
  transition: all var(--ogb-anim-time) var(--ogb-anim-ease);
}

.ogb-wrap > .ogb-btn:hover:not(:disabled) > .ogb-inner {
  color: var(--foreground);
  text-shadow: 0.025em 0.025em 0.025em oklch(from var(--foreground) l c h / 12%);
}

.ogb-wrap > .ogb-btn > .ogb-inner::after {
  content: "";
  position: absolute;
  display: block;
  box-sizing: border-box;
  width: calc(100% - var(--ogb-border-width));
  height: calc(100% - var(--ogb-border-width));
  top: calc(0% + var(--ogb-border-width) / 2);
  left: calc(0% + var(--ogb-border-width) / 2);
  border-radius: 9999px;
  background: linear-gradient(
    var(--ogb-angle-2),
    transparent 0%,
    oklch(from var(--background) l c h / 46%) 40% 50%,
    transparent 55%
  );
  background-position: 0%;
  background-size: 200% 200%;
  z-index: 3;
  mix-blend-mode: screen;
  pointer-events: none;
  overflow: clip;
  transition:
    background-position calc(var(--ogb-anim-time) * 1.25) var(--ogb-anim-ease),
    --ogb-angle-2 calc(var(--ogb-anim-time) * 1.25) var(--ogb-anim-ease);
}

.ogb-wrap > .ogb-btn:hover:not(:disabled) > .ogb-inner::after,
.ogb-wrap > .ogb-btn[aria-expanded="true"] > .ogb-inner::after {
  background-position: 25%;
}

.ogb-wrap > .ogb-btn:active:not(:disabled) > .ogb-inner::after {
  --ogb-angle-2: -15deg;
  background-position: 50% 15%;
}

.ogb-wrap > .ogb-btn::after {
  content: "";
  position: absolute;
  z-index: 1;
  box-sizing: border-box;
  inset: auto;
  width: calc(100% + var(--ogb-border-width));
  height: calc(100% + var(--ogb-border-width));
  top: calc(0% - var(--ogb-border-width) / 2);
  left: calc(0% - var(--ogb-border-width) / 2);
  padding: var(--ogb-border-width);
  border-radius: 9999px;
  pointer-events: none;
  background:
    conic-gradient(
      from var(--ogb-angle-1) at 50% 50%,
      oklch(from var(--ogb-tint) l c h / calc(62% * var(--ogb-k))) 0%,
      transparent 5% 40%,
      oklch(from var(--foreground) l c h / 48%) 50%,
      transparent 60% 95%,
      oklch(from var(--ogb-tint) l c h / calc(62% * var(--ogb-k))) 100%
    ),
    linear-gradient(
      180deg,
      oklch(from var(--ogb-tint) l c h / calc(52% * var(--ogb-k))),
      oklch(from var(--background) l c h / 40%)
    );
  transition: all var(--ogb-anim-time) var(--ogb-anim-ease), --ogb-angle-1 0.5s ease;
  box-shadow: inset 0 0 0 calc(var(--ogb-border-width) / 2) oklch(from var(--background) l c h / 42%);
  -webkit-mask-image: linear-gradient(#000 0 0), linear-gradient(#000 0 0);
  mask-image: linear-gradient(#000 0 0), linear-gradient(#000 0 0);
  -webkit-mask-clip: content-box, border-box;
  mask-clip: content-box, border-box;
  -webkit-mask-origin: content-box, border-box;
  mask-origin: content-box, border-box;
  -webkit-mask-composite: xor;
  mask-composite: exclude;
}

.ogb-wrap > .ogb-btn:hover:not(:disabled)::after,
.ogb-wrap > .ogb-btn[aria-expanded="true"]::after {
  --ogb-angle-1: -125deg;
}

.ogb-wrap > .ogb-btn:active:not(:disabled)::after {
  --ogb-angle-1: -75deg;
}

.ogb-wrap:has(> .ogb-btn:hover:not(:disabled)) > .ogb-shadow {
  filter: blur(clamp(2px, 0.0625em, 6px));
}

.ogb-wrap:has(> .ogb-btn:hover:not(:disabled)) > .ogb-shadow::after {
  top: calc(var(--ogb-cutoff) - 0.72em);
  opacity: 1;
}

.ogb-wrap:has(> .ogb-btn:active:not(:disabled)) > .ogb-shadow {
  filter: blur(clamp(2px, 0.125em, 10px));
}

.ogb-wrap:has(> .ogb-btn:active:not(:disabled)) > .ogb-shadow::after {
  top: calc(var(--ogb-cutoff) - 0.45em);
  opacity: 0.75;
}

.ogb-wrap:has(> .ogb-btn:active:not(:disabled)) > .ogb-btn {
  box-shadow:
    inset 0 0.125em 0.125em oklch(from var(--foreground) l c h / 6%),
    inset 0 -0.125em 0.14em oklch(from var(--ogb-tint) l c h / calc(42% * var(--ogb-k))),
    0 0.125em 0.125em -0.125em oklch(from var(--foreground) l c h / 20%),
    0 0 0.1em 0.25em inset oklch(from var(--background) l c h / 20%),
    0 0.2em 0.05em oklch(from var(--foreground) l c h / 5%),
    0 0.22em 0.05em oklch(from var(--background) l c h / 70%),
    inset 0 0.22em 0.05em oklch(from var(--foreground) l c h / 14%);
}

/* Composer sizes: circular icon (32x32) & compact pill (height 32px) */
.ogb-wrap.ogb-icon > .ogb-btn > .ogb-inner {
  width: 32px;
  height: 32px;
  padding: 0;
}

.ogb-wrap.ogb-pill > .ogb-btn > .ogb-inner {
  height: 32px;
  padding: 0 10px;
  font-size: 11.5px;
  font-weight: 500;
}

.ogb-wrap > .ogb-btn .ppc-chev {
  flex: none;
  opacity: 0.7;
  transition: transform 0.25s ease, opacity 0.2s ease;
}

.ogb-wrap > .ogb-btn[aria-expanded="true"] .ppc-chev {
  transform: rotate(180deg);
  opacity: 0.95;
}

@media (max-width: 420px) {
  .ogb-wrap.ogb-icon > .ogb-btn > .ogb-inner {
    width: 30px;
    height: 30px;
  }
  .ogb-wrap.ogb-pill > .ogb-btn > .ogb-inner {
    height: 30px;
    padding: 0 8px;
    font-size: 11px;
    gap: 4px;
  }
}

@media (hover: none) and (pointer: coarse) {
  .ogb-wrap > .ogb-btn::after,
  .ogb-wrap > .ogb-btn:hover::after,
  .ogb-wrap > .ogb-btn:active::after {
    --ogb-angle-1: -75deg;
  }
  .ogb-wrap > .ogb-btn > .ogb-inner::after,
  .ogb-wrap > .ogb-btn:active > .ogb-inner::after {
    --ogb-angle-2: -45deg;
  }
}
`;

let cssInjected = false;
function ensureGlassButtonCss() {
  if (cssInjected || typeof document === "undefined") return;
  const existing = document.getElementById(GLASS_BTN_CSS_ID);
  if (existing) {
    existing.textContent = GLASS_BTN_CSS;
    cssInjected = true;
    return;
  }
  const style = document.createElement("style");
  style.id = GLASS_BTN_CSS_ID;
  style.textContent = GLASS_BTN_CSS;
  document.head.appendChild(style);
  cssInjected = true;
}

export interface GlassButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** "icon" = circular icon button (36x36), "pill" = capsule button (height 36px). */
  variant?: "icon" | "pill";
  /** Boosts the warm orange glass intensity slightly when a mode/state is active. */
  active?: boolean;
  /** Optional class on the outer perspective wrapper. */
  wrapClassName?: string;
}

export const GlassButton = React.forwardRef<HTMLButtonElement, GlassButtonProps>(function GlassButton(
  { variant = "pill", active = false, wrapClassName, className, children, type = "button", ...props },
  ref,
) {
  ensureGlassButtonCss();

  return (
    <span
      className={cn(
        "ogb-wrap",
        variant === "icon" ? "ogb-icon" : "ogb-pill",
        active && "ogb-active",
        wrapClassName,
      )}
    >
      <button ref={ref} type={type} className={cn("ogb-btn", className)} {...props}>
        <span className="ogb-inner">{children}</span>
      </button>
      <span className="ogb-shadow" aria-hidden="true" />
    </span>
  );
});
