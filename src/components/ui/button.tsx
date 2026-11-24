// Reusable UI primitive button; adjust its default appearance and behavior here.
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { useJellyStretch } from "@/lib/useJellyStretch";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[12px] text-sm font-medium transition-[background,color,box-shadow,transform,border-color] duration-200 ease-out select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-b from-[var(--accent-from)] to-[var(--accent-to)] text-white shadow-[0_1px_0_rgb(255_255_255/0.25)_inset,0_10px_26px_-10px_var(--accent-glow)] transition-[transform,box-shadow] duration-300 hover:shadow-[0_1px_0_rgb(255_255_255/0.25)_inset,0_14px_34px_-8px_var(--accent-glow)] disabled:opacity-80",
        secondary:
          "bg-[var(--surface-2)] text-foreground border border-[var(--border)] hover:bg-[var(--surface-3)] hover:border-[var(--border-strong)]",
        outline:
          "border border-[var(--border-strong)] bg-transparent text-foreground hover:bg-[var(--surface-2)]",
        ghost: "text-[var(--muted-foreground)] hover:text-foreground hover:bg-[var(--surface-2)]",
        destructive:
          "bg-[var(--destructive-soft)] text-[var(--destructive)] border border-[color-mix(in_oklab,var(--destructive)_30%,transparent)] hover:bg-[color-mix(in_oklab,var(--destructive)_18%,transparent)]",
        link: "text-[var(--accent)] underline-offset-4 hover:underline",
        soft: "bg-[var(--primary-soft)] text-[var(--primary)] hover:bg-[color-mix(in_oklab,var(--primary)_18%,transparent)]",
      },
      size: {
        default: "h-9 px-3.5 [&_svg]:size-4",
        sm: "h-8 px-3 text-[13px] [&_svg]:size-3.5",
        xs: "h-7 px-2 text-xs rounded-[9px] [&_svg]:size-3.5",
        lg: "h-11 px-5 text-[15px] [&_svg]:size-[18px]",
        icon: "h-9 w-9 [&_svg]:size-4",
        "icon-sm": "h-8 w-8 rounded-[10px] [&_svg]:size-3.5",
        "icon-xs": "h-7 w-7 rounded-[8px] [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  disableJelly?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, disableJelly = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    const jellyRef = useJellyStretch<HTMLButtonElement>(ref, {
      enabled: !disableJelly && variant !== "link",
    });
    return <Comp ref={jellyRef} className={cn(buttonVariants({ variant, size, className }))} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
