// layout feature: RightPanel; change its UI/flow here and keep related state/API calls in sync.
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  Download,
  Eye,
  FileCode2,
  FilePlus2,
  Folder,
  FolderOpen,
  History,
  Loader2,
  Maximize2,
  Monitor,
  PanelRightClose,
  RefreshCw,
  RotateCcw,
  Save,
  Smartphone,
  Tablet,
  Terminal,
  Trash2,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { CopyButton } from "@/components/CopyButton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { db } from "@/db";
import { PreviewCropOverlay } from "@/features/preview/PreviewCropOverlay";
import {
  AiElementPromptPopover,
  ManualElementInspectorPopover,
} from "@/features/preview/PreviewElementPopovers";
import { PreviewStudioBar } from "@/features/preview/PreviewStudioBar";
import type {
  CodeInjectMode,
  CropRect,
  ElementStylePatch,
  PreviewStudioMode,
  SelectedElementInfo,
  StudioFromIframeMessage,
} from "@/features/preview/previewBridge";
import { useAuthStore } from "@/stores/auth";
import { activeThread, useChatsStore } from "@/stores/chats";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore, type PreviewDevice, type RightTab } from "@/stores/ui";
import {
  buildPreviewHtml,
  extractProjectFiles,
  extractStreamingProjectFiles,
  fileTree,
  splitChatAndArtifact,
  type ChatArtifactSplit,
  type TreeNode,
} from "@/lib/codefiles";
import { diffLines, diffStat } from "@/lib/diff";
import { copyToClipboard, downloadText, downloadZip, safeFilename } from "@/lib/export";
import { useT } from "@/lib/i18n";
import { uid } from "@/lib/id";
import { formatRelativeTime } from "@/lib/tokens";
import { cn } from "@/lib/utils";
import type { Chat, Message, ProjectVersion, VirtualFile } from "@/lib/types";

interface ConsoleLine {
  type: "log" | "warn" | "error" | "info" | "debug";
  text: string;
  at: number;
}

interface RestoredVersion {
  messageId: string;
  files: VirtualFile[];
  versionId: string;
}

const DEVICE_WIDTH: Record<PreviewDevice, string> = {
  desktop: "100%",
  tablet: "820px",
  mobile: "390px",
};

function PanelEmpty({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <span className="grid size-11 place-items-center rounded-[14px] border border-[var(--border)] bg-[var(--surface-2)] text-[var(--faint)]">
        {icon}
      </span>
      <p className="text-[13px] font-medium text-foreground">{title}</p>
      <p className="max-w-[260px] text-balance text-[11.5px] leading-relaxed text-[var(--muted-foreground)]">
        {description}
      </p>
    </div>
  );
}

interface PanelFilesState {
  candidates: { message: Message; files: VirtualFile[]; isStreaming?: boolean }[];
  selected: { message: Message; files: VirtualFile[]; isStreaming?: boolean } | null;
  files: VirtualFile[];
  restored: RestoredVersion | null;
  chat: Chat | null;
  isStreamingActive: boolean;
  streamingArtifact: ChatArtifactSplit | null;
  studioMode: PreviewStudioMode;
  setStudioMode: React.Dispatch<React.SetStateAction<PreviewStudioMode>>;
  selectMessage: (messageId: string) => void;
  restoreVersion: (version: ProjectVersion) => void;
  saveManualHtml: (nextHtml: string) => Promise<void>;
  clearRestored: () => void;
}

