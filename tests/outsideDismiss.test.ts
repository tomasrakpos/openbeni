import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachOutsideDismiss } from "@/lib/outsideDismiss";

type Listener = (ev: any) => void;

describe("attachOutsideDismiss", () => {
  const docListeners = new Map<string, Listener[]>();
  const winListeners = new Map<string, Listener[]>();
  let now = 1000;
  let activeElement: { tagName: string } | null = null;
  const origDoc = globalThis.document;
  const origWin = globalThis.window;

  const fireDoc = (type: string, target: any) => {
    for (const fn of docListeners.get(type) ?? []) {
      fn({ target, composedPath: () => [target] });
    }
  };

  beforeEach(() => {
    docListeners.clear();
    winListeners.clear();
    now = 1000;
    activeElement = null;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    (globalThis as any).document = {
      get activeElement() {
        return activeElement;
      },
      addEventListener: (type: string, fn: Listener) => {
        const list = docListeners.get(type) ?? [];
        list.push(fn);
        docListeners.set(type, list);
      },
      removeEventListener: (type: string, fn: Listener) => {
        const list = docListeners.get(type);
        if (!list) return;
        docListeners.set(
          type,
          list.filter((l) => l !== fn),
        );
      },
    };
    (globalThis as any).window = {
      addEventListener: (type: string, fn: Listener) => {
        const list = winListeners.get(type) ?? [];
        list.push(fn);
        winListeners.set(type, list);
      },
      removeEventListener: (type: string, fn: Listener) => {
        const list = winListeners.get(type);
        if (!list) return;
        winListeners.set(
          type,
          list.filter((l) => l !== fn),
        );
      },
      setTimeout: (fn: () => void) => {
        fn();
        return 1;
      },
    };
  });

  afterEach(() => {
    (globalThis as any).document = origDoc;
    (globalThis as any).window = origWin;
    vi.restoreAllMocks();
  });

  it("dismisses once on touchstart + pointerdown outside, ignores taps inside, and respects iframe blur", () => {
    const insideNode = { id: "menu" } as unknown as Node;
    const outsideNode = { id: "page" } as unknown as Node;
    const onDismiss = vi.fn();

    const detach = attachOutsideDismiss({
      isInside: (target) => target === insideNode,
      onDismiss,
    });

    // Tap inside -> no dismiss
    fireDoc("touchstart", insideNode);
    fireDoc("pointerdown", insideNode);
    expect(onDismiss).not.toHaveBeenCalled();

    // Tap outside on mobile fires touchstart + pointerdown + mousedown within milliseconds -> dismisses once
    fireDoc("touchstart", outsideNode);
    now += 10;
    fireDoc("pointerdown", outsideNode);
    now += 10;
    fireDoc("mousedown", outsideNode);
    expect(onDismiss).toHaveBeenCalledTimes(1);

    // Next tap outside after dedupe window -> dismisses again
    now += 200;
    fireDoc("pointerdown", outsideNode);
    expect(onDismiss).toHaveBeenCalledTimes(2);

    // Tapping inside an embedded iframe triggers window blur with activeElement = IFRAME
    activeElement = { tagName: "IFRAME" };
    for (const fn of winListeners.get("blur") ?? []) fn({});
    expect(onDismiss).toHaveBeenCalledTimes(3);

    detach();
    now += 200;
    fireDoc("pointerdown", outsideNode);
    expect(onDismiss).toHaveBeenCalledTimes(3);
  });
});
