// chat feature: pure auto-scroll state machine for MessageList.
// Keeps the thread pinned to the bottom while streaming only until the user
// expresses any upward intent (touch pull, wheel up, scrollbar drag, or upward
// scroll delta), and re-attaches only when the user returns to the bottom.

export const REATTACH_THRESHOLD_PX = 28;
export const UPWARD_DETACH_DELTA_PX = 2;
export const TOUCH_PULL_UP_PX = 5;

export interface AutoScrollSnapshot {
  stick: boolean;
  atBottom: boolean;
  isTouching: boolean;
  isDraggingScrollbar: boolean;
}

export class ChatAutoScrollController {
  stick = true;
  atBottom = true;
  isTouching = false;
  isDraggingScrollbar = false;

  private touchStartY: number | null = null;
  private lastScrollTop = 0;
  private programmaticUntil = 0;

  resetForChat(scrollTop: number, now: number): void {
    this.stick = true;
    this.atBottom = true;
    this.isTouching = false;
    this.touchStartY = null;
    this.isDraggingScrollbar = false;
    this.lastScrollTop = Math.max(0, scrollTop);
    this.programmaticUntil = now + 80;
  }

  detach(): boolean {
    const changed = this.stick || this.atBottom;
    this.programmaticUntil = 0;
    this.stick = false;
    this.atBottom = false;
    return changed;
  }

  markProgrammaticScroll(targetTop: number, durationMs: number, now: number): void {
    this.stick = true;
    this.atBottom = true;
    this.programmaticUntil = now + durationMs;
    if (durationMs <= 100) {
      this.lastScrollTop = Math.max(0, targetTop);
    }
  }

  canFollow(): boolean {
    return this.stick && !this.isTouching && !this.isDraggingScrollbar;
  }

  onWheel(deltaY: number): boolean {
    if (deltaY < 0) return this.detach();
    return false;
  }

  onTouchStart(clientY: number | null): void {
    this.isTouching = true;
    this.touchStartY = clientY;
  }

  onTouchMove(clientY: number | null): boolean {
    if (clientY === null || this.touchStartY === null) return false;
    // Finger moving downward pulls the viewport upward toward earlier messages.
    if (clientY - this.touchStartY > TOUCH_PULL_UP_PX) {
      return this.detach();
    }
    // Track peak upward finger position so reversing direction mid-gesture detaches immediately.
    if (clientY < this.touchStartY) {
      this.touchStartY = clientY;
    }
    return false;
  }

  onTouchEnd(): void {
    this.isTouching = false;
    this.touchStartY = null;
  }

  onScrollbarDragStart(): void {
    this.isDraggingScrollbar = true;
  }

  onScrollbarDragEnd(): void {
    this.isDraggingScrollbar = false;
  }

  onScroll(scrollTop: number, scrollHeight: number, clientHeight: number, now: number): AutoScrollSnapshot {
    const currentTop = Math.max(0, scrollTop);
    const prevTop = this.lastScrollTop;
    this.lastScrollTop = currentTop;

    const maxScroll = Math.max(0, scrollHeight - clientHeight);
    const distance = Math.max(0, maxScroll - currentTop);
    const isProgrammatic = now < this.programmaticUntil;

    // Any genuine upward scroll immediately detaches so rapid streaming tokens or
    // growing build-step cards never yank the user back down.
    if (!isProgrammatic && currentTop < prevTop - UPWARD_DETACH_DELTA_PX) {
      this.detach();
      return this.snapshot();
    }

    if (distance <= REATTACH_THRESHOLD_PX) {
      // Only re-attach if already anchored or if the user actively scrolled DOWN to the bottom.
      if (this.stick || currentTop > prevTop) {
        this.stick = true;
        this.atBottom = true;
      }
    } else if (!isProgrammatic && currentTop !== prevTop) {
      this.stick = false;
      this.atBottom = false;
    }

    return this.snapshot();
  }

  snapshot(): AutoScrollSnapshot {
    return {
      stick: this.stick,
      atBottom: this.atBottom,
      isTouching: this.isTouching,
      isDraggingScrollbar: this.isDraggingScrollbar,
    };
  }
}
