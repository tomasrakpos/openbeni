// chat feature: ArtifactCard — Claude Artifacts × Lovable style in-chat build
// activity timeline + clickable preview handoff card. Replaces raw project code
// blocks inside the chat thread so the conversation stays human and clean.
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  LayoutTemplate,
  Loader2,
} from "lucide-react";
import * as React from "react";
import { TextShimmer } from "@/components/ui/text-shimmer";
import type { ChatArtifactSplit } from "@/lib/codefiles";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";

interface ArtifactCardProps {
  messageId: string;
  artifact: ChatArtifactSplit;
}

export function ArtifactCard({ messageId, artifact }: ArtifactCardProps) {
  const t = useT();
  const setSelectedArtifactMessageId = useUiStore((s) => s.setSelectedArtifactMessageId);
  const setRightTab = useUiStore((s) => s.setRightTab);
  const setMobilePanelOpen = useUiStore((s) => s.setMobilePanelOpen);
  const updateSettings = useSettingsStore((s) => s.update);

  const [stepsExpanded, setStepsExpanded] = React.useState(false);

  const openWorkspace = React.useCallback(
    (tab: "preview" | "files" = "preview") => {
      setSelectedArtifactMessageId(messageId);
      setRightTab(tab);
      if (typeof window !== "undefined" && window.innerWidth >= 1280) {
        void updateSettings({ rightPanelOpen: true });
      } else {
        setMobilePanelOpen(true);
      }
    },
    [messageId, setMobilePanelOpen, setRightTab, setSelectedArtifactMessageId, updateSettings],
  );

  const fileCount = artifact.files.length;
  const fileLabel =
    fileCount === 1
      ? t("preview.filesCount", { n: 1 })
      : t("preview.filesCountPlural", { n: Math.max(1, fileCount) });
  const linesLabel = artifact.totalLines > 0 ? t("preview.linesCount", { n: artifact.totalLines }) : null;

  const showStepsList = artifact.isBuilding || stepsExpanded;

  return (
    <div className="my-2.5 space-y-2">
      {/* Live / collapsible build progress steps (Lovable / Claude Code pattern) */}
      {artifact.steps.length > 0 ? (
        <div className="overflow-hidden rounded-[13px] border border-[var(--border)] bg-[color-mix(in_oklab,var(--surface-2)_55%,transparent)]">
          <button
            type="button"
            onClick={() => {
              if (!artifact.isBuilding) setStepsExpanded((v) => !v);
            }}
            aria-expanded={showStepsList}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-2 text-start text-[12px]",
              !artifact.isBuilding && "cursor-pointer transition-colors hover:bg-[var(--surface-2)]/70",
            )}
          >
            {artifact.isBuilding ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-[var(--accent)]" />
            ) : (
              <span className="grid size-4 shrink-0 place-items-center rounded-full bg-[var(--success-soft)] text-[var(--success)]">
                <Check className="size-2.5 stroke-[2.5]" />
              </span>
            )}
            <span className="min-w-0 flex-1 truncate font-medium text-[var(--foreground-soft)]">
              {artifact.isBuilding ? (
                <TextShimmer>{t("preview.building")}</TextShimmer>
              ) : (
                t("preview.stepsDone", { n: artifact.steps.length })
              )}
            </span>
            {artifact.isBuilding && artifact.steps.length > 0 ? (
              <span className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface-1)]/70 px-2 py-0.5 font-mono text-[10px] tabular-nums text-[var(--muted-foreground)]">
                {artifact.completedSteps}/{artifact.steps.length}
              </span>
            ) : null}
            {linesLabel ? (
              <span className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface-1)]/70 px-2 py-0.5 font-mono text-[10px] tabular-nums text-[var(--faint)]">
                {linesLabel}
              </span>
            ) : null}
            {!artifact.isBuilding ? (
              <ChevronDown
                className={cn(
                  "size-3.5 shrink-0 text-[var(--faint)] transition-transform duration-200",
                  stepsExpanded && "rotate-180",
                )}
              />
            ) : null}
          </button>

          <AnimatePresence initial={false}>
            {showStepsList ? (
              <motion.ul
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden border-t border-[var(--border)]/70 px-3 py-2"
              >
                <div className="space-y-1.5">
                  {artifact.steps.map((step) => (
                    <li
                      key={step.id}
                      className="flex items-center gap-2 text-[11.5px] leading-snug"
                    >
                      {step.status === "active" ? (
                        <span className="relative flex size-3.5 shrink-0 items-center justify-center">
                          <span className="absolute inline-flex size-2.5 animate-ping rounded-full bg-[var(--accent)]/45" />
                          <span className="relative inline-flex size-1.5 rounded-full bg-[var(--accent)]" />
                        </span>
                      ) : step.status === "done" ? (
                        <Check className="size-3.5 shrink-0 text-[var(--success)]" />
                      ) : (
                        <span className="flex size-3.5 shrink-0 items-center justify-center">
                          <span className="size-2 rounded-full border border-[var(--border-strong)]" />
                        </span>
                      )}
                      <span
                        className={cn(
                          "min-w-0 truncate transition-colors",
                          step.status === "active"
                            ? "font-medium text-foreground"
                            : step.status === "done"
                              ? "text-[var(--muted-foreground)]"
                              : "text-[var(--faint)]",
                        )}
                      >
                        {step.label}
                      </span>
                    </li>
                  ))}
                </div>
              </motion.ul>
            ) : null}
          </AnimatePresence>
        </div>
      ) : null}

      {/* Claude-style Interactive Artifact Handoff Card */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => openWorkspace("preview")}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openWorkspace("preview");
          }
        }}
        className={cn(
          "group/artifact flex w-full cursor-pointer items-center gap-3 rounded-[16px] border px-3.5 py-3 text-start transition-all duration-200",
          "border-[var(--border-strong)] bg-[color-mix(in_oklab,var(--surface-1)_76%,transparent)] backdrop-blur-md",
          "hover:border-[color-mix(in_oklab,var(--accent)_45%,var(--border-strong))] hover:bg-[color-mix(in_oklab,var(--surface-2)_70%,transparent)]",
          "active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]",
        )}
      >
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-[12px] border transition-colors",
            artifact.isBuilding
              ? "border-[color-mix(in_oklab,var(--accent)_35%,transparent)] bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] text-[var(--accent)]"
              : "border-[var(--border)] bg-[var(--surface-2)] text-foreground group-hover/artifact:border-[color-mix(in_oklab,var(--accent)_35%,transparent)] group-hover/artifact:text-[var(--accent)]",
          )}
        >
          {artifact.isBuilding ? (
            <Loader2 className="size-4.5 animate-spin" />
          ) : (
            <LayoutTemplate className="size-4.5" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-semibold text-foreground">
              {artifact.title}
            </span>
            {fileCount > 0 ? (
              <span className="hidden shrink-0 rounded-[6px] border border-[var(--border)] bg-[var(--surface-2)]/80 px-1.5 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)] sm:inline-flex">
                {fileLabel}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-[11.5px] text-[var(--muted-foreground)]">
            {artifact.isBuilding ? t("preview.building") : t("preview.ready")}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {artifact.isBuilding ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openWorkspace("files");
              }}
              aria-label={t("preview.viewCode")}
              className="hidden h-7 items-center gap-1 rounded-[9px] border border-[var(--border)] bg-[var(--surface-2)]/80 px-2 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:text-foreground sm:inline-flex"
            >
              <Code2 className="size-3" />
              <span>{t("preview.files")}</span>
            </button>
          ) : null}
          <span
            className={cn(
              "inline-flex h-8 items-center gap-1 rounded-[10px] px-2.5 text-[11.5px] font-medium transition-colors",
              artifact.isBuilding
                ? "border border-[var(--border)] bg-[var(--surface-2)]/80 text-foreground"
                : "bg-foreground text-background group-hover/artifact:opacity-90",
            )}
          >
            <span>{artifact.isBuilding ? t("preview.watchLive") : t("preview.openPreview")}</span>
            <ChevronRight className="size-3.5 rtl:rotate-180" />
          </span>
        </div>
      </div>
    </div>
  );
}
