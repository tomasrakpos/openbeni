// layout feature: MobilePreviewPager — hardware-accelerated 1:1 real-time
// horizontal 2-page scroll-snap slider for mobile/tablet viewports (< 1280px).
// Swiping right-to-left pushes the main chat screen aside in real time and
// reveals the full-screen preview page; swiping left-to-right (even directly
// on top of the live preview iframe) pulls the main chat screen smoothly back.
import * as React from "react";
import { useUiStore } from "@/stores/ui";

const COMMIT_RATIO = 0.22;
const FLICK_VELOCITY = 0.3; // px/ms

interface MobilePreviewPagerProps {
  /** When false (lobby or ordinary chat), Slide 1 is not mounted and horizontal swiping is disabled. */
  enabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Document reading direction ("ltr" | "rtl") preserved inside each slide. */
  dir: "ltr" | "rtl";
  /** Slide 0 (left): main chat screen. */
  main: React.ReactNode;
  /** Slide 1 (right): full-screen preview/files/versions page. */
  preview: React.ReactNode;
}

function isBlockingOverlayOpen(): boolean {
  const ui = useUiStore.getState();
  if (
    ui.paletteOpen ||
    ui.wizardOpen ||
    ui.settingsOpen ||
    ui.chatSettingsOpen ||
    ui.authOpen ||
    ui.authGateOpen ||
    ui.searchOpen ||
    ui.modelPickerOpen
  ) {
    return true;
  }
  if (typeof document === "undefined") return false;
  return Boolean(
    document.querySelector(
      '[data-state="open"][role="dialog"], [data-state="open"][role="alertdialog"], [data-state="open"][role="menu"], [aria-expanded="true"][aria-haspopup]',
    ),
  );
}

function isInteractiveInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable="true"], [role="slider"]',
    ),
  );
}

function canAncestorScrollHorizontally(
  target: EventTarget | null,
  boundary: HTMLElement | null,
  dx: number,
): boolean {
  if (!(target instanceof HTMLElement)) return false;
  let el: HTMLElement | null = target;
  while (el && el !== boundary) {
    // Only defer horizontal dragging to elements that genuinely scroll
    // horizontally (code blocks, wide tables, or explicit horizontal strips),
    // never to vertical scroll containers whose computed overflow-x is "auto".
    const style = window.getComputedStyle(el);
    const overflowX = style.overflowX;
    const isExplicitHorizontal =
      el.tagName === "PRE" ||
      el.tagName === "TABLE" ||
      el.hasAttribute("data-scroll-x") ||
      overflowX === "scroll";
    if (
      isExplicitHorizontal &&
      (overflowX === "auto" || overflowX === "scroll") &&
      el.scrollWidth > el.clientWidth + 6
    ) {
      const maxScroll = el.scrollWidth - el.clientWidth;
      const isRtl = style.direction === "rtl";
      const pos = Math.abs(el.scrollLeft);
      if (isRtl) {
        if (dx > 0 && pos < maxScroll - 2) return true;
        if (dx < 0 && pos > 2) return true;
      } else {
        if (dx < 0 && pos < maxScroll - 2) return true;
        if (dx > 0 && pos > 2) return true;
      }
    }
    el = el.parentElement;
  }
  return false;
}

