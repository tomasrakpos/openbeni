// chat feature: MessageList; change its UI/flow here and keep related state/API calls in sync.
import { ArrowDown } from "lucide-react";
import * as React from "react";
import { EmptyState } from "@/features/chat/EmptyState";
import { MessageItem } from "@/features/chat/MessageItem";
import { useT } from "@/lib/i18n";
import { activeThread, useChatsStore } from "@/stores/chats";

export function MessageList() {
  const t = useT();
  const messages = useChatsStore((s) => s.messages);
  const chats = useChatsStore((s) => s.chats);
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const streaming = useChatsStore((s) => s.streaming);
  const chat = chats.find((c) => c.id === activeChatId) ?? null;
  const thread = React.useMemo(() => activeThread(messages, chat), [messages, chat]);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const stickRef = React.useRef(true);
  const [atBottom, setAtBottom] = React.useState(true);

  const scrollToBottom = React.useCallback((behavior: ScrollBehavior = "auto") => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior });
    stickRef.current = true;
    setAtBottom(true);
  }, []);

  // A new conversation always opens at its newest message.
  React.useLayoutEffect(() => {
    stickRef.current = true;
    setAtBottom(true);
    scrollToBottom("auto");
  }, [activeChatId, scrollToBottom]);

  // Sending (or receiving) a message pins the thread to the bottom.
  React.useLayoutEffect(() => {
    scrollToBottom("auto");
  }, [thread.length, scrollToBottom]);

  // While streaming, follow the tail only when the reader is already there.
  React.useLayoutEffect(() => {
    if (stickRef.current) scrollToBottom("auto");
  }, [streaming?.content, streaming?.reasoning, scrollToBottom]);

  /*
   * Bubble heights and the composer padding settle after layout (code blocks,
   * images, the glass height itself). Observing the content means the last
   * message is never left hidden below the fold.
   */
  React.useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      if (stickRef.current) scrollToBottom("auto");
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [thread.length, scrollToBottom]);

  const onScroll = () => {
    const node = scrollRef.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    const nearBottom = distance < 120;
    stickRef.current = nearBottom;
    setAtBottom(nearBottom);
  };

  if (thread.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" ref={scrollRef}>
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        role="log"
        aria-live="polite"
        aria-label={t("chat.conversation")}
      >
        <div
          ref={contentRef}
          className="mx-auto w-full max-w-[860px] px-4 pt-[calc(var(--header-h)+16px)] sm:px-6"
          // The composer floats over this scroller (see ChatView). Pad the
          // content by its live height so the newest message can always rest
          // *above* the glass instead of being trapped under it.
          style={{ paddingBottom: "calc(var(--thread-composer-h, 176px) + 24px)" }}
        >
          {thread.map((message, index) => (
            <MessageItem
              key={message.id}
              message={message}
              streaming={streaming}
              isLast={index === thread.length - 1}
            />
          ))}
        </div>
      </div>
      {!atBottom && (
        <button
          type="button"
          onClick={() => scrollToBottom("smooth")}
          className="absolute left-1/2 z-10 grid size-9 -translate-x-1/2 place-items-center rounded-full border border-[var(--border)] bg-[var(--surface-1)] text-[var(--muted-foreground)] shadow-md transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          style={{ bottom: "calc(var(--thread-composer-h, 176px) + 12px)" }}
          aria-label={t("chat.scrollLatest")}
        >
          <ArrowDown className="size-4" />
        </button>
      )}
    </div>
  );
}
