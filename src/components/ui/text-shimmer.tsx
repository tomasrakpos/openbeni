// Reusable UI primitive text-shimmer; adjust its default appearance and behavior here.
import * as React from "react";
import { cn } from "@/lib/utils";

const PALETTE = [
  "rgba(176, 124, 255, 0.95)",
  "rgba(110, 200, 255, 0.95)",
  "rgba(90, 225, 140, 0.95)",
  "rgba(255, 160, 77, 0.95)",
];

const SWEEP_SECONDS = 1.15;
const PERIOD_SECONDS = 2.2;
const BAND_RATIO = 0.6;

function ease(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function TextShimmer({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.style.setProperty("--ts-w", "60%");
      el.style.setProperty("--ts-x", "30%");
      return;
    }

    let frame = 0;
    let cycle = -1;
    const start = performance.now();

    const tick = (now: number) => {
      const t = (now - start) / 1000;
      const c = Math.floor(t / PERIOD_SECONDS);
      const local = t - c * PERIOD_SECONDS;
      if (c !== cycle) {
        cycle = c;
        el.style.setProperty("--ts-band", PALETTE[c % PALETTE.length]!);
      }
      const width = el.clientWidth;
      const band = width * BAND_RATIO;
      const k = ease(Math.min(1, local / SWEEP_SECONDS));
      el.style.setProperty("--ts-w", `${band}px`);
      el.style.setProperty("--ts-x", `${-band + k * (width + band)}px`);
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <span ref={ref} className={cn("text-shimmer", className)}>
      {children}
    </span>
  );
}