export function MobilePreviewPager({
  enabled,
  open,
  onOpenChange,
  dir,
  main,
  preview,
}: MobilePreviewPagerProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const enabledRef = React.useRef(enabled);
  enabledRef.current = enabled;
  const openRef = React.useRef(open);
  openRef.current = open;
  const onOpenChangeRef = React.useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  const manualDragRef = React.useRef(false);
  const programmaticRef = React.useRef(false);
  const settleTimerRef = React.useRef<number>(0);

  const setDraggingAttr = React.useCallback((active: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    if (active) el.setAttribute("data-pager-dragging", "true");
    else el.removeAttribute("data-pager-dragging");
  }, []);

  const scrollToSlide = React.useCallback((targetOpen: boolean, smooth: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    const width = el.clientWidth || window.innerWidth || 0;
    const targetLeft = enabledRef.current && targetOpen ? width : 0;
    if (Math.abs(el.scrollLeft - targetLeft) < 2) {
      el.style.scrollSnapType = "";
      programmaticRef.current = false;
      return;
    }
    programmaticRef.current = true;
    el.style.scrollSnapType = "";
    el.scrollTo({ left: targetLeft, behavior: smooth ? "smooth" : "auto" });
    window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(() => {
      programmaticRef.current = false;
    }, smooth ? 420 : 60);
  }, []);

  // Reset scroll to Slide 0 immediately whenever preview mode is turned off.
  React.useEffect(() => {
    if (!enabled) {
      const el = scrollRef.current;
      if (el) el.scrollLeft = 0;
    }
  }, [enabled]);

  // Sync programmatic state changes (ArtifactCard click, Back button, Escape, etc.)
  const prevOpenRef = React.useRef(open);
  React.useEffect(() => {
    const prev = prevOpenRef.current;
    prevOpenRef.current = open;
    if (!enabled || manualDragRef.current) return;
    if (prev !== open) {
      scrollToSlide(open, true);
    } else if (open) {
      scrollToSlide(true, false);
    }
  }, [enabled, open, scrollToSlide]);

  // Keep current slide aligned on viewport resize / orientation change.
  React.useEffect(() => {
    if (!enabled) return;
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (manualDragRef.current) return;
      const w = el.clientWidth;
      if (w > 0) {
        el.scrollLeft = openRef.current ? w : 0;
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled]);

  // Sync React `open` state whenever native scroll-snap settles on Slide 0 or Slide 1.
  React.useEffect(() => {
    if (!enabled) return;
    const el = scrollRef.current;
    if (!el) return;
    let debounceId = 0;

    const syncFromScroll = () => {
      if (manualDragRef.current || programmaticRef.current) return;
      const w = el.clientWidth;
      if (w <= 0) return;
      const ratio = el.scrollLeft / w;
      if (ratio >= 0.85 && !openRef.current) {
        prevOpenRef.current = true;
        onOpenChangeRef.current(true);
      } else if (ratio <= 0.15 && openRef.current) {
        prevOpenRef.current = false;
        onOpenChangeRef.current(false);
      }
    };

    const onScroll = () => {
      window.clearTimeout(debounceId);
      debounceId = window.setTimeout(syncFromScroll, 90);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("scrollend", syncFromScroll);
    return () => {
      window.clearTimeout(debounceId);
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("scrollend", syncFromScroll);
    };
  }, [enabled]);

  // Escape key returns smoothly to chat when preview is open.
  React.useEffect(() => {
    if (!enabled || !open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isBlockingOverlayOpen()) {
        onOpenChangeRef.current(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, open]);

  // Bridge live 1:1 left-to-right swipes started directly inside the preview iframe.
  React.useEffect(() => {
    if (!enabled) return;
    const el = scrollRef.current;
    if (!el) return;
    let iframeStartLeft = 0;
    let iframeWidth = 1;

    const onMessage = (event: MessageEvent) => {
      const data = event.data as
        | { __ohPager?: boolean; phase?: "start" | "move" | "end"; dx?: number; vx?: number; cancel?: boolean }
        | null;
      if (!data || !data.__ohPager) return;

      if (data.phase === "start") {
        if (!openRef.current) return;
        manualDragRef.current = true;
        iframeWidth = el.clientWidth || window.innerWidth || 1;
        iframeStartLeft = el.scrollLeft || iframeWidth;
        el.style.scrollSnapType = "none";
        setDraggingAttr(true);
      } else if (data.phase === "move") {
        if (!manualDragRef.current) return;
        const dx = typeof data.dx === "number" ? data.dx : 0;
        const nextLeft = Math.max(0, Math.min(iframeWidth, iframeStartLeft - dx));
        el.scrollLeft = nextLeft;
      } else if (data.phase === "end") {
        if (!manualDragRef.current) return;
        const dx = typeof data.dx === "number" ? data.dx : 0;
        const vx = typeof data.vx === "number" ? data.vx : 0;
        const shouldClose =
          !data.cancel &&
          (dx > iframeWidth * COMMIT_RATIO || (vx > FLICK_VELOCITY && dx > 20));
        manualDragRef.current = false;
        setDraggingAttr(false);
        const nextOpen = !shouldClose;
        scrollToSlide(nextOpen, true);
        if (nextOpen !== openRef.current) {
          prevOpenRef.current = nextOpen;
          onOpenChangeRef.current(nextOpen);
        }
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [enabled, scrollToSlide, setDraggingAttr]);

  // Real-time 1:1 mouse drag-to-scroll for narrow desktop windows / browser preview.
  // (Touchscreens & trackpads already use the browser's native 1:1 compositor scroll!)
  React.useEffect(() => {
    if (!enabled) return;
    const el = scrollRef.current;
    if (!el) return;

    type Lock = "idle" | "pending" | "horizontal" | "vertical";
    let lock: Lock = "idle";
    let startX = 0;
    let startY = 0;
    let dragOriginX = 0;
    let startScrollLeft = 0;
    let lastX = 0;
    let lastTime = 0;
    let velocity = 0;
    let width = 1;
    let startTarget: EventTarget | null = null;
    let suppressClickUntil = 0;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (isBlockingOverlayOpen() || isInteractiveInput(e.target)) return;
      if (e.target instanceof HTMLElement && e.target.closest("pre, code")) return;

      lock = "pending";
      startX = e.clientX;
      startY = e.clientY;
      dragOriginX = e.clientX;
      lastX = e.clientX;
      lastTime = performance.now();
      velocity = 0;
      width = el.clientWidth || window.innerWidth || 1;
      startScrollLeft = el.scrollLeft;
      startTarget = e.target;
    };

    const onDragStart = (e: DragEvent) => {
      if (lock === "pending" || lock === "horizontal") {
        e.preventDefault();
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (lock === "idle" || lock === "vertical") return;
      // If mouse button was released outside the window, settle cleanly.
      if ((e.buttons & 1) === 0) {
        onMouseUp(e);
        return;
      }
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (lock === "pending") {
        if (Math.hypot(dx, dy) < 6) return;
        if (Math.abs(dy) > Math.abs(dx) * 1.15) {
          lock = "vertical";
          return;
        }
        if (canAncestorScrollHorizontally(startTarget, el, dx)) {
          lock = "vertical";
          return;
        }
        lock = "horizontal";
        manualDragRef.current = true;
        dragOriginX = e.clientX;
        startScrollLeft = el.scrollLeft;
        lastX = e.clientX;
        lastTime = performance.now();
        el.style.scrollSnapType = "none";
        setDraggingAttr(true);
        window.getSelection()?.removeAllRanges();
      }

      if (lock === "horizontal") {
        e.preventDefault();
        window.getSelection()?.removeAllRanges();
        const now = performance.now();
        const dt = Math.max(1, now - lastTime);
        velocity = velocity * 0.45 + ((e.clientX - lastX) / dt) * 0.55;
        lastX = e.clientX;
        lastTime = now;

        const nextLeft = Math.max(
          0,
          Math.min(width, startScrollLeft - (e.clientX - dragOriginX)),
        );
        el.scrollLeft = nextLeft;
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (lock === "horizontal") {
        const delta = e.clientX - dragOriginX;
        const startOpen = startScrollLeft > width * 0.5;
        const passedDistance = Math.abs(delta) > width * COMMIT_RATIO;
        const passedFlick = !startOpen
          ? velocity < -FLICK_VELOCITY && delta < -18
          : velocity > FLICK_VELOCITY && delta > 18;
        const commit = passedDistance || passedFlick;
        const nextOpen = startOpen ? !commit : commit;

        manualDragRef.current = false;
        setDraggingAttr(false);
        suppressClickUntil = performance.now() + 120;
        scrollToSlide(nextOpen, true);
        if (nextOpen !== openRef.current) {
          prevOpenRef.current = nextOpen;
          onOpenChangeRef.current(nextOpen);
        }
      }
      lock = "idle";
      startTarget = null;
    };

    const onClickCapture = (e: MouseEvent) => {
      if (performance.now() < suppressClickUntil) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    el.addEventListener("mousedown", onMouseDown);
    el.addEventListener("dragstart", onDragStart);
    el.addEventListener("click", onClickCapture, true);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      el.removeEventListener("mousedown", onMouseDown);
      el.removeEventListener("dragstart", onDragStart);
      el.removeEventListener("click", onClickCapture, true);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [enabled, scrollToSlide, setDraggingAttr]);

  React.useEffect(() => {
    return () => {
      window.clearTimeout(settleTimerRef.current);
    };
  }, []);

  return (
    <div
      ref={scrollRef}
      dir="ltr"
      className={
        enabled
          ? "oh-mobile-pager relative z-10 flex h-full min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
          : "relative z-10 flex h-full min-h-0 min-w-0 flex-1"
      }
    >
      {/* Slide 0: Main Chat Screen (never unmounts when preview activates) */}
      <div
        dir={dir}
        className={
          enabled
            ? "oh-mobile-pager-slide relative flex h-full w-full shrink-0 flex-col"
            : "relative flex h-full w-full shrink-0 flex-col"
        }
      >
        {main}
      </div>

      {/* Slide 1: Full-Screen Preview Page (mounted ONLY when backend enables preview) */}
      {enabled ? (
        <div
          dir={dir}
          className="oh-mobile-pager-slide relative flex h-full w-full shrink-0 flex-col border-l border-[var(--border)] bg-[color-mix(in_oklab,var(--background)_82%,transparent)] backdrop-blur-2xl"
        >
          {preview}
        </div>
      ) : null}
    </div>
  );
}
