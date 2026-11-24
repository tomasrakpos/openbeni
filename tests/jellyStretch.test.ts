import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JellyStretchEngine, rubber } from "@/lib/useJellyStretch";

type Listener = (event: any) => void;

class FakeElement {
  offsetWidth: number;
  offsetHeight: number;
  disabled = false;
  style: Record<string, string> = {};
  dataset: Record<string, string | undefined> = {};
  private attrs = new Map<string, string>();
  private listeners = new Map<string, Array<{ fn: Listener; capture: boolean }>>();

  constructor(width = 120, height = 36) {
    this.offsetWidth = width;
    this.offsetHeight = height;
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  getBoundingClientRect() {
    return {
      left: 100,
      top: 100,
      right: 100 + this.offsetWidth,
      bottom: 100 + this.offsetHeight,
      width: this.offsetWidth,
      height: this.offsetHeight,
      x: 100,
      y: 100,
      toJSON: () => ({}),
    };
  }

  addEventListener(type: string, fn: Listener, capture = false) {
    const list = this.listeners.get(type) ?? [];
    list.push({ fn, capture: Boolean(capture) });
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, fn: Listener, capture = false) {
    const list = this.listeners.get(type);
    if (!list) return;
    this.listeners.set(
      type,
      list.filter((l) => l.fn !== fn || l.capture !== Boolean(capture)),
    );
  }

  dispatch(type: string, event: Record<string, any> = {}) {
    const ev = {
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this.propagationStopped = true;
      },
      ...event,
    };
    const list = this.listeners.get(type) ?? [];
    // Run capture phase first, then bubble phase
    for (const item of list.filter((l) => l.capture)) {
      item.fn(ev);
      if (ev.propagationStopped) return ev;
    }
    for (const item of list.filter((l) => !l.capture)) {
      item.fn(ev);
      if (ev.propagationStopped) return ev;
    }
    return ev;
  }
}

