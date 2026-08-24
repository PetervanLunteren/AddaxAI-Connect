/**
 * Previous/next navigation for the image detail modal.
 *
 * One rule decides everything: where does the open image sit in the list?
 * The subtle case is an image that drops OUT of the list while the modal
 * is open. Saving a verification refetches the images list, and under a
 * filter like "Unverified" the just-saved image no longer matches, so a
 * plain indexOf turns -1 and every arrow would die (the v0.7.0 annotation
 * freeze). This hook remembers the image's last known position: the items
 * behind it shifted up one, so its old slot now holds the next image and
 * navigation keeps working.
 *
 * A shared link to an image that was never in the visible list still gets
 * no arrows, there is nothing meaningful to step to. The remembered
 * position is keyed to the uuid, so it cannot leak from one image to
 * another.
 */
import { useRef } from 'react';

interface ModalImageNavigationOptions {
  /** Uuids of the current list page, in display order. */
  uuids: string[];
  /** The image open in the modal, null when the modal is closed. */
  selectedUuid: string | null;
  /** Open another image of the list in the modal. */
  onSelect: (uuid: string) => void;
  /** True when a previous page exists to step back into. */
  canGoBeforeFirst?: boolean;
  /** True when a next page exists to step forward into. */
  canGoAfterLast?: boolean;
  /** Step to the previous page (the caller selects its last image). */
  onBeforeFirst?: () => void;
  /** Step to the next page (the caller selects its first image). */
  onAfterLast?: () => void;
}

interface ModalImageNavigation {
  hasPrevious: boolean;
  hasNext: boolean;
  goPrevious: () => void;
  goNext: () => void;
}

export function useModalImageNavigation({
  uuids,
  selectedUuid,
  onSelect,
  canGoBeforeFirst = false,
  canGoAfterLast = false,
  onBeforeFirst,
  onAfterLast,
}: ModalImageNavigationOptions): ModalImageNavigation {
  // Last position the open image was seen at. Survives the image dropping
  // out of a refetched list, cleared when the modal closes. Written during
  // render like the other snapshot refs in this codebase; the write is
  // idempotent so a repeated render is harmless.
  const lastKnownRef = useRef<{ uuid: string; index: number } | null>(null);

  const currentIndex = selectedUuid ? uuids.indexOf(selectedUuid) : -1;
  if (selectedUuid && currentIndex !== -1) {
    lastKnownRef.current = { uuid: selectedUuid, index: currentIndex };
  } else if (!selectedUuid) {
    lastKnownRef.current = null;
  }

  // The image was in this list and a refetch removed it (saved under a
  // filter it no longer matches). Distinct from a shared link, whose uuid
  // never had a known position.
  const dropped =
    selectedUuid !== null &&
    currentIndex === -1 &&
    lastKnownRef.current?.uuid === selectedUuid;

  // After a drop the items behind the image shifted up one, so its old
  // index IS the next image, and the one before it is still the previous.
  const nextIndex = dropped ? lastKnownRef.current!.index : currentIndex + 1;
  const previousIndex = dropped ? lastKnownRef.current!.index - 1 : currentIndex - 1;
  const inList = currentIndex !== -1 || dropped;

  const hasNext = inList && (nextIndex < uuids.length || canGoAfterLast);
  const hasPrevious = inList && (previousIndex >= 0 || canGoBeforeFirst);

  return {
    hasPrevious,
    hasNext,
    goPrevious: () => {
      if (!inList) return;
      if (previousIndex >= 0) {
        onSelect(uuids[previousIndex]);
      } else if (canGoBeforeFirst) {
        onBeforeFirst?.();
      }
    },
    goNext: () => {
      if (!inList) return;
      if (nextIndex < uuids.length) {
        onSelect(uuids[nextIndex]);
      } else if (canGoAfterLast) {
        onAfterLast?.();
      }
    },
  };
}
