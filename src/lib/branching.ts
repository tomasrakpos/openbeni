// Shared logic branching; change this helper here and update callers if its contract changes.
import type { Message } from "@/lib/types";

export function groupChildren(messages: Message[]): Map<string | null, Message[]> {
  const map = new Map<string | null, Message[]>();
  const sorted = [...messages].sort((a, b) => a.createdAt - b.createdAt);
  for (const message of sorted) {
    const key = message.parentId ?? null;
    const list = map.get(key) ?? [];
    list.push(message);
    map.set(key, list);
  }
  return map;
}

/** Root → leaf path, following parent pointers. Returns [] when the leaf is unknown. */
export function buildThread(messages: Message[], leafId: string | null): Message[] {
  if (!leafId) return [];
  const byId = new Map(messages.map((m) => [m.id, m]));
  const path: Message[] = [];
  let cursor = byId.get(leafId);
  const seen = new Set<string>();
  while (cursor) {
    if (seen.has(cursor.id)) break;
    seen.add(cursor.id);
    path.push(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return path.reverse();
}

export function childrenOf(messages: Message[], message: Message): Message[] {
  return messages
    .filter((m) => m.parentId === message.parentId && m.role === message.role && m.id !== message.id)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function branchInfo(messages: Message[], message: Message): { index: number; total: number; siblings: Message[] } {
  const siblings = messages
    .filter((m) => m.parentId === message.parentId && m.role === message.role)
    .sort((a, b) => a.createdAt - b.createdAt);
  const index = siblings.findIndex((m) => m.id === message.id);
  return { index: index === -1 ? 0 : index, total: siblings.length, siblings };
}

/** Deepest most-recent descendant of a message (the visible tip of that branch). */
export function deepestLeaf(messages: Message[], messageId: string): string {
  const map = groupChildren(messages);
  let cursor = messageId;
  const seen = new Set<string>();
  for (;;) {
    if (seen.has(cursor)) return cursor;
    seen.add(cursor);
    const kids = map.get(cursor);
    if (!kids || kids.length === 0) return cursor;
    const next = kids[kids.length - 1];
    if (!next) return cursor;
    cursor = next.id;
  }
}

export function lastLeaf(messages: Message[]): string | null {
  if (messages.length === 0) return null;
  const map = groupChildren(messages);
  const roots = map.get(null) ?? [];
  const root = roots[roots.length - 1];
  if (!root) return null;
  return deepestLeaf(messages, root.id);
}

export function visibleAttachments(message: Message): string[] {
  return message.attachments ?? [];
}
