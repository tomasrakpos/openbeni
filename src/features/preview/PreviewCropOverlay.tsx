// Interactive crop & screenshot overlay rendered over the live preview iframe.
import { AnimatePresence, motion } from "framer-motion";
import { Camera, Check, Loader2, X } from "lucide-react";
import * as React from "react";
import { GlassButton } from "@/components/ui/glass-button";
import { useT } from "@/lib/i18n";
import type { CropRect } from "@/features/preview/previewBridge";

type DragKind = "draw" | "move" | "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";

interface DragState {
  kind: DragKind;
  startX: number;
  startY: number;
  origin: CropRect;
}

const MIN_SIZE = 28;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export const PreviewCropOverlay = React.memo(function PreviewCropOverlay({
  capturing,
  captureCount,
  onConfirm,
  onCancel,
}: {
  capturing: boolean;
  captureCount: number;
  onConfirm: (rect: CropRect) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = React.useState({ w: 320, h: 420 });
  const [rect, setRect] = React.useState<CropRect | null>(null);
  const [drag, setDrag] = React.useState<DragState | null>(null);
  const [flash, setFlash] = React.useState(false);

  // Measure the overlay box and seed an immediately adjustable centered crop frame
  // so users can either resize/move it directly or drag anywhere to draw a fresh box.
  React.useLayoutEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const sync = () => {
      const r = node.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      setBounds({ w: r.width, h: r.height });
      setRect((cur) => {
        if (cur) {
          const w = clamp(cur.width, MIN_SIZE, r.width);
          const h = clamp(cur.height, MIN_SIZE, r.height);
          return {
            x: clamp(cur.x, 0, Math.max(0, r.width - w)),
            y: clamp(cur.y, 0, Math.max(0, r.height - h)),
            width: w,
            height: h,
          };
        }
        const padX = Math.round(r.width * 0.14);
        const padY = Math.round(r.height * 0.16);
        return {
          x: padX,
          y: padY,
          width: Math.max(MIN_SIZE, Math.round(r.width - padX * 2)),
          height: Math.max(MIN_SIZE, Math.round(r.height - padY * 2)),
        };
      });
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const toLocal = (clientX: number, clientY: number) => {
    const node = rootRef.current;
    if (!node) return { x: 0, y: 0 };
    const r = node.getBoundingClientRect();
    return {
      x: clamp(clientX - r.left, 0, r.width),
      y: clamp(clientY - r.top, 0, r.height),
    };
  };

  const startDrag = (kind: DragKind, event: React.PointerEvent) => {
    if (capturing) return;
    event.stopPropagation();
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    const pt = toLocal(event.clientX, event.clientY);
    const origin =
      kind === "draw"
        ? { x: pt.x, y: pt.y, width: 0, height: 0 }
        : rect ?? { x: pt.x, y: pt.y, width: 0, height: 0 };
    if (kind === "draw") {
      setRect({ x: pt.x, y: pt.y, width: 0, height: 0 });
    }
    setDrag({ kind, startX: pt.x, startY: pt.y, origin });
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!drag) return;
    const pt = toLocal(event.clientX, event.clientY);
    const dx = pt.x - drag.startX;
    const dy = pt.y - drag.startY;
    const { origin, kind } = drag;

    if (kind === "draw") {
      const x1 = Math.min(drag.startX, pt.x);
      const y1 = Math.min(drag.startY, pt.y);
      const x2 = Math.max(drag.startX, pt.x);
      const y2 = Math.max(drag.startY, pt.y);
      setRect({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
      return;
    }

    if (kind === "move") {
      setRect({
        x: clamp(origin.x + dx, 0, Math.max(0, bounds.w - origin.width)),
        y: clamp(origin.y + dy, 0, Math.max(0, bounds.h - origin.height)),
        width: origin.width,
        height: origin.height,
      });
      return;
    }

    let left = origin.x;
    let top = origin.y;
    let right = origin.x + origin.width;
    let bottom = origin.y + origin.height;

    if (kind.includes("w")) left = clamp(origin.x + dx, 0, right - MIN_SIZE);
    if (kind.includes("e")) right = clamp(origin.x + origin.width + dx, left + MIN_SIZE, bounds.w);
    if (kind.includes("n")) top = clamp(origin.y + dy, 0, bottom - MIN_SIZE);
    if (kind.includes("s")) bottom = clamp(origin.y + origin.height + dy, top + MIN_SIZE, bounds.h);

    setRect({ x: left, y: top, width: right - left, height: bottom - top });
  };

  const onPointerUp = () => {
    if (!drag) return;
    setDrag(null);
    setRect((cur) => {
      if (!cur) return cur;
      if (cur.width < MIN_SIZE || cur.height < MIN_SIZE) {
        return {
          x: clamp(cur.x, 0, Math.max(0, bounds.w - 140)),
          y: clamp(cur.y, 0, Math.max(0, bounds.h - 100)),
          width: Math.min(140, bounds.w),
          height: Math.min(100, bounds.h),
        };
      }
      return cur;
    });
  };

  const handleConfirm = () => {
    if (!rect || rect.width < MIN_SIZE || rect.height < MIN_SIZE || capturing) return;
    setFlash(true);
    window.setTimeout(() => setFlash(false), 260);
    onConfirm({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
  };

  const validRect = rect && rect.width >= MIN_SIZE && rect.height >= MIN_SIZE;

  // Position the floating confirm bar below the crop frame if space permits,
  // otherwise above it, or tucked neatly inside the bottom of the frame.
  const actionPos = React.useMemo(() => {
    if (!rect) return { left: 12, top: 12 };
    const barW = 216;
    const barH = 44;
    const centeredLeft = rect.x + rect.width / 2 - barW / 2;
    const left = clamp(centeredLeft, 8, Math.max(8, bounds.w - barW - 8));
    const belowTop = rect.y + rect.height + 10;
    const aboveTop = rect.y - barH - 10;
    const top =
      belowTop + barH <= bounds.h - 6
        ? belowTop
        : aboveTop >= 8
          ? aboveTop
          : clamp(rect.y + rect.height - barH - 8, 8, Math.max(8, bounds.h - barH - 8));
    return { left, top };
  }, [rect, bounds.w, bounds.h]);

  return (
    <motion.div
      ref={rootRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className="absolute inset-0 z-20 select-none overflow-hidden touch-none"
      style={{ cursor: drag?.kind === "move" ? "grabbing" : "crosshair" }}
      onPointerDown={(e) => startDrag("draw", e)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* Subtle shutter flash when screenshot is snapped */}
      <AnimatePresence>
        {flash ? (
          <motion.div
            initial={{ opacity: 0.65 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.24 }}
            className="pointer-events-none absolute inset-0 z-40 bg-white"
          />
        ) : null}
      </AnimatePresence>

      {/* Capture counter pill when user takes multiple screenshots */}
      {captureCount > 0 ? (
        <div
          className="pointer-events-none absolute top-2.5 right-2.5 z-30 inline-flex items-center gap-1.5 rounded-full border border-[var(--border-strong)] bg-[color-mix(in_oklab,var(--surface-1)_88%,transparent)] px-2.5 py-1 text-[10.5px] font-medium text-foreground shadow-lg backdrop-blur-md"
        >
          <Check className="size-3 text-[var(--success)]" />
          <span>{t("preview.studio.captureCount", { n: captureCount })}</span>
        </div>
      ) : null}

      {rect ? (
        <div
          className="absolute z-20 rounded-[6px] border-[1.5px] border-white/95"
          style={{
            left: rect.x,
            top: rect.y,
            width: Math.max(1, rect.width),
            height: Math.max(1, rect.height),
            boxShadow:
              "0 0 0 9999px rgba(7, 9, 18, 0.56), 0 0 0 1px color-mix(in oklab, var(--primary) 80%, white)",
            cursor: "grab",
          }}
          onPointerDown={(e) => startDrag("move", e)}
        >
          {/* Rule-of-thirds subtle hairlines */}
          <div className="pointer-events-none absolute inset-0 opacity-35">
            <div className="absolute inset-y-0 left-1/3 w-px bg-white/60" />
            <div className="absolute inset-y-0 left-2/3 w-px bg-white/60" />
            <div className="absolute inset-x-0 top-1/3 h-px bg-white/60" />
            <div className="absolute inset-x-0 top-2/3 h-px bg-white/60" />
          </div>

          {/* Live pixel dimensions badge */}
          <div className="pointer-events-none absolute -top-6 left-0 inline-flex items-center rounded-md bg-black/75 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-white shadow-sm backdrop-blur-sm">
            {Math.round(rect.width)} × {Math.round(rect.height)}
          </div>

          {/* 4 corner resize handles */}
          {(
            [
              { kind: "nw", cls: "-top-1.5 -left-1.5 cursor-nwse-resize" },
              { kind: "ne", cls: "-top-1.5 -right-1.5 cursor-nesw-resize" },
              { kind: "sw", cls: "-bottom-1.5 -left-1.5 cursor-nesw-resize" },
              { kind: "se", cls: "-bottom-1.5 -right-1.5 cursor-nwse-resize" },
            ] as const
          ).map((handle) => (
            <div
              key={handle.kind}
              className={`absolute size-3.5 rounded-full border-2 border-white bg-[var(--primary)] shadow-md transition-transform hover:scale-125 ${handle.cls}`}
              onPointerDown={(e) => startDrag(handle.kind, e)}
            />
          ))}

          {/* 4 edge resize grips */}
          <div
            className="absolute inset-x-3 -top-1.5 h-3 cursor-ns-resize"
            onPointerDown={(e) => startDrag("n", e)}
          />
          <div
            className="absolute inset-x-3 -bottom-1.5 h-3 cursor-ns-resize"
            onPointerDown={(e) => startDrag("s", e)}
          />
          <div
            className="absolute inset-y-3 -left-1.5 w-3 cursor-ew-resize"
            onPointerDown={(e) => startDrag("w", e)}
          />
          <div
            className="absolute inset-y-3 -right-1.5 w-3 cursor-ew-resize"
            onPointerDown={(e) => startDrag("e", e)}
          />
        </div>
      ) : null}

      {/* Floating Liquid Glass Confirm / Cancel pill */}
      {validRect && !drag ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="absolute z-30 flex items-center gap-1.5 rounded-full border border-[var(--border-strong)] bg-[color-mix(in_oklab,var(--surface-1)_88%,transparent)] p-1 shadow-xl backdrop-blur-xl"
          style={{ left: actionPos.left, top: actionPos.top }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <GlassButton
            variant="pill"
            active
            disabled={capturing}
            onClick={handleConfirm}
          >
            {capturing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Camera className="size-3.5" />
            )}
            <span>{t("preview.studio.captureConfirm")}</span>
          </GlassButton>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t("common.cancel")}
            className="grid size-8 place-items-center rounded-full text-[var(--muted-foreground)] transition-colors hover:bg-[var(--surface-2)] hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </motion.div>
      ) : null}
    </motion.div>
  );
});
