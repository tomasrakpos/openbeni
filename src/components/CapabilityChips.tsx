// Shared component CapabilityChips; change its presentation here and update consumers if props change.
import { AudioLines, Brain, Eye, Film, Wrench } from "lucide-react";
import type { Capability } from "@/lib/types";
import { cn } from "@/lib/utils";

const META: Record<Capability, { label: string; Icon: typeof Eye }> = {
  text: { label: "Text", Icon: Eye },
  vision: { label: "Vision", Icon: Eye },
  video: { label: "Video", Icon: Film },
  audio: { label: "Audio", Icon: AudioLines },
  tools: { label: "Tools", Icon: Wrench },
  reasoning: { label: "Reasoning", Icon: Brain },
};

export function CapabilityChips({
  capabilities,
  max = 4,
  className,
}: {
  capabilities: Capability[];
  max?: number;
  className?: string;
}) {
  const shown = capabilities.filter((c) => c !== "text").slice(0, max);
  if (shown.length === 0) return null;
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {shown.map((capability) => {
        const { label, Icon } = META[capability];
        return (
          <span
            key={capability}
            title={label}
            className="inline-flex size-[18px] items-center justify-center rounded-[5px] border border-[var(--border)] bg-[var(--surface-2)] text-[var(--faint)]"
          >
            <Icon className="size-3" aria-hidden />
            <span className="sr-only">{label}</span>
          </span>
        );
      })}
    </span>
  );
}

export function CapabilityIcon({ capability }: { capability: Capability }) {
  const { label, Icon } = META[capability];
  return <Icon className="size-3.5" aria-label={label} />;
}
