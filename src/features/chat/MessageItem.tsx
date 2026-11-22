// chat feature: MessageItem; change its UI/flow here and keep related state/API calls in sync.
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  Brain,
  Check,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Copy,
  FileText,
  Pencil,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ProviderIcon } from "@/components/ProviderIcon";
import { MenuFrame } from "@/components/ui/menu-frame";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ArtifactCard } from "@/features/chat/ArtifactCard";
import { Markdown } from "@/features/chat/Markdown";
import { SkillIcon } from "@/features/chat/SkillPicker";
import { branchInfo } from "@/lib/branching";
import { splitChatAndArtifact } from "@/lib/codefiles";
import { localizeError } from "@/lib/errors";
import { errorHint } from "@/lib/http";
import { copyToClipboard } from "@/lib/export";
import { providerDisplayName } from "@/lib/bundled";
import { useT } from "@/lib/i18n";
import { formatRelativeTime } from "@/lib/tokens";
import { cn } from "@/lib/utils";
import { useChatsStore, type StreamingState } from "@/stores/chats";
import { useAllModels, useAllProviders } from "@/stores/catalog";
import { useSettingsStore } from "@/stores/settings";
import type { Attachment, Message } from "@/lib/types";
import { useObjectUrl } from "@/components/ModelIdentity";

function IconButton({
  label,
  onClick,
  children,
  danger,
  active,
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
  active?: "up" | "down";
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          aria-pressed={active ? true : undefined}
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-[8px] text-[var(--faint)] transition-colors hover:bg-[var(--surface-2)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)] disabled:opacity-40",
            danger && "hover:bg-[var(--destructive-soft)] hover:text-[var(--destructive)]",
            active === "up" && "bg-[var(--success-soft)] text-[var(--success)] hover:bg-[var(--success-soft)] hover:text-[var(--success)]",
            active === "down" && "bg-[var(--destructive-soft)] text-[var(--destructive)] hover:bg-[var(--destructive-soft)] hover:text-[var(--destructive)]",
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function AttachmentStrip({ attachments }: { attachments: Attachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {attachments.map((attachment) => (
        <AttachmentTile key={attachment.id} attachment={attachment} />
      ))}
    </div>
  );
}

function AttachmentTile({ attachment }: { attachment: Attachment }) {
  const thumb = useObjectUrl(attachment.blob);
  const frame = attachment.frames?.[0];
  if (attachment.kind === "image") {
    return (
      <img
        src={thumb}
        alt={attachment.name}
        className="size-20 rounded-[10px] border border-[var(--border)] object-cover"
      />
    );
  }
  if (attachment.kind === "video") {
    return (
      <span className="relative flex size-20 items-center justify-center overflow-hidden rounded-[10px] border border-[var(--border)] bg-black/40">
        {frame ? <img src={frame} alt={attachment.name} className="size-full object-cover opacity-85" /> : null}
        <span className="absolute inset-0 grid place-items-center bg-black/25">
          <Clapperboard className="size-4 text-white" />
        </span>
      </span>
    );
  }
  return (
    <span className="flex max-w-[220px] items-center gap-2 rounded-[9px] border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[11.5px] text-[var(--foreground-soft)]">
      <FileText className="size-3.5 shrink-0 text-[var(--muted-foreground)]" />
      <span className="truncate">{attachment.name}</span>
    </span>
  );
}

function BranchNav({ message, compact }: { message: Message; compact?: boolean }) {
  const t = useT();
  const messages = useChatsStore((s) => s.messages);
  const switchBranch = useChatsStore((s) => s.switchBranch);
  const info = branchInfo(messages, message);
  if (info.total < 2) return null;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[11px] text-[var(--faint)]", compact && "opacity-100")}>
      <button
        type="button"
        aria-label={t("chat.prevBranch")}
        onClick={() => switchBranch(message.id, -1)}
        className="grid size-6 place-items-center rounded-[6px] transition-colors hover:bg-[var(--surface-2)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]"
      >
          <ChevronLeft className="size-3.5" />
      </button>
      <span className="min-w-[26px] text-center font-mono tabular-nums">
        {info.index + 1}/{info.total}
      </span>
      <button
        type="button"
        aria-label={t("chat.nextBranch")}
        onClick={() => switchBranch(message.id, 1)}
        className="grid size-6 place-items-center rounded-[6px] transition-colors hover:bg-[var(--surface-2)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]"
      >
          <ChevronRight className="size-3.5" />
      </button>
    </span>
  );
}

