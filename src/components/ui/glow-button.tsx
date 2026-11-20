// Reusable UI primitive glow-button; adjust its default appearance and behavior here.
import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type GlowButtonVariant = "default" | "secondary" | "ghost";
type GlowButtonSize = "default" | "sm";

export interface GlowButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: GlowButtonVariant;
  size?: GlowButtonSize;
  loading?: boolean;
}

const variants: Record<GlowButtonVariant, string> = {
  default:
    "text-white bg-gradient-to-b from-[var(--accent-from)] to-[var(--accent-to)] shadow-[0_1px_0_rgb(255_255_255/0.25)_inset,0_10px_26px_-10px_var(--accent-glow)] hover:shadow-[0_1px_0_rgb(255_255_255/0.25)_inset,0_14px_34px_-8px_var(--accent-glow)]",
  secondary:
    "text-foreground bg-[var(--surface-2)] border border-[var(--border)] hover:bg-[var(--surface-3)] hover:border-[var(--border-strong)]",
  ghost: "text-[var(--muted-foreground)] hover:text-foreground hover:bg-[var(--surface-2)]",
};

const sizes: Record<GlowButtonSize, string> = {
  default: "h-10 px-4 text-sm [&_svg]:size-4",
  sm: "h-8 px-3 text-[13px] [&_svg]:size-3.5",
};

export const GlowButton = React.forwardRef<HTMLButtonElement, GlowButtonProps>(
  ({ className, variant = "default", size = "default", loading, disabled, children, type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[12px] font-medium select-none",
        "transition-[background,color,box-shadow,transform,border-color] duration-200 ease-out",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]",
        "active:scale-[0.985] disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" /> : null}
      {children}
    </button>
  ),
);
GlowButton.displayName = "GlowButton";

export default GlowButton;
