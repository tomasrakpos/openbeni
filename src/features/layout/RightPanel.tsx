// layout feature: RightPanel; change its UI/flow here and keep related state/API calls in sync.
import {
  AlertTriangle,
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
  Laptop,
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
import { Segmented } from "@/components/ui/segmented";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { db } from "@/db";
import { activeThread, useChatsStore } from "@/stores/chats";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore, type PreviewDevice, type RightTab } from "@/stores/ui";
import { buildPreviewHtml, extractProjectFiles, fileTree, type TreeNode } from "@/lib/codefiles";
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
  candidates: { message: Message; files: VirtualFile[] }[];
  selected: { message: Message; files: VirtualFile[] } | null;
  files: VirtualFile[];
  restored: RestoredVersion | null;
  chat: Chat | null;
  selectMessage: (messageId: string) => void;
  restoreVersion: (version: ProjectVersion) => void;
  clearRestored: () => void;
}

function usePanelFilesState(): PanelFilesState {
  const t = useT();
  const messages = useChatsStore((s) => s.messages);
  const chats = useChatsStore((s) => s.chats);
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const chat = chats.find((c) => c.id === activeChatId) ?? null;
  const thread = React.useMemo(() => activeThread(messages, chat), [messages, chat]);

  const candidates = React.useMemo(
    () =>
      thread
        .filter((message) => message.role === "assistant" && message.content.trim().length > 0)
        .map((message) => ({ message, files: extractProjectFiles(message.content) }))
        .filter((entry) => entry.files.length > 0)
        .reverse(),
    [thread],
  );

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [restored, setRestored] = React.useState<RestoredVersion | null>(null);

  React.useEffect(() => {
    if (candidates.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !candidates.some((entry) => entry.message.id === selectedId)) {
      setSelectedId(candidates[0]?.message.id ?? null);
    }
  }, [candidates, selectedId]);

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

  return {
    candidates,
    selected,
    files,
    restored,
    chat,
    selectMessage,
    restoreVersion,
    clearRestored,
  };
}

const PanelContext = React.createContext<PanelFilesState | null>(null);

function usePanelContext(): PanelFilesState {
  const value = React.useContext(PanelContext);
  if (!value) throw new Error("Panel context is missing");
  return value;
}

function PreviewPane() {
  const t = useT();
  const { candidates, selected, files, restored, selectMessage, clearRestored } = usePanelContext();
  const previewDevice = useUiStore((s) => s.previewDevice);
  const setPreviewDevice = useUiStore((s) => s.setPreviewDevice);
  const [consoleOpen, setConsoleOpen] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [lines, setLines] = React.useState<ConsoleLine[]>([]);

  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { __apiset?: boolean; type?: string; args?: unknown[] } | undefined;
      if (!data || data.__apiset !== true) return;
      const type = (data.type === "warn" || data.type === "error" || data.type === "info" || data.type === "debug"
        ? data.type
        : "log") as ConsoleLine["type"];
      const text = (data.args ?? [])
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
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const built = React.useMemo(() => buildPreviewHtml(files), [files]);

  const reload = () => {
    setLines([]);
    setReloadKey((value) => value + 1);
  };

  const openExternal = () => {
    if (!built.html) return;
    const blob = new Blob([built.html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border)] px-2.5 py-1.5">
        <Segmented
          aria-label={t("preview.title")}
          value={previewDevice}
          onChange={(value) => setPreviewDevice(value as PreviewDevice)}
          options={[
            { value: "desktop", label: <Monitor className="size-3.5" aria-label={t("preview.desktop")} /> },
            { value: "tablet", label: <Tablet className="size-3.5" aria-label={t("preview.tablet")} /> },
            { value: "mobile", label: <Smartphone className="size-3.5" aria-label={t("preview.mobile")} /> },
          ]}
        />
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

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--surface-2)]/40 p-2">
        <div
          className="mx-auto flex min-h-0 w-full flex-1 justify-center overflow-hidden rounded-[10px] border border-[var(--border)] bg-white shadow-sm"
          style={{ maxWidth: DEVICE_WIDTH[previewDevice] }}
        >
          <iframe
            key={`${selected.message.id}-${reloadKey}-${previewDevice}-${restored?.versionId ?? "live"}`}
            title={t("preview.title")}
            srcDoc={built.html}
            sandbox="allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock"
            referrerPolicy="no-referrer"
            className="h-full min-h-[220px] w-full border-0 bg-white"
          />
        </div>
      </div>

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

      <div className="flex shrink-0 items-center gap-2 border-t border-[var(--border)] px-2.5 py-1.5">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-[9.5px] text-[var(--faint)]">
          <Laptop className="size-3 shrink-0" />
          <span className="truncate">{built.entry ?? t("preview.project")}</span>
        </span>
        <span className="ml-auto truncate text-[9px] text-[var(--faint)]">{t("preview.running")}</span>
      </div>
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