const FEEDBACK_KEY = "openharness.msg.feedback";

function readFeedback(messageId: string): "up" | "down" | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(FEEDBACK_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, "up" | "down">;
    return map[messageId] ?? null;
  } catch {
    return null;
  }
}

function writeFeedback(messageId: string, value: "up" | "down" | null): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(FEEDBACK_KEY);
    const map: Record<string, "up" | "down"> = raw ? (JSON.parse(raw) as Record<string, "up" | "down">) : {};
    if (value) map[messageId] = value;
    else delete map[messageId];
    window.localStorage.setItem(FEEDBACK_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota / privacy-mode errors.
  }
}

interface MessageItemProps {
  message: Message;
  streaming: StreamingState | null;
  isLast: boolean;
}

export function MessageItem({ message, streaming, isLast }: MessageItemProps) {
  const t = useT();
  const lang = useSettingsStore((s) => s.settings.lang);
  const showReasoning = useSettingsStore((s) => s.settings.showReasoning);
  const providers = useAllProviders();
  const models = useAllModels();
  const attachments = useChatsStore((s) => s.attachments);
  const chatPreviewEnabled = useChatsStore(
    (s) => s.chats.find((c) => c.id === message.chatId)?.previewEnabled === true,
  );
  const regenerate = useChatsStore((s) => s.regenerate);
  const deleteMessage = useChatsStore((s) => s.deleteMessage);
  const editAndResend = useChatsStore((s) => s.editAndResend);
  const isStreaming = streaming?.messageId === message.id;
  const [copied, setCopied] = React.useState(false);
  const [feedback, setFeedback] = React.useState<"up" | "down" | null>(() => readFeedback(message.id));
  const [editing, setEditing] = React.useState(false);
  const [editText, setEditText] = React.useState(message.content);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [reasoningOpen, setReasoningOpen] = React.useState(false);
  const reduceMotion = useReducedMotion();

  React.useEffect(() => {
    setFeedback(readFeedback(message.id));
  }, [message.id]);

  const toggleFeedback = (kind: "up" | "down") => {
    const next = feedback === kind ? null : kind;
    setFeedback(next);
    writeFeedback(message.id, next);
  };

  const provider = providers.find((p) => p.id === message.providerId);
  // Messages store the provider-side model id, but older/imported rows may hold
  // the local row id, so accept either before falling back to the raw value.
  const model =
    models.find((m) => m.id === message.modelId && (!message.providerId || m.providerId === message.providerId)) ??
    models.find((m) => m.modelId === message.modelId && (!message.providerId || m.providerId === message.providerId)) ??
    models.find((m) => m.id === message.modelId) ??
    models.find((m) => m.modelId === message.modelId);
  const providerName = provider ? providerDisplayName(provider) : t("chat.assistant");
  const modelName = model?.displayName ?? message.modelId ?? "";

  const content = isStreaming ? streaming?.content ?? "" : message.content;
  const reasoning = isStreaming ? streaming?.reasoning ?? "" : message.reasoning ?? "";
  const activeSkillId = isStreaming ? streaming?.skillId ?? message.skillId : message.skillId;
  const activeSkillSources = isStreaming
    ? streaming?.skillSourcesCount ?? message.skillSourcesCount ?? 0
    : message.skillSourcesCount ?? 0;
  const messageAttachments = attachments.filter((a) => message.attachments.includes(a.id));

  // In preview-enabled project chats (website/game/app builds), keep raw code
  // out of the chat bubble — render clean prose + the live ArtifactCard instead.
  const artifact = React.useMemo(() => {
    if (message.role !== "assistant" || !chatPreviewEnabled || !content) return null;
    return splitChatAndArtifact(content, isStreaming, lang);
  }, [message.role, chatPreviewEnabled, content, isStreaming, lang]);

  React.useEffect(() => {
    if (isStreaming && reasoning && showReasoning) setReasoningOpen(true);
  }, [isStreaming, reasoning, showReasoning]);

  const copy = async () => {
    if (await copyToClipboard(content)) {
      setCopied(true);
      toast.success(t("toast.copied"));
      window.setTimeout(() => setCopied(false), 1500);
    } else {
      toast.error(t("common.clipboardDenied"));
    }
  };

  const startEdit = () => {
    setEditText(message.content);
    setEditing(true);
  };

  const submitEdit = async () => {
    if (!editText.trim()) return;
    setEditing(false);
    await editAndResend(message.id, editText);
  };

  if (message.role === "user") {
    return (
      <motion.article
        initial={reduceMotion ? false : { opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
        className="group/msg flex flex-col items-end gap-1.5 py-2.5"
      >
        <div className="flex max-w-[min(86%,46rem)] flex-col items-end gap-2">
          {messageAttachments.length > 0 && (
            <div className="flex flex-wrap justify-end gap-2">
              <AttachmentStrip attachments={messageAttachments} />
            </div>
          )}
          {editing ? (
            <MenuFrame
              className="w-[min(86vw,640px)] p-2"
              style={{ "--hl": 1 } as React.CSSProperties}
            >
              <textarea
                autoFocus
                value={editText}
                onChange={(event) => setEditText(event.target.value)}
                rows={Math.min(10, Math.max(2, editText.split("\n").length + 1))}
                className="w-full resize-none bg-transparent px-2 py-1.5 text-[13.5px] leading-relaxed text-foreground outline-none"
                aria-label={t("chat.edit")}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void submitEdit();
                  }
                  if (event.key === "Escape") setEditing(false);
                }}
              />
              <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] px-1 pt-2">
                <span className="text-[10.5px] text-[var(--faint)]">{t("chat.editHint")}</span>
                <span className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    className="inline-flex h-7 items-center gap-1 rounded-[7px] px-2 text-[11.5px] text-[var(--muted-foreground)] hover:bg-[var(--surface-2)] hover:text-foreground"
                  >
                    <X className="size-3" /> {t("common.cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={submitEdit}
                    disabled={!editText.trim()}
                    className="inline-flex h-7 items-center gap-1 rounded-[7px] bg-[var(--primary)] px-2.5 text-[11.5px] font-medium text-[var(--primary-foreground)] disabled:opacity-40"
                  >
                    <Check className="size-3" /> {t("chat.send")}
                  </button>
                </span>
              </div>
            </MenuFrame>
          ) : (
            <MenuFrame
              className="px-4 py-2.5"
              style={{ "--hl": 1 } as React.CSSProperties}
            >
              <Markdown content={message.content} className="prose-chat [&_p]:my-0.5" />
            </MenuFrame>
          )}
        </div>
        <div className="flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover/msg:opacity-100 sm:group-focus-within/msg:opacity-100">
          <BranchNav message={message} />
          <span className="text-[10.5px] text-[var(--faint)]">{formatRelativeTime(message.createdAt, lang)}</span>
          <IconButton label={t("common.copy")} onClick={copy}>
            {copied ? <Check className="size-3.5 text-[var(--success)]" /> : <Copy className="size-3.5" />}
          </IconButton>
          <IconButton label={t("chat.edit")} onClick={startEdit}>
            <Pencil className="size-3.5" />
          </IconButton>
          <IconButton label={t("chat.deleteMessage")} onClick={() => setConfirmOpen(true)} danger>
            <Trash2 className="size-3.5" />
          </IconButton>
        </div>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={t("chat.deleteMessage")}
          description={t("chat.editHint")}
          confirmLabel={t("common.delete")}
          cancelLabel={t("common.cancel")}
          destructive
          onConfirm={() => deleteMessage(message.id)}
        />
      </motion.article>
    );
  }

  const errorMessage = message.error ? localizeError(message.error.message, t) : null;
  const hint =
    message.error && message.error.message !== "error.noKey" && message.error.message !== "error.vaultLocked"
      ? errorHint(message.error.kind, lang)
      : null;

  return (
    <motion.article
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className="group/msg flex gap-3 py-2.5"
      aria-busy={isStreaming}
    >
      <div className="pt-0.5">
        <ProviderIcon
          icon={provider?.icon ?? model?.icon}
          name={providerName}
          color={provider?.color}
          baseUrl={provider?.baseUrl}
          modelName={modelName}
          modelId={model?.modelId ?? message.modelId}
          size={30}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex min-h-6 flex-wrap items-center gap-1.5">
          <span className="truncate text-[12.5px] font-semibold text-foreground">{modelName || providerName}</span>
          {model ? (
            <span className="hidden rounded-[5px] border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[9.5px] text-[var(--faint)] sm:inline">
              {model.modelId}
            </span>
          ) : null}
          {activeSkillId && activeSkillId !== "chat" ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface-2)]/80 px-2 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]">
              <SkillIcon mode={activeSkillId} size={11} />
              <span>{t(`skill.${activeSkillId}`)}</span>
              {activeSkillSources > 0 ? (
                <span className="text-[var(--faint)]">
                  · {t("skill.sourcesBadge", { n: activeSkillSources })}
                </span>
              ) : null}
            </span>
          ) : null}
          <span className="text-[10.5px] text-[var(--faint)]">{formatRelativeTime(message.createdAt, lang)}</span>
        </div>

        {showReasoning && reasoning ? (
          <div className="mb-2">
            <button
              type="button"
              onClick={() => setReasoningOpen((value) => !value)}
              aria-expanded={reasoningOpen}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--muted-foreground)] transition-colors hover:text-foreground"
            >
              <Brain className="size-3" />
              {isStreaming ? t("chat.thinking") : t("chat.reasoning")}
              <ChevronRight className={cn("size-3 transition-transform", reasoningOpen && "rotate-90")} />
            </button>
            <AnimatePresence initial={false}>
              {reasoningOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="overflow-hidden"
                >
                  <div className="mt-1.5 max-h-[280px] overflow-y-auto whitespace-pre-wrap rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)]/50 px-3 py-2 text-[12px] leading-relaxed text-[var(--muted-foreground)]">
                    {reasoning}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : null}

        {messageAttachments.length > 0 && <AttachmentStrip attachments={messageAttachments} />}

        {artifact && (artifact.hasCode || (isStreaming && artifact.beforeText)) ? (
          <>
            {artifact.beforeText ? (
              <Markdown content={artifact.beforeText} streaming={isStreaming && !artifact.hasCode} />
            ) : null}
            {artifact.hasCode ? (
              <ArtifactCard messageId={message.id} artifact={artifact} />
            ) : null}
            {artifact.afterText ? (
              <Markdown content={artifact.afterText} streaming={isStreaming} />
            ) : null}
          </>
        ) : content ? (
          <Markdown content={content} streaming={isStreaming} />
        ) : isStreaming ? (
          <div className="py-1.5 text-[12.5px] font-medium tracking-[0.01em]">
            <TextShimmer>{t("chat.thinking")}</TextShimmer>
          </div>
        ) : null}

        {errorMessage ? (
          <div
            role="alert"
            className="mt-2 rounded-[12px] border border-[color-mix(in_oklab,var(--destructive)_30%,transparent)] bg-[var(--destructive-soft)] px-3 py-2.5"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--destructive)]" />
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-medium text-[var(--destructive)]">{t("chat.error")}</p>
                <p className="mt-0.5 break-words text-[12px] leading-relaxed text-[var(--foreground-soft)]">{errorMessage}</p>
                {hint ? <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--muted-foreground)]">{hint}</p> : null}
                <button
                  type="button"
                  onClick={() => regenerate(message.id)}
                  className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-[7px] border border-[var(--border-strong)] px-2.5 text-[11.5px] font-medium text-foreground hover:bg-[var(--surface-2)]"
                >
                  <RefreshCw className="size-3" /> {t("chat.retry")}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {!isStreaming ? (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <IconButton label={t("common.copy")} onClick={copy}>
              {copied ? <Check className="size-3.5 text-[var(--success)]" /> : <Copy className="size-3.5" />}
            </IconButton>
            <IconButton label={t("chat.regenerate")} onClick={() => regenerate(message.id)} disabled={isStreaming}>
              <RefreshCw className="size-3.5" />
            </IconButton>
            <IconButton
              label={t("chat.like")}
              onClick={() => toggleFeedback("up")}
              active={feedback === "up" ? "up" : undefined}
            >
              <ThumbsUp className="size-3.5" />
            </IconButton>
            <IconButton
              label={t("chat.dislike")}
              onClick={() => toggleFeedback("down")}
              active={feedback === "down" ? "down" : undefined}
            >
              <ThumbsDown className="size-3.5" />
            </IconButton>
            <BranchNav message={message} />
            {message.stats ? (
              <span className="ml-auto flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-[var(--faint)]">
                {typeof message.stats.latencyMs === "number" && <span>{(message.stats.latencyMs / 1000).toFixed(1)}s</span>}
                {typeof message.stats.tokensOut === "number" && <span>{message.stats.tokensOut} tok</span>}
                {message.stats.finishReason === "aborted" && <span className="text-[var(--warning)]">{t("chat.stopped")}</span>}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </motion.article>
  );
}

export function useLocalizedTime(timestamp: number): string {
  const lang = useSettingsStore((s) => s.settings.lang);
  return formatRelativeTime(timestamp, lang);
}
