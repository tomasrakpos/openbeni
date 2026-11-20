// layout feature: useChatSearch; change its UI/flow here and keep related state/API calls in sync.
import * as React from "react";
import { db } from "@/db";
import type { Chat, Message } from "@/lib/types";
import { useChatsStore } from "@/stores/chats";

/**
 * Chat/message full-text search shared by the search dialog and the inline
 * navbar search. Messages are read once per activation and filtered in memory;
 * the chat map comes from the live store so renamed/removed chats stay correct.
 */

export interface SearchHit {
  message: Message;
  chat: Chat;
}

export interface SearchGroup {
  chat: Chat;
  hits: SearchHit[];
}

export function snippet(
  content: string,
  query: string,
): { before: string; match: string; after: string } {
  const index = content.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) {
    return { before: content.slice(0, 120), match: "", after: content.length > 120 ? "…" : "" };
  }
  const start = Math.max(0, index - 48);
  const end = Math.min(content.length, index + query.length + 72);
  return {
    before: `${start > 0 ? "…" : ""}${content.slice(start, index)}`,
    match: content.slice(index, index + query.length),
    after: `${content.slice(index + query.length, end)}${end < content.length ? "…" : ""}`,
  };
}

export function useChatSearch(query: string, enabled: boolean, limit = 80) {
  const chats = useChatsStore((s) => s.chats);
  const [allMessages, setAllMessages] = React.useState<Message[]>([]);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoaded(false);
    db.messages
      .toArray()
      .then((rows) => {
        if (!cancelled) {
          setAllMessages(rows);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const loading = enabled && !loaded;

  const results = React.useMemo<SearchHit[]>(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const chatMap = new Map(chats.map((chat) => [chat.id, chat]));
    const hits: SearchHit[] = [];
    for (const message of allMessages) {
      if (!message.content.toLowerCase().includes(needle)) continue;
      const chat = chatMap.get(message.chatId);
      if (!chat) continue;
      hits.push({ message, chat });
      if (hits.length >= limit) break;
    }
    return hits.sort((a, b) => b.message.createdAt - a.message.createdAt);
  }, [allMessages, chats, limit, query]);

  const groups = React.useMemo<SearchGroup[]>(() => {
    const map = new Map<string, SearchGroup>();
    for (const hit of results) {
      const group = map.get(hit.chat.id);
      if (group) group.hits.push(hit);
      else map.set(hit.chat.id, { chat: hit.chat, hits: [hit] });
    }
    return [...map.values()];
  }, [results]);

  return { results, groups, loading };
}
