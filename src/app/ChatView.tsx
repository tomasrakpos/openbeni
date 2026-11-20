// Main app view ChatView; change its view behavior here and keep shared state in sync.
import * as React from "react";
import { MessageList } from "@/features/chat/MessageList";
import { ThreadComposer } from "@/features/chat/ThreadComposer";
import { activeThread, useChatsStore } from "@/stores/chats";

export function ChatView() {
  const messages = useChatsStore((s) => s.messages);
  const chats = useChatsStore((s) => s.chats);
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const chat = chats.find((c) => c.id === activeChatId) ?? null;
  const thread = React.useMemo(() => activeThread(messages, chat), [messages, chat]);
  const empty = thread.length === 0;

  /*
   * The thread composer floats over the message list instead of sitting below
   * it. That is what makes the glass real: the lens is a backdrop-filter, so
   * it can only refract what is painted behind it. In a stacked layout the
   * messages were in a separate box above the composer (nothing behind the
   * glass but the page background); overlaying the scroll area puts actual
   * bubbles behind the material.
   *
   * The wrapper must not animate opacity/transform/filter: any of those turns
   * it into a "backdrop root" and silences the refraction of everything
   * outside it. The composer's own children already animate in (`.ppc-enter`).
   */
  const composerRef = React.useRef<HTMLDivElement>(null);
  const [composerHeight, setComposerHeight] = React.useState(0);

  React.useLayoutEffect(() => {
    const node = composerRef.current;
    if (!node) {
      setComposerHeight(0);
      return;
    }
    const sync = () => setComposerHeight(Math.round(node.getBoundingClientRect().height));
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    return () => observer.disconnect();
  }, [empty]);

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      style={
        {
          "--thread-composer-h": `${empty ? 0 : composerHeight || 176}px`,
        } as React.CSSProperties
      }
    >
      <MessageList />
      {!empty && (
        <div ref={composerRef} className="pointer-events-none absolute inset-x-0 bottom-0 z-20">
          <div className="pointer-events-auto">
            <ThreadComposer />
          </div>
        </div>
      )}
    </div>
  );
}
