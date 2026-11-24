import { describe, expect, it } from "vitest";
import { ChatAutoScrollController } from "@/features/chat/autoScroll";

describe("ChatAutoScrollController (website build streaming scroll lock fix)", () => {
  it("never snaps back after the user pulls up by <120px with touch while build tasks stream in", () => {
    const ctrl = new ChatAutoScrollController();
    let now = 1000;
    const clientHeight = 600;
    let scrollHeight = 1600;
    let scrollTop = 1000;

    ctrl.resetForChat(scrollTop, now);
    expect(ctrl.canFollow()).toBe(true);

    // Advance past programmatic window
    now += 200;

    // User puts finger on screen and pulls upward by only 50px (previously snapped back under <120px)
    ctrl.onTouchStart(300);
    expect(ctrl.canFollow()).toBe(false); // Never auto-scroll while finger is on screen

    const detached = ctrl.onTouchMove(340); // Finger drags down -> viewport scrolls up
    expect(detached).toBe(true);
    expect(ctrl.stick).toBe(false);
    expect(ctrl.atBottom).toBe(false);

    scrollTop = 950;
    ctrl.onScroll(scrollTop, scrollHeight, clientHeight, now);
    expect(ctrl.canFollow()).toBe(false);

    // While finger is lifted and momentum scrolls further up, new ArtifactCard tasks arrive
    ctrl.onTouchEnd();
    scrollHeight += 180;
    expect(ctrl.canFollow()).toBe(false);

    now += 40;
    scrollTop = 820;
    ctrl.onScroll(scrollTop, scrollHeight, clientHeight, now);
    expect(ctrl.stick).toBe(false);
    expect(ctrl.atBottom).toBe(false);
    expect(ctrl.canFollow()).toBe(false);
  });

  it("detaches immediately on upward wheel or tiny upward scroll delta and only re-attaches when scrolling back down to bottom", () => {
    const ctrl = new ChatAutoScrollController();
    let now = 1000;
    const clientHeight = 600;
    let scrollHeight = 1600;

    ctrl.resetForChat(1000, now);
    now += 200;

    // Single upward mouse wheel tick
    expect(ctrl.onWheel(-30)).toBe(true);
    expect(ctrl.canFollow()).toBe(false);

    // Even if only 12px away from bottom (inside REATTACH_THRESHOLD_PX), an upward or stationary scroll must NOT re-attach
    ctrl.onScroll(988, scrollHeight, clientHeight, now);
    expect(ctrl.stick).toBe(false);
    ctrl.onScroll(988, scrollHeight, clientHeight, now + 20);
    expect(ctrl.stick).toBe(false);

    // Rapid streaming grows card height -> still detached
    scrollHeight += 240;
    expect(ctrl.canFollow()).toBe(false);

    // User deliberately scrolls DOWN to the new bottom (1840 - 600 = 1240)
    now += 200;
    ctrl.onScroll(1240, scrollHeight, clientHeight, now);
    expect(ctrl.stick).toBe(true);
    expect(ctrl.atBottom).toBe(true);
    expect(ctrl.canFollow()).toBe(true);
  });

  it("stays anchored when streaming grows scrollHeight without user upward scroll, and pauses during scrollbar drag", () => {
    const ctrl = new ChatAutoScrollController();
    let now = 1000;
    const clientHeight = 600;
    let scrollHeight = 1600;

    ctrl.resetForChat(1000, now);
    now += 200;

    // Streaming adds a task step; programmatic follow scrolls to bottom
    scrollHeight += 120;
    expect(ctrl.canFollow()).toBe(true);
    ctrl.markProgrammaticScroll(1120, 80, now);
    ctrl.onScroll(1120, scrollHeight, clientHeight, now + 10);
    expect(ctrl.stick).toBe(true);

    // User grabs scrollbar -> auto-follow pauses immediately
    ctrl.onScrollbarDragStart();
    expect(ctrl.canFollow()).toBe(false);

    now += 150;
    ctrl.onScroll(700, scrollHeight, clientHeight, now);
    ctrl.onScrollbarDragEnd();
    expect(ctrl.stick).toBe(false);
    expect(ctrl.canFollow()).toBe(false);
  });

  it("cancels an in-flight smooth scroll-to-bottom if the user pulls up mid-animation", () => {
    const ctrl = new ChatAutoScrollController();
    let now = 1000;
    ctrl.resetForChat(1000, now);
    now += 200;

    ctrl.detach();
    ctrl.markProgrammaticScroll(1500, 500, now);
    expect(ctrl.stick).toBe(true);

    // Mid smooth scroll, user pulls up with touch
    ctrl.onTouchStart(400);
    expect(ctrl.onTouchMove(420)).toBe(true);
    expect(ctrl.stick).toBe(false);
    expect(ctrl.canFollow()).toBe(false);
  });
});
