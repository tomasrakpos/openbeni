// Shared logic export; change this helper here and update callers if its contract changes.
import type { AIModel, Chat, Message, Provider, Settings, VirtualFile } from "@/lib/types";

/**
 * `file-saver` and `jszip` are only needed when the user actually downloads
 * something, so they are loaded on demand instead of in the entry chunk.
 */

export function safeFilename(value: string, fallback = "apiset"): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

export async function downloadText(
  content: string,
  filename: string,
  mime = "text/plain;charset=utf-8",
): Promise<void> {
  const { saveAs } = await import("file-saver");
  saveAs(new Blob([content], { type: mime }), filename);
}

export async function downloadJson(data: unknown, filename: string): Promise<void> {
  await downloadText(JSON.stringify(data, null, 2), filename, "application/json;charset=utf-8");
}

export function chatToMarkdown(chat: Chat, messages: Message[], modelLabel?: string): string {
  const friendlyFromMessages = messages.find((m) => m.modelDisplayName)?.modelDisplayName;
  const resolvedModel =
    modelLabel ||
    (chat.modelId?.startsWith("router::") ? (friendlyFromMessages || "OpenHarneks") : chat.modelId) ||
    "—";
  const lines: string[] = [`# ${chat.title}`, ""];
  lines.push(`- Model: ${resolvedModel}`);
  lines.push(`- Created: ${new Date(chat.createdAt).toISOString()}`);
  lines.push("");
  if (chat.systemPrompt.trim()) {
    lines.push("## System prompt", "", "> " + chat.systemPrompt.replace(/\n/g, "\n> "), "");
  }
  for (const message of messages) {
    lines.push(`## ${message.role === "user" ? "User" : "Assistant"}`, "");
    lines.push(message.content || (message.error ? `_Error: ${message.error.message}_` : ""));
    lines.push("");
    if (message.reasoning) {
      lines.push("<details><summary>Reasoning</summary>", "", message.reasoning, "", "</details>", "");
    }
  }
  lines.push("---", "Exported from OpenHarneks");
  return lines.join("\n");
}

export function chatToJson(chat: Chat, messages: Message[]): unknown {
  return {
    format: "apiset-pro-chat",
    version: 1,
    exportedAt: new Date().toISOString(),
    chat: {
      title: chat.title,
      systemPrompt: chat.systemPrompt,
      modelId: chat.modelId,
      providerId: chat.providerId,
      params: chat.params,
      createdAt: chat.createdAt,
    },
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
      reasoning: m.reasoning,
      createdAt: m.createdAt,
      modelId: m.modelId,
      stats: m.stats,
    })),
  };
}

export async function downloadZip(files: VirtualFile[], name: string): Promise<void> {
  const [{ default: JSZip }, { saveAs }] = await Promise.all([import("jszip"), import("file-saver")]);
  const zip = new JSZip();
  for (const file of files) zip.file(file.path, file.content);
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  saveAs(blob, `${safeFilename(name, "project")}.zip`);
}

export interface SettingsExport {
  format: "apiset-pro-settings";
  version: 1;
  exportedAt: string;
  settings: Omit<Settings, "kdfSalt">;
  providers: Omit<Provider, "hasKey">[];
  models: AIModel[];
}

export function settingsExportPayload(
  settings: Settings,
  providers: Provider[],
  models: AIModel[],
): SettingsExport {
  const { kdfSalt: _salt, ...rest } = settings;
  return {
    format: "apiset-pro-settings",
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: rest,
    providers: providers.map(({ hasKey: _hasKey, ...provider }) => provider),
    models,
  };
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}
