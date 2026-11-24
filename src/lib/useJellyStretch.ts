// Pure jelly squash, 3D press-tilt, and rubber-band drag-stretch physics
// extracted from the WaterRippleButton spring engine — zero WebGL, zero ripples,
// zero visual/color overrides. Respects prefers-reduced-motion and draws 0 frames
// while idle.
import * as React from "react";

export interface JellyStretchOptions {
  /** Enable or disable the physics (e.g. for text-only link buttons). Default: true */
  enabled?: boolean;
  /** Squash/tilt/drag bounce multiplier. Default: 0.7 (matches WaterRippleButton) */
  bounce?: number;
  /** Feel: 0 = snappy water-balloon, 1 = soft slow jelly. Default: 0.95 */
  softness?: number;
  /** Horizontal rubber-band drag reach in px at bounce = 1. Default: 22 */
  dragReachX?: number;
  /** Vertical rubber-band drag reach in px at bounce = 1. Default: 14 */
  dragReachY?: number;
  /** Drag stretch per pixel of pull (area conserved). Default: 0.009 */
  dragStretch?: number;
  /** Distance outside button (px) before the rubber band snaps back. Default: 48 */
  dragBreak?: number;
  /** Ignore pointerdown originating inside nested interactive controls (useful for card containers). */
  ignoreInteractiveChildren?: boolean;
  /** Optional per-frame callback with current spring translation (dx, dy). */
  onFrame?: (dx: number, dy: number) => void;
}

const DEFAULTS: Required<Omit<JellyStretchOptions, "onFrame">> & {
  onFrame?: (dx: number, dy: number) => void;
} = {
  enabled: true,
  bounce: 0.7,
  softness: 0.95,
  dragReachX: 22,
  dragReachY: 14,
  dragStretch: 0.009,
  dragBreak: 48,
  ignoreInteractiveChildren: false,
  onFrame: undefined,
};

const PRESS_SCALE = 0.97;
const SQUASH = 0.08;
const TILT_DEPTH = 6;

interface Spring {
  x: number;
  v: number;
}

const newSpring = (): Spring => ({ x: 0, v: 0 });

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

export function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Rubber-band curve: tracks the pointer at first, then stiffens toward `reach`. */
export function rubber(d: number, reach: number): number {
  if (reach <= 0) return 0;
  return Math.sign(d) * reach * (1 - 1 / ((Math.abs(d) * 0.55) / reach + 1));
}

function pull(sp: Spring, target: number, freq: number, zeta: number, h: number): void {
  const w = 2 * Math.PI * freq;
  sp.v += (w * w * (target - sp.x) - 2 * zeta * w * sp.v) * h;
  sp.x += sp.v * h;
}

function settled(sp: Spring, target: number): boolean {
  return Math.abs(sp.x - target) < 1e-3 && Math.abs(sp.v) < 1e-2;
}

export class JellyStretchEngine {
  private trigger: HTMLElement;
  private target: HTMLElement;
  private opts: typeof DEFAULTS;

  private depth = newSpring();
  private squash = newSpring();
  private tiltX = newSpring();
  private tiltY = newSpring();
  private dragX = newSpring();
  private dragY = newSpring();

  private pressed = false;
  private pointerId = -1;
  private tracking = false;
  private reduce = false;
  private destroyed = false;
  private raf = 0;
  private last = 0;

  // Base geometry captured at pointerdown before drag displacement so
  // transforming `target` never feeds back into pointer measurement.
  private baseLeft = 0;
  private baseTop = 0;
  private baseW = 0;
  private baseH = 0;
  private pressX = 0;
  private pressY = 0;
  private originX = 0;
  private originY = 0;
  private dragTX = 0;
  private dragTY = 0;

  // Suppress accidental click after a rubber-band snap-back past dragBreak.
  private suppressClickUntil = 0;
  private disposers: Array<() => void> = [];

