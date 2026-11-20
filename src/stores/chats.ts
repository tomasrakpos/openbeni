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
import { streamServerChat } from "@/lib/serverChat";
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
import type {
  AIModel,
  Attachment,
  Chat,
  ChatMessageInput,
  ChatParams,
  ErrorKind,
  Message,
  Provider,
} from "@/lib/types";
import { useSettingsStore } from "@/stores/settings";
import { useProvidersStore } from "@/stores/providers";
import { SERVER_PROVIDER_ID, serverProvider, useCatalogStore } from "@/stores/catalog";

export interface StreamingState {
  chatId: string;
  messageId: string;
  content: string;
  reasoning: string;
  startedAt: number;
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
  createChat: (options?: Partial<Pick<Chat, "providerId" | "modelId" | "systemPrompt">>) => Promise<Chat>;
  selectChat: (id: string) => Promise<void>;
  deleteChat: (id: string) => Promise<void>;
  renameChat: (id: string, title: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  setSystemPrompt: (prompt: string) => Promise<void>;
  setChatModel: (providerId: string, modelId: string) => Promise<void>;
  setParams: (patch: Partial<ChatParams>) => Promise<void>;
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

export function resolveTarget(chat: Chat): { provider: Provider; model: AIModel } | { error: string } {
  const localProviders = useProvidersStore.getState().providers;
  const localModels = useProvidersStore.getState().models;
  const serverModels = useCatalogStore.getState().providerModels;
  const providers = serverModels.length > 0 ? [...localProviders, serverProvider()] : localProviders;
  const models = serverModels.length > 0 ? [...localModels, ...serverModels] : localModels;
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

export function activeThread(messages: Message[], chat: Chat | null): Message[] {
  if (!chat) return [];
  return buildThread(messages, chat.currentLeafId);
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
    const chats = await listChats();
    const first = chats[0];
    if (first) {
      const [messages, attachments] = await Promise.all([getMessages(first.id), db.attachments.where("chatId").equals(first.id).toArray()]);
      set({ chats, activeChatId: first.id, messages, attachments, loading: false });
    } else {
      set({ chats, loading: false });
    }
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

  send: async (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (get().streaming) return;
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
    const title = chat.title.trim() ? chat.title : deriveTitle(trimmed);
    const updatedChat: Chat = {
      ...chat,
      title,
      providerId: provider.id,
      modelId: model.id,
      currentLeafId: assistantMessage.id,
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
    // Local preview: resolve the site model to the real provider + key stored
    // by the admin panel, then run it through the normal BYOK streaming path.
    let forcedKey: string | null = null;
    if (provider.id === SERVER_PROVIDER_ID && import.meta.env.DEV) {
      const { devChatTarget } = await import("@/lib/devAdminMock");
      const dev = await devChatTarget(model.modelId);
      if (dev) {
        provider = dev.provider;
        forcedKey = dev.apiKey;
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
        const result = await streamServerChat({
          modelId: model.modelId,
          messages: withSystem.map((message) => ({ role: message.role, content: message.content })),
          params: chat.params,
          signal: controller.signal,
          onDelta: appendDelta,
        });
        const persisted = get().messages.find((m) => m.id === assistantId);
        const finalContent = result.text || get().streaming?.content || "";
        const finalReasoning = result.reasoning || get().streaming?.reasoning || "";
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
    const routes = orderRoutes(buildModelRoutes(model, allProviders, allModels));
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
      let result: Awaited<ReturnType<typeof streamChat>> | null = null;
      let lastError: unknown = null;
      let usedRoute = routes[0]!;
      let attempts = 0;
      const withSystemFor = (inputs: ChatMessageInput[]): ChatMessageInput[] =>
        chat.systemPrompt.trim() ? [{ role: "system", content: chat.systemPrompt.trim() }, ...inputs] : inputs;

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
        const keyCandidates = getProviderKeyCandidates(routeProvider, storedKey);
        const keys = keyCandidates.length > 0 ? keyCandidates : [""];
        if (routeProvider.auth.header && keys[0] === "") {
          lastError = { kind: "auth", message: "error.noKey" };
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
              markKeyFailure(apiKey, kind);
              markRouteFailure(route, kind);
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
