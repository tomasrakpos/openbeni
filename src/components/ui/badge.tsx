// Reusable UI primitive badge; adjust its default appearance and behavior here.
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 transition-colors [&_svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted-foreground)]",
        free: "border-[color-mix(in_oklab,var(--success)_32%,transparent)] bg-[var(--success-soft)] text-[var(--success)]",
        paid: "border-[color-mix(in_oklab,var(--warning)_32%,transparent)] bg-[var(--warning-soft)] text-[var(--warning)]",
        unknown: "border-[var(--border)] bg-[var(--surface-2)] text-[var(--faint)]",
        primary: "border-[color-mix(in_oklab,var(--primary)_32%,transparent)] bg-[var(--primary-soft)] text-[var(--primary)]",
        accent: "border-[color-mix(in_oklab,var(--accent)_32%,transparent)] bg-[var(--accent-soft)] text-[var(--accent)]",
        destructive:
          "border-[color-mix(in_oklab,var(--destructive)_32%,transparent)] bg-[var(--destructive-soft)] text-[var(--destructive)]",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
