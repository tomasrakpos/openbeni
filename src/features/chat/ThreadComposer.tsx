// chat feature: ThreadComposer; change its UI/flow here and keep related state/API calls in sync.
import { Mic, MicOff } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import PromptComposer from "@/components/ui/prompt-composer";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { buildComposerModels, resolveComposerModelId } from "@/features/chat/modelOptions";
import { IntelligencePicker } from "@/features/chat/IntelligencePicker";
import { useVoiceInput } from "@/features/chat/useVoiceInput";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { ChatParams } from "@/lib/types";
import { activeThread, resolveTarget, useChatsStore } from "@/stores/chats";
import { useAllModels, useAllProviders } from "@/stores/catalog";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";

/** The glass composer used once a conversation has at least one message. */
export function ThreadComposer() {
  const t = useT();
  const lang = useSettingsStore((s) => s.settings.lang);
  const chats = useChatsStore((s) => s.chats);
  const messages = useChatsStore((s) => s.messages);
  const attachments = useChatsStore((s) => s.attachments);
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const streaming = useChatsStore((s) => s.streaming);
  const send = useChatsStore((s) => s.send);
  const stop = useChatsStore((s) => s.stop);
  const addFiles = useChatsStore((s) => s.addFiles);
  const removeAttachment = useChatsStore((s) => s.removeAttachment);
  const setChatModel = useChatsStore((s) => s.setChatModel);
  const setParams = useChatsStore((s) => s.setParams);
  const providers = useAllProviders();
  const models = useAllModels();
  const focusSignal = useUiStore((s) => s.focusComposer);

  const chat = chats.find((c) => c.id === activeChatId) ?? null;
  const resolved = chat ? resolveTarget(chat) : null;
  const model = resolved && "model" in resolved ? resolved.model : undefined;

  const [text, setText] = React.useState("");
  const [busyFiles, setBusyFiles] = React.useState(false);

  const modelOptions = React.useMemo(() => buildComposerModels(providers, models), [providers, models]);

  const selectedModelId = React.useMemo(
    () => resolveComposerModelId(modelOptions, models, chat?.modelId ?? ""),
    [chat, modelOptions, models],
  );

  const referenced = React.useMemo(() => new Set(messages.flatMap((m) => m.attachments)), [messages]);
  const pending = attachments.filter((attachment) => !referenced.has(attachment.id));

  const voice = useVoiceInput({
    lang,
    onTranscript: (transcript, final) => {
      if (final) {
        setText((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}${transcript}`);
      }
    },
    onError: () => toast.error(t("chat.voiceUnsupported")),
  });

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    if (files.length > 6) toast.error(t("attach.limit", { n: 6, mb: 25 }));
    setBusyFiles(true);
    try {
      const result = await addFiles(files.slice(0, 6));
      for (const warning of result.errors) {
        if (warning.startsWith("attach.videoFrames:")) {
          toast.info(t("attach.videoFrames", { count: warning.split(":")[1] ?? "6" }));
        } else if (warning.startsWith("attach.")) {
          toast.error(t(warning));
        } else {
          toast.error(warning);
        }
      }
    } finally {
      setBusyFiles(false);
    }
  };

  const handleModelChange = (modelId: string) => {
    const row = models.find((model) => model.id === modelId);
    if (row) void setChatModel(row.providerId, row.id);
  };

  const handleSubmit = async ({ prompt, modelId }: { prompt: string; modelId: string }) => {
    const row = models.find((model) => model.id === modelId);
    if (!row) return;
    if (chat && (chat.providerId !== row.providerId || chat.modelId !== row.id)) {
      await setChatModel(row.providerId, row.id);
    }
    await send(prompt);
  };

  const updateParams = (patch: Partial<ChatParams>) => {
    void setParams(patch);
  };

  const actionButtonClass = cn(
    "relative grid size-8 place-items-center rounded-[10px] transition-colors duration-150",
    "text-[color-mix(in_oklab,var(--foreground)_55%,transparent)]",
    "hover:bg-[color-mix(in_oklab,var(--foreground)_10%,transparent)] hover:text-[color-mix(in_oklab,var(--foreground)_90%,transparent)]",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]",
    "disabled:opacity-40 disabled:hover:bg-transparent",
  );

  const leadingActions = (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => (voice.listening ? voice.stop() : voice.start())}
          disabled={!voice.supported}
          aria-label={voice.listening ? t("chat.listening") : t("chat.voice")}
          aria-pressed={voice.listening}
          className={cn(
            actionButtonClass,
            voice.listening &&
              "bg-[var(--destructive-soft)] text-[var(--destructive)] hover:bg-[var(--destructive-soft)] hover:text-[var(--destructive)]",
          )}
        >
          {voice.listening ? (
            <MicOff size={18} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <Mic size={18} strokeWidth={1.75} aria-hidden="true" />
          )}
          {voice.listening && (
            <span className="absolute right-1 top-1 size-1.5 rounded-full bg-[var(--destructive)]" aria-hidden="true" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>{voice.supported ? t("chat.voice") : t("chat.voiceUnsupported")}</TooltipContent>
    </Tooltip>
  );

  const modelLeading = model?.capabilities.includes("reasoning") ? (
    <IntelligencePicker
      value={chat?.params.reasoningEffort}
      onChange={(value) => updateParams({ reasoningEffort: value })}
    />
  ) : null;

  return (
    <div className="relative z-10 px-3 pb-3 pt-1 sm:px-5">
      <PromptComposer
        prompts={[]}
        placeholder={t("chat.placeholder")}
        models={modelOptions}
        modelId={selectedModelId}
        onModelChange={handleModelChange}
        attachments={pending.map((attachment) => ({
          id: attachment.id,
          name: attachment.name,
          kind: attachment.kind,
        }))}
        attachPending={busyFiles}
        onAttach={(files) => void handleFiles(files)}
        onRemoveAttachment={(id) => void removeAttachment(id)}
        value={text}
        onChange={setText}
        streaming={!!streaming}
        onStop={stop}
        stopLabel={t("chat.stop")}
        focusSignal={focusSignal}
        hintText={t("chat.placeholderHint")}
        leadingActions={leadingActions}
        modelLeading={modelLeading}
        labels={{
          form: t("chat.composerLabel"),
          input: t("chat.composerLabel"),
          attach: t("chat.attach"),
          model: t("chat.modelLabel"),
          remove: t("common.remove"),
          send: t("chat.send"),
          files: t("chat.attachedFiles"),
        }}
        onSubmit={(submission) => void handleSubmit(submission)}
      />
    </div>
  );
}
