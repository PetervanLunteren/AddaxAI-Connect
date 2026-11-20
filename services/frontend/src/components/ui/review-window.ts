/**
 * The frame of a review window that shows one item at a time with the
 * evidence left and the answer right: image verification and the camera
 * updates check. One class, so the two keep the same size, padding and
 * corners. Each window adds its own layout (scrolling, grid) to it.
 */
export const REVIEW_WINDOW_CLASS =
  'bg-background p-3 sm:p-6 rounded-lg shadow-lg w-[calc(100vw-1rem)] sm:w-full sm:max-w-7xl ' +
  'max-h-[calc(100dvh_-_env(safe-area-inset-top)_-_1rem)] sm:max-h-[90vh]';
