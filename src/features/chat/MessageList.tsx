// chat feature: MessageList; change its UI/flow here and keep related state/API calls in sync.
import { ArrowDown } from "lucide-react";
import * as React from "react";
import { ChatAutoScrollController } from "@/features/chat/autoScroll";
import { EmptyState } from "@/features/chat/EmptyState";
import { useT } from "@/lib/i18n";
import { loadMessageItem } from "@/lib/preload";
import { activeThread, useChatsStore } from "@/stores/chats";

const MessageItem = React.lazy(loadMessageItem);

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
  const ctrlRef = React.useRef<ChatAutoScrollController | null>(null);
  if (!ctrlRef.current) ctrlRef.current = new ChatAutoScrollController();
  const rafIdRef = React.useRef<number | null>(null);
  const prevThreadLenRef = React.useRef(thread.length);
  const [atBottom, setAtBottom] = React.useState(true);

  const syncAtBottom = React.useCallback((next: boolean) => {
    setAtBottom((prev) => (prev === next ? prev : next));
  }, []);

  const cancelPendingFollow = React.useCallback(() => {
    if (rafIdRef.current !== null) {
      window.cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  const scrollToBottom = React.useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const node = scrollRef.current;
      const ctrl = ctrlRef.current!;
      if (!node) return;
      cancelPendingFollow();
      const maxScroll = Math.max(0, node.scrollHeight - node.clientHeight);
      if (behavior === "smooth") {
        ctrl.markProgrammaticScroll(maxScroll, 500, performance.now());
        node.scrollTo({ top: maxScroll, behavior: "smooth" });
      } else {
        ctrl.markProgrammaticScroll(maxScroll, 80, performance.now());
        node.scrollTop = maxScroll;
      }
      syncAtBottom(true);
    },
    [cancelPendingFollow, syncAtBottom],
  );

  // Coalesce rapid streaming / ResizeObserver updates into a single rAF per frame
  // and never hijack scroll while the user is touching, dragging, or has scrolled up.
  const scheduleFollowBottom = React.useCallback(() => {
    const ctrl = ctrlRef.current!;
    if (!ctrl.canFollow()) return;
    if (rafIdRef.current !== null) return;
    rafIdRef.current = window.requestAnimationFrame(() => {
      rafIdRef.current = null;
      const node = scrollRef.current;
      if (!node || !ctrl.canFollow()) return;
      const maxScroll = Math.max(0, node.scrollHeight - node.clientHeight);
      if (maxScroll - node.scrollTop <= 1) return;
      ctrl.markProgrammaticScroll(maxScroll, 80, performance.now());
      node.scrollTop = maxScroll;
    });
  }, []);

  React.useEffect(() => cancelPendingFollow, [cancelPendingFollow]);

  // Clear scrollbar drag state even if pointer is released outside the scroller.
  React.useEffect(() => {
    const endDrag = () => {
      ctrlRef.current?.onScrollbarDragEnd();
    };
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    return () => {
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, []);

  // A new conversation always opens at its newest message.
  React.useLayoutEffect(() => {
    prevThreadLenRef.current = thread.length;
    const node = scrollRef.current;
    const maxScroll = node ? Math.max(0, node.scrollHeight - node.clientHeight) : 0;
    ctrlRef.current!.resetForChat(maxScroll, performance.now());
    syncAtBottom(true);
    scrollToBottom("auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChatId, scrollToBottom, syncAtBottom]);

  // Sending a new user message pins the thread to the bottom; otherwise only
  // follow if the reader was already anchored at the tail.
  React.useLayoutEffect(() => {
    const prevLen = prevThreadLenRef.current;
    prevThreadLenRef.current = thread.length;
    if (thread.length === 0) return;
    const latest = thread[thread.length - 1];
    const userJustSent = thread.length > prevLen && latest?.role === "user";
    if (userJustSent) {
      scrollToBottom("auto");
    } else if (ctrlRef.current!.canFollow()) {
      scheduleFollowBottom();
    }
  }, [thread, scrollToBottom, scheduleFollowBottom]);

  // While streaming, follow the tail only when the reader is still anchored there.
  React.useLayoutEffect(() => {
    if (ctrlRef.current!.canFollow()) scheduleFollowBottom();
  }, [streaming?.content, streaming?.reasoning, scheduleFollowBottom]);

  /*
   * Bubble heights and the composer padding settle after layout (artifact build
   * steps, code blocks, images, the glass height itself). Follow smoothly only
   * when anchored and the user is not actively interacting with the scroller.
   */
  React.useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      if (ctrlRef.current!.canFollow()) scheduleFollowBottom();
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [thread.length, scheduleFollowBottom]);

  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (ctrlRef.current!.onWheel(event.deltaY)) {
      cancelPendingFollow();
      syncAtBottom(false);
    }
  };

  const onTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    cancelPendingFollow();
    ctrlRef.current!.onTouchStart(event.touches[0]?.clientY ?? null);
  };

  const onTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (ctrlRef.current!.onTouchMove(event.touches[0]?.clientY ?? null)) {
      cancelPendingFollow();
      syncAtBottom(false);
    }
  };

  const onTouchEnd = () => {
    ctrlRef.current!.onTouchEnd();
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse") return;
    const node = scrollRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const scrollbarWidth = node.offsetWidth - node.clientWidth;
    if (scrollbarWidth > 0 && event.clientX >= rect.right - scrollbarWidth - 6) {
      cancelPendingFollow();
      ctrlRef.current!.onScrollbarDragStart();
    }
  };

  const onScroll = () => {
    const node = scrollRef.current;
    if (!node) return;
    const snap = ctrlRef.current!.onScroll(
      node.scrollTop,
      node.scrollHeight,
      node.clientHeight,
      performance.now(),
    );
    if (!snap.stick) cancelPendingFollow();
    syncAtBottom(snap.atBottom);
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
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onPointerDown={onPointerDown}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain [overflow-anchor:none]"
        role="log"
        aria-live="polite"
        aria-label={t("chat.conversation")}
      >
        <div
          ref={contentRef}
          className="mx-auto w-full max-w-[860px] px-4 pt-[calc(var(--header-h)+44px)] sm:px-6"
          // The composer floats over this scroller (see ChatView). Pad the
          // content by its live height so the newest message can always rest
          // *above* the glass instead of being trapped under it.
          style={{ paddingBottom: "calc(var(--thread-composer-h, 176px) + 24px)" }}
        >
          <React.Suspense fallback={null}>
            {thread.map((message, index) => (
              <MessageItem
                key={message.id}
                message={message}
                streaming={streaming}
                isLast={index === thread.length - 1}
              />
            ))}
          </React.Suspense>
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
