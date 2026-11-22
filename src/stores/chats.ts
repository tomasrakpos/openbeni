// App state chats; change state/actions here and keep local persistence in sync.
import { create } from "zustand";
import {
  db,
  deleteChatCascade,
  getMessages,
  listChats,
} from "@/db";
import { getProviderKey } from "@/db/vault";
import { buildThread, deepestLeaf, lastLeaf } from "@/lib/branching";
import { streamChat } from "@/lib/chatClient";
import { extractProjectFiles } from "@/lib/codefiles";
import { checkBackendPreviewIntent, streamServerChat } from "@/lib/serverChat";
import {
  MAX_KEY_ATTEMPTS,
  canRotateKey,
  getProviderKeyCandidates,
  markKeyFailure,
  markKeySuccess,
} from "@/lib/keyPool";
import {
  MAX_ROUTE_ATTEMPTS,
  buildModelRoutes,
  canRotateRoute,
  markRouteFailure,
  markRouteSuccess,
  orderRoutes,
} from "@/lib/modelRoutes";
import { estimateMessages, estimateTokens, deriveTitle } from "@/lib/tokens";
import { blobToBase64, processFile } from "@/lib/media";
import { uid } from "@/lib/id";
import {
  executeWithRouterFailover,
  ROUTER_MAX_FAILOVER_ATTEMPTS,
  RouterScheduler,
} from "@/lib/routerEngine";
import { useAuthStore } from "@/stores/auth";
import { useUiStore } from "@/stores/ui";
import {
  buildCombinedRouters,
  eligibleFreeModelsForLocalProvider,
  isRouterSelectionId,
  parseRouterSelectionId,
  useRoutersStore,
  type CombinedRouterItem,
} from "@/stores/routers";
import type {
  AIModel,
  Attachment,
  Chat,
  ChatMessageInput,
  ChatParams,
  ErrorKind,
  Message,
  Provider,
  SkillId,
} from "@/lib/types";
import { useSettingsStore } from "@/stores/settings";
import { useProvidersStore } from "@/stores/providers";
import {
  DEMO_PROVIDER_ID,
  DEMO_WEB_DESIGN_MODEL_ID,
  demoModel,
  demoProvider,
  demoWebDesignModel,
  SERVER_PROVIDER_ID,
  serverProvider,
  useCatalogStore,
} from "@/stores/catalog";

export interface StreamingState {
  chatId: string;
  messageId: string;
  content: string;
  reasoning: string;
  startedAt: number;
  skillId?: SkillId;
  skillSourcesCount?: number;
}

interface ChatsState {
  chats: Chat[];
  activeChatId: string | null;
  messages: Message[];
  attachments: Attachment[];
  streaming: StreamingState | null;
  loading: boolean;
  error: { kind: ErrorKind; message: string } | null;
  load: () => Promise<void>;
  startNewChat: () => void;
  createChat: (options?: Partial<Pick<Chat, "providerId" | "modelId" | "systemPrompt">>) => Promise<Chat>;
  selectChat: (id: string) => Promise<void>;
  deleteChat: (id: string) => Promise<void>;
  renameChat: (id: string, title: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  setSystemPrompt: (prompt: string) => Promise<void>;
  setChatModel: (providerId: string, modelId: string) => Promise<void>;
  setParams: (patch: Partial<ChatParams>) => Promise<void>;
  setChatPreviewEnabled: (chatId: string, enabled: boolean) => Promise<void>;
  send: (text: string) => Promise<void>;
  stop: () => void;
  regenerate: (messageId: string) => Promise<void>;
  editAndResend: (messageId: string, text: string) => Promise<void>;
  switchBranch: (messageId: string, direction: 1 | -1) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  addFiles: (files: File[]) => Promise<{ added: number; errors: string[] }>;
  removeAttachment: (id: string) => Promise<void>;
  clearError: () => void;
  streamInto: (
    chat: Chat,
    provider: Provider,
    model: AIModel,
    thread: Message[],
    assistantId: string,
  ) => Promise<void>;
}

let activeAbort: AbortController | null = null;

function defaultChatParams(): ChatParams {
  const settings = useSettingsStore.getState().settings;
  return { temperature: settings.temperature, topP: settings.topP, maxTokens: settings.maxTokens };
}

const clientRouterScheduler = new RouterScheduler();

function routerVirtualProvider(router: CombinedRouterItem): Provider {
  const now = Date.now();
  return {
    id: "router",
    name: router.providerName || "OpenHarneks",
    baseUrl: "",
    apiFormat: "openai",
    auth: { header: "", prefix: "" },
    extraHeaders: {},
    timeoutMs: 30_000,
    useProxy: false,
    enabled: true,
    favorite: false,
    order: 0,
    managed: router.source === "server",
    paths: {},
    hasKey: true,
    createdAt: now,
    updatedAt: now,
  };
}

function routerVirtualModel(router: CombinedRouterItem): AIModel {
  const now = Date.now();
  return {
    id: router.selectionId,
    providerId: "router",
    modelId: router.selectionId,
    displayName: router.name,
    capabilities: (router.capabilities.length > 0 ? router.capabilities : ["text"]) as AIModel["capabilities"],
    tier: "free",
    pricingTier: "free",
    enabled: true,
    favorite: false,
    order: 0,
    source: "preset",
    createdAt: now,
    updatedAt: now,
  };
}

export function resolveTarget(chat: Chat): { provider: Provider; model: AIModel } | { error: string } {
  const localProviders = useProvidersStore.getState().providers;
  const localModels = useProvidersStore.getState().models;
  const serverModels = useCatalogStore.getState().providerModels;
  const providers = serverModels.length > 0 ? [...localProviders, serverProvider()] : [...localProviders];
  const models = serverModels.length > 0 ? [...localModels, ...serverModels] : [...localModels];
  if (import.meta.env.DEV) {
    providers.push(demoProvider());
    models.push(demoModel(), demoWebDesignModel());
  }

  if (isRouterSelectionId(chat.modelId)) {
    const routersState = useRoutersStore.getState();
    const combined = buildCombinedRouters(
      routersState.publicRouters,
      routersState.localRouters,
      providers,
      models,
    );
    const router = combined.find((r) => r.selectionId === chat.modelId);
    if (router) {
      if (router.activeMemberCount === 0) return { error: "router.disabledEmpty" };
      return {
        provider: routerVirtualProvider(router),
        model: routerVirtualModel(router),
      };
    }
  }
  const provider = providers.find((p) => p.id === chat.providerId && p.enabled);
  const model = models.find((m) => m.id === chat.modelId && m.enabled && !m.locked);
  if (provider && model && model.providerId === provider.id) return { provider, model };
  for (const candidate of providers.filter((p) => p.enabled).sort((a, b) => Number(b.favorite) - Number(a.favorite))) {
    const candidateModels = models
      .filter((m) => m.providerId === candidate.id && m.enabled && !m.locked)
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.order - b.order);
    const first = candidateModels[0];
    if (first) return { provider: candidate, model: first };
  }
  if (providers.length === 0) return { error: "error.noProvider" };
  if (models.length === 0) return { error: "error.noModel" };
  return { error: "error.noModel" };
}

export function activeThread(messages: Message[], chat: Chat | null | undefined): Message[] {
  if (!chat) return [];
  return buildThread(messages, chat.currentLeafId);
}

/**
 * Returns true only when the active conversation is actually building or
 * editing a previewable project (classified by the backend preview-intent
 * algorithm or containing runnable HTML/CSS/JS/JSX code). Always false in the
 * lobby (no messages) and in ordinary chat/search/Q&A conversations.
 */
export function isChatPreviewAvailable(
  chat: Chat | null | undefined,
  messages: Message[],
): boolean {
  if (!chat) return false;
  const thread = activeThread(messages, chat);
  if (thread.length === 0) return false;
  if (chat.previewEnabled) return true;
  for (let i = thread.length - 1; i >= 0; i -= 1) {
    const msg = thread[i];
    if (msg?.role === "assistant" && msg.content && extractProjectFiles(msg.content).length > 0) {
      return true;
    }
  }
  return false;
}

async function buildApiInputs(
  thread: Message[],
  attachmentMap: Map<string, Attachment>,
  provider: Provider,
  model: AIModel,
): Promise<ChatMessageInput[]> {
  const out: ChatMessageInput[] = [];
  for (const message of thread) {
    if (message.role === "system") continue;
    if (message.role === "assistant" && !message.content.trim()) continue;
    const images: { mimeType: string; data: string }[] = [];
    const videos: { mimeType: string; data: string }[] = [];
    let extraText = "";
    for (const attachmentId of message.attachments) {
      const attachment = attachmentMap.get(attachmentId);
      if (!attachment) continue;
      if (attachment.kind === "image" && attachment.blob) {
        images.push({ mimeType: attachment.mimeType, data: await blobToBase64(attachment.blob) });
      } else if (attachment.kind === "video") {
        const nativeVideo =
          provider.apiFormat === "gemini" &&
          model.capabilities.includes("video") &&
          attachment.blob &&
          attachment.blob.size <= 18 * 1024 * 1024;
        if (nativeVideo && attachment.blob) {
          videos.push({ mimeType: attachment.mimeType, data: await blobToBase64(attachment.blob) });
        } else if (attachment.frames?.length) {
          for (const frame of attachment.frames) {
            const comma = frame.indexOf(",");
            if (comma > -1) images.push({ mimeType: "image/jpeg", data: frame.slice(comma + 1) });
          }
        }
      } else if (attachment.text) {
        extraText += `\n\n--- Attached file: ${attachment.name} ---\n${attachment.text}`;
      }
    }
    out.push({
      role: message.role,
      content: `${message.content}${extraText}`.trim(),
      ...(images.length ? { images } : {}),
      ...(videos.length ? { videos } : {}),
    });
  }
  return out;
}

