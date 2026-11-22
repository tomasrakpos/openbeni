// Shared component TierBadge; change its presentation here and update consumers if props change.
import { Coins } from "lucide-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Tier } from "@/lib/types";

const STYLES: Record<Tier, string> = {
  free: "border-[color-mix(in_oklab,var(--success)_35%,transparent)] bg-[var(--success-soft)] text-[var(--success)]",
  paid: "border-[color-mix(in_oklab,var(--warning)_35%,transparent)] bg-[var(--warning-soft)] text-[var(--warning)]",
  unknown: "border-[var(--border)] bg-[var(--surface-2)] text-[var(--faint)]",
};

export function TierBadge({ tier, className }: { tier: Tier; className?: string }) {
  const t = useT();
  const label =
    tier === "free"
      ? t("models.free")
      : tier === "paid"
        ? t("models.paid")
        : t("models.unknown");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-[1px] text-[10px] font-semibold tracking-[0.02em]",
        STYLES[tier],
        className,
      )}
    >
      {tier === "paid" ? <Coins className="size-2.5" aria-hidden="true" /> : null}
      {label}
    </span>
  );
}