  constructor(
    trigger: HTMLElement,
    target: HTMLElement = trigger,
    options: JellyStretchOptions = {},
  ) {
    this.trigger = trigger;
    this.target = target;
    this.opts = { ...DEFAULTS, ...options };

    const on = <K extends keyof HTMLElementEventMap>(
      el: HTMLElement,
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      capture = false,
    ) => {
      el.addEventListener(type, fn, capture);
      this.disposers.push(() => el.removeEventListener(type, fn, capture));
    };

    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    this.reduce = Boolean(motion?.matches);
    const onMotion = () => {
      this.reduce = Boolean(motion?.matches);
      if (this.reduce) this.resetBody();
    };
    motion?.addEventListener?.("change", onMotion);
    this.disposers.push(() => motion?.removeEventListener?.("change", onMotion));

    on(
      trigger,
      "click",
      (e) => {
        if (performance.now() < this.suppressClickUntil) {
          e.preventDefault();
          e.stopPropagation();
          this.suppressClickUntil = 0;
        }
      },
      true,
    );

    on(trigger, "pointerdown", (e) => {
      if (e.button !== 0 || this.isDisabled() || !this.opts.enabled || this.reduce) return;
      if (
        this.opts.ignoreInteractiveChildren &&
        typeof Element !== "undefined" &&
        e.target instanceof Element
      ) {
        const hit = e.target.closest("button, a, input, textarea, select, [role='button']");
        if (hit && hit !== trigger) return;
      }
      this.captureBaseGeometry();
      const localX = clamp(e.clientX - this.baseLeft, 0, Math.max(this.baseW, 1));
      const localY = clamp(e.clientY - this.baseTop, 0, Math.max(this.baseH, 1));
      this.pointerId = e.pointerId;
      this.press(true, localX, localY);
      this.track(true);
    });

    const release = (e: PointerEvent) => {
      if (this.pressed && e.pointerId === this.pointerId) this.press(false);
    };
    on(trigger, "pointerup", release);
    on(trigger, "pointercancel", release);

    on(trigger, "keydown", (e) => {
      if (
        e.repeat ||
        this.isDisabled() ||
        !this.opts.enabled ||
        this.reduce ||
        (e.key !== "Enter" && e.key !== " ")
      ) {
        return;
      }
      this.captureBaseGeometry();
      this.pointerId = -1;
      this.press(true, this.baseW / 2, this.baseH / 2);
    });
    on(trigger, "keyup", (e) => {
      if (e.key === "Enter" || e.key === " ") this.press(false);
    });
    on(trigger, "blur", () => this.press(false));
  }

  updateOptions(options: JellyStretchOptions): void {
    this.opts = { ...DEFAULTS, ...options };
    if (!this.opts.enabled) {
      this.press(false);
      this.resetBody();
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.raf) window.cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.track(false);
    for (const off of this.disposers) off();
    this.disposers = [];
    this.target.style.transform = "";
    delete this.target.dataset.jellyStretching;
  }

  private isDisabled(): boolean {
    const el = this.trigger as HTMLButtonElement;
    return Boolean(el.disabled) || el.getAttribute("aria-disabled") === "true";
  }

  private captureBaseGeometry(): void {
    const r = this.target.getBoundingClientRect();
    const w = this.target.offsetWidth || r.width || 1;
    const h = this.target.offsetHeight || r.height || 1;
    // Subtract any in-flight spring translation so repeated rapid presses
    // stay anchored to the element's resting layout box.
    const cx = r.left + r.width / 2 - this.dragX.x;
    const cy = r.top + r.height / 2 - this.dragY.x;
    this.baseW = w;
    this.baseH = h;
    this.baseLeft = cx - w / 2;
    this.baseTop = cy - h / 2;
  }

  private press(down: boolean, x?: number, y?: number): void {
    if (down) {
      this.pressed = true;
      this.dragTX = 0;
      this.dragTY = 0;
      if (x !== undefined && y !== undefined) {
        this.pressX = x;
        this.pressY = y;
        this.aimAt(x, y);
      }
    } else {
      this.track(false);
      if (!this.pressed) return;
      this.pressed = false;
      this.dragTX = 0;
      this.dragTY = 0;
    }
    if (!this.reduce) this.start();
  }