export const useChatsStore = create<ChatsState>()((set, get) => ({
  chats: [],
  activeChatId: null,
  messages: [],
  attachments: [],
  streaming: null,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true });
    const rawChats = await listChats();
    // Prune any leftover empty draft chats (no messages and no title) that were
    // created before chats became lazy-on-first-send.
    const emptyIds: string[] = [];
    const chats: Chat[] = [];
    for (const chat of rawChats) {
      if (!chat.currentLeafId && !chat.title.trim()) {
        const msgCount = await db.messages.where("chatId").equals(chat.id).count();
        if (msgCount === 0) {
          emptyIds.push(chat.id);
          continue;
        }
      }
      chats.push(chat);
    }
    if (emptyIds.length > 0) {
      void Promise.all(emptyIds.map((id) => deleteChatCascade(id))).catch(() => undefined);
    }

    const first = chats[0];
    if (first) {
      const [messages, attachments] = await Promise.all([
        getMessages(first.id),
        db.attachments.where("chatId").equals(first.id).toArray(),
      ]);
      set({ chats, activeChatId: first.id, messages, attachments, loading: false });
    } else {
      set({ chats, activeChatId: null, messages: [], attachments: [], loading: false });
    }
  },

  startNewChat: () => {
    if (get().streaming) get().stop();
    const currentId = get().activeChatId;
    const current = currentId ? get().chats.find((c) => c.id === currentId) : null;
    // If the user leaves an unsent empty draft (e.g. attached files then clicked
    // New Chat without sending), drop that empty draft so no "…" ghosts accumulate.
    if (current && !current.currentLeafId && !current.title.trim() && get().messages.length === 0) {
      void deleteChatCascade(current.id).catch(() => undefined);
      set((state) => ({
        chats: state.chats.filter((c) => c.id !== current.id),
        activeChatId: null,
        messages: [],
        attachments: [],
        error: null,
        streaming: null,
      }));
      return;
    }
    set({
      activeChatId: null,
      messages: [],
      attachments: [],
      error: null,
      streaming: null,
    });
  },

  createChat: async (options) => {
    const settings = useSettingsStore.getState().settings;
    const providers = useProvidersStore.getState().providers;
    const localModels = useProvidersStore.getState().models;
    const serverModels = useCatalogStore.getState().providerModels;
    const allProviders = serverModels.length > 0 ? [...providers, serverProvider()] : providers;
    const models = serverModels.length > 0 ? [...localModels, ...serverModels] : localModels;
    const fallbackProvider = allProviders.find((p) => p.enabled);
    const fallbackModel = models.find((m) => m.providerId === fallbackProvider?.id && m.enabled && !m.locked);
    const now = Date.now();
    const chat: Chat = {
      id: uid("chat"),
      title: "",
      systemPrompt: options?.systemPrompt ?? "",
      pinned: false,
      providerId: options?.providerId ?? fallbackProvider?.id,
      modelId: options?.modelId ?? fallbackModel?.id,
      params: defaultChatParams(),
      currentLeafId: null,
      createdAt: now,
      updatedAt: now,
    };
    await db.chats.put(chat);
    set((state) => ({
      chats: [chat, ...state.chats],
      activeChatId: chat.id,
      messages: [],
      attachments: [],
      error: null,
      streaming: null,
    }));
    return chat;
  },

  selectChat: async (id) => {
    if (get().streaming) get().stop();
    const [messages, attachments] = await Promise.all([
      getMessages(id),
      db.attachments.where("chatId").equals(id).toArray(),
    ]);
    set({ activeChatId: id, messages, attachments, error: null });
  },

  deleteChat: async (id) => {
    if (get().streaming?.chatId === id) get().stop();
    await deleteChatCascade(id);
    const remaining = get().chats.filter((c) => c.id !== id);
    set({ chats: remaining });
    if (get().activeChatId === id) {
      const next = remaining[0];
      if (next) await get().selectChat(next.id);
      else set({ activeChatId: null, messages: [], attachments: [] });
    }
  },

  renameChat: async (id, title) => {
    const chat = get().chats.find((c) => c.id === id);
    if (!chat) return;
    const next = { ...chat, title: title.trim() || chat.title, updatedAt: Date.now() };
    await db.chats.put(next);
    set((state) => ({ chats: state.chats.map((c) => (c.id === id ? next : c)) }));
  },

  togglePin: async (id) => {
    const chat = get().chats.find((c) => c.id === id);
    if (!chat) return;
    const next = { ...chat, pinned: !chat.pinned, updatedAt: Date.now() };
    await db.chats.put(next);
    set((state) => ({ chats: state.chats.map((c) => (c.id === id ? next : c)) }));
  },

  setSystemPrompt: async (prompt) => {
    const chat = get().chats.find((c) => c.id === get().activeChatId);
    if (!chat) return;
    const next = { ...chat, systemPrompt: prompt, updatedAt: Date.now() };
    await db.chats.put(next);
    set((state) => ({ chats: state.chats.map((c) => (c.id === chat.id ? next : c)) }));
  },

  setChatModel: async (providerId, modelId) => {
    const chat = get().chats.find((c) => c.id === get().activeChatId);
    if (!chat) return;
    const next = { ...chat, providerId, modelId, updatedAt: Date.now() };
    await db.chats.put(next);
    set((state) => ({ chats: state.chats.map((c) => (c.id === chat.id ? next : c)) }));
  },

  setParams: async (patch) => {
    const chat = get().chats.find((c) => c.id === get().activeChatId);
    if (!chat) return;
    const next = { ...chat, params: { ...chat.params, ...patch }, updatedAt: Date.now() };
    await db.chats.put(next);
    set((state) => ({ chats: state.chats.map((c) => (c.id === chat.id ? next : c)) }));
  },

  setChatPreviewEnabled: async (chatId, enabled) => {
    const chat = get().chats.find((c) => c.id === chatId);
    if (!chat || Boolean(chat.previewEnabled) === enabled) return;
    const next: Chat = { ...chat, previewEnabled: enabled, updatedAt: Date.now() };
    // Update store synchronously so the preview slider unlocks on frame 0
    // (immediately swipeable even while the model is still streaming).
    set((state) => ({ chats: state.chats.map((c) => (c.id === chatId ? next : c)) }));
    await db.chats.put(next);
  },

  send: async (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (get().streaming) return;
    const auth = useAuthStore.getState();
    if (!auth.signedIn) {
      useUiStore.getState().setAuthGateOpen(true);
      set({ error: { kind: "auth", message: "error.signInRequired" } });
      return;
    }
    if (auth.profile && auth.profile.credits <= 0) {
      set({ error: { kind: "rate-limit", message: "error.creditsExhausted" } });
      return;
    }
    let chat = get().chats.find((c) => c.id === get().activeChatId);
    if (!chat) chat = await get().createChat();
    const target = resolveTarget(chat);
    if ("error" in target) {
      set({ error: { kind: "unknown", message: target.error } });
      return;
    }
    const { provider, model } = target;
    const now = Date.now();
    const referenced = new Set(get().messages.flatMap((m) => m.attachments));
    const pendingAttachments = get()
      .attachments.filter((attachment) => !referenced.has(attachment.id))
      .map((attachment) => attachment.id);
    const userMessage: Message = {
      id: uid("msg"),
      chatId: chat.id,
      role: "user",
      content: trimmed,
      parentId: chat.currentLeafId,
      attachments: pendingAttachments,
      createdAt: now,
    };
    const assistantMessage: Message = {
      id: uid("msg"),
      chatId: chat.id,
      role: "assistant",
      content: "",
      parentId: userMessage.id,
      attachments: [],
      providerId: provider.id,
      modelId: model.modelId,
      createdAt: now + 1,
    };
    const activeSkillMode = useUiStore.getState().skillMode;
    const pinnedPreviewSkill = activeSkillMode === "web_builder" || activeSkillMode === "game_builder";
    const title = chat.title.trim() ? chat.title : deriveTitle(trimmed);
    const updatedChat: Chat = {
      ...chat,
      title,
      providerId: provider.id,
      modelId: model.id,
      currentLeafId: assistantMessage.id,
      previewEnabled:
        chat.previewEnabled ||
        pinnedPreviewSkill ||
        (import.meta.env.DEV && model.id === DEMO_WEB_DESIGN_MODEL_ID) ||
        undefined,
      updatedAt: now,
    };
    await db.messages.bulkPut([userMessage, assistantMessage]);
    await db.chats.put(updatedChat);
    const messages = [...get().messages, userMessage, assistantMessage];
    set((state) => ({
      chats: state.chats.map((c) => (c.id === chat!.id ? updatedChat : c)),
      messages,
      error: null,
    }));

    const thread = buildThread(messages, userMessage.id);
    await get().streamInto(updatedChat, provider, model, thread, assistantMessage.id);
  },

  stop: () => {
    activeAbort?.abort();
  },

  regenerate: async (messageId) => {
    if (get().streaming) return;
    const chat = get().chats.find((c) => c.id === get().activeChatId);
    const targetMessage = get().messages.find((m) => m.id === messageId);
    if (!chat || !targetMessage || targetMessage.role !== "assistant") return;
    const target = resolveTarget(chat);
    if ("error" in target) {
      set({ error: { kind: "unknown", message: target.error } });
      return;
    }
    const assistant: Message = {
      id: uid("msg"),
      chatId: chat.id,
      role: "assistant",
      content: "",
      parentId: targetMessage.parentId,
      attachments: [],
      providerId: target.provider.id,
      modelId: target.model.modelId,
      createdAt: Date.now(),
    };
    await db.messages.put(assistant);
    const messages = [...get().messages, assistant];
    const updatedChat: Chat = { ...chat, currentLeafId: assistant.id, updatedAt: Date.now() };
    await db.chats.put(updatedChat);
    set((state) => ({ messages, chats: state.chats.map((c) => (c.id === chat.id ? updatedChat : c)), error: null }));
    const parentThread = assistant.parentId ? buildThread(messages, assistant.parentId) : [];
    await get().streamInto(updatedChat, target.provider, target.model, parentThread, assistant.id);
  },

  editAndResend: async (messageId, text) => {
    if (get().streaming) return;
    const chat = get().chats.find((c) => c.id === get().activeChatId);
    const original = get().messages.find((m) => m.id === messageId);
    if (!chat || !original || original.role !== "user" || !text.trim()) return;
    const target = resolveTarget(chat);
    if ("error" in target) {
      set({ error: { kind: "unknown", message: target.error } });
      return;
    }
    const now = Date.now();
    const userMessage: Message = {
      ...original,
      id: uid("msg"),
      content: text.trim(),
      parentId: original.parentId,
      createdAt: now,
    };
    const assistant: Message = {
      id: uid("msg"),
      chatId: chat.id,
      role: "assistant",
      content: "",
      parentId: userMessage.id,
      attachments: [],
      providerId: target.provider.id,
      modelId: target.model.modelId,
      createdAt: now + 1,
    };
    await db.messages.bulkPut([userMessage, assistant]);
    const messages = [...get().messages, userMessage, assistant];
    const updatedChat: Chat = { ...chat, currentLeafId: assistant.id, updatedAt: now };
    await db.chats.put(updatedChat);
    set((state) => ({ messages, chats: state.chats.map((c) => (c.id === chat.id ? updatedChat : c)), error: null }));
    const thread = buildThread(messages, userMessage.id);
    await get().streamInto(updatedChat, target.provider, target.model, thread, assistant.id);
  },

  switchBranch: async (messageId, direction) => {
    const chat = get().chats.find((c) => c.id === get().activeChatId);
    const message = get().messages.find((m) => m.id === messageId);
    if (!chat || !message) return;
    const siblings = get()
      .messages.filter((m) => m.parentId === message.parentId && m.role === message.role)
      .sort((a, b) => a.createdAt - b.createdAt);
    if (siblings.length < 2) return;
    const index = siblings.findIndex((m) => m.id === message.id);
    const nextIndex = (index + direction + siblings.length) % siblings.length;
    const sibling = siblings[nextIndex];
    if (!sibling) return;
    const leaf = deepestLeaf(get().messages, sibling.id);
    const updatedChat = { ...chat, currentLeafId: leaf, updatedAt: Date.now() };
    await db.chats.put(updatedChat);
    set((state) => ({ chats: state.chats.map((c) => (c.id === chat.id ? updatedChat : c)) }));
  },

  deleteMessage: async (messageId) => {
    const chat = get().chats.find((c) => c.id === get().activeChatId);
    const message = get().messages.find((m) => m.id === messageId);
    if (!chat || !message) return;
    const doomed = new Set<string>([messageId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const m of get().messages) {
        if (m.parentId && doomed.has(m.parentId) && !doomed.has(m.id)) {
          doomed.add(m.id);
          changed = true;
        }
      }
    }
    await db.messages.bulkDelete([...doomed]);
    const remaining = get().messages.filter((m) => !doomed.has(m.id));
    let leaf = chat.currentLeafId;
    if (!leaf || doomed.has(leaf)) {
      leaf = message.parentId ? deepestLeaf(remaining, message.parentId) : lastLeaf(remaining);
    }
    const updatedChat = { ...chat, currentLeafId: leaf, updatedAt: Date.now() };
    await db.chats.put(updatedChat);
    set((state) => ({
      messages: remaining,
      chats: state.chats.map((c) => (c.id === chat.id ? updatedChat : c)),
    }));
  },

  addFiles: async (files) => {
    let chat = get().chats.find((c) => c.id === get().activeChatId);
    if (!chat) chat = await get().createChat();
    const target = resolveTarget(chat);
    const model = "error" in target ? null : target.model;
    const provider = "error" in target ? null : target.provider;
    const result: { added: number; errors: string[] } = { added: 0, errors: [] };
    const created: Attachment[] = [];
    for (const file of files) {
      const isImage = file.type.startsWith("image/");
      const isVideo = file.type.startsWith("video/");
      if (isImage && model && !model.capabilities.includes("vision")) {
        result.errors.push("attach.visionRequired");
        continue;
      }
      if (isVideo && model && !model.capabilities.includes("vision")) {
        result.errors.push("attach.visionRequired");
        continue;
      }
      try {
        const processed = await processFile(file, {
          preferNativeVideo: provider?.apiFormat === "gemini" && !!model?.capabilities.includes("video"),
        });
        const attachment: Attachment = {
          id: uid("att"),
          chatId: chat.id,
          name: processed.name,
          mimeType: processed.mimeType,
          size: processed.size,
          kind: processed.kind,
          width: processed.width,
          height: processed.height,
          durationSec: processed.durationSec,
          blob: processed.blob,
          text: processed.text,
          frames: processed.frames,
          createdAt: Date.now(),
        };
        await db.attachments.put(attachment);
        created.push(attachment);
        result.added += 1;
        if (processed.warning === "PDF text extracted") result.errors.push("attach.pdfExtract");
        if (processed.warning?.includes("frames extracted")) {
          result.errors.push("attach.videoFrames:" + String(processed.frames?.length ?? 0));
        }
      } catch (err) {
        result.errors.push(err instanceof Error ? err.message : "attach.unsupported");
      }
    }
    if (created.length) set((state) => ({ attachments: [...state.attachments, ...created] }));
    return result;
  },

  removeAttachment: async (id) => {
    await db.attachments.delete(id);
    set((state) => ({ attachments: state.attachments.filter((a) => a.id !== id) }));
  },

  clearError: () => set({ error: null }),

  streamInto: async (chat, provider, model, thread, assistantId) => {
    const auth = useAuthStore.getState();
    if (!auth.signedIn) {
      useUiStore.getState().setAuthGateOpen(true);
      set({ error: { kind: "auth", message: "error.signInRequired" } });
      return;
    }
    if (auth.profile?.status === "blocked") {
      set({ error: { kind: "auth", message: "error.accountBlocked" } });
      return;
    }
    if (import.meta.env.DEV && auth.profile) {
      const { checkDevUserBlocked } = await import("@/lib/devAdminMock");
      if (await checkDevUserBlocked(auth.profile.id, auth.profile.email)) {
        set({ error: { kind: "auth", message: "error.accountBlocked" } });
        return;
      }
    }
    if (auth.profile && auth.profile.credits <= 0) {
      set({ error: { kind: "rate-limit", message: "error.creditsExhausted" } });
      return;
    }

    // Dev-only local mock chat: simulates a smooth ~3s streamed reply without
    // calling any AI API so the real-time credit drain UI can be previewed.
    if (provider.id === DEMO_PROVIDER_ID && import.meta.env.DEV) {
      const controller = new AbortController();
      activeAbort = controller;
      const startedAt = Date.now();
      set({
        streaming: { chatId: chat.id, messageId: assistantId, content: "", reasoning: "", startedAt },
        error: null,
      });

      const lastUser = [...thread].reverse().find((m) => m.role === "user")?.content.trim() ?? "";
      const isPersian = /[\u0600-\u06FF]/.test(lastUser);
      const quote = lastUser.length > 60 ? `${lastUser.slice(0, 60)}…` : lastUser;
      const remainingAfter = Math.max(0, (auth.profile?.credits ?? 1) - 1);

      const activeSkillMode = useUiStore.getState().skillMode;
      const attachmentMap = new Map(get().attachments.map((a) => [a.id, a]));
      const intentMessages = thread.map((m) => ({
        role: m.role,
        content: m.content,
        hasImages: m.attachments.some((id) => attachmentMap.get(id)?.kind === "image"),
      }));

      const isWebDesignMock = model.id === DEMO_WEB_DESIGN_MODEL_ID;
      // Query the real backend 4-skill router + live search engine so DEV mock
      // testing demonstrates all 4 skills (Auto & Manual) with real live search.
      const effectiveMode =
        isWebDesignMock && activeSkillMode === "auto" ? "web_builder" : activeSkillMode;
      const backendIntent = await checkBackendPreviewIntent(
        intentMessages,
        controller.signal,
        effectiveMode,
      );
      const resolvedSkill: SkillId =
        backendIntent?.skillId ?? (isWebDesignMock ? "web_builder" : "chat");
      const resolvedSourcesCount =
        (backendIntent?.webSources?.length ?? 0) + (backendIntent?.imageAssets?.length ?? 0);
      set((state) =>
        state.streaming && state.streaming.messageId === assistantId
          ? {
              streaming: {
                ...state.streaming,
                skillId: resolvedSkill,
                skillSourcesCount: resolvedSourcesCount,
              },
            }
          : state,
      );

      const needsPreview = Boolean(
        resolvedSkill === "web_builder" ||
          resolvedSkill === "game_builder" ||
          backendIntent?.needsPreview ||
          chat.previewEnabled,
      );
      if (needsPreview) {
        void get().setChatPreviewEnabled(chat.id, true);
      }

      const uiLang = useSettingsStore.getState().settings.lang;
      const usePersian = isPersian || uiLang === "fa";

      const loginSteps = usePersian
        ? [
            "ساخت ساختار پایه صفحه (index.html)",
            "طراحی کارت شیشه‌ای و استایل ریسپانسیو",
            "ساخت فیلدهای ایمیل، رمز عبور و دکمه نمایش رمز",
            "افزودن اعتبارسنجی تعاملی و پیام وضعیت ورود",
          ]
        : [
            "Creating page structure (index.html)",
            "Styling glassmorphic card & responsive layout",
            "Building email, password & visibility toggle fields",
            "Adding interactive validation & login feedback",
          ];

      const loginPlanBlock = `<plan>\n${loginSteps.map((s) => `- ${s}`).join("\n")}\n</plan>`;

      const demoLoginFormCode = `${loginPlanBlock}\n\n\`\`\`html index.html
<!-- @step: ${loginSteps[0]} -->
<!doctype html>
<html lang="${usePersian ? "fa" : "en"}" dir="${usePersian ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${usePersian ? "فرم ورود — پیش‌نمایش" : "Sign In — Preview"}</title>
<!-- @step: ${loginSteps[1]} -->
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{
    min-height:100vh;display:grid;place-items:center;padding:20px;
    background:radial-gradient(circle at 20% 10%,#2b1d5e 0%,#0b0d1a 55%,#070811 100%);
    color:#f3f6ff;font-family:Inter,system-ui,-apple-system,sans-serif;
  }
  .card{
    width:min(380px,100%);padding:28px 24px;border-radius:22px;
    background:rgba(255,255,255,.06);
    border:1px solid rgba(255,255,255,.13);
    box-shadow:0 24px 60px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.16);
    backdrop-filter:blur(18px);
  }
  .badge{
    display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;
    background:rgba(139,92,246,.18);color:#c4b5fd;font-size:11px;font-weight:600;margin-bottom:14px;
  }
  h1{font-size:22px;font-weight:700;letter-spacing:-.02em;margin-bottom:6px}
  .sub{font-size:13px;color:rgba(243,246,255,.65);margin-bottom:22px;line-height:1.5}
  label{display:block;font-size:12px;font-weight:500;color:rgba(243,246,255,.82);margin-bottom:6px}
  .field{margin-bottom:14px;position:relative}
  input[type=email],input[type=password],input[type=text]{
    width:100%;height:42px;padding:0 14px;border-radius:12px;
    border:1px solid rgba(255,255,255,.14);background:rgba(10,12,24,.65);
    color:#fff;font-size:14px;outline:none;transition:border-color .2s,box-shadow .2s;
  }
  input:focus{border-color:#8b5cf6;box-shadow:0 0 0 3px rgba(139,92,246,.22)}
  .pw-wrap{position:relative}
  .pw-wrap input{padding-inline-end:64px}
  .toggle{
    position:absolute;inset-inline-end:8px;top:50%;transform:translateY(-50%);
    border:0;background:transparent;color:#a5b4fc;font-size:12px;font-weight:600;
    padding:4px 8px;border-radius:8px;cursor:pointer;
  }
  .row{display:flex;align-items:center;justify-content:space-between;margin:10px 0 18px;font-size:12.5px;color:rgba(243,246,255,.72)}
  .row label{display:inline-flex;align-items:center;gap:7px;margin:0;cursor:pointer}
  .row a{color:#c4b5fd;text-decoration:none}
  .btn{
    width:100%;height:44px;border:0;border-radius:13px;
    background:linear-gradient(135deg,#7c5cff,#5b3df5);color:#fff;
    font-size:14px;font-weight:600;cursor:pointer;
    box-shadow:0 10px 26px rgba(124,92,255,.38);transition:transform .15s,filter .15s;
  }
  .btn:active{transform:scale(.98)}
  .status{
    margin-top:14px;min-height:20px;font-size:12.5px;text-align:center;
    color:#6ee7b7;font-weight:500;
  }
</style>
</head>
<body>
  <!-- @step: ${usePersian ? "ساخت فیلدهای ایمیل، رمز عبور و دکمه نمایش رمز" : "Building email, password & visibility toggle fields"} -->
  <form class="card" id="loginForm" novalidate>
    <div class="badge">${usePersian ? "پیش‌نمایش طراحی وب" : "Web Design Preview"}</div>
    <h1>${usePersian ? "خوش برگشتی" : "Welcome back"}</h1>
    <p class="sub">${usePersian ? "برای ورود به فضای کاری، اطلاعات حسابت را وارد کن." : "Sign in to continue to your workspace."}</p>
    <div class="field">
      <label for="email">${usePersian ? "ایمیل" : "Email"}</label>
      <input id="email" type="email" placeholder="you@example.com" dir="ltr" required />
    </div>
    <div class="field">
      <label for="pw">${usePersian ? "رمز عبور" : "Password"}</label>
      <div class="pw-wrap">
        <input id="pw" type="password" placeholder="••••••••" dir="ltr" required />
        <button type="button" class="toggle" id="togglePw">${usePersian ? "نمایش" : "Show"}</button>
      </div>
    </div>
    <div class="row">
      <label><input type="checkbox" id="rem" checked /> ${usePersian ? "مرا به خاطر بسپار" : "Remember me"}</label>
      <a href="#" id="forgot">${usePersian ? "فراموشی رمز؟" : "Forgot password?"}</a>
    </div>
    <button class="btn" type="submit">${usePersian ? "ورود به حساب" : "Sign in"}</button>
    <div class="status" id="status" role="status"></div>
  </form>
  <!-- @step: ${usePersian ? "افزودن اعتبارسنجی تعاملی و پیام وضعیت ورود" : "Adding interactive validation & login feedback"} -->
  <script>
    const pw = document.getElementById("pw");
    const toggle = document.getElementById("togglePw");
    const status = document.getElementById("status");
    const isFa = ${usePersian ? "true" : "false"};
    toggle.onclick = () => {
      const show = pw.type === "password";
      pw.type = show ? "text" : "password";
      toggle.textContent = show ? (isFa ? "مخفی" : "Hide") : (isFa ? "نمایش" : "Show");
    };
    document.getElementById("forgot").onclick = (e) => {
      e.preventDefault();
      status.style.color = "#c4b5fd";
      status.textContent = isFa ? "لینک بازیابی رمز ارسال شد (آزمایشی)." : "Password reset link sent (demo).";
    };
    document.getElementById("loginForm").onsubmit = (e) => {
      e.preventDefault();
      const email = document.getElementById("email").value.trim();
      if (!email || !pw.value) {
        status.style.color = "#fda4af";
        status.textContent = isFa ? "لطفاً ایمیل و رمز عبور را وارد کن." : "Please enter both email and password.";
        return;
      }
      status.style.color = "#6ee7b7";
      status.textContent = isFa ? "با موفقیت وارد شدی (" + email + ") ✓" : "Signed in as " + email + " ✓";
    };
  </script>
</body>
</html>
\`\`\``;

      const demoPreviewCode =
        resolvedSkill === "game_builder"
          ? `<plan>
- ${usePersian ? "ساخت بوم ریسپانسیو و نورپردازی فضا" : "Set up HiDPI canvas & atmospheric lighting"}
- ${usePersian ? "پیاده‌سازی حرکت نرم بازیکن با کیبورد و لمس" : "Implement smooth keyboard & touch controls"}
- ${usePersian ? "افزودن موانع، ذرات برخورد و امتیاز زنده" : "Add obstacles, particle bursts & live scoring"}
</plan>

\`\`\`html index.html
<!-- @step: ${usePersian ? "ساخت بوم ریسپانسیو و نورپردازی فضا" : "Set up HiDPI canvas & atmospheric lighting"} -->
<!doctype html>
<html lang="${usePersian ? "fa" : "en"}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no" />
<title>${usePersian ? "بازی فضایی — پیش‌نمایش" : "Orbit Dodge — Game Studio"}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;user-select:none;-webkit-user-select:none}
  body{min-height:100vh;overflow:hidden;background:#070914;color:#eef2ff;font-family:Inter,system-ui,sans-serif;display:grid;place-items:center}
  canvas{display:block;width:100vw;height:100vh;touch-action:none}
  .hud{position:fixed;top:14px;inset-inline:16px;display:flex;justify-content:space-between;align-items:center;pointer-events:none;font-size:13px;font-weight:600}
  .pill{padding:6px 12px;border-radius:999px;background:rgba(15,18,36,.72);border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(10px)}
  .overlay{position:fixed;inset:0;display:grid;place-items:center;background:rgba(7,9,20,.65);backdrop-filter:blur(8px)}
  .panel{width:min(320px,88vw);padding:24px;border-radius:20px;background:rgba(18,22,42,.92);border:1px solid rgba(255,255,255,.14);text-align:center}
  h1{font-size:20px;margin-bottom:6px}
  p{font-size:12.5px;color:rgba(238,242,255,.68);margin-bottom:18px;line-height:1.5}
  button{width:100%;height:42px;border:0;border-radius:12px;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;font-weight:600;cursor:pointer}
</style>
</head>
<body>
  <canvas id="c"></canvas>
  <div class="hud">
    <div class="pill" id="scoreHud">0</div>
    <div class="pill" id="bestHud">Best: 0</div>
  </div>
  <div class="overlay" id="ov">
    <div class="panel">
      <h1 id="ovTitle">${usePersian ? "فرار مداری" : "Orbit Dodge"}</h1>
      <p id="ovSub">${usePersian ? "انگشت یا موس را بکشید (یا کلیدهای چپ/راست) و از شهاب‌ها جاخالی بدهید." : "Drag anywhere or use Left/Right arrows to dodge incoming meteors."}</p>
      <button id="startBtn">${usePersian ? "شروع بازی" : "Play"}</button>
    </div>
  </div>
  <script>
    const c = document.getElementById("c"), ctx = c.getContext("2d");
    const ov = document.getElementById("ov"), scoreHud = document.getElementById("scoreHud"), bestHud = document.getElementById("bestHud");
    let w = 0, h = 0, dpr = Math.min(2, window.devicePixelRatio || 1);
    function resize(){ w = innerWidth; h = innerHeight; c.width = w*dpr; c.height = h*dpr; ctx.setTransform(dpr,0,0,dpr,0,0); }
    resize(); addEventListener("resize", resize);
    // @step: ${usePersian ? "پیاده‌سازی حرکت نرم بازیکن با کیبورد و لمس" : "Implement smooth keyboard & touch controls"}
    let running = false, score = 0, best = Number(localStorage.getItem("oh_orbit_best")||0);
    bestHud.textContent = "Best: " + best;
    const ship = { x: 0, tx: 0, y: 0, r: 14 };
    const keys = { left: false, right: false };
    let rocks = [], parts = [], stars = Array.from({length:60},()=>({x:Math.random()*1200,y:Math.random()*900,s:Math.random()*2+0.5}));
    addEventListener("keydown", e => { if(e.key==="ArrowLeft"||e.key==="a") keys.left=true; if(e.key==="ArrowRight"||e.key==="d") keys.right=true; });
    addEventListener("keyup", e => { if(e.key==="ArrowLeft"||e.key==="a") keys.left=false; if(e.key==="ArrowRight"||e.key==="d") keys.right=false; });
    c.addEventListener("pointermove", e => { if(running) ship.tx = e.clientX; });
    c.addEventListener("pointerdown", e => { if(running) ship.tx = e.clientX; });
    // @step: ${usePersian ? "افزودن موانع، ذرات برخورد و امتیاز زنده" : "Add obstacles, particle bursts & live scoring"}
    function start(){ running = true; score = 0; rocks = []; parts = []; ship.x = w/2; ship.tx = w/2; ship.y = h - 78; ov.style.display = "none"; }
    document.getElementById("startBtn").onclick = start;
    let last = performance.now(), spawn = 0;
    function loop(now){
      const dt = Math.min(0.05, (now - last)/1000); last = now;
      ctx.fillStyle = "#070914"; ctx.fillRect(0,0,w,h);
      for(const s of stars){ s.y += (30 + s.s*25)*dt; if(s.y > h){ s.y = -4; s.x = Math.random()*w; } ctx.fillStyle = "rgba(199,210,254,"+(0.25+s.s*0.2)+")"; ctx.fillRect(s.x%w,s.y,s.s,s.s); }
      if(running){
        if(keys.left) ship.tx -= 380*dt; if(keys.right) ship.tx += 380*dt;
        ship.tx = Math.max(22, Math.min(w-22, ship.tx)); ship.x += (ship.tx - ship.x) * Math.min(1, dt*14); ship.y = h - 78;
        score += dt * 15; scoreHud.textContent = Math.floor(score);
        spawn -= dt; if(spawn <= 0){ spawn = Math.max(0.22, 0.72 - score*0.002); rocks.push({x:20+Math.random()*(w-40),y:-24,r:12+Math.random()*16,vy:180+Math.random()*160+score*0.6}); }
        for(let i=rocks.length-1;i>=0;i--){
          const r = rocks[i]; r.y += r.vy*dt;
          const g = ctx.createRadialGradient(r.x-r.r*0.3,r.y-r.r*0.3,2,r.x,r.y,r.r);
          g.addColorStop(0,"#fda4af"); g.addColorStop(1,"#9f1239");
          ctx.beginPath(); ctx.fillStyle=g; ctx.arc(r.x,r.y,r.r,0,Math.PI*2); ctx.fill();
          if(Math.hypot(r.x-ship.x,r.y-ship.y) < r.r + ship.r - 3){
            running = false; best = Math.max(best, Math.floor(score)); localStorage.setItem("oh_orbit_best", String(best));
            bestHud.textContent = "Best: " + best;
            document.getElementById("ovTitle").textContent = "Score: " + Math.floor(score);
            ov.style.display = "grid";
          }
          if(r.y > h + 40) rocks.splice(i,1);
        }
        const glow = ctx.createRadialGradient(ship.x,ship.y,2,ship.x,ship.y,30);
        glow.addColorStop(0,"rgba(129,140,248,.65)"); glow.addColorStop(1,"rgba(129,140,248,0)");
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(ship.x,ship.y,30,0,Math.PI*2); ctx.fill();
        ctx.fillStyle = "#e0e7ff"; ctx.beginPath(); ctx.moveTo(ship.x,ship.y-16); ctx.lineTo(ship.x-12,ship.y+12); ctx.lineTo(ship.x+12,ship.y+12); ctx.closePath(); ctx.fill();
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  </script>
</body>
</html>
\`\`\``
          : demoLoginFormCode;

      const liveSources = backendIntent?.webSources ?? [];
      const deepResearchSourcesMd =
        liveSources.length > 0
          ? liveSources
              .slice(0, 5)
              .map((s, idx) => `${idx + 1}. **[${s.title}](${s.url})** — ${s.snippet || s.source}`)
              .join("\n")
          : usePersian
            ? "منبع آنلاین مستقیمی برای این عبارت برنگشت؛ تحلیل بر پایه دانش پایه انجام می‌شود."
            : "No live web excerpts returned for this query; falling back to first-principles synthesis.";

      const demoReply =
        resolvedSkill === "game_builder"
          ? usePersian
            ? `دارم یک **بازی آرکید روان و ریسپانسیو** با نورپردازی و کنترل هم‌زمان لمسی و کیبورد برات می‌سازم.\n\n${demoPreviewCode}\n\nبازی آماده است! روی کارت بالا کلیک کن یا صفحه رو به چپ ورق بزن تا همین الان بازی کنی.`
            : `Building a smooth, responsive **Arcade Game** with lighting and dual keyboard/touch controls.\n\n${demoPreviewCode}\n\nYour game is ready! Tap the preview card above or swipe left to play.`
          : resolvedSkill === "web_builder" || needsPreview
            ? usePersian
              ? `حتماً! دارم یک **فرم ورود مدرن و تعاملی** با طراحی شیشه‌ای و قابلیت نمایش/مخفی کردن رمز عبور برات می‌سازم.\n\n${demoPreviewCode}\n\nفرم ورود آماده شد! برای دیدن و تست کردنش روی کارت بالا کلیک کن یا صفحه رو به سمت چپ ورق بزن.`
              : `Sure! I'm building a modern, interactive **Login Form** with a glassmorphic card and show/hide password toggle.\n\n${demoPreviewCode}\n\nYour login form is ready! Click the preview card above or swipe left to try it out.`
            : resolvedSkill === "deep_research"
              ? usePersian
                ? `### نتیجه بررسی و جستجوی عمیق\n\nاسکیل **سرچ و تحلیل عمیق** در بکند فعال شد و **${liveSources.length} منبع زنده از وب** برای «${quote || "موضوع"}» بازیابی کرد:\n\n${deepResearchSourcesMd}\n\nدر اتصال به مدل هوش مصنوعی واقعی، تمام این منابع به‌صورت خودکار وارد کانتکست تحلیل عمیق مدل می‌شوند تا پاسخ مستند، دقیق و همراه با ارجاع تولید شود.`
                : `### Deep Research Summary\n\nThe backend **Deep Research** skill retrieved **${liveSources.length} live web sources** for "${quote || "your query"}":\n\n${deepResearchSourcesMd}\n\nWhen connected to a real AI model, these live sources are grounded directly into the model's analytical reasoning context with inline citations.`
              : usePersian
                ? `پیام «${quote || "تست"}» توسط اسکیل **چت طبیعی** دریافت شد.\n\nاین یک پاسخ آزمایشی محلی بدون اتصال به API هوش مصنوعی است تا مصرف زنده‌ی کریدیت (باقیمانده پس از این پیام: **${remainingAfter}**) و تشخیص خودکار اسکیل در بکند را ببینید.`
                : `Your message ("${quote || "Test"}") was routed to the **Natural Chat** skill.\n\nThis is a local preview reply (no external AI API call) so you can test live credit drain (**${remainingAfter} credits** remaining after this reply) and backend skill routing.`;

      const chunks = demoReply.match(needsPreview ? /.{1,48}/gs : /.{1,6}/gs) ?? [demoReply];
      try {
        for (const chunk of chunks) {
          if (controller.signal.aborted) break;
          await new Promise<void>((resolve) => {
            const timer = window.setTimeout(resolve, 48);
            controller.signal.addEventListener(
              "abort",
              () => {
                window.clearTimeout(timer);
                resolve();
              },
              { once: true },
            );
          });
          if (controller.signal.aborted) break;
          set((state) => {
            if (!state.streaming || state.streaming.messageId !== assistantId) return state;
            return {
              streaming: {
                ...state.streaming,
                content: state.streaming.content + chunk,
              },
            };
          });
        }

        const finalContent = get().streaming?.content || "";
        const persisted = get().messages.find((m) => m.id === assistantId);
        const finished: Message = {
          ...(persisted ?? {
            id: assistantId,
            chatId: chat.id,
            role: "assistant",
            parentId: null,
            attachments: [],
            createdAt: startedAt,
          }),
          providerId: provider.id,
          modelId: model.modelId,
          skillId: resolvedSkill,
          ...(resolvedSourcesCount > 0 ? { skillSourcesCount: resolvedSourcesCount } : {}),
          content: finalContent,
          stats: {
            latencyMs: Date.now() - startedAt,
            tokensIn: estimateMessages(thread),
            tokensOut: estimateTokens(finalContent),
            finishReason: controller.signal.aborted ? "aborted" : "stop",
          },
        };
        await db.messages.put(finished);
        if (finalContent && !controller.signal.aborted) {
          useAuthStore.getState().consumeLocalCredit(1);
          if (auth.profile) {
            void import("@/lib/devAdminMock").then(({ recordDevUserMessage }) =>
              recordDevUserMessage({
                userId: auth.profile!.id,
                email: auth.profile!.email,
                displayName: auth.profile!.displayName,
                modelName: model.displayName,
                providerName: "OpenHarneks",
                source: "default",
                tokens: (finished.stats?.tokensIn ?? 0) + (finished.stats?.tokensOut ?? 0),
              }),
            );
          }
        }
        set((state) => ({
          messages: state.messages.map((m) => (m.id === assistantId ? finished : m)),
          streaming: null,
          error: null,
        }));
      } finally {
        activeAbort = null;
      }
      return;
    }

    // -------------------------------------------------------------------------
    // Free Model Router execution (Round-robin + 3-attempt pre-stream failover,
    // no mid-stream restart once streaming output begins)
    // -------------------------------------------------------------------------
    if (provider.id === "router" && isRouterSelectionId(model.id)) {
      const routerId = parseRouterSelectionId(model.id)!;
      const routersState = useRoutersStore.getState();
      const allProviders = useProvidersStore.getState().providers;
      const allModels = useProvidersStore.getState().models;
      const combined = buildCombinedRouters(
        routersState.publicRouters,
        routersState.localRouters,
        allProviders,
        allModels,
      );
      const router = combined.find((r) => r.id === routerId);
      if (!router || router.activeMemberCount === 0) {
        const persisted = get().messages.find((m) => m.id === assistantId);
        if (persisted) {
          const failed: Message = {
            ...persisted,
            error: { kind: "unknown", message: "router.disabledEmpty" },
          };
          await db.messages.put(failed);
          set((state) => ({
            messages: state.messages.map((m) => (m.id === assistantId ? failed : m)),
            streaming: null,
            error: { kind: "unknown", message: "router.disabledEmpty" },
          }));
        } else {
          set({ streaming: null, error: { kind: "unknown", message: "router.disabledEmpty" } });
        }
        return;
      }

      const attachmentMap = new Map(get().attachments.map((a) => [a.id, a]));
      const controller = new AbortController();
      activeAbort = controller;
      const startedAt = Date.now();
      let emitted = false;
      set({
        streaming: { chatId: chat.id, messageId: assistantId, content: "", reasoning: "", startedAt },
        error: null,
      });

      const makeDeltaHandler = (onFirstDelta?: () => void) => (delta: { text?: string; reasoning?: string }) => {
        if (!delta.text && !delta.reasoning) return;
        if (!emitted) {
          emitted = true;
          onFirstDelta?.();
        }
        set((state) => {
          if (!state.streaming || state.streaming.messageId !== assistantId) return state;
          return {
            streaming: {
              ...state.streaming,
              content: state.streaming.content + (delta.text ?? ""),
              reasoning: state.streaming.reasoning + (delta.reasoning ?? ""),
            },
          };
        });
      };

      // Server-backed router (public admin router or server-stored user router)
      if (router.source === "server") {
        try {
          const inputs = await buildApiInputs(thread, attachmentMap, provider, model);
          const withSystem = chat.systemPrompt.trim()
            ? [{ role: "system" as const, content: chat.systemPrompt.trim() }, ...inputs]
            : inputs;
          const activeSkillMode = useUiStore.getState().skillMode;
          const result = await streamServerChat({
            modelId: routerId,
            routerId,
            messages: withSystem.map((m) => ({ role: m.role, content: m.content })),
            params: chat.params,
            skillMode: activeSkillMode,
            signal: controller.signal,
            onDelta: makeDeltaHandler(),
            onPreviewIntent: (enabled) => {
              if (enabled) void get().setChatPreviewEnabled(chat.id, true);
            },
            onSkillResolved: (skillId, sourcesCount) => {
              set((state) =>
                state.streaming && state.streaming.messageId === assistantId
                  ? { streaming: { ...state.streaming, skillId, skillSourcesCount: sourcesCount } }
                  : state,
              );
            },
          });
          const persisted = get().messages.find((m) => m.id === assistantId);
          const finalContent = result.text || get().streaming?.content || "";
          const finalReasoning = result.reasoning || get().streaming?.reasoning || "";
          if (result.previewIntent || (finalContent && extractProjectFiles(finalContent).length > 0)) {
            void get().setChatPreviewEnabled(chat.id, true);
          }
          const finished: Message = {
            ...(persisted ?? {
              id: assistantId,
              chatId: chat.id,
              role: "assistant",
              parentId: null,
              attachments: [],
              createdAt: startedAt,
            }),
            providerId: "router",
            modelId: model.id,
            ...(result.skillId ? { skillId: result.skillId } : {}),
            ...(result.skillSourcesCount ? { skillSourcesCount: result.skillSourcesCount } : {}),
            content: finalContent,
            reasoning: finalReasoning || undefined,
            stats: {
              latencyMs: result.latencyMs,
              tokensIn: result.usage.promptTokens ?? estimateMessages(thread),
              tokensOut: result.usage.completionTokens ?? estimateTokens(finalContent),
              finishReason: result.finishReason,
            },
            error: finalContent ? undefined : { kind: "unknown", message: "error.empty" },
          };
          await db.messages.put(finished);
          if (finalContent) void useAuthStore.getState().refresh();
          set((state) => ({
            messages: state.messages.map((m) => (m.id === assistantId ? finished : m)),
            streaming: null,
            error: finished.error ? { kind: "unknown", message: "error.empty" } : null,
          }));
        } catch (err) {
          const apiError = err as { kind?: ErrorKind; message?: string };
          const partial = get().streaming?.content ?? "";
          const errMessage = emitted
            ? "router.midStreamInterrupted"
            : (apiError.message ?? "error.generic");
          const persisted = get().messages.find((m) => m.id === assistantId);
          if (persisted) {
            const failed: Message = {
              ...persisted,
              content: partial,
              error: { kind: apiError.kind ?? "unknown", message: errMessage },
            };
            await db.messages.put(failed);
            set((state) => ({
              messages: state.messages.map((m) => (m.id === assistantId ? failed : m)),
              streaming: null,
              error: { kind: apiError.kind ?? "unknown", message: errMessage },
            }));
          } else {
            set({
              streaming: null,
              error: { kind: apiError.kind ?? "unknown", message: errMessage },
            });
          }
        } finally {
          activeAbort = null;
        }
        return;
      }

      // DEV admin router OR Local BYOK user router: client-side Round-robin + 3-attempt failover
      try {
        const settings = useSettingsStore.getState().settings;
        const activeSkillMode = useUiStore.getState().skillMode;
        const intent = await checkBackendPreviewIntent(
          thread.map((m) => ({
            role: m.role,
            content: m.content,
            hasImages: m.attachments.some((id) => attachmentMap.get(id)?.kind === "image"),
          })),
          controller.signal,
          activeSkillMode,
        );
        if (intent?.needsPreview && !chat.previewEnabled) {
          void get().setChatPreviewEnabled(chat.id, true);
        }
        const skillId = intent?.skillId;
        const skillSourcesCount =
          (intent?.webSources?.length ?? 0) + (intent?.imageAssets?.length ?? 0);
        if (skillId) {
          set((state) =>
            state.streaming && state.streaming.messageId === assistantId
              ? { streaming: { ...state.streaming, skillId, skillSourcesCount } }
              : state,
          );
        }
        const skillInstruction = (intent?.systemPrompt ?? intent?.builderSystemPrompt ?? "").trim();

        interface ClientRouterMember {
          id: string;
          upstreamId: string;
          displayName: string;
          provider: Provider;
          model: AIModel;
          apiKeys: string[];
          providerName: string;
          billingSource: "site" | "byok";
        }

        let members: ClientRouterMember[] = [];
        if (router.source === "dev" && import.meta.env.DEV) {
          const { devRouterTarget } = await import("@/lib/devAdminMock");
          const devTarget = await devRouterTarget(routerId);
          if (devTarget) {
            members = devTarget.members.map((m) => ({
              id: m.id,
              upstreamId: m.upstreamId,
              displayName: m.displayName,
              provider: devTarget.provider,
              model: {
                id: m.id,
                providerId: devTarget.provider.id,
                modelId: m.upstreamId,
                displayName: m.displayName,
                capabilities: ["text"],
                tier: "free",
                pricingTier: "free",
                enabled: true,
                favorite: false,
                order: 0,
                source: "api",
                createdAt: startedAt,
                updatedAt: startedAt,
              },
              apiKeys: devTarget.apiKeys,
              providerName: devTarget.providerName,
              billingSource: "site",
            }));
          }
        } else {
          const localProvider = allProviders.find((p) => p.id === router.providerId && p.enabled);
          if (localProvider) {
            let storedKey = "";
            if (!localProvider.managed) {
              try {
                storedKey = (await getProviderKey(localProvider.id)) ?? "";
              } catch {
                set({ streaming: null, error: { kind: "auth", message: "error.vaultLocked" } });
                return;
              }
            }
            const candidates = getProviderKeyCandidates(localProvider, storedKey);
            const keys = candidates.length > 0 ? candidates : [storedKey.trim()];
            const eligible = eligibleFreeModelsForLocalProvider(localProvider, allModels);
            members = eligible.map((m) => ({
              id: m.id,
              upstreamId: m.modelId,
              displayName: m.displayName,
              provider: localProvider,
              model: m,
              apiKeys: keys,
              providerName: localProvider.name,
              billingSource: "byok",
            }));
          }
        }

        const failover = await executeWithRouterFailover<
          ClientRouterMember,
          Awaited<ReturnType<typeof streamChat>>
        >({
          routerId,
          members,
          scheduler: clientRouterScheduler,
          maxAttempts: ROUTER_MAX_FAILOVER_ATTEMPTS,
          execute: async (member, { markStreamStarted }) => {
            if (member.provider.auth.header && (!member.apiKeys[0] || !member.apiKeys[0].trim())) {
              return {
                ok: false,
                error: { status: 401, message: "error.noKey" },
              };
            }
            const inputs = await buildApiInputs(thread, attachmentMap, member.provider, member.model);
            const combinedSys = [chat.systemPrompt.trim(), skillInstruction].filter(Boolean).join("\n\n");
            const withSystem: ChatMessageInput[] = combinedSys
              ? [{ role: "system", content: combinedSys }, ...inputs]
              : inputs;

            const keyLimit = Math.min(member.apiKeys.length, MAX_KEY_ATTEMPTS);
            let lastErr: { status?: number; kind?: ErrorKind; message?: string } | null = null;

            for (let k = 0; k < keyLimit; k++) {
              const apiKey = member.apiKeys[k] ?? "";
              try {
                const res = await streamChat({
                  provider: member.provider,
                  apiKey,
                  modelId: member.upstreamId,
                  messages: withSystem,
                  params: chat.params,
                  signal: controller.signal,
                  proxyUrl: settings.proxyUrl || undefined,
                  onDelta: makeDeltaHandler(markStreamStarted),
                });
                if (apiKey) markKeySuccess(apiKey);
                return { ok: true, value: res };
              } catch (err) {
                if (controller.signal.aborted) {
                  return { ok: false, error: { status: 499, message: "aborted" } };
                }
                const apiErr = err as { status?: number; kind?: ErrorKind; message?: string };
                lastErr = apiErr;
                if (apiErr.kind && keyLimit > 1 && apiKey) {
                  markKeyFailure(apiKey, apiErr.kind);
                }
                if (emitted) {
                  return {
                    ok: false,
                    error: {
                      status: apiErr.status ?? 500,
                      message: apiErr.message ?? "router.midStreamInterrupted",
                    },
                  };
                }
                if (!canRotateKey(apiErr.kind) || k >= keyLimit - 1) {
                  break;
                }
              }
            }

            const kind = lastErr?.kind;
            const status =
              lastErr?.status ??
              (kind === "auth"
                ? 401
                : kind === "not-found"
                  ? 404
                  : kind === "rate-limit"
                    ? 429
                    : kind === "timeout"
                      ? 504
                      : kind === "server"
                        ? 502
                        : kind === "network"
                          ? 503
                          : 500);
            return {
              ok: false,
              error: {
                status,
                message: lastErr?.message ?? "error.generic",
                timeout: kind === "timeout",
                network: kind === "network",
              },
            };
          },
        });

        if (!failover.ok || !failover.value || !failover.usedMember) {
          const partial = get().streaming?.content ?? "";
          const errMsg = failover.midStreamInterrupted
            ? "router.midStreamInterrupted"
            : failover.error || "error.generic";
          const persisted = get().messages.find((m) => m.id === assistantId);
          if (persisted) {
            const failed: Message = {
              ...persisted,
              content: partial,
              error: { kind: "unknown", message: errMsg },
            };
            await db.messages.put(failed);
            set((state) => ({
              messages: state.messages.map((m) => (m.id === assistantId ? failed : m)),
              streaming: null,
              error: { kind: "unknown", message: errMsg },
            }));
          } else {
            set({ streaming: null, error: { kind: "unknown", message: errMsg } });
          }
          return;
        }

        const result = failover.value;
        const usedMember = failover.usedMember;
        const persisted = get().messages.find((m) => m.id === assistantId);
        const finalContent = result.text || get().streaming?.content || "";
        const finalReasoning = result.reasoning || get().streaming?.reasoning || "";
        if (finalContent && extractProjectFiles(finalContent).length > 0) {
          void get().setChatPreviewEnabled(chat.id, true);
        }
        const finished: Message = {
          ...(persisted ?? {
            id: assistantId,
            chatId: chat.id,
            role: "assistant",
            parentId: null,
            attachments: [],
            createdAt: startedAt,
          }),
          providerId: "router",
          modelId: usedMember.upstreamId,
          ...(skillId ? { skillId } : {}),
          ...(skillSourcesCount > 0 ? { skillSourcesCount } : {}),
          content: finalContent,
          reasoning: finalReasoning || undefined,
          stats: {
            latencyMs: result.latencyMs,
            tokensIn: result.usage.promptTokens ?? estimateMessages(thread),
            tokensOut: result.usage.completionTokens ?? estimateTokens(finalContent),
            finishReason: result.finishReason,
          },
          error: finalContent ? undefined : { kind: "unknown", message: "error.empty" },
        };
        await db.messages.put(finished);
        if (finalContent && usedMember.billingSource === "site") {
          useAuthStore.getState().consumeLocalCredit(1);
          if (import.meta.env.DEV && auth.profile) {
            void import("@/lib/devAdminMock").then(({ recordDevUserMessage }) =>
              recordDevUserMessage({
                userId: auth.profile!.id,
                email: auth.profile!.email,
                displayName: auth.profile!.displayName,
                modelName: usedMember.displayName,
                providerName: usedMember.providerName,
                source: "admin",
                tokens: (finished.stats?.tokensIn ?? 0) + (finished.stats?.tokensOut ?? 0),
              }),
            );
          }
        }
        set((state) => ({
          messages: state.messages.map((m) => (m.id === assistantId ? finished : m)),
          streaming: null,
          error: finished.error ? { kind: "unknown", message: "error.empty" } : null,
        }));
      } finally {
        activeAbort = null;
      }
      return;
    }

    // Local preview: resolve the site model to the real provider + keys stored
    // by the admin panel, then run it through the normal streaming path with
    // full key rotation and live admin usage tracking.
    let forcedKey: string | null = null;
    let forcedKeys: string[] | null = null;
    let devAdminMeta: { modelDisplayName: string; providerName: string } | null = null;
    if (provider.id === SERVER_PROVIDER_ID && import.meta.env.DEV) {
      const { devChatTarget } = await import("@/lib/devAdminMock");
      const dev = await devChatTarget(model.modelId, model.id);
      if (dev) {
        provider = dev.provider;
        forcedKey = dev.apiKey;
        forcedKeys = dev.apiKeys;
        devAdminMeta = { modelDisplayName: dev.modelDisplayName, providerName: dev.providerName };
      }
    }

    if (provider.id === SERVER_PROVIDER_ID) {
      const attachmentMap = new Map(get().attachments.map((a) => [a.id, a]));
      const inputs = await buildApiInputs(thread, attachmentMap, provider, model);
      const withSystem = chat.systemPrompt.trim()
        ? [{ role: "system" as const, content: chat.systemPrompt.trim() }, ...inputs]
        : inputs;

      const controller = new AbortController();
      activeAbort = controller;
      const startedAt = Date.now();
      set({
        streaming: { chatId: chat.id, messageId: assistantId, content: "", reasoning: "", startedAt },
        error: null,
      });

      const appendDelta = (delta: { text?: string; reasoning?: string }) => {
        if (!delta.text && !delta.reasoning) return;
        set((state) => {
          if (!state.streaming || state.streaming.messageId !== assistantId) return state;
          return {
            streaming: {
              ...state.streaming,
              content: state.streaming.content + (delta.text ?? ""),
              reasoning: state.streaming.reasoning + (delta.reasoning ?? ""),
            },
          };
        });
      };

      try {
        const activeSkillMode = useUiStore.getState().skillMode;
        const result = await streamServerChat({
          modelId: model.modelId,
          messages: withSystem.map((message) => ({ role: message.role, content: message.content })),
          params: chat.params,
          skillMode: activeSkillMode,
          signal: controller.signal,
          onDelta: appendDelta,
          onPreviewIntent: (enabled) => {
            if (enabled) void get().setChatPreviewEnabled(chat.id, true);
          },
          onSkillResolved: (skillId, sourcesCount) => {
            set((state) =>
              state.streaming && state.streaming.messageId === assistantId
                ? {
                    streaming: {
                      ...state.streaming,
                      skillId,
                      skillSourcesCount: sourcesCount,
                    },
                  }
                : state,
            );
          },
        });
        const persisted = get().messages.find((m) => m.id === assistantId);
        const finalContent = result.text || get().streaming?.content || "";
        const finalReasoning = result.reasoning || get().streaming?.reasoning || "";
        if (result.previewIntent || (finalContent && extractProjectFiles(finalContent).length > 0)) {
          void get().setChatPreviewEnabled(chat.id, true);
        }
        const finished: Message = {
          ...(persisted ?? {
            id: assistantId,
            chatId: chat.id,
            role: "assistant",
            parentId: null,
            attachments: [],
            createdAt: startedAt,
          }),
          providerId: provider.id,
          modelId: model.modelId,
          ...(result.skillId ? { skillId: result.skillId } : {}),
          ...(result.skillSourcesCount ? { skillSourcesCount: result.skillSourcesCount } : {}),
          content: finalContent,
          reasoning: finalReasoning || undefined,
          stats: {
            latencyMs: result.latencyMs,
            tokensIn: result.usage.promptTokens ?? estimateMessages(thread),
            tokensOut: result.usage.completionTokens ?? estimateTokens(finalContent),
            finishReason: result.finishReason,
          },
          error: finalContent ? undefined : { kind: "unknown", message: "error.empty" },
        };
        await db.messages.put(finished);
        if (finalContent) void useAuthStore.getState().refresh();
        set((state) => ({
          messages: state.messages.map((m) => (m.id === assistantId ? finished : m)),
          streaming: null,
          error: finished.error ? { kind: "unknown", message: "error.empty" } : null,
        }));
      } catch (err) {
        const apiError = err as { kind?: ErrorKind; message?: string };
        const partial = get().streaming?.content ?? "";
        const persisted = get().messages.find((m) => m.id === assistantId);
        if (persisted) {
          const failed: Message = {
            ...persisted,
            content: partial,
            error: { kind: apiError.kind ?? "unknown", message: apiError.message ?? "error.generic" },
          };
          await db.messages.put(failed);
          set((state) => ({
            messages: state.messages.map((m) => (m.id === assistantId ? failed : m)),
            streaming: null,
            error: { kind: apiError.kind ?? "unknown", message: apiError.message ?? "error.generic" },
          }));
        } else {
          set({
            streaming: null,
            error: { kind: apiError.kind ?? "unknown", message: apiError.message ?? "error.generic" },
          });
        }
      } finally {
        activeAbort = null;
      }
      return;
    }

    // The selected model may exist on several gateways. Keep the user's route
    // first, then queue every equivalent model so quota failures switch hosts
    // without changing the model they picked.
    const allProviders = useProvidersStore.getState().providers;
    const allModels = useProvidersStore.getState().models;
    // When devChatTarget resolved a server-preview model, stay strictly on that
    // dev-admin provider instead of mixing its key with BYOK routes.
    const routes = forcedKey
      ? [{ provider, model }]
      : orderRoutes(buildModelRoutes(model, allProviders, allModels));
    if (routes.length === 0) routes.push({ provider, model });

    const attachmentMap = new Map(get().attachments.map((a) => [a.id, a]));
    const settings = useSettingsStore.getState().settings;

    const controller = new AbortController();
    activeAbort = controller;
    const startedAt = Date.now();
    let emitted = false;
    set({
      streaming: { chatId: chat.id, messageId: assistantId, content: "", reasoning: "", startedAt },
      error: null,
    });

    const appendDelta = (delta: { text?: string; reasoning?: string }) => {
      if (delta.text || delta.reasoning) emitted = true;
      set((state) => {
        if (!state.streaming || state.streaming.messageId !== assistantId) return state;
        return {
          streaming: {
            ...state.streaming,
            content: state.streaming.content + (delta.text ?? ""),
            reasoning: state.streaming.reasoning + (delta.reasoning ?? ""),
          },
        };
      });
    };

    try {
      // Evaluate the 4-skill router + live web/photo search via the backend BEFORE
      // starting BYOK streaming so: (1) build chats unlock the preview slider on
      // frame 0, and (2) real BYOK models receive the full tailored skill prompt.
      const activeSkillMode = useUiStore.getState().skillMode;
      const byokIntent = await checkBackendPreviewIntent(
        thread.map((m) => ({
          role: m.role,
          content: m.content,
          hasImages: m.attachments.some((id) => attachmentMap.get(id)?.kind === "image"),
        })),
        controller.signal,
        activeSkillMode,
      );
      if (byokIntent?.needsPreview && !chat.previewEnabled) {
        void get().setChatPreviewEnabled(chat.id, true);
      }
      const byokSkillId = byokIntent?.skillId;
      const byokSourcesCount =
        (byokIntent?.webSources?.length ?? 0) + (byokIntent?.imageAssets?.length ?? 0);
      if (byokSkillId) {
        set((state) =>
          state.streaming && state.streaming.messageId === assistantId
            ? {
                streaming: {
                  ...state.streaming,
                  skillId: byokSkillId,
                  skillSourcesCount: byokSourcesCount,
                },
              }
            : state,
        );
      }
      const skillInstruction = (byokIntent?.systemPrompt ?? byokIntent?.builderSystemPrompt ?? "").trim();

      let result: Awaited<ReturnType<typeof streamChat>> | null = null;
      let lastError: unknown = null;
      let usedRoute = routes[0]!;
      let attempts = 0;
      const withSystemFor = (inputs: ChatMessageInput[]): ChatMessageInput[] => {
        const combined = [chat.systemPrompt.trim(), skillInstruction].filter(Boolean).join("\n\n");
        return combined ? [{ role: "system", content: combined }, ...inputs] : inputs;
      };

      for (let r = 0; r < routes.length && attempts < MAX_ROUTE_ATTEMPTS; r += 1) {
        const route = routes[r]!;
        const routeProvider = route.provider;
        const routeModel = route.model;

        let storedKey = "";
        if (!routeProvider.managed) {
          if (forcedKey) {
            storedKey = forcedKey;
          } else {
            try {
              storedKey = (await getProviderKey(routeProvider.id)) ?? "";
            } catch {
              set({ error: { kind: "auth", message: "error.vaultLocked" } });
              return;
            }
          }
        }
        const trimmedStored = storedKey.trim();
        const keyCandidates = forcedKeys && forcedKeys.length > 0
          ? forcedKeys
          : getProviderKeyCandidates(routeProvider, storedKey);
        // Never falsely report "no stored key" when the user DOES have a stored
        // key that was only cooling down from an earlier error on another model
        // (e.g. a 402 on a paid model or 429/404 on one free model). Only skip
        // a cooling key when another alternate route is available to try next.
        const hasAlternateRoute = r < routes.length - 1;
        const keys =
          keyCandidates.length > 0
            ? keyCandidates
            : !routeProvider.managed && trimmedStored && !hasAlternateRoute
              ? [trimmedStored]
              : [""];
        if (routeProvider.auth.header && keys[0] === "") {
          lastError = {
            kind: "auth",
            message: trimmedStored ? "error.generic" : "error.noKey",
          };
          continue;
        }

        const inputs = await buildApiInputs(thread, attachmentMap, routeProvider, routeModel);
        const withSystem = withSystemFor(inputs);
        const keyAttempts = Math.min(keys.length, MAX_KEY_ATTEMPTS);

        for (let k = 0; k < keyAttempts && attempts < MAX_ROUTE_ATTEMPTS; k += 1) {
          attempts += 1;
          const apiKey = keys[k]!;
          try {
            result = await streamChat({
              provider: routeProvider,
              apiKey,
              modelId: routeModel.modelId,
              messages: withSystem,
              params: chat.params,
              signal: controller.signal,
              proxyUrl: settings.proxyUrl || undefined,
              onDelta: appendDelta,
            });
            markKeySuccess(apiKey);
            markRouteSuccess(route);
            usedRoute = route;
            break;
          } catch (err) {
            lastError = err;
            const kind = (err as { kind?: ErrorKind }).kind;
            if (kind) {
              // Only put a key into cooldown when rotating across multiple keys;
              // cooling a user's single BYOK key would lock out all other free
              // models on that provider for 10–30 minutes after one model fails.
              if (keyAttempts > 1) markKeyFailure(apiKey, kind);
              if (routes.length > 1) markRouteFailure(route, kind);
            }
            // Never replay once tokens reached the UI: that would duplicate the
            // answer. Switching routes is silent only before the first delta.
            if (emitted || controller.signal.aborted) throw err;
            const canTryKey = canRotateKey(kind) && k < keyAttempts - 1 && attempts < MAX_ROUTE_ATTEMPTS;
            const canTryRoute = canRotateRoute(kind) && r < routes.length - 1 && attempts < MAX_ROUTE_ATTEMPTS;
            if (!canTryKey && !canTryRoute) throw err;
          }
        }
        if (result) break;
      }

      if (!result) throw lastError ?? new Error("error.generic");
      const persisted = get().messages.find((m) => m.id === assistantId);
      const finalContent = result.text || get().streaming?.content || "";
      const finalReasoning = result.reasoning || get().streaming?.reasoning || "";
      if (finalContent && extractProjectFiles(finalContent).length > 0) {
        void get().setChatPreviewEnabled(chat.id, true);
      }
      const finished: Message = {
        ...(persisted ?? {
          id: assistantId,
          chatId: chat.id,
          role: "assistant",
          parentId: null,
          attachments: [],
          createdAt: startedAt,
        }),
        providerId: usedRoute.provider.id,
        modelId: usedRoute.model.modelId,
        ...(byokSkillId ? { skillId: byokSkillId } : {}),
        ...(byokSourcesCount > 0 ? { skillSourcesCount: byokSourcesCount } : {}),
        content: finalContent,
        reasoning: finalReasoning || undefined,
        stats: {
          latencyMs: result.latencyMs,
          tokensIn: result.usage.promptTokens ?? estimateMessages(thread),
          tokensOut: result.usage.completionTokens ?? estimateTokens(finalContent),
          finishReason: result.finishReason,
        },
        error: finalContent ? undefined : { kind: "unknown", message: "error.empty" },
      };
      await db.messages.put(finished);
      if (finalContent) {
        useAuthStore.getState().consumeLocalCredit(1);
        if (import.meta.env.DEV && auth.profile && devAdminMeta) {
          void import("@/lib/devAdminMock").then(({ recordDevUserMessage }) =>
            recordDevUserMessage({
              userId: auth.profile!.id,
              email: auth.profile!.email,
              displayName: auth.profile!.displayName,
              modelName: devAdminMeta!.modelDisplayName,
              providerName: devAdminMeta!.providerName,
              source: "admin",
              tokens: (finished.stats?.tokensIn ?? 0) + (finished.stats?.tokensOut ?? 0),
            }),
          );
        }
      }
      set((state) => ({
        messages: state.messages.map((m) => (m.id === assistantId ? finished : m)),
        streaming: null,
        error: finished.error ? { kind: "unknown", message: "error.empty" } : null,
      }));
    } catch (err) {
      const apiError = err as { kind?: ErrorKind; message?: string };
      const partial = get().streaming?.content ?? "";
      const persisted = get().messages.find((m) => m.id === assistantId);
      if (persisted) {
        const failed: Message = {
          ...persisted,
          content: partial,
          error: { kind: apiError.kind ?? "unknown", message: apiError.message ?? "error.generic" },
        };
        await db.messages.put(failed);
        set((state) => ({
          messages: state.messages.map((m) => (m.id === assistantId ? failed : m)),
          streaming: null,
          error: { kind: apiError.kind ?? "unknown", message: apiError.message ?? "error.generic" },
        }));
      } else {
        set({ streaming: null, error: { kind: apiError.kind ?? "unknown", message: apiError.message ?? "error.generic" } });
      }
    } finally {
      activeAbort = null;
    }
  },
}));
