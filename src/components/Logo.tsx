// Shared component Logo; change its presentation here and update consumers if props change.
import { cn } from "@/lib/utils";

/** Shared OpenHarneks brand mark and app icon. */
export function Logo({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <img
      src="/brand/openharness-mark.png"
      alt=""
      aria-hidden
      draggable={false}
      width={size}
      height={size}
      className={cn("shrink-0 select-none object-contain", className)}
      style={{
        width: size,
        height: size,
        filter: "drop-shadow(0 5px 10px color-mix(in oklab, var(--primary) 55%, transparent))",
      }}
    />
  );
}