  private aimAt(x: number, y: number): void {
    const hw = Math.max(this.baseW / 2, 1);
    const hh = Math.max(this.baseH / 2, 1);
    this.originX = clamp((x - hw) / hw, -1, 1);
    this.originY = clamp((y - hh) / hh, -1, 1);
  }

  private track(on: boolean): void {
    if (on === this.tracking) return;
    this.tracking = on;
    if (on) {
      window.addEventListener("pointermove", this.onDragMove);
      window.addEventListener("pointerup", this.onDragEnd);
      window.addEventListener("pointercancel", this.onDragEnd);
    } else {
      window.removeEventListener("pointermove", this.onDragMove);
      window.removeEventListener("pointerup", this.onDragEnd);
      window.removeEventListener("pointercancel", this.onDragEnd);
    }
  }

  private onDragMove = (e: PointerEvent): void => {
    if (!this.pressed || e.pointerId !== this.pointerId) return;
    const px = e.clientX - this.baseLeft;
    const py = e.clientY - this.baseTop;

    const outX = Math.max(0, -px, px - this.baseW);
    const outY = Math.max(0, -py, py - this.baseH);
    if (Math.hypot(outX, outY) > this.opts.dragBreak) {
      this.suppressClickUntil = performance.now() + 380;
      this.press(false);
      return;
    }

    this.aimAt(clamp(px, 0, this.baseW), clamp(py, 0, this.baseH));
    const b = this.bounceAmount();
    // Scale reach proportionally down slightly on tiny icon buttons (< 40px)
    // so they stretch playfully without flying far out of tight toolbars.
    const sizeScale = clamp(Math.max(this.baseW, this.baseH) / 48, 0.72, 1);
    this.dragTX = rubber(px - this.pressX, this.opts.dragReachX * sizeScale) * b;
    this.dragTY = rubber(py - this.pressY, this.opts.dragReachY * sizeScale) * b;
    if (!this.reduce) this.start();
  };

  private onDragEnd = (e: PointerEvent): void => {
    if (e.pointerId === this.pointerId) this.press(false);
  };

  private bounceAmount(): number {
    return this.reduce ? 0 : clamp(this.opts.bounce, 0, 3);
  }

  private start(): void {
    if (this.raf || this.destroyed) return;
    this.last = performance.now();
    this.raf = window.requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    const busy = this.stepBody(dt);
    this.applyTransform();
    this.raf = busy ? window.requestAnimationFrame(this.tick) : 0;
  };

  private stepBody(dt: number): boolean {
    if (this.reduce) {
      this.resetBody();
      return false;
    }
    const soft = clamp(this.opts.softness, 0, 1);
    const wobble = mix(4.8, 2.3, soft);
    const ring = mix(0.2, 0.15, soft);
    const down = this.pressed;
    const pressT = down ? 1 : 0;
    const tx = down ? this.originX : 0;
    const ty = down ? this.originY : 0;
    const gx = down ? this.dragTX : 0;
    const gy = down ? this.dragTY : 0;

    let left = dt;
    while (left > 1e-6) {
      const h = Math.min(left, 1 / 240);
      pull(this.dragX, gx, down ? 7 : wobble * 0.9, down ? 0.75 : ring * 1.3, h);
      pull(this.dragY, gy, down ? 7 : wobble * 0.9, down ? 0.75 : ring * 1.3, h);
      pull(this.depth, pressT, down ? 5.5 : 3.6, down ? 0.85 : 0.42, h);
      pull(this.squash, pressT, down ? wobble * 1.15 : wobble, down ? 0.38 : ring, h);
      pull(this.tiltX, tx, down ? 4 : wobble * 0.85, down ? 0.55 : ring * 1.6, h);
      pull(this.tiltY, ty, down ? 4 : wobble * 0.85, down ? 0.55 : ring * 1.6, h);
      left -= h;
    }

    const busy = !(
      settled(this.depth, pressT) &&
      settled(this.squash, pressT) &&
      settled(this.tiltX, tx) &&
      settled(this.tiltY, ty) &&
      settled(this.dragX, gx) &&
      settled(this.dragY, gy)
    );
    if (!busy && !down) this.resetBody();
    return busy;
  }

