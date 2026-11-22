// Reusable UI primitive dialog; adjust its default appearance and behavior here.
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";
import { menuFrameClass } from "@/components/ui/menu-frame";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay> & { rise?: boolean }
>(({ className, rise = false, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-[rgba(4,6,12,0.62)] backdrop-blur-[3px]",
      rise
        ? "dialog-overlay-rise"
        : "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = "DialogOverlay";

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    hideClose?: boolean;
    variant?: "default" | "corner";
    /** Use the shared corner-menu card frame (border, gradient, shadow, 20px radius). */
    frame?: boolean;
    /** Animate opening and closing smoothly from the bottom up. */
    rise?: boolean;
  }
>(({ className, children, hideClose, variant = "default", frame = false, rise = false, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay rise={rise} />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        frame
          ? cn(
              menuFrameClass,
              "fixed left-1/2 top-1/2 z-50 grid w-[min(680px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 p-5",
            )
          : variant === "corner"
            ? "fixed left-1/2 top-1/2 z-50 grid w-[min(760px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-[22px] p-5 cm-surface"
            : "fixed inset-x-0 bottom-0 z-50 grid w-full gap-4 rounded-t-[22px] border border-[var(--border)] bg-[color-mix(in_oklab,var(--surface-1)_88%,transparent)] p-5 shadow-lg backdrop-blur-xl backdrop-saturate-150 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[88vh] sm:w-[min(680px,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[20px] sm:p-6",
        frame ? "max-h-[92dvh] overflow-x-hidden overflow-y-auto" : "max-h-[92dvh] overflow-y-auto safe-bottom",
        rise
          ? "dialog-rise"
          : frame
            ? "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-90 data-[state=closed]:zoom-out-95"
            : variant === "corner"
              ? "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-90 data-[state=closed]:zoom-out-95"
              : "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 data-[state=open]:slide-in-from-bottom-4 sm:data-[state=open]:slide-in-from-bottom-2",
        className,
      )}
      {...props}
    >
      {children}
      {!hideClose && (
        <DialogPrimitive.Close
          className="absolute right-4 top-4 grid size-8 place-items-center rounded-[10px] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--surface-2)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          aria-label="Close"
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = "DialogContent";

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 pr-8 text-left", className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />
  );
}

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-[17px] font-semibold tracking-tight text-foreground", className)}
    {...props}
  />
));
DialogTitle.displayName = "DialogTitle";

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-[13px] leading-relaxed text-[var(--muted-foreground)]", className)}
    {...props}
  />
));
DialogDescription.displayName = "DialogDescription";

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
