// In-frame Custom Code / Component / CSS / JS Studio rendered inside the
// inspector's <MenuFrame>. Includes a 1-click Paste button so users can paste
// ready-made HTML/CSS/JS components and apply them live onto any element.
import { motion } from "framer-motion";
import { ArrowLeft, Check, ClipboardPaste, Code2, Copy, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/ui/glass-button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CodeInjectMode } from "@/features/preview/previewBridge";
import { copyToClipboard } from "@/lib/export";
import { useT } from "@/lib/i18n";

type CodeTab = "html" | "css" | "js";

export const StudioCodeStudio = React.memo(function StudioCodeStudio({
  elementLabel,
  currentOuterHtml,
  onApply,
  onCancel,
}: {
  elementLabel: string;
  currentOuterHtml: string;
  onApply: (mode: CodeInjectMode, code: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [tab, setTab] = React.useState<CodeTab>("html");
  const [htmlTarget, setHtmlTarget] = React.useState<"replace" | "inside">("replace");
  const [code, setCode] = React.useState("");
  const editorRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    const id = window.setTimeout(() => editorRef.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, []);

  const handlePaste = async () => {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.readText === "function") {
        const clip = await navigator.clipboard.readText();
        if (clip) {
          setCode(clip);
          toast.success(t("preview.studio.pasted"));
          editorRef.current?.focus();
          return;
        }
      }
      editorRef.current?.focus();
      toast.info(t("preview.studio.pasteManualHint"));
    } catch {
      editorRef.current?.focus();
      toast.info(t("preview.studio.pasteManualHint"));
    }
  };

  const handleCopyCurrent = () => {
    if (!currentOuterHtml) return;
    void copyToClipboard(currentOuterHtml).then(() => {
      toast.success(t("preview.studio.codeCopied"));
    });
  };

  const handleApply = () => {
    const clean = code.trim();
    if (!clean) return;
    const mode: CodeInjectMode = tab === "html" ? htmlTarget : tab;
    onApply(mode, clean);
  };

  const placeholder =
    tab === "html"
      ? t("preview.studio.codePlaceholderHtml")
      : tab === "css"
        ? t("preview.studio.codePlaceholderCss")
        : t("preview.studio.codePlaceholderJs");

  return (
    <motion.div
      dir="ltr"
      initial={{ opacity: 0, x: 18 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 18 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <button
          type="button"
          onClick={onCancel}
          aria-label={t("common.back")}
          className="grid size-6 shrink-0 place-items-center rounded-[7px] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--surface-2)] hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
        </button>
        <span className="grid size-5 shrink-0 place-items-center rounded-[6px] bg-[var(--primary-soft)] text-[var(--primary)]">
          <Code2 className="size-3" />
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] font-semibold text-foreground">
          {t("preview.studio.codeTitle")} · {elementLabel}
        </span>
      </div>

      {/* Mode tabs + 1-click Paste toolbar */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain p-2.5">
        <Tabs value={tab} onValueChange={(v) => setTab(v as CodeTab)}>
          <TabsList className="w-full">
            <TabsTrigger value="html" className="flex-1 text-[10.5px]">
              {t("preview.studio.codeTabHtml")}
            </TabsTrigger>
            <TabsTrigger value="css" className="flex-1 text-[10.5px]">
              CSS
            </TabsTrigger>
            <TabsTrigger value="js" className="flex-1 text-[10.5px]">
              {t("preview.studio.codeTabJs")}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {tab === "html" ? (
          <Tabs value={htmlTarget} onValueChange={(v) => setHtmlTarget(v as "replace" | "inside")}>
            <TabsList className="w-full">
              <TabsTrigger value="replace" className="flex-1 text-[10px]">
                {t("preview.studio.codeReplace")}
              </TabsTrigger>
              <TabsTrigger value="inside" className="flex-1 text-[10px]">
                {t("preview.studio.codeInside")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}

        {/* Action Strip: 1-Click Paste + Load/Copy Current + Clear */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => void handlePaste()}
            className="inline-flex h-7 items-center gap-1.5 rounded-[9px] border border-[var(--primary)]/40 bg-[var(--primary-soft)] px-2.5 text-[10.5px] font-semibold text-[var(--primary)] transition-colors hover:bg-[color-mix(in_oklab,var(--primary)_22%,transparent)] active:scale-[0.97]"
          >
            <ClipboardPaste className="size-3.5" />
            <span>{t("preview.studio.paste")}</span>
          </button>

          {tab === "html" && currentOuterHtml ? (
            <button
              type="button"
              onClick={() => setCode(currentOuterHtml)}
              className="inline-flex h-7 items-center gap-1 rounded-[9px] border border-[var(--border-strong)] bg-[var(--surface-2)] px-2 text-[10px] font-medium text-foreground transition-colors hover:border-[var(--primary)]/40"
            >
              <Code2 className="size-3" />
              <span>{t("preview.studio.loadCurrent")}</span>
            </button>
          ) : null}

          {currentOuterHtml ? (
            <button
              type="button"
              onClick={handleCopyCurrent}
              title={t("preview.studio.copyCurrent")}
              className="grid size-7 place-items-center rounded-[9px] border border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted-foreground)] transition-colors hover:text-foreground"
            >
              <Copy className="size-3" />
            </button>
          ) : null}

          {code ? (
            <button
              type="button"
              onClick={() => setCode("")}
              title={t("preview.studio.clearCode")}
              className="ml-auto grid size-7 place-items-center rounded-[9px] border border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted-foreground)] transition-colors hover:text-[var(--destructive)]"
            >
              <Trash2 className="size-3" />
            </button>
          ) : null}
        </div>

        {/* Code Textarea */}
        <textarea
          ref={editorRef}
          dir="ltr"
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Tab") {
              e.preventDefault();
              const el = e.currentTarget;
              const start = el.selectionStart;
              const end = el.selectionEnd;
              const next = code.slice(0, start) + "  " + code.slice(end);
              setCode(next);
              window.requestAnimationFrame(() => {
                el.selectionStart = el.selectionEnd = start + 2;
              });
            } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              handleApply();
            }
          }}
          placeholder={placeholder}
          className="min-h-[112px] w-full flex-1 resize-none rounded-[12px] border border-[var(--border-strong)] bg-[color-mix(in_oklab,var(--code-bg,var(--surface-2))_86%,transparent)] p-2.5 font-mono text-[11px] leading-relaxed text-foreground outline-none placeholder:text-[var(--faint)] focus:border-[var(--primary)]"
        />
      </div>

      {/* Footer */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--border)] px-3 py-2">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--surface-2)] hover:text-foreground"
        >
          {t("common.cancel")}
        </button>
        <GlassButton
          variant="pill"
          active={code.trim().length > 0}
          disabled={!code.trim()}
          onClick={handleApply}
        >
          <Check className="size-3.5" />
          <span>{t("preview.studio.codeApply")}</span>
        </GlassButton>
      </div>
    </motion.div>
  );
});
