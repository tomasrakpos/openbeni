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
  isAdminPublicRouter,
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
  ElementEditContext,
  ElementEditFileSnapshot,
  ErrorKind,
  Message,
  Provider,
  SkillId,
} from "@/lib/types";
import { useSettingsStore } from "@/stores/settings";
import { useProvidersStore } from "@/stores/providers";
import {
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
  send: (text: string, options?: { editContext?: ElementEditContext }) => Promise<void>;
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
  const isAdminNative = isAdminPublicRouter(router);
  return {
    id: "router",
    name: isAdminNative ? "OpenHarneks" : (router.providerName || "OpenHarneks"),
    baseUrl: "",
    apiFormat: "openai",
    auth: { header: "", prefix: "" },
    extraHeaders: {},
    timeoutMs: 30_000,
    useProxy: false,
    enabled: true,
    favorite: false,
    order: 0,
    managed: isAdminNative || router.source === "server",
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
  // If all individual provider models are hidden/disabled, fall back to an active
  // router (preferring public admin native OpenHarneks routers) so chat stays usable.
  const routersState = useRoutersStore.getState();
  const fallbackCombined = buildCombinedRouters(
    routersState.publicRouters,
    routersState.localRouters,
    providers,
    models,
  );
  const fallbackRouter =
    fallbackCombined.find((r) => isAdminPublicRouter(r) && r.activeMemberCount > 0) ??
    fallbackCombined.find((r) => r.activeMemberCount > 0);
  if (fallbackRouter) {
    return {
      provider: routerVirtualProvider(fallbackRouter),
      model: routerVirtualModel(fallbackRouter),
    };
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

export const ELEMENT_EDIT_MARKER = "[OPENBENI_ELEMENT_EDIT]";

const MAX_EMBEDDED_PROJECT_CHARS = 52_000;

const CLIENT_ELEMENT_EDIT_SYSTEM_PROMPT = [
  "Active task: SURGICAL IN-PLACE ELEMENT EDIT on an existing web/app project.",
  "CRITICAL RULES — FOLLOW STRICTLY:",
  "1. DO NOT rebuild, redesign, or replace the existing page with a different design.",
  "2. Preserve the ENTIRE existing project — background, colors, theme, layout, typography, copy, styles, scripts, and every unrelated element — verbatim.",
  "3. Modify ONLY the selected target element to satisfy the user's request.",
  "4. Output the complete updated project file(s) in standard fenced code blocks preserving exact filenames so the preview updates in place with ONLY that change.",
].join("\n");

function findLatestProjectFilesInThread(
  thread: Message[],
  beforeIndex: number,
): ElementEditFileSnapshot[] {
  for (let i = beforeIndex - 1; i >= 0; i -= 1) {
    const msg = thread[i];
    if (!msg || msg.role !== "assistant" || !msg.content.trim()) continue;
    const files = extractProjectFiles(msg.content);
    if (files.length > 0) {
      return files.map((f) => ({ path: f.path, language: f.language, content: f.content }));
    }
  }
  return [];
}

export function formatElementEditApiContent(
  message: Message,
  isLatestEdit: boolean,
  fallbackFiles: ElementEditFileSnapshot[],
): string {
  const ctx = message.editContext;
  if (!ctx) return message.content;

  if (!isLatestEdit) {
    return `[Edited preview element ${ctx.label} (${ctx.selector})]: ${message.content}`;
  }

  const projectFiles =
    ctx.projectFiles && ctx.projectFiles.length > 0 ? ctx.projectFiles : fallbackFiles;

  const lines: string[] = [
    ELEMENT_EDIT_MARKER,
    "SURGICAL IN-PLACE ELEMENT EDIT — DO NOT REBUILD OR REDESIGN THE PAGE.",
    "Preserve the existing project files below 100% intact (keep the exact same theme, colors, layout, sections, text, styles, and scripts). Modify ONLY the selected target element below to fulfill the user's request, and output the complete updated file(s) in fenced code blocks using the exact same filenames.",
    "",
    "Selected target element:",
    `- Label: \`${ctx.label}\``,
    `- CSS Selector: \`${ctx.selector}\``,
  ];
  if (ctx.text) {
    lines.push(`- Current text: "${ctx.text.slice(0, 160)}"`);
  }
  if (ctx.outerHtml) {
    lines.push(`- Current outerHTML:\n\`\`\`html\n${ctx.outerHtml.slice(0, 2400)}\n\`\`\``);
  }

  if (projectFiles.length > 0) {
    let used = lines.join("\n").length;
    const embedded: string[] = [];
    for (const file of projectFiles) {
      const lang = file.language || "html";
      const block = `\`\`\`${lang} ${file.path}\n${file.content}\n\`\`\``;
      if (used + block.length + 200 <= MAX_EMBEDDED_PROJECT_CHARS) {
        embedded.push(block);
        used += block.length + 2;
      }
    }
    if (embedded.length > 0) {
      lines.push(
        "",
        "Current project files (edit THESE exact files in place — do NOT start over):",
        ...embedded,
      );
    } else {
      lines.push(
        "",
        "Current project files are in the previous assistant message in this conversation — edit THOSE exact files in place and do NOT start over.",
      );
    }
  }

  lines.push("", `User's requested change on the selected element:\n${message.content}`);
  return lines.join("\n");
}

function buildIntentMessages(
  thread: Message[],
  attachmentMap: Map<string, Attachment>,
): Array<{ role: Message["role"]; content: string; hasImages: boolean }> {
  let lastEditIdx = -1;
  for (let i = thread.length - 1; i >= 0; i -= 1) {
    if (thread[i]?.role === "user" && thread[i]?.editContext) {
      lastEditIdx = i;
      break;
    }
  }
  return thread.map((m, idx) => ({
    role: m.role,
    content:
      idx === lastEditIdx && m.editContext
        ? `${ELEMENT_EDIT_MARKER} (${m.editContext.label}) ${m.content}`
        : m.content,
    hasImages: m.attachments.some((id) => attachmentMap.get(id)?.kind === "image"),
  }));
}

export async function buildApiInputs(
  thread: Message[],
  attachmentMap: Map<string, Attachment>,
  provider: Provider,
  model: AIModel,
): Promise<ChatMessageInput[]> {
  let lastEditIdx = -1;
  for (let i = thread.length - 1; i >= 0; i -= 1) {
    if (thread[i]?.role === "user" && thread[i]?.editContext) {
      lastEditIdx = i;
      break;
    }
  }

  const out: ChatMessageInput[] = [];
  for (let idx = 0; idx < thread.length; idx += 1) {
    const message = thread[idx]!;
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
    const baseContent = message.editContext
      ? formatElementEditApiContent(
          message,
          idx === lastEditIdx,
          idx === lastEditIdx ? findLatestProjectFilesInThread(thread, idx) : [],
        )
      : message.content;
    out.push({
      role: message.role,
      content: `${baseContent}${extraText}`.trim(),
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

  send: async (text, options) => {
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
    const editContext = options?.editContext;
    const userMessage: Message = {
      id: uid("msg"),
      chatId: chat.id,
      role: "user",
      content: trimmed,
      parentId: chat.currentLeafId,
      attachments: pendingAttachments,
      ...(editContext ? { editContext } : {}),
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
      ...(provider.id === "router" ? { modelDisplayName: model.displayName } : {}),
      createdAt: now + 1,
    };
    const activeSkillMode = useUiStore.getState().skillMode;
    const pinnedPreviewSkill = activeSkillMode === "website" || activeSkillMode === "game";
    const title = chat.title.trim() ? chat.title : deriveTitle(trimmed);
    const updatedChat: Chat = {
      ...chat,
      title,
      providerId: provider.id,
      modelId: model.id,
      currentLeafId: assistantMessage.id,
      previewEnabled:
        chat.previewEnabled ||
        Boolean(editContext) ||
        pinnedPreviewSkill ||
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
      ...(target.provider.id === "router" ? { modelDisplayName: target.model.displayName } : {}),
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
      ...(target.provider.id === "router" ? { modelDisplayName: target.model.displayName } : {}),
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
    if (auth.profile && auth.profile.credits <= 0) {
      set({ error: { kind: "rate-limit", message: "error.creditsExhausted" } });
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
            modelDisplayName: router.name,
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
          const apiError = err as { kind?: ErrorKind; message?: string; code?: string };
          const partial = get().streaming?.content ?? "";
          if (apiError.code === "credits_exhausted" || partial) {
            void useAuthStore.getState().refresh();
          }
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
        const isElementEdit = Boolean(thread[thread.length - 1]?.editContext);
        const intent = await checkBackendPreviewIntent(
          buildIntentMessages(thread, attachmentMap),
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
        const rawSkillInstruction = (intent?.systemPrompt ?? intent?.builderSystemPrompt ?? "").trim();
        const skillInstruction = isElementEdit
          ? CLIENT_ELEMENT_EDIT_SYSTEM_PROMPT
          : rawSkillInstruction;

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
        {
          const targetProviderIds =
            router.providerIds && router.providerIds.length > 0
              ? router.providerIds
              : router.providerId
                ? [router.providerId]
                : [];
          const attachedProviders = targetProviderIds
            .map((pid) => allProviders.find((p) => p.id === pid && p.enabled))
            .filter((p): p is Provider => Boolean(p));

          const seenMemberModelIds = new Set<string>();
          for (const localProvider of attachedProviders) {
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
            for (const m of eligible) {
              if (seenMemberModelIds.has(m.id)) continue;
              seenMemberModelIds.add(m.id);
              members.push({
                id: m.id,
                upstreamId: m.modelId,
                displayName: m.displayName,
                provider: localProvider,
                model: m,
                apiKeys: keys,
                providerName: localProvider.name,
                billingSource: "byok",
              });
            }
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

        const adminNativeRouter = isAdminPublicRouter(router);
        if (!failover.ok || !failover.value || !failover.usedMember) {
          const partial = get().streaming?.content ?? "";
          const errMsg = failover.midStreamInterrupted
            ? "router.midStreamInterrupted"
            : adminNativeRouter
              ? "error.generic"
              : (failover.error || "error.generic");
          const persisted = get().messages.find((m) => m.id === assistantId);
          if (persisted) {
            const failed: Message = {
              ...persisted,
              ...(adminNativeRouter ? { modelId: router.selectionId, modelDisplayName: router.name } : {}),
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
          // Admin public routers never persist or expose the underlying model id
          // on the user-visible message; keep the native router selection + name.
          modelId: adminNativeRouter ? router.selectionId : usedMember.upstreamId,
          modelDisplayName: router.name,
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
        const apiError = err as { kind?: ErrorKind; message?: string; code?: string };
        const partial = get().streaming?.content ?? "";
        if (apiError.code === "credits_exhausted" || partial) {
          void useAuthStore.getState().refresh();
        }
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
      // Evaluate the 4-skill router + live web/photo search via the backend BEFORE
      // starting BYOK streaming so: (1) build chats unlock the preview slider on
      // frame 0, and (2) real BYOK models receive the full tailored skill prompt.
      const activeSkillMode = useUiStore.getState().skillMode;
      const isElementEdit = Boolean(thread[thread.length - 1]?.editContext);
      const byokIntent = await checkBackendPreviewIntent(
        buildIntentMessages(thread, attachmentMap),
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
      const rawByokInstruction = (byokIntent?.systemPrompt ?? byokIntent?.builderSystemPrompt ?? "").trim();
      const skillInstruction = isElementEdit
        ? CLIENT_ELEMENT_EDIT_SYSTEM_PROMPT
        : rawByokInstruction;

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
          try {
            storedKey = (await getProviderKey(routeProvider.id)) ?? "";
          } catch {
            set({ error: { kind: "auth", message: "error.vaultLocked" } });
            return;
          }
        }
        const trimmedStored = storedKey.trim();
        const keyCandidates = getProviderKeyCandidates(routeProvider, storedKey);
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
