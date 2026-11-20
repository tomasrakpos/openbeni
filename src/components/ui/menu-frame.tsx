// Shared card frame: the exact border, gradient, shadow and radius of the corner menu card.
import * as React from "react";
import { cn } from "@/lib/utils";
import "./menu-frame.css";

/** Class hook for primitives (Dialog/Sheet) that apply the frame to their own element. */
export const menuFrameClass = "menu-frame";

export function MenuFrame({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn(menuFrameClass, className)} {...props}>
      {children}
    </div>
  );
}
