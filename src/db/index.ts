// Local persistence index; change storage setup here and preserve upgrade behavior.
import Dexie, { type Table } from "dexie";
import type {
  AIModel,
  Attachment,
  Chat,
  Folder,
  Message,
  PingResult,
  ProjectVersion,
  Provider,
  Settings,
} from "@/lib/types";

export interface SecretRow {
  providerId: string;
  iv: string;
  ct: string;
  updatedAt: number;
}

export interface MetaRow {
  k: string;
  v: unknown;
}

export class ApiSetDB extends Dexie {
  providers!: Table<Provider, string>;
  models!: Table<AIModel, string>;
  chats!: Table<Chat, string>;
  messages!: Table<Message, string>;
  attachments!: Table<Attachment, string>;
  pings!: Table<PingResult, string>;
  secrets!: Table<SecretRow, string>;
  versions!: Table<ProjectVersion, string>;
  folders!: Table<Folder, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    // The database id is intentionally kept from before the OpenHarness rename so
    // existing local chats, providers and keys keep loading without a migration.
    super("apiset-pro");
    this.version(1).stores({
      providers: "id, order, updatedAt, enabled",
      models: "id, providerId, modelId, [providerId+modelId], order",
      chats: "id, updatedAt, pinned",
      messages: "id, chatId, parentId, createdAt",
      attachments: "id, chatId",
      pings: "id, providerId, modelId, at",
      secrets: "providerId",
      versions: "id, chatId, createdAt",
      folders: "id, order",
      meta: "k",
    });
  }
}

export const db = new ApiSetDB();

/* -------------------------------------------------------------------------- */
/*  Settings                                                                  */
/* -------------------------------------------------------------------------- */

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  lang: "en",
  showBackground: true,
  proxyUrl: "",
  autoPingMinutes: 0,
  sidebarCollapsed: false,
  rightPanelOpen: true,
  temperature: 0.7,
  topP: 1,
  maxTokens: 4096,
  systemPresets: [
    { id: "preset-general", name: "General assistant", prompt: "You are a concise, precise assistant. Prefer concrete answers and short explanations." },
    { id: "preset-code", name: "Senior engineer", prompt: "You are a senior software engineer. Produce complete, runnable code. Explain trade-offs briefly." },
    { id: "preset-fa", name: "دستیار فارسی", prompt: "شما یک دستیار فارسی‌زبان دقیق و مختصر هستید. پاسخ‌ها را روان و طبیعی بنویسید." },
  ],
  encryption: "device",
  onboardingDone: false,
  showReasoning: true,
};

export async function loadSettings(): Promise<Settings> {
  const row = await db.meta.get("settings");
  return { ...DEFAULT_SETTINGS, ...((row?.v as Partial<Settings> | undefined) ?? {}) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await db.meta.put({ k: "settings", v: settings });
}

/* -------------------------------------------------------------------------- */
/*  Chats                                                                     */
/* -------------------------------------------------------------------------- */

export async function listChats(): Promise<Chat[]> {
  const chats = await db.chats.orderBy("updatedAt").reverse().toArray();
  return chats;
}

export async function getMessages(chatId: string): Promise<Message[]> {
  return db.messages.where("chatId").equals(chatId).toArray();
}

export async function deleteChatCascade(chatId: string): Promise<void> {
  await db.transaction("rw", [db.chats, db.messages, db.attachments, db.versions], async () => {
    await db.messages.where("chatId").equals(chatId).delete();
    await db.attachments.where("chatId").equals(chatId).delete();
    await db.versions.where("chatId").equals(chatId).delete();
    await db.chats.delete(chatId);
  });
}

export async function clearAllData(): Promise<void> {
  await db.transaction(
    "rw",
    [db.chats, db.messages, db.attachments, db.versions, db.pings, db.folders],
    async () => {
      await Promise.all([
        db.chats.clear(),
        db.messages.clear(),
        db.attachments.clear(),
        db.versions.clear(),
        db.pings.clear(),
        db.folders.clear(),
      ]);
    },
  );
}

/* -------------------------------------------------------------------------- */
/*  Providers + models                                                        */
/* -------------------------------------------------------------------------- */

export async function listProviders(): Promise<Provider[]> {
  const rows = await db.providers.toArray();
  return rows.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export async function listModels(): Promise<AIModel[]> {
  const rows = await db.models.toArray();
  return rows.sort((a, b) => a.order - b.order || a.displayName.localeCompare(b.displayName));
}

export async function deleteProviderCascade(providerId: string): Promise<void> {
  await db.transaction("rw", [db.providers, db.models, db.secrets, db.pings], async () => {
    await db.models.where("providerId").equals(providerId).delete();
    await db.pings.where("providerId").equals(providerId).delete();
    await db.secrets.delete(providerId);
    await db.providers.delete(providerId);
  });
}

/** Removes every stored provider with its models, keys and pings. */
export async function clearAllProviders(): Promise<void> {
  await db.transaction(
    "rw",
    [db.providers, db.models, db.secrets, db.pings],
    async () => {
      await Promise.all([
        db.providers.clear(),
        db.models.clear(),
        db.secrets.clear(),
        db.pings.clear(),
      ]);
    },
  );
}

export async function addPing(ping: PingResult): Promise<void> {
  await db.pings.add(ping);
  const stale = await db.pings.where("providerId").equals(ping.providerId).sortBy("at");
  if (stale.length > 200) {
    await db.pings.bulkDelete(stale.slice(0, stale.length - 200).map((p) => p.id));
  }
}
