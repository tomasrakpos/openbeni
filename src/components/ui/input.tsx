// Reusable UI primitive input; adjust its default appearance and behavior here.
import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        "flex h-9 w-full rounded-[11px] border border-[var(--input)] bg-[var(--surface-1)] px-3 py-1 text-sm text-foreground shadow-xs transition-[border,box-shadow] duration-200 placeholder:text-[var(--faint)]",
        "hover:border-[var(--border-strong)] focus-visible:border-[color-mix(in_oklab,var(--primary)_55%,var(--border))] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]",
        "disabled:cursor-not-allowed disabled:opacity-50 file:border-0 file:bg-transparent file:text-sm file:font-medium",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export { Input };
