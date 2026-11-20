// Reusable UI primitive sheet; adjust its default appearance and behavior here.
import * as SheetPrimitive from "@radix-ui/react-dialog";
import * as React from "react";
import { menuFrameClass } from "@/components/ui/menu-frame";
import { cn } from "@/lib/utils";

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;

const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content> & {
    side?: "left" | "right" | "bottom";
    /** Use the shared corner-menu card frame (border, gradient, shadow, 20px radius). */
    frame?: boolean;
  }
>(({ className, children, side = "right", frame = false, ...props }, ref) => (
  <SheetPrimitive.Portal>
    <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgba(4,6,12,0.62)] backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
    <SheetPrimitive.Content
      ref={ref}
      className={cn(
        "fixed z-50 flex flex-col gap-4 transition ease-out",
        frame
          ? menuFrameClass
          : "border-[var(--border)] bg-[color-mix(in_oklab,var(--surface-1)_78%,transparent)] shadow-lg backdrop-blur-xl backdrop-saturate-150",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        side === "right" &&
          cn(
            "inset-y-0 right-0 h-full w-[min(420px,92vw)] data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
            !frame && "border-l",
          ),
        side === "left" &&
          cn(
            "inset-y-0 left-0 h-full w-[min(380px,92vw)] data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left",
            !frame && "border-r",
          ),
        side === "bottom" &&
          cn(
            "inset-x-0 bottom-0 max-h-[88dvh] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",
            !frame && "rounded-t-[22px] border-t",
          ),
        className,
      )}
      {...props}
    >
      {children}
    </SheetPrimitive.Content>
  </SheetPrimitive.Portal>
));
SheetContent.displayName = "SheetContent";

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn("text-[15px] font-semibold text-foreground", className)}
    {...props}
  />
));
SheetTitle.displayName = "SheetTitle";

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn("text-[13px] text-[var(--muted-foreground)]", className)}
    {...props}
  />
));
SheetDescription.displayName = "SheetDescription";

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetTitle, SheetDescription };
