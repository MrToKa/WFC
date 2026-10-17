import { useLayoutEffect, useState, type RefObject } from 'react';

/** The project shell grows with its content; measure the slot instead of assuming a header height. */
export function availableViewerHeight(top: number, bottom: number, bottomPadding: number, fallbackTop?: number): number {
  const remaining = Math.max(0, Math.floor(bottom - top - bottomPadding));
  return remaining || (fallbackTop === undefined ? 0 : Math.max(0, Math.floor(bottom - fallbackTop - bottomPadding)));
}

export function useRoutingsViewerHeight(anchor: RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const element = anchor.current;
    if (!element) return;
    let frame = 0;
    let revealing = false;
    const measure = () => {
      frame = 0;
      const viewport = window.visualViewport;
      const bottom = viewport ? viewport.offsetTop + viewport.height : document.documentElement.clientHeight || window.innerHeight;
      let padding = 0;
      let headerBottom = viewport?.offsetTop ?? 0;
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        padding += Number.parseFloat(getComputedStyle(parent).paddingBottom) || 0;
        if (parent.id === 'app-root') {
          for (const sibling of parent.parentElement?.children ?? []) {
            if (sibling.tagName === 'HEADER') headerBottom = Math.max(headerBottom, sibling.getBoundingClientRect().bottom);
          }
          break;
        }
      }
      const top = element.getBoundingClientRect().top;
      const remaining = availableViewerHeight(top, bottom, padding);
      if (!remaining) revealing = true;
      // A wrapped header can initially put the slot below the screen. Preserve
      // measured scrollable space until it is revealed, rather than collapsing it.
      const next = revealing && top > headerBottom ? availableViewerHeight(bottom, bottom, padding, headerBottom) : remaining;
      if (top <= headerBottom) revealing = false;
      setHeight(previous => previous === next ? previous : next);
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(measure); };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    // Observe siblings/ancestors which move the slot, rather than our own height.
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      for (const sibling of parent.children) if (sibling !== element && !sibling.contains(element)) observer?.observe(sibling);
      if (parent.id === 'app-root') {
        observer?.observe(parent);
        for (const sibling of parent.parentElement?.children ?? []) if (sibling !== parent) observer?.observe(sibling);
        break;
      }
    }
    measure();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    return () => {
      observer?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, [anchor]);
  return height;
}
