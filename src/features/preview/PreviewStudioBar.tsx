// Bottom studio toolbar for the live preview panel.
// Uses the exact liquid-glass <GlassButton> component from the chat composer
// (automatically synced to Violet / Ember accents).
import { AnimatePresence, motion } from "framer-motion";
import { Camera, PencilRuler, WandSparkles, X } from "lucide-react";
import * as React from "react";
import { GlassButton } from "@/components/ui/glass-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/lib/i18n";
import type { PreviewStudioMode } from "@/features/preview/previewBridge";

export const PreviewStudioBar = React.memo(function PreviewStudioBar({
  mode,
  disabled,
  onSelectMode,
}: {
  mode: PreviewStudioMode;
  disabled?: boolean;
  onSelectMode: (next: PreviewStudioMode) => void;
}) {
  const t = useT();

  const toggle = (target: Exclude<PreviewStudioMode, "off">) => {
    onSelectMode(mode === target ? "off" : target);
  };

  const hintText =
    mode === "capture"
      ? t("preview.studio.hintCapture")
      : mode === "ai-pick"
        ? t("preview.studio.hintAiPick")
        : mode === "manual-edit"
          ? t("preview.studio.hintManualEdit")
          : null;

  return (
    <div dir="ltr" className="shrink-0 border-t border-[var(--border)] bg-[color-mix(in_oklab,var(--surface-1)_72%,transparent)] backdrop-blur-xl">
      <AnimatePresence initial={false}>
        {hintText ? (
          <motion.div
            key={mode}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden border-b border-[var(--border)]/70"
          >
            <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-[10.5px] text-[var(--muted-foreground)]">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="size-1.5 shrink-0 rounded-full bg-[var(--primary)]" />
                <span dir="auto" className="truncate">
                  {hintText}
                </span>
              </span>
              <button
                type="button"
                onClick={() => onSelectMode("off")}
                aria-label={t("common.close")}
                className="grid size-5 shrink-0 place-items-center rounded-full text-[var(--faint)] transition-colors hover:bg-[var(--surface-2)] hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="flex flex-wrap items-center justify-center gap-1.5 px-2 py-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <GlassButton
              variant="pill"
              active={mode === "capture"}
              disabled={disabled}
              aria-pressed={mode === "capture"}
              onClick={() => toggle("capture")}
            >
              <Camera className="size-3.5 shrink-0" />
              <span>{t("preview.studio.capture")}</span>
            </GlassButton>
          </TooltipTrigger>
          <TooltipContent>{t("preview.studio.captureTip")}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <GlassButton
              variant="pill"
              active={mode === "ai-pick"}
              disabled={disabled}
              aria-pressed={mode === "ai-pick"}
              onClick={() => toggle("ai-pick")}
            >
              <WandSparkles className="size-3.5 shrink-0" />
              <span>{t("preview.studio.aiEdit")}</span>
            </GlassButton>
          </TooltipTrigger>
          <TooltipContent>{t("preview.studio.aiEditTip")}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <GlassButton
              variant="pill"
              active={mode === "manual-edit"}
              disabled={disabled}
              aria-pressed={mode === "manual-edit"}
              onClick={() => toggle("manual-edit")}
            >
              <PencilRuler className="size-3.5 shrink-0" />
              <span>{t("preview.studio.manualEdit")}</span>
            </GlassButton>
          </TooltipTrigger>
          <TooltipContent>{t("preview.studio.manualEditTip")}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
});
