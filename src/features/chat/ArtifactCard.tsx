// chat feature: ArtifactCard — unified in-chat build result card with collapsible
// build steps, live 16:9 scaled preview thumbnail, and spring-jelly Preview / Code
// action buttons. Card chrome is intentionally kept in English regardless of site
// language so layout, metrics, and actions stay crisp and balanced.
import { Loader2, Terminal } from "lucide-react";
import * as React from "react";
import { TextShimmer } from "@/components/ui/text-shimmer";
import type { ChatArtifactSplit } from "@/lib/codefiles";
import { useJellyStretch } from "@/lib/useJellyStretch";
import type { VirtualFile } from "@/lib/types";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";

interface ArtifactCardProps {
  messageId: string;
  artifact: ChatArtifactSplit;
  skillMode?: string | null;
}

const THUMB_LOCK_STYLE =
  "<style data-oh-thumb-lock>html,body{width:1280px!important;height:720px!important;min-height:720px!important;max-width:1280px!important;max-height:720px!important;overflow:hidden!important;scrollbar-width:none!important}::-webkit-scrollbar{display:none!important}</style>";

const THUMB_SANDBOX_SHIM =
  "<script data-oh-thumb-shim>(function(){try{window.alert=window.confirm=window.prompt=function(){};}catch(_){}try{var s=window.localStorage;void s;}catch(_){try{var m={};var api={getItem:function(k){return Object.prototype.hasOwnProperty.call(m,k)?m[k]:null},setItem:function(k,v){m[k]=String(v)},removeItem:function(k){delete m[k]},clear:function(){m={}}};Object.defineProperty(window,'localStorage',{value:api,configurable:true});Object.defineProperty(window,'sessionStorage',{value:api,configurable:true});}catch(_){}}})();</script>";

/**
 * Lightweight preview HTML builder exclusively for the non-interactive 16:9 card
 * thumbnail. Avoids importing the ~75 KB Preview Studio bridge so the initial
 * chat bundle stays small and thumbnails never emit postMessage events or break
 * card layout in mobile/WebKit viewports.
 */
