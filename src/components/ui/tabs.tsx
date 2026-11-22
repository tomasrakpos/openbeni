"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ComponentPropsWithoutRef } from "react";
import {
  ChevronLeft as NavArrowLeft,
  ChevronRight as NavArrowRight,
} from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { motionTokens } from "@/components/ui/tabs-utils/motion-tokens";
import styles from "@/components/ui/tabs-utils/tabs.module.css";

type RootProps = ComponentPropsWithoutRef<typeof TabsPrimitive.Root>;

const TabsContext = createContext<{
  active: string;
  hasSwitched: boolean;
}>({
  active: "",
  hasSwitched: false,
});

export function Tabs({
  value,
  defaultValue,
  onValueChange,
  className,
  ...props
}: RootProps) {
  const [internal, setInternal] = useState(defaultValue ?? "");
  const [hasSwitched, setHasSwitched] = useState(false);
  const active = value ?? internal;
  const root = useRef<HTMLDivElement>(null);

  function handleChange(next: string) {
    if (next !== active) setHasSwitched(true);
    if (value === undefined) setInternal(next);
    onValueChange?.(next);
  }

  return (
    <TabsContext.Provider value={{ active, hasSwitched }}>
      <TabsPrimitive.Root
        {...props}
        ref={root}
        className={[styles.root, className].filter(Boolean).join(" ")}
        value={active}
        onValueChange={handleChange}
      />
    </TabsContext.Provider>
  );
}

