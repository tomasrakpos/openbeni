// Shared component CopyButton; change its presentation here and update consumers if props change.
import { Check, Copy } from "lucide-react";
import * as React from "react";
import { copyToClipboard } from "@/lib/export";
import { cn } from "@/lib/utils";

interface CopyButtonProps {
  value: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
  size?: "xs" | "sm";
}

export function CopyButton({ value, label, copiedLabel = "Copied", className, size = "xs" }: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<number | null>(null);
  React.useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);
  const onClick = async () => {
    const ok = await copyToClipboard(value);
    if (!ok) return;
    setCopied(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label ?? "Copy"}
      title={label ?? "Copy"}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[8px] text-[11.5px] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--surface-2)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]",
        size === "xs" ? "h-7 px-2" : "h-8 px-2.5",
        className,
      )}
    >
      {copied ? <Check className="size-3.5 text-[var(--success)]" /> : <Copy className="size-3.5" />}
      <span>{copied ? copiedLabel : label}</span>
    </button>
  );
}
