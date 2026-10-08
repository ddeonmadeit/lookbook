import { useEffect, useRef, useState, type RefObject } from "react";

/** How far (px) the content must be pulled before letting go refreshes. */
export const PULL_THRESHOLD = 64;
const MAX_PULL = 96;

/**
 * Pull-to-refresh for a scrolling element on touch screens, like a native app.
 * Installed to the home screen there is no browser reload button, so this is
 * how the owner gets fresh orders. Only starts when the element is scrolled to
 * the very top, so normal scrolling is never hijacked.
 *
 * Returns how far the content is currently pulled (for the indicator) and
 * whether a refresh is running.
 */
export function usePullToRefresh(ref: RefObject<HTMLElement>, onRefresh: () => Promise<void> | void) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(onRefresh);
  latest.current = onRefresh;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let startY: number | null = null;
    let distance = 0;
    let busy = false;

    const onStart = (e: TouchEvent) => {
      startY = !busy && el.scrollTop <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null;
      distance = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (startY === null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0 || el.scrollTop > 0) {
        if (distance) setPull(0);
        distance = 0;
        return;
      }
      // Resistance, so it feels like stretching rather than dragging.
      distance = Math.min(MAX_PULL, dy * 0.5);
      setPull(distance);
      if (e.cancelable) e.preventDefault();
    };
    const onEnd = async () => {
      if (startY === null) return;
      startY = null;
      const pulled = distance;
      distance = 0;
      if (pulled < PULL_THRESHOLD) {
        setPull(0);
        return;
      }
      busy = true;
      setRefreshing(true);
      setPull(PULL_THRESHOLD * 0.75);
      try {
        // Long enough to see that something happened, even when the data comes back instantly.
        await Promise.all([latest.current(), new Promise((r) => setTimeout(r, 600))]);
      } finally {
        busy = false;
        setRefreshing(false);
        setPull(0);
      }
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [ref]);

  return { pull, refreshing };
}