interface PillRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function TabsList({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  const { active } = useContext(TabsContext);
  const reduced = useReducedMotion();
  const shell = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const hasMeasuredRef = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const [pill, setPill] = useState<PillRect | null>(null);
  const [instant, setInstant] = useState(true);
  const [edges, setEdges] = useState({
    overflow: false,
    left: false,
    right: false,
  });

  const measurePill = useCallback((shouldAnimate: boolean) => {
    const listEl = list.current;
    if (!listEl) return;
    const currentActive = activeRef.current;
    const activeTab =
      (currentActive
        ? listEl.querySelector<HTMLElement>(
            `[role="tab"][data-value="${CSS.escape(currentActive)}"]`,
          )
        : null) ??
      listEl.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
    if (!activeTab) return;

    // Local offsetLeft/offsetTop/offsetWidth/offsetHeight inside `.list`
    // are immune to ancestor CSS transforms (scale, translate, dialog zoom)
    // and work identically in LTR and RTL without layoutId projection jumps.
    const next: PillRect = {
      left: activeTab.offsetLeft,
      top: activeTab.offsetTop,
      width: activeTab.offsetWidth,
      height: activeTab.offsetHeight,
    };
    if (next.width <= 0 || next.height <= 0) return;

    const first = !hasMeasuredRef.current;
    hasMeasuredRef.current = true;
    setPill((prev) => {
      if (
        prev &&
        prev.left === next.left &&
        prev.top === next.top &&
        prev.width === next.width &&
        prev.height === next.height
      ) {
        return prev;
      }
      setInstant(first || !shouldAnimate);
      return next;
    });
  }, []);

  const updateEdges = useCallback(() => {
    const frame = shell.current;
    const scroll = viewport.current;
    if (!frame || !scroll) return;
    const max = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
    const next = {
      overflow: scroll.scrollWidth > frame.clientWidth + 1,
      left: scroll.scrollLeft > 1,
      right: scroll.scrollLeft < max - 1,
    };
    setEdges((previous) =>
      previous.overflow === next.overflow &&
      previous.left === next.left &&
      previous.right === next.right
        ? previous
        : next,
    );
  }, []);

  const reveal = useCallback(
    (tab: HTMLElement | null) => {
      const scroll = viewport.current;
      if (!scroll || !tab) return;
      const frame = scroll.getBoundingClientRect();
      const item = tab.getBoundingClientRect();
      const max = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
      const left = frame.left + (scroll.scrollLeft > 1 ? 34 : 0);
      const right = frame.right - (scroll.scrollLeft < max - 1 ? 34 : 0);
      const delta =
        item.left < left
          ? item.left - left
          : item.right > right
            ? item.right - right
            : 0;
      if (delta) {
        scroll.scrollBy({
          left: delta,
          behavior: reduced ? "instant" : "smooth",
        });
      }
    },
    [reduced],
  );

  useLayoutEffect(() => {
    const frame = shell.current;
    const scroll = viewport.current;
    const content = list.current;
    if (!frame || !scroll || !content) return;

    const observer = new ResizeObserver(() => {
      updateEdges();
      measurePill(false);
    });
    observer.observe(frame);
    observer.observe(scroll);
    observer.observe(content);

    const onScroll = () => updateEdges();
    scroll.addEventListener("scroll", onScroll, { passive: true });
    updateEdges();
    measurePill(false);

    return () => {
      observer.disconnect();
      scroll.removeEventListener("scroll", onScroll);
    };
  }, [updateEdges, measurePill]);

  useLayoutEffect(() => {
    measurePill(true);
    const raf = requestAnimationFrame(() => {
      reveal(
        list.current?.querySelector<HTMLElement>(
          '[role="tab"][data-state="active"]',
        ) ?? null,
      );
    });
    return () => cancelAnimationFrame(raf);
  }, [active, measurePill, reveal]);

  const scrollTabs = (dir: number) =>
    viewport.current?.scrollBy({
      left: dir * (viewport.current?.clientWidth ?? 0) * 0.75,
      behavior: reduced ? "instant" : "smooth",
    });

  return (
    <div
      ref={shell}
      className={styles.listShell}
      data-overflow={edges.overflow}
      data-left={edges.left}
      data-right={edges.right}
    >
      {edges.overflow && (
        <button
          type="button"
          className={`${styles.scrollButton} ${styles.scrollLeft}`}
          aria-label="Scroll tabs left"
          disabled={!edges.left}
          onClick={() => scrollTabs(-1)}
        >
          <NavArrowLeft width={17} height={17} aria-hidden="true" />
        </button>
      )}
      <div
        ref={viewport}
        className={styles.viewport}
        onFocusCapture={(event) => {
          if (
            event.target instanceof HTMLElement &&
            event.target.getAttribute("role") === "tab"
          ) {
            reveal(event.target);
          }
        }}
      >
        <TabsPrimitive.List
          {...props}
          ref={list}
          className={[styles.list, className].filter(Boolean).join(" ")}
        >
          {pill ? (
            <motion.span
              className={styles.selection}
              aria-hidden="true"
              initial={false}
              animate={{
                x: pill.left,
                y: pill.top,
                width: pill.width,
                height: pill.height,
              }}
              transition={
                reduced || instant ? { duration: 0 } : motionTokens.spring.morph
              }
            />
          ) : null}
          {children}
        </TabsPrimitive.List>
      </div>
      {edges.overflow && (
        <button
          type="button"
          className={`${styles.scrollButton} ${styles.scrollRight}`}
          aria-label="Scroll tabs right"
          disabled={!edges.right}
          onClick={() => scrollTabs(1)}
        >
          <NavArrowRight width={17} height={17} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export function TabsTrigger({
  className,
  children,
  value,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      {...props}
      value={value}
      data-value={value}
      className={[styles.trigger, className].filter(Boolean).join(" ")}
    >
      <span className={styles.triggerLabel}>{children}</span>
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({
  className,
  value,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.Content>) {
  const { hasSwitched } = useContext(TabsContext);
  const reduced = useReducedMotion();
  const classes = [styles.content, className].filter(Boolean).join(" ");

  return (
    <TabsPrimitive.Content {...props} value={value} className={classes}>
      <motion.div
        key={value}
        initial={!hasSwitched || reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{
          duration: reduced ? 0 : motionTokens.duration.standard,
          ease: [...motionTokens.ease.enter],
        }}
      >
        {children}
      </motion.div>
    </TabsPrimitive.Content>
  );
}

export default Tabs;
