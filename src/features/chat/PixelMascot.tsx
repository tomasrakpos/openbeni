// chat feature: PixelMascot; change its UI/flow here and keep related state/API calls in sync.
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The small pixel character that sits on the top-left rim of the composer.
 *
 * The sprite is a 12×8 grid copied from the reference: a light purple cap,
 * violet body, two dark eyes, a dark chin row and two feet. It bobs in two
 * steps, blinks now and then, swaps its feet every 350ms and throws three
 * tiny sparks.
 *
 * Size and position come from CSS (`.pix-mascot`), so `size` / `className` /
 * `style` are enough to move or resize it. The palette is a set of CSS
 * variables rooted at `--pix-main`, so recoloring is a one-line override.
 */

const ROWS = [
  "..LLLLLLLL..",
  ".PPPPPPPPPP.",
  "PPPEPPPPEPPP",
  "PPPEPPPPEPPP",
  "PPPPPPPPPPPP",
  ".DDDDDDDDDD.",
  "..FF....FF..",
  "..FF....FF..",
];

const STEPPED = ".FF......FF.";

export interface PixelMascotProps {
  /** Width in px (the sprite keeps its 12:8 ratio). Defaults to 48. */
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function PixelMascot({ size = 48, className, style }: PixelMascotProps) {
  const [blink, setBlink] = React.useState(false);
  const [step, setStep] = React.useState(0);

  // Alternating feet.
  React.useEffect(() => {
    const id = window.setInterval(() => setStep((value) => value ^ 1), 350);
    return () => window.clearInterval(id);
  }, []);

  // Blink: 140ms closed, then a random 1.8–4.4s pause.
  React.useEffect(() => {
    let closed: number | undefined;
    let next: number | undefined;
    let cancelled = false;

    const schedule = () => {
      next = window.setTimeout(() => {
        if (cancelled) return;
        setBlink(true);
        closed = window.setTimeout(() => {
          if (cancelled) return;
          setBlink(false);
          schedule();
        }, 140);
      }, 1800 + Math.random() * 2600);
    };

    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(closed);
      window.clearTimeout(next);
    };
  }, []);

  const rects: React.ReactNode[] = [];
  ROWS.forEach((row, y) => {
    let line = row;
    if (blink && y === 2) line = row.replace(/E/g, "P");
    if (y >= 6 && step) line = STEPPED;
    [...line].forEach((color, x) => {
      if (color === ".") return;
      rects.push(
        <rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width={1.02}
          height={1.02}
          className={`pix-${color}`}
        />,
      );
    });
  });

  return (
    <div
      className={cn("pix-mascot", className)}
      style={{ width: size, ...style }}
      aria-hidden="true"
    >
      <b />
      <b />
      <b />
      <svg viewBox="0 0 12 8" focusable="false">
        {rects}
      </svg>
    </div>
  );
}
