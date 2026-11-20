// Shared component Sparkline; change its presentation here and update consumers if props change.
import { cn } from "@/lib/utils";

interface SparklineProps {
  values: number[];
  failures?: boolean[];
  className?: string;
  width?: number;
  height?: number;
}

/** Tiny latency sparkline. Green bars are fast, amber slow, red failures. */
export function Sparkline({ values, failures, className, width = 120, height = 26 }: SparklineProps) {
  if (values.length === 0) {
    return (
      <span className={cn("text-[10.5px] text-[var(--faint)]", className)}>—</span>
    );
  }
  const max = Math.max(...values, 1);
  const gap = 2;
  const barWidth = Math.max(2, (width - gap * (values.length - 1)) / values.length);
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", className)}
      role="img"
      aria-label={`Latency history: ${values.join(", ")} ms`}
    >
      {values.map((value, index) => {
        const ratio = Math.max(0.14, value / max);
        const barHeight = Math.max(3, ratio * (height - 4));
        const failed = failures?.[index];
        const color = failed
          ? "var(--destructive)"
          : value < 800
            ? "var(--success)"
            : value < 2500
              ? "var(--warning)"
              : "var(--destructive)";
        return (
          <rect
            key={index}
            x={index * (barWidth + gap)}
            y={height - barHeight}
            width={barWidth}
            height={barHeight}
            rx={Math.min(2, barWidth / 2)}
            fill={color}
            opacity={failed ? 0.9 : 0.55 + (index / values.length) * 0.45}
          />
        );
      })}
    </svg>
  );
}
