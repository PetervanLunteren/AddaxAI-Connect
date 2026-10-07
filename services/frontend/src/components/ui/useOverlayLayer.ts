/**
 * Escape and page scroll lock for overlays (Dialog, Sheet), which can stack:
 * a confirm dialog over a bulk dialog, a dialog over a site sheet.
 *
 * Open overlays form a stack. Escape closes only the top one; every overlay
 * listened before, so one press closed the whole stack, or the wrong layer.
 * The page scroll lock is released when the last overlay closes, not when
 * any of them does.
 */
import { useEffect, useRef } from 'react';

const openLayers: object[] = [];

export function useOverlayLayer(open: boolean, onClose: () => void) {
  // A ref, so a parent re-render with a new callback does not re-run the
  // effect and move this layer to the top of the stack.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const layer = {};
    openLayers.push(layer);
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openLayers[openLayers.length - 1] === layer) {
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      openLayers.splice(openLayers.indexOf(layer), 1);
      if (openLayers.length === 0) document.body.style.overflow = '';
    };
  }, [open]);
}
