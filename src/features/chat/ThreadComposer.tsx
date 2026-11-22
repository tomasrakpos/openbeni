// chat feature: ThreadComposer; change its UI/flow here and keep related state/API calls in sync.
import { Coins, Lock, Mic, MicOff } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { GlassButton } from "@/components/ui/glass-button";
import PromptComposer from "@/components/ui/prompt-composer";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { buildComposerModels, resolveComposerModelId } from "@/features/chat/modelOptions";
import { IntelligencePicker } from "@/features/chat/IntelligencePicker";
import { SkillPicker } from "@/features/chat/SkillPicker";
import { useVoiceInput } from "@/features/chat/useVoiceInput";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { ChatParams } from "@/lib/types";
import { useAuthStore } from "@/stores/auth";
import { activeThread, resolveTarget, useChatsStore } from "@/stores/chats";
import { useAllModels, useAllProviders } from "@/stores/catalog";
import { buildCombinedRouters, isRouterSelectionId, useRoutersStore } from "@/stores/routers";
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
  const publicRouters = useRoutersStore((s) => s.publicRouters);
  const localRouters = useRoutersStore((s) => s.localRouters);
  const combinedRouters = React.useMemo(
    () => buildCombinedRouters(publicRouters, localRouters, providers, models),
    [publicRouters, localRouters, providers, models],
  );
  const focusSignal = useUiStore((s) => s.focusComposer);
  const setAuthGateOpen = useUiStore((s) => s.setAuthGateOpen);
  const skillMode = useUiStore((s) => s.skillMode);
  const setSkillMode = useUiStore((s) => s.setSkillMode);
  const signedIn = useAuthStore((s) => s.signedIn);

  const chat = chats.find((c) => c.id === activeChatId) ?? null;
  const resolved = chat ? resolveTarget(chat) : null;
  const model = resolved && "model" in resolved ? resolved.model : undefined;

  const [text, setText] = React.useState("");
  const [busyFiles, setBusyFiles] = React.useState(false);

  const modelOptions = React.useMemo(
    () => (signedIn ? buildComposerModels(providers, models, combinedRouters, lang) : []),
    [signedIn, providers, models, combinedRouters, lang],
  );

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
    if (isRouterSelectionId(modelId)) {
      void setChatModel("router", modelId);
      return;
    }
    const row = models.find((model) => model.id === modelId);
    if (row) void setChatModel(row.providerId, row.id);
  };

  const handleSubmit = async ({ prompt, modelId }: { prompt: string; modelId: string }) => {
    if (!useAuthStore.getState().signedIn) {
      setAuthGateOpen(true);
      return;
    }
    if (isRouterSelectionId(modelId)) {
      const router = combinedRouters.find((r) => r.selectionId === modelId);
      if (!router || router.activeMemberCount === 0) return;
      if (chat && (chat.providerId !== "router" || chat.modelId !== router.selectionId)) {
        await setChatModel("router", router.selectionId);
      }
      await send(prompt);
      return;
    }
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

  const leadingActions = (
    <Tooltip>
      <TooltipTrigger asChild>
        <GlassButton
          variant="icon"
          active={voice.listening}
          onClick={() => (voice.listening ? voice.stop() : voice.start())}
          disabled={!voice.supported}
          aria-label={voice.listening ? t("chat.listening") : t("chat.voice")}
          aria-pressed={voice.listening}
          className={cn(
            voice.listening && "!text-[var(--destructive)]",
          )}
        >
          {voice.listening ? (
            <MicOff size={14} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <Mic size={14} strokeWidth={1.75} aria-hidden="true" />
          )}
          {voice.listening && (
            <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-[var(--destructive)]" aria-hidden="true" />
          )}
        </GlassButton>
      </TooltipTrigger>
      <TooltipContent>{voice.supported ? t("chat.voice") : t("chat.voiceUnsupported")}</TooltipContent>
    </Tooltip>
  );

  const trailingActions = <SkillPicker value={skillMode} onChange={setSkillMode} />;

  const modelLeading = model?.capabilities.includes("reasoning") ? (
    <IntelligencePicker
      value={chat?.params.reasoningEffort}
      onChange={(value) => updateParams({ reasoningEffort: value })}
    />
  ) : null;

  if (!signedIn) {
    return (
      <div className="relative z-10 mx-auto max-w-[920px] px-3 pb-3 pt-1 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-[var(--border)] bg-[var(--surface-glass)] px-4 py-3 shadow-sm backdrop-blur-xl">
          <div className="flex items-center gap-2.5 text-[12.5px]">
            <Lock className="size-4 shrink-0 text-[var(--primary)]" />
            <span className="text-[var(--muted-foreground)]">{t("auth.signInToUnlockDesc")}</span>
          </div>
          <Button size="sm" onClick={() => setAuthGateOpen(true)}>
            <Coins className="size-3.5" />
            {t("auth.signInGetCredits")}
          </Button>
        </div>
      </div>
    );
  }

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
        trailingActions={trailingActions}
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