function PanelBody() {
  const t = useT();
  const tab = useUiStore((s) => s.rightTab);
  const setTab = useUiStore((s) => s.setRightTab);
  const state = usePanelFilesState();
  const files = state.files;

  return (
    <PanelContext.Provider value={state}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-1 border-b border-[var(--border)] px-2 py-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-0.5 rounded-[9px] bg-[var(--surface-2)]/60 p-0.5">
            {(
              [
                { value: "preview", label: t("preview.title"), icon: <Eye className="size-3" /> },
                { value: "files", label: t("preview.files"), icon: <Code2 className="size-3" /> },
                { value: "versions", label: t("preview.versions"), icon: <History className="size-3" /> },
              ] as { value: RightTab; label: string; icon: React.ReactNode }[]
            ).map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setTab(item.value)}
                aria-pressed={tab === item.value}
                className={cn(
                  "inline-flex h-6 min-w-0 flex-1 items-center justify-center gap-1 rounded-[7px] px-1.5 text-[10.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]",
                  tab === item.value
                    ? "bg-[var(--surface-1)] text-foreground shadow-xs"
                    : "text-[var(--faint)] hover:text-foreground",
                )}
              >
                {item.icon}
                <span className="truncate">{item.label}</span>
                {item.value === "files" && files.length > 0 ? (
                  <span className="rounded-full bg-[var(--surface-2)] px-1 text-[9px] tabular-nums text-[var(--faint)]">
                    {files.length}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <PanelCloseButton />
        </div>

        {tab === "preview" ? <PreviewPane /> : tab === "files" ? <FilesPane /> : <VersionsPane />}

        <div className="shrink-0 border-t border-[var(--border)] px-2.5 py-1.5">
          <p className="flex items-center gap-1 text-[9px] leading-relaxed text-[var(--faint)]">
            <AlertTriangle className="size-2.5 shrink-0" />
            {t("preview.srcdocNote")}
          </p>
        </div>
      </div>
    </PanelContext.Provider>
  );
}

function PanelCloseButton() {
  const t = useT();
  const update = useSettingsStore((s) => s.update);
  const settings = useSettingsStore((s) => s.settings);
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
  const mobileOpen = useUiStore((s) => s.mobilePanelOpen);
  const setMobileOpen = useUiStore((s) => s.setMobilePanelOpen);

  return (
    <>
      {settings.rightPanelOpen ? (
        <aside
          className="relative z-10 hidden w-[360px] shrink-0 flex-col border-l border-[var(--border)] bg-[color-mix(in_oklab,var(--surface-1)_48%,transparent)] backdrop-blur-xl backdrop-saturate-150 xl:flex 2xl:w-[420px]"
          aria-label={t("preview.title")}
        >
          <PanelBody />
        </aside>
      ) : null}

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="right" className="gap-0 p-0">
          <SheetTitle className="sr-only">{t("preview.title")}</SheetTitle>
          <SheetDescription className="sr-only">{t("preview.srcdocNote")}</SheetDescription>
          <PanelBody />
        </SheetContent>
      </Sheet>
    </>
  );
}
