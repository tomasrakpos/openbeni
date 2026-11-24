// chat feature: EmptyState; change its UI/flow here and keep related state/API calls in sync.
import { ArrowRight, Coins, KeyRound, Lock, MessageCircle, Mic, MicOff, ShieldCheck } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { GlassButton } from "@/components/ui/glass-button";
import PromptComposer, { type PromptComposerModel } from "@/components/ui/prompt-composer";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ProviderIcon } from "@/components/ProviderIcon";
import { buildComposerModels, resolveComposerModelId } from "@/features/chat/modelOptions";
import { IntelligencePicker, type ReasoningEffort } from "@/features/chat/IntelligencePicker";
import { SkillPicker } from "@/features/chat/SkillPicker";
import { useVoiceInput, voiceErrorI18nKey } from "@/features/chat/useVoiceInput";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import { useChatsStore } from "@/stores/chats";
import { useAllModels, useAllProviders } from "@/stores/catalog";
import { buildCombinedRouters, isRouterSelectionId, useRoutersStore } from "@/stores/routers";
import { useUiStore } from "@/stores/ui";
import { useSettingsStore } from "@/stores/settings";
import { Logo } from "@/components/Logo";
import { PixelMascot } from "@/features/chat/PixelMascot";

// Prevent React StrictMode double-mount or view switches from replaying the
// landing hero entrance animation and making the title appear twice.
let heroRevealed = false;

