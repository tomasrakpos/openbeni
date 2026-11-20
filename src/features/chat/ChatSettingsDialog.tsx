// chat feature: ChatSettingsDialog; change its UI/flow here and keep related state/API calls in sync.
import { Brain, FileText } from "lucide-react";
import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { Slider } from "@/components/ui/slider";
import { useT } from "@/lib/i18n";
import { estimateMessages, estimateTokens, formatTokens, usageRatio } from "@/lib/tokens";
import { activeThread, resolveTarget, useChatsStore } from "@/stores/chats";
import { useSettingsStore } from "@/stores/settings";
import type { ChatParams } from "@/lib/types";
import { cn } from "@/lib/utils";

function ParamRow({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11.5px] font-medium text-[var(--foreground-soft)]">{label}</span>
        <span className="shrink-0 font-mono text-[11px] text-[var(--muted-foreground)]">{value}</span>
      </div>
      {children}
    </div>
  );
}

/**
 * Per-chat parameters, context usage and system prompt. This used to live in a
 * small popover above the composer; it is a dialog now so the composer toolbar
 * stays compact and the same controls remain reachable from the top bar.
 */
export function ChatSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const chats = useChatsStore((s) => s.chats);
  const messages = useChatsStore((s) => s.messages);
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const setParams = useChatsStore((s) => s.setParams);
  const setSystemPrompt = useChatsStore((s) => s.setSystemPrompt);
  const systemPresets = useSettingsStore((s) => s.settings.systemPresets);

  const chat = chats.find((item) => item.id === activeChatId) ?? null;
  const resolved = chat ? resolveTarget(chat) : null;
  const model = resolved && "model" in resolved ? resolved.model : undefined;
  const thread = React.useMemo(() => activeThread(messages, chat), [messages, chat]);

  const [systemDraft, setSystemDraft] = React.useState(chat?.systemPrompt ?? "");
  React.useEffect(() => {
    if (open) setSystemDraft(chat?.systemPrompt ?? "");
  }, [open, chat?.id, chat?.systemPrompt]);

  const totalTokens = React.useMemo(
    () => estimateMessages(thread) + estimateTokens(chat?.systemPrompt ?? ""),
    [thread, chat?.systemPrompt],
  );
  const ratio = usageRatio(totalTokens, model?.contextWindow);

  const updateParams = (patch: Partial<ChatParams>) => {
    void setParams(patch);
  };

  const save = () => {
    void setSystemPrompt(systemDraft);
    onOpenChange(false);
  };

  const cancel = () => {
    setSystemDraft(chat?.systemPrompt ?? "");
    onOpenChange(false);
  };

  if (!chat) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent frame className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t("chat.params")}</DialogTitle>
          <DialogDescription>{t("chat.paramsHint")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11.5px] font-medium text-[var(--foreground-soft)]">{t("chat.context")}</span>
              <span className="shrink-0 font-mono text-[10px] text-[var(--faint)]">
                {formatTokens(totalTokens)}
                {model?.contextWindow ? ` / ${formatTokens(model.contextWindow)}` : ""}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-300",
                  ratio > 0.9 ? "bg-[var(--destructive)]" : ratio > 0.7 ? "bg-[var(--warning)]" : "accent-gradient",
                )}
                style={{ width: `${Math.max(2, ratio * 100)}%` }}
              />
            </div>
          </div>

          <div className="h-px bg-[var(--border)]" />

          <div className="grid gap-4 sm:grid-cols-2">
            <ParamRow label={t("settings.temperature")} value={(chat.params.temperature ?? 0.7).toFixed(2)}>
              <Slider
                value={[chat.params.temperature ?? 0.7]}
                min={0}
                max={2}
                step={0.05}
                onValueChange={([value]) => updateParams({ temperature: value ?? 0.7 })}
                aria-label={t("settings.temperature")}
              />
            </ParamRow>
            <ParamRow label={t("settings.topP")} value={(chat.params.topP ?? 1).toFixed(2)}>
              <Slider
                value={[chat.params.topP ?? 1]}
                min={0.05}
                max={1}
                step={0.01}
                onValueChange={([value]) => updateParams({ topP: value ?? 1 })}
                aria-label={t("settings.topP")}
              />
            </ParamRow>
            <ParamRow label={t("settings.maxTokens")} value={String(chat.params.maxTokens ?? 4096)}>
              <input
                type="number"
                min={1}
                max={200000}
                value={chat.params.maxTokens ?? 4096}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value) && value > 0) updateParams({ maxTokens: Math.round(value) });
                }}
                className="h-8 w-full rounded-[8px] border border-[var(--input)] bg-[var(--surface-2)] px-2 font-mono text-[11.5px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                aria-label={t("settings.maxTokens")}
              />
            </ParamRow>
            {model?.capabilities.includes("reasoning") ? (
              <div className="space-y-1.5">
                <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--foreground-soft)]">
                  <Brain className="size-3.5 text-[var(--faint)]" aria-hidden="true" /> {t("chat.reasoningEffort")}
                </span>
                <Segmented
                  aria-label={t("chat.reasoningEffort")}
                  value={chat.params.reasoningEffort ?? "off"}
                  onChange={(value) =>
                    updateParams({
                      reasoningEffort: value === "off" ? undefined : (value as "low" | "medium" | "high"),
                    })
                  }
                  options={[
                    { value: "off", label: t("chat.off") },
                    { value: "low", label: t("chat.low") },
                    { value: "medium", label: t("chat.medium") },
                    { value: "high", label: t("chat.high") },
                  ]}
                />
              </div>
            ) : null}
          </div>

          <div className="h-px bg-[var(--border)]" />

          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
              <FileText className="size-3.5 text-[var(--faint)]" aria-hidden="true" />
              {t("chat.systemPrompt")}
            </p>
            <textarea
              value={systemDraft}
              onChange={(event) => setSystemDraft(event.target.value)}
              placeholder={t("chat.systemPromptPlaceholder")}
              rows={4}
              dir="auto"
              className="w-full resize-y rounded-[10px] border border-[var(--input)] bg-[var(--surface-2)] px-2.5 py-2 text-[12.5px] leading-relaxed outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]"
            />
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--faint)]">
                {t("chat.systemPresets")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {systemPresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setSystemDraft(preset.prompt)}
                    className="max-w-full truncate rounded-[7px] border border-[var(--border)] px-2 py-1 text-start text-[11.5px] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--surface-2)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]"
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={cancel}
            className="h-9 rounded-[9px] px-3 text-[12.5px] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--surface-2)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={save}
            className="h-9 rounded-[9px] bg-[var(--primary)] px-3.5 text-[12.5px] font-medium text-[var(--primary-foreground)] transition-[filter] hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            {t("common.save")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
