// Shared component TierBadge; change its presentation here and update consumers if props change.
import { cn } from "@/lib/utils";
import type { Tier } from "@/lib/types";

const STYLES: Record<Tier, string> = {
  free: "border-[color-mix(in_oklab,var(--success)_35%,transparent)] bg-[var(--success-soft)] text-[var(--success)]",
  paid: "border-[color-mix(in_oklab,var(--warning)_35%,transparent)] bg-[var(--warning-soft)] text-[var(--warning)]",
  unknown: "border-[var(--border)] bg-[var(--surface-2)] text-[var(--faint)]",
};

export function TierBadge({ tier, className }: { tier: Tier; className?: string }) {
  const label = tier === "free" ? "Free" : tier === "paid" ? "Paid" : "Unknown";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-[0.06em]",
        STYLES[tier],
        className,
      )}
    >
      {label}
    </span>
  );
}