  private resetBody(): void {
    for (const sp of [this.depth, this.squash, this.tiltX, this.tiltY, this.dragX, this.dragY]) {
      sp.x = 0;
      sp.v = 0;
    }
    this.applyTransform();
  }

  private applyTransform(): void {
    const atRest =
      this.depth.x === 0 &&
      this.squash.x === 0 &&
      this.tiltX.x === 0 &&
      this.tiltY.x === 0 &&
      this.dragX.x === 0 &&
      this.dragY.x === 0;
    if (atRest || this.reduce) {
      this.target.style.transform = "";
      delete this.target.dataset.jellyStretching;
      this.opts.onFrame?.(0, 0);
      return;
    }

    const b = this.bounceAmount();
    const base = 1 - (1 - PRESS_SCALE) * this.depth.x;
    const q = 1 + SQUASH * b * this.squash.x;
    const w = Math.max(this.baseW, 1);
    const h = Math.max(this.baseH, 1);
    const depth = TILT_DEPTH * b;
    const ry = (Math.asin(clamp(depth / (w / 2), -1, 1)) * 180) / Math.PI;
    const rx = (Math.asin(clamp(depth / (h / 2), -1, 1)) * 180) / Math.PI;
    const perspective = clamp(4 * Math.min(w, h) + 120, 300, 900);

    const dx = this.dragX.x;
    const dy = this.dragY.x;
    const reach = Math.hypot(dx, dy);
    let stretch = "";
    if (reach > 0.01) {
      const st = 1 + this.opts.dragStretch * reach;
      const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
      stretch = `rotate(${ang.toFixed(2)}deg) scale(${st.toFixed(5)}, ${(1 / st).toFixed(5)}) rotate(${(-ang).toFixed(2)}deg) `;
    }

    const t =
      `translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0) ` +
      `perspective(${perspective.toFixed(0)}px) ` +
      `rotateX(${(-this.tiltY.x * rx).toFixed(3)}deg) rotateY(${(this.tiltX.x * ry).toFixed(3)}deg) ` +
      stretch +
      `scale(${(base * q).toFixed(5)}, ${(base / q).toFixed(5)})`;

    this.target.dataset.jellyStretching = "true";
    this.target.style.transform = t;
    this.opts.onFrame?.(dx, dy);
  }
}

export function attachJellyStretch(
  trigger: HTMLElement,
  target: HTMLElement = trigger,
  options: JellyStretchOptions = {},
): () => void {
  if (typeof window === "undefined") return () => {};
  const engine = new JellyStretchEngine(trigger, target, options);
  return () => engine.destroy();
}

/**
 * React hook that attaches pure jelly squash/tilt/rubber-band drag-stretch
 * physics to a button without touching its colors, styles, or ripples.
 */
export function useJellyStretch<T extends HTMLElement = HTMLButtonElement>(
  externalRef?: React.ForwardedRef<T>,
  options: JellyStretchOptions = {},
): React.RefCallback<T> {
  const engineRef = React.useRef<JellyStretchEngine | null>(null);
  const optsRef = React.useRef<JellyStretchOptions>(options);
  optsRef.current = options;

  React.useEffect(() => {
    engineRef.current?.updateOptions(options);
  }, [
    options.enabled,
    options.bounce,
    options.softness,
    options.dragReachX,
    options.dragReachY,
    options.dragStretch,
    options.dragBreak,
  ]);

  React.useEffect(() => {
    return () => {
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, []);

  return React.useCallback(
    (node: T | null) => {
      if (typeof externalRef === "function") externalRef(node);
      else if (externalRef) externalRef.current = node;

      engineRef.current?.destroy();
      engineRef.current = null;

      if (node && typeof window !== "undefined") {
        engineRef.current = new JellyStretchEngine(node, node, optsRef.current);
      }
    },
    [externalRef],
  );
}