export function EmptyState({ docking = false }: { docking?: boolean }) {
  const t = useT();
  const send = useChatsStore((s) => s.send);
  const chats = useChatsStore((s) => s.chats);
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const attachments = useChatsStore((s) => s.attachments);
  const addFiles = useChatsStore((s) => s.addFiles);
  const removeAttachment = useChatsStore((s) => s.removeAttachment);
  const setChatModel = useChatsStore((s) => s.setChatModel);
  const setParams = useChatsStore((s) => s.setParams);
  const createChat = useChatsStore((s) => s.createChat);
  const providers = useAllProviders();
  const models = useAllModels();
  const publicRouters = useRoutersStore((s) => s.publicRouters);
  const localRouters = useRoutersStore((s) => s.localRouters);
  const combinedRouters = React.useMemo(
    () => buildCombinedRouters(publicRouters, localRouters, providers, models),
    [publicRouters, localRouters, providers, models],
  );
  const setView = useUiStore((s) => s.setView);
  const openWizard = useUiStore((s) => s.openWizard);
  const setAuthGateOpen = useUiStore((s) => s.setAuthGateOpen);
  const focusSignal = useUiStore((s) => s.focusComposer);
  const skillMode = useUiStore((s) => s.skillMode);
  const setSkillMode = useUiStore((s) => s.setSkillMode);
  const signedIn = useAuthStore((s) => s.signedIn);
  const authReady = useAuthStore((s) => s.ready);
  const lang = useSettingsStore((s) => s.settings.lang);
  const reduceMotion = useReducedMotion();
  const shouldAnimateHero = React.useRef(!heroRevealed && !docking && !reduceMotion).current;

  React.useEffect(() => {
    heroRevealed = true;
  }, []);

  const rootRef = React.useRef<HTMLDivElement>(null);
  const composerRef = React.useRef<HTMLDivElement>(null);
  const [dockBox, setDockBox] = React.useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const [dockTarget, setDockTarget] = React.useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);

  // When this instance is the leaving copy, freeze the composer where it was,
  // then slide it to the dock position ThreadComposer uses. `top` is animated
  // instead of `transform` so the composer's backdrop-filter keeps sampling
  // the page behind it.
  React.useLayoutEffect(() => {
    if (!docking) {
      setDockBox(null);
      setDockTarget(null);
      return;
    }
    const root = rootRef.current;
    const node = composerRef.current;
    if (!root || !node) return;
    const host = root.parentElement ?? root;
    const hr = host.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    const r = node.getBoundingClientRect();
    setDockBox({ left: r.left - rr.left, top: r.top - rr.top, width: r.width, height: r.height });
    // Land exactly where ThreadComposer sits: bottom 12px, side padding 12px on
    // phones and 20px from `sm` up, both centered in the chat column.
    const pad = window.innerWidth >= 640 ? 20 : 12;
    const width = Math.min(920, Math.max(0, hr.width - pad * 2));
    const target = {
      left: (hr.width - width) / 2 - (rr.left - hr.left),
      top: hr.height - 12 - r.height,
      width,
    };
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setDockTarget(target));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [docking]);

  const dockStyle: React.CSSProperties | undefined = dockBox
    ? {
        position: "absolute",
        left: dockTarget?.left ?? dockBox.left,
        top: dockTarget?.top ?? dockBox.top,
        width: dockTarget?.width ?? dockBox.width,
        zIndex: 20,
      }
    : undefined;

  const [text, setText] = React.useState("");
  const [busyFiles, setBusyFiles] = React.useState(false);
  const [pickedModelId, setPickedModelId] = React.useState("");
  const [reasoningEffort, setReasoningEffort] = React.useState<ReasoningEffort>(undefined);

  const voice = useVoiceInput({
    lang,
    value: text,
    onChange: setText,
    onError: (code) => toast.error(t(voiceErrorI18nKey(code))),
  });

  const chat = chats.find((c) => c.id === activeChatId) ?? null;

  React.useEffect(() => {
    setReasoningEffort(chat?.params.reasoningEffort);
  }, [chat?.id, chat?.params.reasoningEffort]);

  const enabledProviders = React.useMemo(
    () =>
      providers
        .filter((provider) => provider.enabled)
        .sort(
          (a, b) =>
            Number(b.favorite) - Number(a.favorite) ||
            a.order - b.order ||
            a.name.localeCompare(b.name),
        ),
    [providers],
  );

  const modelOptions = React.useMemo<PromptComposerModel[]>(
    () => buildComposerModels(providers, models, combinedRouters, lang),
    [providers, models, combinedRouters, lang],
  );

  const selectedModelId = React.useMemo(() => {
    if (chat?.modelId) {
      const resolved = resolveComposerModelId(modelOptions, models, chat.modelId);
      if (resolved) return resolved;
    }
    if (modelOptions.some((option) => option.id === pickedModelId && !option.disabled)) return pickedModelId;
    return modelOptions.find((option) => !option.disabled)?.id ?? modelOptions[0]?.id ?? "";
  }, [chat, modelOptions, models, pickedModelId]);

  const selectedModelRow = React.useMemo(
    () => models.find((model) => model.id === selectedModelId),
    [models, selectedModelId],
  );
  const reasoningCapable = !!selectedModelRow?.capabilities.includes("reasoning");

  const prompts = React.useMemo(
    () => [
      t("chat.suggestion1Prompt"),
      t("chat.suggestion2Prompt"),
      t("chat.suggestion3Prompt"),
      t("chat.suggestion4Prompt"),
    ],
    [t],
  );

  const handleModelChange = (modelId: string) => {
    setPickedModelId(modelId);
    if (isRouterSelectionId(modelId)) {
      if (chat) void setChatModel("router", modelId);
      return;
    }
    const row = models.find((model) => model.id === modelId);
    if (row && chat) void setChatModel(row.providerId, row.id);
  };

  const handleAttach = async (files: File[]) => {
    if (files.length === 0) return;
    if (files.length > 6) {
      toast.error(t("attach.limit", { n: 6, mb: 25 }));
    }
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

  const handleSubmit = async ({ prompt, modelId }: { prompt: string; modelId: string }) => {
    if (voice.listening) voice.stop({ commit: false });
    if (!useAuthStore.getState().signedIn) {
      setAuthGateOpen(true);
      return;
    }
    if (isRouterSelectionId(modelId)) {
      const router = combinedRouters.find((r) => r.selectionId === modelId);
      if (!router || router.activeMemberCount === 0) return;
      const current = useChatsStore.getState().chats.find((c) => c.id === useChatsStore.getState().activeChatId);
      if (!current) {
        await createChat({ providerId: "router", modelId: router.selectionId });
      } else if (current.providerId !== "router" || current.modelId !== router.selectionId) {
        await setChatModel("router", router.selectionId);
      }
      await send(prompt);
      return;
    }
    const row = models.find((model) => model.id === modelId);
    if (!row) return;
    const current = useChatsStore.getState().chats.find((c) => c.id === useChatsStore.getState().activeChatId);
    if (!current) {
      await createChat({ providerId: row.providerId, modelId: row.id });
    } else if (current.providerId !== row.providerId || current.modelId !== row.id) {
      await setChatModel(row.providerId, row.id);
    }
    await setParams({ reasoningEffort: reasoningCapable ? reasoningEffort : undefined });
    await send(prompt);
  };

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative mx-auto flex w-full max-w-[920px] flex-1 flex-col items-center justify-center px-5 pb-10 pt-[calc(var(--header-h)+48px)]",
        docking && dockTarget && "chat-docking",
      )}
    >
      <motion.div
        initial={shouldAnimateHero ? { opacity: 0, y: 10 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="chat-dock-hero flex w-full flex-col items-center text-center"
      >
        <div className="mb-5 flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-glass)] px-3 py-1.5 shadow-xs backdrop-blur-md">
          <MessageCircle className="size-3.5 text-[var(--primary)]" />
          <span className="text-[11.5px] font-medium tracking-wide text-[var(--muted-foreground)]">
            {t("app.tagline")}
          </span>
        </div>
        <h1
          className="text-balance text-[30px] font-semibold leading-[1.15] tracking-[-0.03em] sm:text-[38px]"
          dir="auto"
        >
          {lang === "fa" ? (
            <span className="text-gradient">{t("chat.emptyTitle")}</span>
          ) : (
            <>
              What are we <span className="text-gradient">working on</span>?
            </>
          )}
        </h1>
        <p className="mt-3 max-w-[520px] text-pretty text-[13.5px] leading-relaxed text-[var(--muted-foreground)]">
          {t("chat.emptySubtitle")}
        </p>
      </motion.div>

      {!authReady && !signedIn ? (
        <div className="chat-dock-hero mt-7 h-[180px] w-full max-w-[440px]" aria-hidden="true" />
      ) : !signedIn ? (
        <div className="chat-dock-hero mt-7 flex max-w-[440px] flex-col items-center gap-3.5 rounded-[20px] border border-[var(--border)] bg-[var(--surface-glass)] p-6 text-center shadow-sm backdrop-blur-xl">
          <span className="grid size-12 place-items-center rounded-[15px] border border-[var(--border)] bg-[var(--surface-2)]">
            <Lock className="size-5 text-[var(--primary)]" />
          </span>
          <div className="space-y-1">
            <p className="text-[15px] font-semibold tracking-[-0.01em]">{t("auth.signInToUnlockTitle")}</p>
            <p className="text-[12.5px] leading-relaxed text-[var(--muted-foreground)]">
              {t("auth.signInToUnlockDesc")}
            </p>
          </div>
          <Button onClick={() => setAuthGateOpen(true)} className="mt-1">
            <Coins className="size-4" />
            {t("auth.signInGetCredits")}
            <ArrowRight className="size-4" />
          </Button>
        </div>
      ) : enabledProviders.length === 0 ? (
        <div className="chat-dock-hero mt-7 flex flex-col items-center gap-3 rounded-[18px] border border-[var(--border)] bg-[var(--surface-glass)] p-6 shadow-sm backdrop-blur-xl">
          <div className="flex -space-x-2">
            {[0, 1, 2].map((index) => (
              <ProviderIcon key={index} name={["OpenAI", "Anthropic", "Gemini"][index]!} size={32} />
            ))}
          </div>
          <p className="max-w-[360px] text-[13px] text-[var(--muted-foreground)]">{t("chat.emptyNoProvider")}</p>
          <div className="flex gap-2">
            <Button onClick={() => openWizard()}>
              {t("chat.emptyAddProvider")}
              <ArrowRight className="size-4" />
            </Button>
            <Button variant="secondary" onClick={() => setView("providers")}>
              {t("nav.providers")}
            </Button>
          </div>
        </div>
      ) : modelOptions.length === 0 ? (
        <div className="chat-dock-hero mt-7 flex flex-col items-center gap-3 rounded-[18px] border border-[var(--border)] bg-[var(--surface-glass)] p-6 shadow-sm backdrop-blur-xl">
          <p className="max-w-[360px] text-[13px] text-[var(--muted-foreground)]">{t("chat.emptyNoModel")}</p>
          <Button variant="secondary" onClick={() => setView("providers")}>
            {t("nav.models")}
            <ArrowRight className="size-4" />
          </Button>
        </div>
      ) : (
        <>
          {dockBox ? <div aria-hidden="true" className="mt-8" style={{ height: dockBox.height }} /> : null}
          <div
            ref={composerRef}
            className={cn("relative w-full", docking ? "chat-dock-composer" : "mt-8")}
            style={dockStyle}
          >
            <PixelMascot />
            <motion.div
              initial={shouldAnimateHero ? { opacity: 0, y: 12 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.32, delay: docking ? 0 : 0.06, ease: [0.22, 1, 0.36, 1] }}
              className="w-full"
            >
              <PromptComposer
                prompts={prompts}
                placeholder={t("chat.placeholder")}
                models={modelOptions}
                modelId={selectedModelId}
                onModelChange={handleModelChange}
                value={text}
                onChange={setText}
                leadingActions={
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <GlassButton
                        variant="icon"
                        active={voice.listening}
                        onClick={voice.toggle}
                        aria-label={voice.listening ? t("chat.voiceStop") : t("chat.voice")}
                        aria-pressed={voice.listening}
                        className={cn(
                          voice.listening && "!text-[var(--destructive)]",
                          !voice.supported && "opacity-60",
                        )}
                      >
                        {voice.listening ? (
                          <MicOff size={14} strokeWidth={1.75} aria-hidden="true" />
                        ) : (
                          <Mic size={14} strokeWidth={1.75} aria-hidden="true" />
                        )}
                        {voice.listening && (
                          <span
                            className="pointer-events-none absolute right-1.5 top-1.5 flex size-1.5"
                            aria-hidden="true"
                          >
                            <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--destructive)] opacity-75" />
                            <span className="relative inline-flex size-1.5 rounded-full bg-[var(--destructive)]" />
                          </span>
                        )}
                      </GlassButton>
                    </TooltipTrigger>
                    <TooltipContent>
                      {voice.listening
                        ? t("chat.listening")
                        : voice.supported
                          ? t("chat.voice")
                          : t("chat.voiceUnsupported")}
                    </TooltipContent>
                  </Tooltip>
                }
                trailingActions={<SkillPicker value={skillMode} onChange={setSkillMode} />}
                modelLeading={
                  reasoningCapable ? (
                    <IntelligencePicker value={reasoningEffort} onChange={setReasoningEffort} />
                  ) : undefined
                }
                attachments={attachments}
                attachPending={busyFiles}
                onAttach={(files) => void handleAttach(files)}
                onRemoveAttachment={(id) => void removeAttachment(id)}
                focusSignal={focusSignal}
                hintText={t("chat.placeholderHint")}
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
            </motion.div>
          </div>
        </>
      )}
    </div>
  );
}