export function buildCardThumbnailHtml(files: VirtualFile[]): string | null {
  if (files.length === 0) return null;

  const entry =
    files.find((f) => f.path === "index.html") ??
    files.find((f) => f.language === "html");

  if (entry) {
    const byPath = new Map(files.map((f) => [f.path.replace(/^\.?\//, ""), f]));
    const lookup = (ref: string) => byPath.get(ref.replace(/^\.?\//, ""));

    let html = entry.content.replace(
      /<link\b[^>]*href=["']([^"']+)["'][^>]*>/gi,
      (tag, href: string) => {
        const file = lookup(href);
        if (!file || file.language !== "css") return tag;
        return `<style>\n${file.content}\n</style>`;
      },
    );
    html = html.replace(
      /<script\b[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi,
      (tag, src: string) => {
        const file = lookup(src);
        if (!file) return tag;
        return `<script>\n${file.content}\n</script>`;
      },
    );

    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head[^>]*>/i, (m) => `${m}${THUMB_SANDBOX_SHIM}`);
      if (/<\/head>/i.test(html)) {
        return html.replace(/<\/head>/i, `${THUMB_LOCK_STYLE}</head>`);
      }
      return html.replace(/<head[^>]*>/i, (m) => `${m}${THUMB_LOCK_STYLE}`);
    }
    if (/<html[^>]*>/i.test(html)) {
      return html.replace(
        /<html[^>]*>/i,
        (m) => `${m}<head>${THUMB_SANDBOX_SHIM}${THUMB_LOCK_STYLE}</head>`,
      );
    }
    return `<!doctype html><html><head><meta charset="utf-8">${THUMB_SANDBOX_SHIM}${THUMB_LOCK_STYLE}</head><body>${html}</body></html>`;
  }

  const css = files
    .filter((f) => f.language === "css")
    .map((f) => f.content)
    .join("\n");
  const js = files
    .filter((f) => f.language === "javascript")
    .map((f) => f.content)
    .join("\n");
  if (!css && !js) return null;

  return `<!doctype html><html><head><meta charset="utf-8">${THUMB_SANDBOX_SHIM}<style>${css}</style>${THUMB_LOCK_STYLE}</head><body><div id="app"></div><script>${js}</script></body></html>`;
}

function deriveProjectKind(files: VirtualFile[], skillMode?: string | null): string {
  if (skillMode === "game") return "Game";
  if (skillMode === "website") return "Website";
  const hasHtml = files.some((f) => f.language === "html" || f.path.endsWith(".html"));
  if (hasHtml) return "Website";
  const hasApp = files.some((f) =>
    f.language === "jsx" || f.language === "tsx" || f.language === "javascript" || f.language === "typescript",
  );
  if (hasApp) return "App";
  return "Code";
}

export function ArtifactCard({ messageId, artifact, skillMode }: ArtifactCardProps) {
  const setSelectedArtifactMessageId = useUiStore((s) => s.setSelectedArtifactMessageId);
  const setRightTab = useUiStore((s) => s.setRightTab);
  const setMobilePanelOpen = useUiStore((s) => s.setMobilePanelOpen);
  const updateSettings = useSettingsStore((s) => s.update);

  const [stepsExpanded, setStepsExpanded] = React.useState(false);
  const [thumbScale, setThumbScale] = React.useState(0);
  const shotRef = React.useRef<HTMLDivElement | null>(null);
  const previewBtnRef = useJellyStretch<HTMLButtonElement>();
  const codeBtnRef = useJellyStretch<HTMLButtonElement>();

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

  // Build a stable signature for file contents so streaming trailing prose
  // (`afterText`) never rebuilds or flickers the live thumbnail iframe.
  const filesSignature = React.useMemo(() => {
    if (artifact.isBuilding || artifact.files.length === 0) return "";
    return artifact.files.map((f) => `${f.path}:${f.content.length}:${f.content.slice(-32)}`).join("|");
  }, [artifact.files, artifact.isBuilding]);

  const filesRef = React.useRef(artifact.files);
  filesRef.current = artifact.files;

  const thumbHtml = React.useMemo(() => {
    if (!filesSignature) return null;
    return buildCardThumbnailHtml(filesRef.current);
  }, [filesSignature]);

  // Measure the 16:9 thumbnail box from initial mount (even while building) so
  // the exact scale factor is already ready on frame 0 when the iframe mounts.
  React.useLayoutEffect(() => {
    const shot = shotRef.current;
    if (!shot) return;

    const fit = () => {
      const w = shot.getBoundingClientRect().width || shot.clientWidth;
      if (w > 0) {
        const nextScale = w / 1280;
        shot.style.setProperty("--brc-scale", String(nextScale));
        setThumbScale((prev) => (Math.abs(prev - nextScale) < 0.0005 ? prev : nextScale));
      }
    };

    fit();
    const raf = window.requestAnimationFrame(fit);
    const ro = new ResizeObserver(fit);
    ro.observe(shot);
    window.addEventListener("resize", fit);

    return () => {
      window.cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);

  const showStepsList = artifact.isBuilding || stepsExpanded;
  const stepCount = artifact.steps.length;
  const stepsSummary = artifact.isBuilding
    ? "Building..."
    : stepCount === 1
      ? "1 step completed"
      : `${stepCount} steps completed`;
  const kindLabel = deriveProjectKind(artifact.files, skillMode);
  const linesLabel =
    artifact.totalLines > 0
      ? `${artifact.totalLines.toLocaleString("en-US")} lines`
      : null;

  return (
    <div className="my-3 -ms-[42px] w-[calc(100%+42px)] sm:ms-0 sm:w-full">
      <div dir="ltr" lang="en" className="brc mx-auto sm:mx-0">
        {stepCount > 0 ? (
          <>
            <button
              type="button"
              className="brc-steps"
              aria-expanded={showStepsList}
              onClick={() => {
                if (!artifact.isBuilding) setStepsExpanded((v) => !v);
              }}
            >
              <span className="brc-ok" aria-hidden="true">
                {artifact.isBuilding ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </span>
              <span className="min-w-0 truncate">
                {artifact.isBuilding ? (
                  <TextShimmer>{stepsSummary}</TextShimmer>
                ) : (
                  stepsSummary
                )}
              </span>
              <span className="brc-sp" />
              {artifact.isBuilding ? (
                <span className="font-mono text-[11px] tabular-nums text-[var(--faint)]">
                  {artifact.completedSteps}/{stepCount}
                </span>
              ) : (
                <svg
                  className="brc-chev"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              )}
            </button>

            {showStepsList ? (
              <ul className="brc-list">
                {artifact.steps.map((step) => (
                  <li key={step.id} data-status={step.status} dir="auto">
                    <span className="min-w-0 truncate">{step.label}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}

        <div
          ref={shotRef}
          className="brc-shot"
          role="button"
          tabIndex={0}
          aria-label={`Open ${artifact.title} preview`}
          onClick={() => openWorkspace("preview")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openWorkspace("preview");
            }
          }}
        >
          {thumbHtml && thumbScale > 0 ? (
            <div className="brc-shot-stage" aria-hidden="true">
              <iframe
                srcDoc={thumbHtml}
                title=""
                width={1280}
                height={720}
                scrolling="no"
                tabIndex={-1}
                aria-hidden="true"
                sandbox="allow-scripts"
                style={{ transform: `scale(${thumbScale})` }}
              />
            </div>
          ) : (
            <div className="brc-ph" aria-hidden="true">
              {artifact.isBuilding ? (
                <>
                  <Loader2 className="size-5 animate-spin" />
                  <span className="text-[11.5px] font-medium text-[var(--muted-foreground)]">
                    Rendering preview...
                  </span>
                </>
              ) : (
                <Terminal className="size-6 opacity-80" />
              )}
            </div>
          )}
        </div>

        <div className="brc-body">
          <h4 className="brc-title" dir="auto">
            {artifact.title}
          </h4>
          <div className="brc-meta">
            <span className="brc-kind">{kindLabel}</span>
            {linesLabel ? <span>{linesLabel}</span> : null}
          </div>
        </div>

        <div className="brc-act">
          <button
            ref={previewBtnRef}
            type="button"
            className="brc-gb brc-gb-primary"
            onClick={() => openWorkspace("preview")}
          >
            <span className="brc-ic" aria-hidden="true">
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </span>
            <span>Preview</span>
          </button>
          <button
            ref={codeBtnRef}
            type="button"
            className="brc-gb brc-gb-secondary"
            onClick={() => openWorkspace("files")}
          >
            <span className="brc-ic" aria-hidden="true">
              <Terminal className="size-[17px]" strokeWidth={2} />
            </span>
            <span>Code</span>
          </button>
        </div>
      </div>
    </div>
  );
}