function usePanelFilesState(): PanelFilesState {
  const t = useT();
  const messages = useChatsStore((s) => s.messages);
  const chats = useChatsStore((s) => s.chats);
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const streaming = useChatsStore((s) => s.streaming);
  const lang = useSettingsStore((s) => s.settings.lang);
  const requestedMessageId = useUiStore((s) => s.selectedArtifactMessageId);
  const setRequestedMessageId = useUiStore((s) => s.setSelectedArtifactMessageId);
  const chat = chats.find((c) => c.id === activeChatId) ?? null;
  const thread = React.useMemo(() => activeThread(messages, chat), [messages, chat]);
  const isStreamingActive = Boolean(streaming && chat && streaming.chatId === chat.id);

  const streamingArtifact = React.useMemo(() => {
    if (!isStreamingActive || !streaming) return null;
    return splitChatAndArtifact(streaming.content, true, lang);
  }, [isStreamingActive, streaming, lang]);

  const candidates = React.useMemo(() => {
    const out: { message: Message; files: VirtualFile[]; isStreaming?: boolean }[] = [];
    for (const message of thread) {
      if (message.role !== "assistant") continue;
      const isLive = Boolean(streaming && streaming.messageId === message.id);
      const raw = isLive ? streaming?.content ?? "" : message.content;
      if (!raw.trim()) continue;
      const files = isLive ? extractStreamingProjectFiles(raw).files : extractProjectFiles(raw);
      if (files.length > 0) {
        out.push({ message, files, isStreaming: isLive });
      }
    }
    return out.reverse();
  }, [thread, streaming]);

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [restored, setRestored] = React.useState<RestoredVersion | null>(null);
  const [studioMode, setStudioMode] = React.useState<PreviewStudioMode>("off");

  // Honor explicit ArtifactCard clicks from chat.
  React.useEffect(() => {
    if (!requestedMessageId) return;
    if (candidates.some((entry) => entry.message.id === requestedMessageId)) {
      setRestored(null);
      setSelectedId(requestedMessageId);
    }
    setRequestedMessageId(null);
  }, [requestedMessageId, candidates, setRequestedMessageId]);

  // Follow the latest completed or streaming project automatically.
  React.useEffect(() => {
    if (candidates.length === 0) {
      setSelectedId(null);
      return;
    }
    if (isStreamingActive && streaming && candidates[0]?.message.id === streaming.messageId) {
      setSelectedId(streaming.messageId);
      return;
    }
    if (!selectedId || !candidates.some((entry) => entry.message.id === selectedId)) {
      setSelectedId(candidates[0]?.message.id ?? null);
    }
  }, [candidates, selectedId, isStreamingActive, streaming]);

  const selected = candidates.find((entry) => entry.message.id === selectedId) ?? candidates[0] ?? null;
  const files =
    restored && selected && restored.messageId === selected.message.id ? restored.files : selected?.files ?? [];

  const selectMessage = React.useCallback((messageId: string) => {
    setRestored(null);
    setSelectedId(messageId);
  }, []);

  const restoreVersion = React.useCallback(
    (version: ProjectVersion) => {
      setSelectedId(version.messageId);
      setRestored({ messageId: version.messageId, files: version.files, versionId: version.id });
      toast.success(t("preview.restored"));
    },
    [t],
  );

  const clearRestored = React.useCallback(() => setRestored(null), []);

  const saveManualHtml = React.useCallback(
    async (nextHtml: string) => {
      if (!selected || !chat) return;
      const baseFiles =
        restored && restored.messageId === selected.message.id ? restored.files : selected.files;
      const entryIndex = baseFiles.findIndex(
        (f) => f.path === "index.html" || f.language === "html",
      );
      const updatedFiles: VirtualFile[] =
        entryIndex >= 0
          ? baseFiles.map((f, idx) => (idx === entryIndex ? { ...f, content: nextHtml } : f))
          : [{ path: "index.html", language: "html", content: nextHtml }, ...baseFiles];
      const versionId = uid("ver");
      const version: ProjectVersion = {
        id: versionId,
        chatId: chat.id,
        messageId: selected.message.id,
        label: `Visual edit`,
        files: updatedFiles,
        createdAt: Date.now(),
      };
      await db.versions.put(version);
      setRestored({ messageId: selected.message.id, files: updatedFiles, versionId });
    },
    [chat, restored, selected],
  );

  return {
    candidates,
    selected,
    files,
    restored,
    chat,
    isStreamingActive,
    streamingArtifact,
    studioMode,
    setStudioMode,
    selectMessage,
    restoreVersion,
    saveManualHtml,
    clearRestored,
  };
}

const PanelContext = React.createContext<PanelFilesState | null>(null);

function usePanelContext(): PanelFilesState {
  const value = React.useContext(PanelContext);
  if (!value) throw new Error("Panel context is missing");
  return value;
}

