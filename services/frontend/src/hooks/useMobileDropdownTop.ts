import { useEffect, useState, RefObject } from 'react';

/**
 * Measure the bottom edge of a trigger element so a fixed-position dropdown
 * can drop down right below it on mobile, regardless of where the button
 * sits horizontally on the page. Returns null on screens >= sm so desktop
 * stays on its normal absolute-flow positioning.
 */
export function useMobileDropdownTop(
  triggerRef: RefObject<HTMLElement>,
  isOpen: boolean,
  gapPx: number = 8
): number | null {
  const [top, setTop] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setTop(null);
      return;
    }
    const update = () => {
      if (!triggerRef.current) return;
      const mq = window.matchMedia('(max-width: 639px)');
      if (mq.matches) {
        const rect = triggerRef.current.getBoundingClientRect();
        setTop(rect.bottom + gapPx);
      } else {
        setTop(null);
      }
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [isOpen, triggerRef, gapPx]);

  return top;
}
