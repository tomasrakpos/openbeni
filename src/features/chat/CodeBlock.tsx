// chat feature: CodeBlock; change its UI/flow here and keep related state/API calls in sync.
import { Check, Code2, Copy, Play, X } from "lucide-react";
import DOMPurify from "dompurify";
import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { extractCodeBlocks, languageFromExtension } from "@/lib/codefiles";
import { buildPreviewHtml } from "@/lib/previewHtml";
import { copyToClipboard } from "@/lib/export";
import { highlightCode } from "@/lib/highlight";
import { useT } from "@/lib/i18n";
import type { VirtualFile } from "@/lib/types";
import { cn } from "@/lib/utils";

const PREVIEWABLE = new Set(["html", "svg", "jsx", "tsx", "xml"]);

interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  className?: string;
}

export function CodeBlock({ code, language = "text", filename, className }: CodeBlockProps) {
  const t = useT();
  const [html, setHtml] = React.useState<string>("");
  const [copied, setCopied] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const deferredCode = React.useDeferredValue(code);
  const lang = normalizeLanguage(language);

  React.useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      highlightCode(deferredCode, lang).then((result) => {
        if (!alive) return;
        // Shiki emits HTML; sanitize it before it ever reaches the DOM.
        setHtml(
          DOMPurify.sanitize(result, {
            USE_PROFILES: { html: true },
            FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "img", "link", "meta"],
            FORBID_ATTR: ["onerror", "onload", "onclick", "srcdoc"],
          }),
        );
      });
    }, 90);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [deferredCode, lang]);

  const onCopy = async () => {
    if (await copyToClipboard(code)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  const canPreview = PREVIEWABLE.has(lang) || (filename ? PREVIEWABLE.has(languageFromExtension(filename)) : false);

  return (
    <div
      className={cn(
        "group/code my-4 overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface-1)] shadow-xs",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface-2)]/60 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <Code2 className="size-3.5 shrink-0 text-[var(--faint)]" aria-hidden />
          <span className="truncate font-mono text-[11px] font-medium text-[var(--muted-foreground)]">
            {filename ?? lang}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {canPreview && (
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              className="inline-flex h-7 items-center gap-1 rounded-[7px] px-2 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--surface-1)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]"
              aria-label={t("code.previewAria")}
            >
              <Play className="size-3" />
              {t("code.preview")}
            </button>
          )}
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex h-7 items-center gap-1 rounded-[7px] px-2 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--surface-1)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]"
            aria-label={t("code.copyAria")}
          >
            {copied ? <Check className="size-3 text-[var(--success)]" /> : <Copy className="size-3" />}
            {copied ? t("common.copied") : t("common.copy")}
          </button>
        </div>
      </div>
      <div className="max-h-[560px] overflow-auto bg-[var(--code-bg)] p-3.5 [contain:paint]">
        {html ? (
          <div className="[&_pre]:m-0 [&_pre]:bg-transparent [&_code]:font-mono" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <pre className="m-0 overflow-x-auto font-mono text-[12.5px] leading-[1.7] text-[var(--foreground-soft)]">
            <code>{code}</code>
          </pre>
        )}
      </div>
      {canPreview && (
        <SnippetPreview open={previewOpen} onOpenChange={setPreviewOpen} code={code} language={lang} filename={filename} />
      )}
    </div>
  );
}

function normalizeLanguage(language: string): string {
  const value = (language || "text").toLowerCase();
  const aliases: Record<string, string> = { js: "javascript", ts: "typescript", py: "python", sh: "bash", html: "html" };
  return aliases[value] ?? value;
}

function SnippetPreview({
  open,
  onOpenChange,
  code,
  language,
  filename,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  code: string;
  language: string;
  filename?: string;
}) {
  const t = useT();
  const files = React.useMemo<VirtualFile[]>(() => {
    if (language === "svg") {
      const blocks = extractCodeBlocks(code);
      const inner = blocks[0]?.content ?? code;
      return [
        {
          path: filename ?? "preview.html",
          language: "html",
          content: `<!doctype html><html><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#0b0e15">${inner}</body></html>`,
        },
      ];
    }
    return [
      {
        path: filename ?? (language === "html" ? "index.html" : `preview.${language === "typescript" ? "tsx" : language}`),
        language,
        content: code,
      },
    ];
  }, [code, filename, language]);
  const built = React.useMemo(() => buildPreviewHtml(files), [files]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent frame className="sm:w-[min(960px,calc(100vw-2rem))] p-0 gap-0">
        <DialogHeader className="flex-row items-center justify-between px-4 py-3 pr-12">
          <DialogTitle className="text-[13px] font-medium">{t("code.snippetPreview")}</DialogTitle>
        </DialogHeader>
        <div className="border-t border-[var(--border)] bg-[var(--surface-2)] p-2">
          <iframe
            title={t("code.snippetPreview")}
            sandbox="allow-scripts"
            srcDoc={built.html}
            className="h-[62vh] w-full rounded-[10px] border border-[var(--border)] bg-white"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-[5px] border border-[var(--border)] bg-[var(--surface-2)] px-1 py-0.5 font-mono text-[0.85em] text-foreground">
      {children}
    </code>
  );
}

export { X as CloseIcon };
