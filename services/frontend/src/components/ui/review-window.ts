/**
 * The frame of a review window that shows one item at a time with the
 * evidence left and the answer right: image verification. The window adds
 * its own layout (scrolling, grid) to it.
 *
 * The width is set, not taken from the content: the dialog wrapper shrinks
 * to fit, so a window sized by its content grows when a photo loads, and a
 * map inside then keeps its first, narrower size.
 */
export const REVIEW_WINDOW_CLASS =
  'bg-background p-3 sm:p-6 rounded-lg shadow-lg w-[calc(100vw-1rem)] sm:w-[calc(100vw-2rem)] sm:max-w-7xl ' +
  'max-h-[calc(100dvh_-_env(safe-area-inset-top)_-_1rem)] sm:max-h-[90vh]';
