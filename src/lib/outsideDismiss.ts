// Unified outside-tap / outside-click dismissal helper for menus & popovers.
// Works reliably on mobile (iOS Safari, Android WebView, Chrome) and desktop:
// - Listens in capture phase so inner stopPropagation() never blocks dismissal
// - Covers pointerdown, touchstart, and mousedown with a short dedupe guard
// - Also dismisses when focus moves into an embedded <iframe> (e.g. live preview)

export interface OutsideDismissOptions {
  /** Return true when `target` is inside the menu/popover or its trigger. */
  isInside: (target: Node, path?: EventTarget[]) => boolean;
  /** Called once when the user taps/clicks outside. */
  onDismiss: () => void;
  /** Optional predicate; dismissal only fires while this returns true. */
  isActive?: () => boolean;
}

export function attachOutsideDismiss({
  isInside,
  onDismiss,
  isActive = () => true,
}: OutsideDismissOptions): () => void {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return () => {};
  }

  let lastHandledAt = 0;

  const handleEvent = (event: Event) => {
    if (!isActive()) return;
    const now = performance.now();
    if (now - lastHandledAt < 80) return;

    const target = event.target as Node | null;
    if (!target) return;
    const path = typeof event.composedPath === "function" ? event.composedPath() : undefined;
    if (isInside(target, path)) return;

    lastHandledAt = now;
    onDismiss();
  };

  const handleWindowBlur = () => {
    if (!isActive()) return;
    // Defer one microtask/tick so document.activeElement updates to the focused iframe.
    window.setTimeout(() => {
      if (!isActive()) return;
      const active = document.activeElement;
      if (active && active.tagName === "IFRAME") {
        onDismiss();
      }
    }, 0);
  };

  document.addEventListener("pointerdown", handleEvent, true);
  document.addEventListener("touchstart", handleEvent, { capture: true, passive: true });
  document.addEventListener("mousedown", handleEvent, true);
  window.addEventListener("blur", handleWindowBlur);

  return () => {
    document.removeEventListener("pointerdown", handleEvent, true);
    document.removeEventListener("touchstart", handleEvent, true);
    document.removeEventListener("mousedown", handleEvent, true);
    window.removeEventListener("blur", handleWindowBlur);
  };
}