function dataUrlToFile(dataUrl: string, filename: string): File {
  const [header, base64] = dataUrl.split(",");
  const mimeMatch = header?.match(/data:([^;]+)/i);
  const mime = mimeMatch?.[1] || "image/png";
  const bin = atob(base64 || "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new File([bytes], filename, { type: mime });
}

function PreviewPane() {
  const t = useT();
  const {
    candidates,
    selected,
    files,
    restored,
    isStreamingActive,
    streamingArtifact,
    studioMode,
    setStudioMode,
    selectMessage,
    saveManualHtml,
    clearRestored,
  } = usePanelContext();
  const previewDevice = useUiStore((s) => s.previewDevice);
  const setPreviewDevice = useUiStore((s) => s.setPreviewDevice);
  const setRightTab = useUiStore((s) => s.setRightTab);
  const setAuthGateOpen = useUiStore((s) => s.setAuthGateOpen);
  const [consoleOpen, setConsoleOpen] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [lines, setLines] = React.useState<ConsoleLine[]>([]);

  // Preview Studio tools state (capture, AI element edit, manual visual edit)
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const [selectedElement, setSelectedElement] = React.useState<SelectedElementInfo | null>(null);
  const [capturing, setCapturing] = React.useState(false);
  const [captureCount, setCaptureCount] = React.useState(0);
  const [aiSubmitting, setAiSubmitting] = React.useState(false);
  const pendingCaptureIdRef = React.useRef<string | null>(null);
  const pendingExportIdRef = React.useRef<string | null>(null);
  const captureSeqRef = React.useRef(0);
  const pendingPatchRef = React.useRef<ElementStylePatch | null>(null);
  const patchRafRef = React.useRef(0);

  const postToIframe = React.useCallback((payload: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage({ __ohStudio: true, ...payload }, "*");
  }, []);

  React.useEffect(() => {
    return () => {
      if (patchRafRef.current) window.cancelAnimationFrame(patchRafRef.current);
    };
  }, []);

  // Sync active studio mode into the preview iframe whenever mode changes.
  React.useEffect(() => {
    postToIframe({ type: "set-mode", mode: studioMode });
    if (studioMode !== "ai-pick" && studioMode !== "manual-edit") {
      setSelectedElement(null);
    }
    if (studioMode !== "capture") {
      setCaptureCount(0);
    }
  }, [studioMode, postToIframe]);

  // Esc closes open element drawer first, then exits active studio mode.
  React.useEffect(() => {
    if (studioMode === "off" && !selectedElement) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (selectedElement) {
        setSelectedElement(null);
        postToIframe({ type: "clear-selection" });
      } else {
        setStudioMode("off");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [studioMode, selectedElement, postToIframe, setStudioMode]);

  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const raw = event.data as Record<string, unknown> | null | undefined;
      if (!raw || typeof raw !== "object") return;

      if (raw.__apiset === true) {
        const logData = raw as { __apiset: true; type?: string; args?: unknown[] };
        const type = (logData.type === "warn" || logData.type === "error" || logData.type === "info" || logData.type === "debug"
          ? logData.type
          : "log") as ConsoleLine["type"];
        const text = (logData.args ?? [])
          .map((value) => {
            if (typeof value === "string") return value;
            try {
              return JSON.stringify(value);
            } catch {
              return String(value);
            }
          })
          .join(" ");
        setLines((current) => [...current.slice(-119), { type, text, at: Date.now() }]);
        return;
      }

      if (raw.__ohStudio !== true) return;
      if (iframeRef.current && event.source !== iframeRef.current.contentWindow) return;
      const data = raw as unknown as StudioFromIframeMessage;

      if (data.type === "element-selected" && data.info) {
        setSelectedElement(data.info);
        return;
      }

      if (data.type === "element-deleted") {
        setSelectedElement(null);
        toast.success(t("preview.studio.deleted"));
        return;
      }

      if (data.type === "element-duplicated") {
        toast.success(t("preview.studio.duplicated"));
        return;
      }

      if (data.type === "code-applied") {
        if (data.ok) toast.success(t("preview.studio.codeApplied"));
        else toast.error(data.error || t("preview.studio.codeFailed"));
        return;
      }

      if (data.type === "capture-result" && data.requestId === pendingCaptureIdRef.current && data.dataUrl) {
        pendingCaptureIdRef.current = null;
        setCapturing(false);
        captureSeqRef.current += 1;
        const seq = captureSeqRef.current;
        try {
          const file = dataUrlToFile(data.dataUrl, `preview-capture-${seq}.png`);
          void useChatsStore
            .getState()
            .addFiles([file])
            .then((res) => {
              if (res.added > 0) {
                setCaptureCount((n) => n + 1);
                toast.success(t("preview.studio.captureAdded"));
              } else if (res.errors.length > 0) {
                toast.error(t(res.errors[0] ?? "preview.studio.captureFailed"));
              }
            });
        } catch {
          toast.error(t("preview.studio.captureFailed"));
        }
        return;
      }

      if (data.type === "capture-error" && data.requestId === pendingCaptureIdRef.current) {
        pendingCaptureIdRef.current = null;
        setCapturing(false);
        toast.error(t("preview.studio.captureFailed"));
        return;
      }

      if (data.type === "export-html-result" && data.requestId === pendingExportIdRef.current && data.html) {
        pendingExportIdRef.current = null;
        void saveManualHtml(data.html).then(() => {
          setSelectedElement(null);
          setStudioMode("off");
          postToIframe({ type: "clear-selection" });
          toast.success(t("preview.studio.saved"));
        });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [postToIframe, saveManualHtml, setStudioMode, t]);

  const built = React.useMemo(() => buildPreviewHtml(files), [files]);

  const reload = () => {
    setLines([]);
    setSelectedElement(null);
    setReloadKey((value) => value + 1);
  };

  const handleConfirmCapture = React.useCallback(
    (rect: CropRect) => {
      const requestId = uid("cap");
      pendingCaptureIdRef.current = requestId;
      setCapturing(true);
      postToIframe({ type: "capture-region", rect, requestId });
      window.setTimeout(() => {
        if (pendingCaptureIdRef.current === requestId) {
          pendingCaptureIdRef.current = null;
          setCapturing(false);
          toast.error(t("preview.studio.captureFailed"));
        }
      }, 6000);
    },
    [postToIframe, t],
  );

  const handleAiElementSubmit = React.useCallback(
    async (instruction: string) => {
      if (!selectedElement) return;
      if (!useAuthStore.getState().signedIn) {
        setAuthGateOpen(true);
        return;
      }
      setAiSubmitting(true);
      const target = selectedElement;
      const snippet = target.outerHtml.slice(0, 700);
      const formattedPrompt = [
        `Update ONLY this selected element in the current preview (keep everything else intact):`,
        `- Element: \`${target.label}\``,
        `- Selector: \`${target.selector}\``,
        target.text ? `- Current text: "${target.text.slice(0, 120)}"` : null,
        snippet ? `- Current HTML:\n\`\`\`html\n${snippet}\n\`\`\`` : null,
        `\nRequested change:\n${instruction}`,
      ]
        .filter(Boolean)
        .join("\n");

      setSelectedElement(null);
      setStudioMode("off");
      postToIframe({ type: "clear-selection" });
      toast.success(t("preview.studio.aiSent"));
      try {
        await useChatsStore.getState().send(formattedPrompt);
      } finally {
        setAiSubmitting(false);
      }
    },
    [selectedElement, setAuthGateOpen, setStudioMode, postToIframe, t],
  );

  // Coalesce high-frequency slider updates to 1 merged postMessage per animation frame.
  const handleManualPatch = React.useCallback(
    (patch: ElementStylePatch) => {
      pendingPatchRef.current = { ...(pendingPatchRef.current ?? {}), ...patch };
      if (patchRafRef.current) return;
      patchRafRef.current = window.requestAnimationFrame(() => {
        patchRafRef.current = 0;
        const merged = pendingPatchRef.current;
        pendingPatchRef.current = null;
        if (merged) postToIframe({ type: "apply-style", patch: merged });
      });
    },
    [postToIframe],
  );

  const handleManualReset = React.useCallback(() => {
    postToIframe({ type: "reset-element" });
  }, [postToIframe]);

  const handleSelectParent = React.useCallback(() => {
    postToIframe({ type: "select-parent" });
  }, [postToIframe]);

  const handleReorder = React.useCallback(
    (dir: "up" | "down") => {
      postToIframe({ type: "reorder-element", dir });
    },
    [postToIframe],
  );

  const handleInjectCode = React.useCallback(
    (mode: CodeInjectMode, code: string) => {
      postToIframe({ type: "inject-code", mode, code });
    },
    [postToIframe],
  );

  const handleManualDuplicate = React.useCallback(() => {
    postToIframe({ type: "duplicate-element" });
  }, [postToIframe]);

  const handleManualDelete = React.useCallback(() => {
    postToIframe({ type: "delete-element" });
  }, [postToIframe]);

  const handleManualSave = React.useCallback(() => {
    const requestId = uid("exp");
    pendingExportIdRef.current = requestId;
    postToIframe({ type: "export-html", requestId });
  }, [postToIframe]);

  const closeElementPopover = React.useCallback(() => {
    setSelectedElement(null);
    postToIframe({ type: "clear-selection" });
  }, [postToIframe]);

  const closeManualEditor = React.useCallback(() => {
    setSelectedElement(null);
    setStudioMode("off");
    postToIframe({ type: "clear-selection" });
  }, [postToIframe, setStudioMode]);

  const handleSelectStudioMode = React.useCallback(
    (next: PreviewStudioMode) => {
      setSelectedElement(null);
      setStudioMode(next);
    },
    [setStudioMode],
  );

  const openExternal = () => {
    if (!built.html) return;
    const blob = new Blob([built.html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  // While the model is actively building the selected preview (or hasn't closed
  // the code fence yet), show a sleek live-building canvas inside the preview
  // pane so users can swipe in immediately and watch progress in real time.
  const showLiveBuilding = Boolean(
    isStreamingActive && (!selected || selected.isStreaming) && streamingArtifact?.isBuilding,
  );

  if (showLiveBuilding && streamingArtifact) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 py-8">
        <div className="w-full max-w-[360px] rounded-[18px] border border-[var(--border-strong)] bg-[color-mix(in_oklab,var(--surface-1)_80%,transparent)] p-5 shadow-sm backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-[12px] border border-[color-mix(in_oklab,var(--accent)_35%,transparent)] bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] text-[var(--accent)]">
              <Loader2 className="size-4.5 animate-spin" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-semibold text-foreground">
                {streamingArtifact.title}
              </p>
              <p className="mt-0.5 text-[11.5px] text-[var(--muted-foreground)]">
                {t("preview.building")}
              </p>
            </div>
            {streamingArtifact.totalLines > 0 ? (
              <span className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 font-mono text-[10px] tabular-nums text-[var(--muted-foreground)]">
                {t("preview.linesCount", { n: streamingArtifact.totalLines })}
              </span>
            ) : null}
          </div>

          {streamingArtifact.steps.length > 0 ? (
            <ul className="mt-4 space-y-2 border-t border-[var(--border)]/70 pt-3.5">
              {streamingArtifact.steps.map((step) => (
                <li key={step.id} className="flex items-center gap-2.5 text-[12px]">
                  {step.status === "active" ? (
                    <span className="relative flex size-4 shrink-0 items-center justify-center">
                      <span className="absolute inline-flex size-3 animate-ping rounded-full bg-[var(--accent)]/45" />
                      <span className="relative inline-flex size-1.5 rounded-full bg-[var(--accent)]" />
                    </span>
                  ) : step.status === "done" ? (
                    <span className="grid size-4 shrink-0 place-items-center rounded-full bg-[var(--success-soft)] text-[var(--success)]">
                      <Check className="size-2.5 stroke-[2.5]" />
                    </span>
                  ) : (
                    <span className="grid size-4 shrink-0 place-items-center">
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
            </ul>
          ) : null}

          <p className="mt-4 text-[11px] leading-relaxed text-[var(--faint)]">
            {t("preview.buildingHint")}
          </p>

          {streamingArtifact.files.length > 0 ? (
            <button
              type="button"
              onClick={() => setRightTab("files")}
              className="mt-3.5 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)]/75 px-3 text-[11.5px] font-medium text-foreground transition-colors hover:bg-[var(--surface-2)]"
            >
              <Code2 className="size-3.5" />
              <span>{t("preview.viewCode")}</span>
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (!selected) {
    return (
      <PanelEmpty
        icon={<Eye className="size-5" />}
        title={t("preview.empty")}
        description={t("preview.emptyDesc")}
      />
    );
  }

  const errorLines = lines.filter((line) => line.type === "error").length;
  const hideTopChrome = studioMode === "manual-edit";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AnimatePresence initial={false}>
        {!hideTopChrome ? (
          <motion.div
            key="preview-device-toolbar"
            initial={{ height: 0, opacity: 0, y: -8 }}
            animate={{ height: "auto", opacity: 1, y: 0 }}
            exit={{ height: 0, opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="shrink-0 overflow-hidden"
            style={{ willChange: "height, opacity, transform" }}
          >
            <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border)] px-2.5 py-1.5">
              <Tabs
                value={previewDevice}
                onValueChange={(value) => setPreviewDevice(value as PreviewDevice)}
              >
                <TabsList>
                  <TabsTrigger value="desktop" aria-label={t("preview.desktop")} className="px-2">
                    <Monitor className="size-3.5" />
                  </TabsTrigger>
                  <TabsTrigger value="tablet" aria-label={t("preview.tablet")} className="px-2">
                    <Tablet className="size-3.5" />
                  </TabsTrigger>
                  <TabsTrigger value="mobile" aria-label={t("preview.mobile")} className="px-2">
                    <Smartphone className="size-3.5" />
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              {candidates.length > 1 ? (
                <select
                  value={selected.message.id}
                  onChange={(event) => selectMessage(event.target.value)}
                  aria-label={t("preview.project")}
                  className="h-6 max-w-[120px] rounded-[7px] border border-[var(--border)] bg-[var(--surface-2)] px-1.5 font-mono text-[10px] text-[var(--muted-foreground)] outline-none"
                >
                  {candidates.map((entry, index) => (
                    <option key={entry.message.id} value={entry.message.id}>
                      #{candidates.length - index} · {entry.files.length}f
                    </option>
                  ))}
                </select>
              ) : null}
              <div className="ml-auto flex items-center gap-0.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={reload}
                      aria-label={t("preview.reload")}
                      className="grid size-6 place-items-center rounded-[6px] text-[var(--faint)] transition-colors hover:bg-[var(--surface-2)] hover:text-foreground"
                    >
                      <RefreshCw className="size-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{t("preview.reload")}</TooltipContent>
                </Tooltip>
                <button
                  type="button"
                  onClick={() => setConsoleOpen((value) => !value)}
                  aria-pressed={consoleOpen}
                  className={cn(
                    "inline-flex h-6 items-center gap-1 rounded-[6px] px-1.5 text-[10px] transition-colors hover:bg-[var(--surface-2)]",
                    consoleOpen ? "text-foreground" : "text-[var(--faint)] hover:text-foreground",
                  )}
                >
                  <Terminal className="size-3" />
                  {t("preview.console")}
                  {errorLines > 0 ? (
                    <span className="grid min-w-[14px] place-items-center rounded-full bg-[var(--destructive-soft)] px-1 text-[9px] font-semibold text-[var(--destructive)]">
                      {errorLines}
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={openExternal}
                  aria-label={t("preview.open")}
                  className="grid size-6 place-items-center rounded-[6px] text-[var(--faint)] transition-colors hover:bg-[var(--surface-2)] hover:text-foreground"
                >
                  <Maximize2 className="size-3" />
                </button>
              </div>
            </div>

            {restored ? (
              <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--primary-soft)] px-2.5 py-1 text-[10px] text-[var(--primary)]">
                <span className="inline-flex items-center gap-1.5">
                  <History className="size-3" /> {t("preview.restored")}
                </span>
                <button type="button" onClick={clearRestored} className="hover:underline">
                  {t("preview.project")}
                </button>
              </div>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--surface-2)]/40 p-2">
        <div
          className="relative mx-auto flex min-h-0 w-full flex-1 justify-center overflow-hidden rounded-[10px] border border-[var(--border)] bg-white shadow-sm"
          style={{ maxWidth: DEVICE_WIDTH[previewDevice] }}
        >
          <iframe
            ref={iframeRef}
            key={`${selected.message.id}-${reloadKey}-${previewDevice}-${restored?.versionId ?? "live"}`}
            title={t("preview.title")}
            srcDoc={built.html}
            onLoad={() => {
              if (studioMode !== "off") {
                postToIframe({ type: "set-mode", mode: studioMode });
              }
            }}
            sandbox="allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock"
            referrerPolicy="no-referrer"
            className="h-full min-h-[220px] w-full border-0 bg-white"
          />

          <AnimatePresence>
            {studioMode === "capture" ? (
              <PreviewCropOverlay
                key="crop-overlay"
                capturing={capturing}
                captureCount={captureCount}
                onConfirm={handleConfirmCapture}
                onCancel={() => setStudioMode("off")}
              />
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      {/* Non-blocking docked studio drawers: website above stays 100% visible */}
      <AnimatePresence initial={false}>
        {studioMode === "ai-pick" && selectedElement ? (
          <AiElementPromptPopover
            key="ai-dock-tray"
            element={selectedElement}
            submitting={aiSubmitting}
            onSubmit={(instruction) => void handleAiElementSubmit(instruction)}
            onClose={closeElementPopover}
          />
        ) : null}

        {studioMode === "manual-edit" && selectedElement ? (
          <ManualElementInspectorPopover
            key="manual-dock-tray"
            element={selectedElement}
            onPatch={handleManualPatch}
            onReset={handleManualReset}
            onSelectParent={handleSelectParent}
            onReorder={handleReorder}
            onInjectCode={handleInjectCode}
            onDuplicate={handleManualDuplicate}
            onDelete={handleManualDelete}
            onSave={handleManualSave}
            onClose={closeManualEditor}
          />
        ) : null}
      </AnimatePresence>

      {consoleOpen ? (
        <div className="max-h-[180px] min-h-[92px] shrink-0 overflow-y-auto border-t border-[var(--border)] bg-[var(--code-bg)] px-2.5 py-1.5 font-mono text-[10.5px] leading-relaxed">
          {lines.length === 0 ? (
            <p className="py-3 text-center text-[var(--faint)]">{t("preview.noConsole")}</p>
          ) : (
            <ul className="space-y-0.5">
              {lines.map((line, index) => (
                <li
                  key={`${line.at}-${index}`}
                  className={cn(
                    "flex gap-1.5 break-all",
                    line.type === "error"
                      ? "text-[var(--destructive)]"
                      : line.type === "warn"
                        ? "text-[var(--warning)]"
                        : "text-[var(--foreground-soft)]",
                  )}
                >
                  <span className="shrink-0 select-none opacity-50">›</span>
                  <span>{line.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <PreviewStudioBar
        mode={studioMode}
        disabled={!built.runnable}
        onSelectMode={handleSelectStudioMode}
      />
    </div>
  );
}

function FileTreeNode({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selected: string;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = React.useState(true);
  if (node.file) {
    return (
      <button
        type="button"
        onClick={() => onSelect(node.path)}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-[6px] py-[3px] pr-1.5 text-left font-mono text-[10.5px] transition-colors hover:bg-[var(--surface-2)]",
          selected === node.path ? "bg-[var(--primary-soft)] text-[var(--primary)]" : "text-[var(--muted-foreground)]",
        )}
        style={{ paddingInlineStart: 8 + depth * 12 }}
        title={node.path}
      >
        <FileCode2 className="size-3 shrink-0 opacity-70" />
        <span className="truncate">{node.name}</span>
      </button>
    );
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-1 rounded-[6px] py-[3px] pr-1.5 text-left font-mono text-[10.5px] text-[var(--foreground-soft)] hover:bg-[var(--surface-2)]"
        style={{ paddingInlineStart: 4 + depth * 12 }}
        aria-expanded={open}
      >
        <ChevronRight className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")} />
        {open ? <FolderOpen className="size-3 shrink-0 opacity-70" /> : <Folder className="size-3 shrink-0 opacity-70" />}
        <span className="truncate">{node.name}</span>
      </button>
      {open ? (
        <div>
          {node.children.map((child) => (
            <FileTreeNode key={child.path} node={child} depth={depth + 1} selected={selected} onSelect={onSelect} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FilesPane() {
  const t = useT();
  const { selected, files, chat } = usePanelContext();
  const tree = React.useMemo(() => fileTree(files), [files]);
  const [activePath, setActivePath] = React.useState<string>("");

  React.useEffect(() => {
    if (!files.some((file) => file.path === activePath)) setActivePath(files[0]?.path ?? "");
  }, [files, activePath]);

  const active = files.find((file) => file.path === activePath) ?? files[0];

  if (files.length === 0) {
    return (
      <PanelEmpty
        icon={<FilePlus2 className="size-5" />}
        title={t("preview.noFiles")}
        description={t("preview.emptyDesc")}
      />
    );
  }

  const copyAll = async () => {
    const text = files.map((file) => `/* ${file.path} */\n${file.content}`).join("\n\n");
    const ok = await copyToClipboard(text);
    if (ok) toast.success(t("toast.copied"));
    else toast.error(t("toast.clipboardFailed"));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-2.5 py-1.5">
        <span className="truncate font-mono text-[10px] text-[var(--faint)]">
          {files.length} files · {safeFilename(chat?.title ?? selected?.message.modelId ?? "project")}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={copyAll}
                aria-label={t("preview.copyAll")}
                className="grid size-6 place-items-center rounded-[6px] text-[var(--faint)] hover:bg-[var(--surface-2)] hover:text-foreground"
              >
                <Copy className="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("preview.copyAll")}</TooltipContent>
          </Tooltip>
          <button
            type="button"
            onClick={() => void downloadZip(files, chat?.title ?? "project")}
            className="inline-flex h-6 items-center gap-1 rounded-[6px] px-1.5 text-[10px] text-[var(--faint)] hover:bg-[var(--surface-2)] hover:text-foreground"
          >
            <Download className="size-3" /> ZIP
          </button>
        </div>
      </div>

      <div className="max-h-[30%] shrink-0 overflow-y-auto border-b border-[var(--border)] px-1.5 py-1">
        {tree.map((node) => (
          <FileTreeNode key={node.path} node={node} depth={0} selected={activePath} onSelect={setActivePath} />
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-2.5 py-1">
          <span className="truncate font-mono text-[10.5px] text-[var(--foreground-soft)]">{active?.path}</span>
          <div className="flex shrink-0 items-center gap-1">
            <CopyButton value={active?.content ?? ""} className="size-6" />
            <button
              type="button"
              onClick={() => {
                if (!active) return;
                downloadText(active.content, active.path.split("/").pop() ?? "file.txt");
              }}
              aria-label={t("preview.downloadFile")}
              className="grid size-6 place-items-center rounded-[6px] text-[var(--faint)] hover:bg-[var(--surface-2)] hover:text-foreground"
            >
              <Download className="size-3" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-[var(--code-bg)]">
          {active ? (
            <div className="flex min-w-full text-[10.5px] leading-[1.7]">
              <div className="select-none border-r border-[var(--border)] px-1.5 py-2 text-right font-mono text-[var(--faint)]/60">
                {active.content.split("\n").map((_, index) => (
                  <div key={index}>{index + 1}</div>
                ))}
              </div>
              <pre className="flex-1 overflow-x-auto px-2 py-2 font-mono text-[var(--foreground-soft)]">
                <code>{active.content}</code>
              </pre>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function VersionsPane() {
  const t = useT();
  const lang = useSettingsStore((s) => s.settings.lang);
  const { selected, files, chat, restoreVersion } = usePanelContext();
  const [versions, setVersions] = React.useState<ProjectVersion[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [diffFor, setDiffFor] = React.useState<string | null>(null);
  const [diffPath, setDiffPath] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    if (!chat) {
      setVersions([]);
      return;
    }
    setLoading(true);
    try {
      const rows = await db.versions.where("chatId").equals(chat.id).toArray();
      setVersions(rows.sort((a, b) => b.createdAt - a.createdAt));
    } finally {
      setLoading(false);
    }
  }, [chat]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveVersion = async () => {
    if (!chat || !selected || files.length === 0) return;
    const version: ProjectVersion = {
      id: uid("ver"),
      chatId: chat.id,
      messageId: selected.message.id,
      label: t("preview.version", { n: versions.length + 1 }),
      files,
      createdAt: Date.now(),
    };
    await db.versions.put(version);
    await refresh();
    toast.success(t("preview.versionSaved"));
  };

  const diffVersion = diffFor ? versions.find((version) => version.id === diffFor) : undefined;
  const previous = React.useMemo(() => {
    if (!diffVersion) return undefined;
    return versions
      .filter((version) => version.createdAt < diffVersion.createdAt)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
  }, [diffVersion, versions]);

  const diffEntries = React.useMemo(() => {
    if (!diffVersion) return [];
    const prevMap = new Map((previous?.files ?? []).map((file) => [file.path, file]));
    return diffVersion.files
      .map((file) => {
        const before = prevMap.get(file.path)?.content ?? "";
        const lines = diffLines(before, file.content);
        return { file, lines, stat: diffStat(lines), added: !prevMap.has(file.path) };
      })
      .filter((entry) => entry.added || entry.stat.added > 0 || entry.stat.removed > 0);
  }, [diffVersion, previous]);

  const activeDiff = diffEntries.find((entry) => entry.file.path === diffPath) ?? diffEntries[0];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-2.5 py-1.5">
        <span className="text-[10px] text-[var(--faint)]">
          {versions.length} {t("preview.versions").toLowerCase()}
        </span>
        <button
          type="button"
          onClick={() => void saveVersion()}
          disabled={files.length === 0}
          className="inline-flex h-6 items-center gap-1 rounded-[6px] bg-[var(--primary-soft)] px-2 text-[10px] font-medium text-[var(--primary)] disabled:opacity-40"
        >
          <Save className="size-3" /> {t("preview.saveVersion")}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[11px] text-[var(--faint)]">
            <Loader2 className="size-3.5 animate-spin" /> {t("common.loading")}
          </div>
        ) : versions.length === 0 ? (
          <PanelEmpty icon={<History className="size-5" />} title={t("preview.noVersions")} description={t("preview.saveVersion")} />
        ) : (
          <ul className="space-y-1.5">
            {versions.map((version) => {
              const open = diffFor === version.id;
              const previousRow = versions.filter((item) => item.createdAt < version.createdAt)[0];
              const prevMap = new Map((previousRow?.files ?? []).map((file) => [file.path, file]));
              const totals = version.files.reduce(
                (acc, file) => {
                  const stat = diffStat(diffLines(prevMap.get(file.path)?.content ?? "", file.content));
                  return { added: acc.added + stat.added, removed: acc.removed + stat.removed };
                },
                { added: 0, removed: 0 },
              );
              return (
                <li
                  key={version.id}
                  className={cn(
                    "rounded-[10px] border border-[var(--border)] bg-[var(--surface-1)]",
                    open && "border-[color-mix(in_oklab,var(--primary)_28%,var(--border))]",
                  )}
                >
                  <div className="flex items-center gap-2 px-2.5 py-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setDiffFor(open ? null : version.id);
                        setDiffPath(null);
                      }}
                      aria-expanded={open}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <span className="grid size-6 shrink-0 place-items-center rounded-[7px] bg-[var(--surface-2)] text-[var(--primary)]">
                        <History className="size-3" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[11.5px] font-medium text-foreground">{version.label}</span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[9.5px] text-[var(--faint)]">
                          <span>{formatRelativeTime(version.createdAt, lang)}</span>
                          <span>· {version.files.length}f</span>
                          {totals.added > 0 ? <span className="text-[var(--success)]">+{totals.added}</span> : null}
                          {totals.removed > 0 ? <span className="text-[var(--destructive)]">−{totals.removed}</span> : null}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => restoreVersion(version)}
                      aria-label={t("preview.restore")}
                      className="grid size-6 place-items-center rounded-[6px] text-[var(--faint)] hover:bg-[var(--surface-2)] hover:text-foreground"
                    >
                      <RotateCcw className="size-3" />
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await db.versions.delete(version.id);
                        await refresh();
                        if (diffFor === version.id) setDiffFor(null);
                      }}
                      aria-label={t("common.delete")}
                      className="grid size-6 place-items-center rounded-[6px] text-[var(--faint)] hover:bg-[var(--destructive-soft)] hover:text-[var(--destructive)]"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                  {open ? (
                    <div className="border-t border-[var(--border)] px-2 py-1.5">
                      <p className="mb-1 text-[9.5px] uppercase tracking-[0.12em] text-[var(--faint)]">
                        {t("preview.diff")} {t("preview.compareToLatest")}
                      </p>
                      {diffEntries.length === 0 ? (
                        <p className="py-2 text-[10.5px] text-[var(--muted-foreground)]">{t("preview.noFiles")}</p>
                      ) : (
                        <div className="space-y-0.5">
                          {diffEntries.map((entry) => (
                            <button
                              key={entry.file.path}
                              type="button"
                              onClick={() => setDiffPath(entry.file.path)}
                              className={cn(
                                "flex w-full items-center gap-1.5 rounded-[5px] px-1 py-0.5 text-left font-mono text-[9.5px] hover:bg-[var(--surface-2)]",
                                activeDiff?.file.path === entry.file.path && "bg-[var(--surface-2)]",
                              )}
                            >
                              <span className="truncate text-[var(--foreground-soft)]">{entry.file.path}</span>
                              <span className="ml-auto shrink-0 text-[var(--success)]">+{entry.stat.added}</span>
                              <span className="shrink-0 text-[var(--destructive)]">−{entry.stat.removed}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {activeDiff ? (
                        <div className="mt-1.5 max-h-[190px] overflow-auto rounded-[6px] border border-[var(--border)] bg-[var(--code-bg)] p-1 font-mono text-[9.5px] leading-[1.6]">
                          {activeDiff.lines.slice(0, 400).map((line, index) => (
                            <div
                              key={index}
                              className={cn(
                                "whitespace-pre",
                                line.type === "add"
                                  ? "bg-[var(--success-soft)] text-[var(--success)]"
                                  : line.type === "del"
                                    ? "bg-[var(--destructive-soft)] text-[var(--destructive)]"
                                    : "text-[var(--faint)]",
                              )}
                            >
                              {line.type === "add" ? "+" : line.type === "del" ? "−" : " "} {line.text || " "}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export function RightPanelBody({ mode = "desktop" }: { mode?: "desktop" | "mobile" }) {
  const t = useT();
  const tab = useUiStore((s) => s.rightTab);
  const setTab = useUiStore((s) => s.setRightTab);
  const setMobileOpen = useUiStore((s) => s.setMobilePanelOpen);
  const state = usePanelFilesState();
  const files = state.files;
  const isMobile = mode === "mobile";

  const hidePanelHeader = tab === "preview" && state.studioMode === "manual-edit";

  return (
    <PanelContext.Provider value={state}>
      <div
        className={cn(
          "flex h-full min-h-0 flex-col",
          isMobile && "pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]",
        )}
      >
        <AnimatePresence initial={false}>
          {!hidePanelHeader ? (
            <motion.div
              key="panel-top-header"
              initial={{ height: 0, opacity: 0, y: -10 }}
              animate={{ height: "auto", opacity: 1, y: 0 }}
              exit={{ height: 0, opacity: 0, y: -10 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              className="shrink-0 overflow-hidden"
              style={{ willChange: "height, opacity, transform" }}
            >
              <div
                dir="ltr"
                className={cn(
                  "flex shrink-0 items-center gap-1.5 border-b border-[var(--border)] px-2 py-1.5",
                  isMobile && "h-[var(--header-h)] px-3",
                )}
              >
                {isMobile ? (
                  <button
                    type="button"
                    onClick={() => setMobileOpen(false)}
                    aria-label={t("common.back")}
                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)]/70 px-2.5 text-[11.5px] font-medium text-foreground transition-colors hover:bg-[var(--surface-2)] active:scale-[0.97]"
                  >
                    <ChevronLeft className="size-3.5" />
                    <span>{t("common.back")}</span>
                  </button>
                ) : null}

                <Tabs
                  value={tab}
                  onValueChange={(value) => setTab(value as RightTab)}
                  className="min-w-0 flex-1"
                >
                  <TabsList className="w-full">
                    <TabsTrigger value="preview" className="flex-1 text-[11px]">
                      <Eye className="size-3" />
                      <span className="truncate">{t("preview.title")}</span>
                    </TabsTrigger>
                    <TabsTrigger value="files" className="flex-1 text-[11px]">
                      <Code2 className="size-3" />
                      <span className="truncate">{t("preview.files")}</span>
                      {files.length > 0 ? (
                        <span className="rounded-full bg-[var(--surface-2)] px-1 text-[9px] tabular-nums text-[var(--faint)]">
                          {files.length}
                        </span>
                      ) : null}
                    </TabsTrigger>
                    <TabsTrigger value="versions" className="flex-1 text-[11px]">
                      <History className="size-3" />
                      <span className="truncate">{t("preview.versions")}</span>
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                {!isMobile ? <PanelCloseButton /> : null}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {tab === "preview" ? <PreviewPane /> : tab === "files" ? <FilesPane /> : <VersionsPane />}
      </div>
    </PanelContext.Provider>
  );
}

function PanelCloseButton() {
  const t = useT();
  const update = useSettingsStore((s) => s.update);
  const setMobileOpen = useUiStore((s) => s.setMobilePanelOpen);

  return (
    <button
      type="button"
      onClick={() => {
        if (window.innerWidth >= 1280) void update({ rightPanelOpen: false });
        else setMobileOpen(false);
      }}
      aria-label={t("common.close")}
      className="grid size-7 shrink-0 place-items-center rounded-[7px] text-[var(--faint)] transition-colors hover:bg-[var(--surface-2)] hover:text-foreground"
    >
      <PanelRightClose className="size-3.5" />
    </button>
  );
}

export function RightPanel() {
  const t = useT();
  const settings = useSettingsStore((s) => s.settings);

  if (!settings.rightPanelOpen) return null;

  return (
    <aside
      className="relative z-10 hidden w-[360px] shrink-0 flex-col border-l border-[var(--border)] bg-[color-mix(in_oklab,var(--surface-1)_48%,transparent)] backdrop-blur-xl backdrop-saturate-150 xl:flex 2xl:w-[420px]"
      aria-label={t("preview.title")}
    >
      <RightPanelBody mode="desktop" />
    </aside>
  );
}
