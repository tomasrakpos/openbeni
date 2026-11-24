// Reusable UI primitive segmented; adjust its default appearance and behavior here.
import * as React from "react";
import { useJellyStretch } from "@/lib/useJellyStretch";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
}

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  size?: "sm" | "md";
  className?: string;
  "aria-label": string;
}

function SegmentedTab({
  active,
  size,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  size: "sm" | "md";
  onClick: () => void;
  icon?: React.ReactNode;
  label: React.ReactNode;
}) {
  const jellyRef = useJellyStretch<HTMLButtonElement>(undefined, {
    bounce: 0.65,
    dragReachX: 16,
    dragReachY: 10,
  });

  return (
    <button
      ref={jellyRef}
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[8px] font-medium transition-all focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]",
        size === "sm" ? "h-7 px-2 text-[12px]" : "h-8 px-2.5 text-[13px]",
        active
          ? "bg-[var(--surface-1)] text-foreground shadow-sm"
          : "text-[var(--muted-foreground)] hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "sm",
  className,
  ...aria
}: SegmentedProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={aria["aria-label"]}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-[11px] border border-[var(--border)] bg-[var(--surface-2)] p-0.5",
        className,
      )}
    >
      {options.map((opt) => (
        <SegmentedTab
          key={opt.value}
          active={opt.value === value}
          size={size}
          onClick={() => onChange(opt.value)}
          icon={opt.icon}
          label={opt.label}
        />
      ))}
    </div>
  );
}
