// Shared component Logo; change its presentation here and update consumers if props change.
import { cn } from "@/lib/utils";

/** Shared OpenHarneks brand mark and app icon. */
export function Logo({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <img
      src="/brand/openharness-mark.webp"
      onError={(e) => {
        const img = e.currentTarget;
        if (!img.dataset.fb) {
          img.dataset.fb = "1";
          img.src = "/brand/openharness-mark.png";
        }
      }}
      alt=""
      aria-hidden
      draggable={false}
      decoding="async"
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

/**
 * Distinct native OpenHarneks model icon used for admin-published models
 * backed by a free router (visually separate from the generic `<Route />`
 * router icon used for personal user routers).
 */
export function OpenHarneksModelIcon({
  size = 16,
  variant = "mark",
  className,
}: {
  size?: number;
  variant?: "mark" | "tile";
  className?: string;
}) {
  if (variant === "tile") {
    const markSize = Math.max(12, Math.round(size * 0.66));
    return (
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-flex shrink-0 items-center justify-center overflow-hidden shadow-xs",
          className,
        )}
        style={{
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.3),
          background:
            "linear-gradient(145deg, color-mix(in oklab, var(--primary) 26%, var(--surface-2)), color-mix(in oklab, var(--primary) 8%, var(--surface-1)))",
          border: "1px solid color-mix(in oklab, var(--primary) 34%, var(--border))",
        }}
      >
        <img
          src="/brand/openharness-mark.webp"
          onError={(e) => {
            const img = e.currentTarget;
            if (!img.dataset.fb) {
              img.dataset.fb = "1";
              img.src = "/brand/openharness-mark.png";
            }
          }}
          alt=""
          aria-hidden="true"
          draggable={false}
          decoding="async"
          width={markSize}
          height={markSize}
          className="shrink-0 select-none object-contain"
          style={{ width: markSize, height: markSize }}
        />
      </span>
    );
  }

  return (
    <img
      src="/brand/openharness-mark.webp"
      onError={(e) => {
        const img = e.currentTarget;
        if (!img.dataset.fb) {
          img.dataset.fb = "1";
          img.src = "/brand/openharness-mark.png";
        }
      }}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
      width={size}
      height={size}
      className={cn("shrink-0 select-none object-contain", className)}
      style={{ width: size, height: size }}
    />
  );
}
