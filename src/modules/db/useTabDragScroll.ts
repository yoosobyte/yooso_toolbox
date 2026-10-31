import { useRef } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

/** 页签栏按住拖动横向滚动，并抑制拖动结束后的点击 */
export default function useTabDragScroll() {
  const tabsBarRef = useRef<HTMLDivElement | null>(null);
  const tabDragRef = useRef<{
    startX: number;
    startScroll: number;
    moved: boolean;
    pointerId: number;
  } | null>(null);
  const suppressTabClickRef = useRef(false);

  const onTabsPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const bar = tabsBarRef.current;
    if (!bar) return;
    suppressTabClickRef.current = false;
    tabDragRef.current = {
      startX: event.clientX,
      startScroll: bar.scrollLeft,
      moved: false,
      pointerId: event.pointerId,
    };
  };

  const onTabsPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = tabDragRef.current;
    const bar = tabsBarRef.current;
    if (!drag || !bar) return;
    const delta = event.clientX - drag.startX;
    if (Math.abs(delta) > 4 && !drag.moved) {
      drag.moved = true;
      bar.setPointerCapture(drag.pointerId);
    }
    if (drag.moved) {
      event.preventDefault();
      bar.scrollLeft = drag.startScroll - delta;
    }
  };

  const onTabsPointerUp = () => {
    const drag = tabDragRef.current;
    const bar = tabsBarRef.current;
    if (!drag) return;
    if (drag.moved) suppressTabClickRef.current = true;
    try {
      bar?.releasePointerCapture(drag.pointerId);
    } catch {
      // pointer capture may already be released
    }
    tabDragRef.current = null;
  };

  const onTabsClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!suppressTabClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressTabClickRef.current = false;
  };

  return {
    tabsBarRef,
    onTabsPointerDown,
    onTabsPointerMove,
    onTabsPointerUp,
    onTabsClickCapture,
  };
}