describe("jellyStretch physics engine", () => {
  let rafQueue: Array<{ id: number; cb: FrameRequestCallback }> = [];
  let nextId = 1;
  let now = 1000;
  let reducedMotion = false;
  let winListeners: Map<string, Listener[]>;
  const origWindow = globalThis.window;

  const dispatchWindow = (type: string, event: Record<string, any> = {}) => {
    for (const fn of winListeners.get(type) ?? []) {
      fn(event);
    }
  };

  const stepFrames = (count: number, dtMs = 16) => {
    for (let i = 0; i < count; i++) {
      now += dtMs;
      const batch = rafQueue;
      rafQueue = [];
      for (const item of batch) {
        item.cb(now);
      }
    }
  };

  beforeEach(() => {
    rafQueue = [];
    nextId = 1;
    now = 1000;
    reducedMotion = false;
    winListeners = new Map();

    vi.spyOn(performance, "now").mockImplementation(() => now);
    (globalThis as any).window = {
      requestAnimationFrame: (cb: FrameRequestCallback) => {
        const id = nextId++;
        rafQueue.push({ id, cb });
        return id;
      },
      cancelAnimationFrame: (id: number) => {
        rafQueue = rafQueue.filter((item) => item.id !== id);
      },
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
      matchMedia: (query: string) => ({
        matches: reducedMotion && query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    };
  });

  afterEach(() => {
    (globalThis as any).window = origWindow;
    vi.restoreAllMocks();
  });

  it("rubber() curves smoothly, stays symmetric, and asymptotes below reach", () => {
    expect(rubber(0, 22)).toBe(0);
    expect(rubber(10, 22)).toBeGreaterThan(0);
    expect(rubber(10, 22)).toBeLessThan(10);
    expect(rubber(-10, 22)).toBeCloseTo(-rubber(10, 22), 6);
    expect(rubber(5000, 22)).toBeLessThan(22);
    expect(rubber(5000, 22)).toBeGreaterThan(21);
  });

  it("squashes, tilts, stretches on drag, and settles back to a clean transform on release", () => {
    const btn = new FakeElement(120, 36);
    btn.style.backgroundColor = "rgb(255, 100, 0)";
    const engine = new JellyStretchEngine(btn as unknown as HTMLElement, btn as unknown as HTMLElement);

    btn.dispatch("pointerdown", { button: 0, pointerId: 1, clientX: 160, clientY: 118 });
    stepFrames(6);

    expect(btn.dataset.jellyStretching).toBe("true");
    expect(btn.style.transform).toContain("translate3d(");
    expect(btn.style.transform).toContain("perspective(");
    expect(btn.style.transform).toContain("scale(");
    // Original visual styles must remain completely untouched
    expect(btn.style.backgroundColor).toBe("rgb(255, 100, 0)");

    // Drag to the right -> directional stretch along the drag vector
    dispatchWindow("pointermove", { pointerId: 1, clientX: 195, clientY: 122 });
    stepFrames(10);
    expect(btn.style.transform).toContain("rotate(");

    // Release -> rebounds softly and eventually clears transform & stops RAF
    dispatchWindow("pointerup", { pointerId: 1, clientX: 195, clientY: 122 });
    stepFrames(400);

    expect(btn.style.transform).toBe("");
    expect(btn.dataset.jellyStretching).toBeUndefined();
    expect(rafQueue.length).toBe(0);

    engine.destroy();
  });

  it("snaps back and suppresses accidental click when dragged past dragBreak", () => {
    const btn = new FakeElement(120, 36);
    const onClick = vi.fn();
    btn.addEventListener("click", onClick);
    const engine = new JellyStretchEngine(btn as unknown as HTMLElement, btn as unknown as HTMLElement, {
      dragBreak: 48,
    });

    btn.dispatch("pointerdown", { button: 0, pointerId: 2, clientX: 160, clientY: 118 });
    stepFrames(4);

    // Pull well past the 48px break distance outside the right edge (220 + 80)
    dispatchWindow("pointermove", { pointerId: 2, clientX: 300, clientY: 118 });

    const clickEv = btn.dispatch("click");
    expect(clickEv.defaultPrevented).toBe(true);
    expect(onClick).not.toHaveBeenCalled();

    engine.destroy();
  });

  it("respects prefers-reduced-motion and disabled buttons", () => {
    reducedMotion = true;
    const btn = new FakeElement(120, 36);
    const engine = new JellyStretchEngine(btn as unknown as HTMLElement, btn as unknown as HTMLElement);

    btn.dispatch("pointerdown", { button: 0, pointerId: 3, clientX: 160, clientY: 118 });
    stepFrames(10);

    expect(btn.style.transform).toBeUndefined();
    expect(rafQueue.length).toBe(0);
    engine.destroy();

    reducedMotion = false;
    const disabledBtn = new FakeElement(120, 36);
    disabledBtn.disabled = true;
    const engine2 = new JellyStretchEngine(
      disabledBtn as unknown as HTMLElement,
      disabledBtn as unknown as HTMLElement,
    );
    disabledBtn.dispatch("pointerdown", { button: 0, pointerId: 4, clientX: 160, clientY: 118 });
    stepFrames(10);
    expect(disabledBtn.style.transform).toBeUndefined();
    expect(rafQueue.length).toBe(0);
    engine2.destroy();
  });

  it("invokes onFrame during drag and resets to (0, 0) at rest", () => {
    const card = new FakeElement(344, 320);
    const frames: Array<[number, number]> = [];
    const engine = new JellyStretchEngine(card as unknown as HTMLElement, card as unknown as HTMLElement, {
      bounce: 0.55,
      dragReachX: 20,
      dragReachY: 16,
      onFrame: (dx, dy) => frames.push([dx, dy]),
    });

    card.dispatch("pointerdown", { button: 0, pointerId: 9, clientX: 250, clientY: 200 });
    dispatchWindow("pointermove", { pointerId: 9, clientX: 290, clientY: 220 });
    stepFrames(10);
    expect(frames.some(([dx, dy]) => dx > 0 && dy > 0)).toBe(true);

    dispatchWindow("pointerup", { pointerId: 9, clientX: 290, clientY: 220 });
    stepFrames(400);
    expect(frames[frames.length - 1]).toEqual([0, 0]);

    engine.destroy();
  });
});
