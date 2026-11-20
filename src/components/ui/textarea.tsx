// Reusable UI primitive textarea; adjust its default appearance and behavior here.
import * as React from "react";
import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-[72px] w-full resize-y rounded-[12px] border border-[var(--input)] bg-[var(--surface-1)] px-3 py-2 text-sm leading-relaxed text-foreground shadow-xs transition-[border,box-shadow] duration-200 placeholder:text-[var(--faint)]",
        "hover:border-[var(--border-strong)] focus-visible:border-[color-mix(in_oklab,var(--primary)_55%,var(--border))] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

export { Textarea };
