/**
 * Utility functions for normalizing and formatting labels
 */

/**
 * Normalize a label by replacing underscores with spaces and capitalizing first letter
 * @param label - Raw label from backend (e.g., "red_deer", "animal", "vehicle")
 * @returns Normalized label (e.g., "Red deer", "Animal", "Vehicle")
 */
export const normalizeLabel = (label: string): string => {
  return label.replace(/_/g, ' ').replace(/\b\w/, l => l.toUpperCase());
};

/**
 * Labels the detector produces that are not wildlife species.
 *
 * Kept here so "which labels are not a species" has one definition. Pages use
 * it differently: the performance page marks these rows and leaves them out of
 * its averages, the group size page drops them from the picker entirely.
 * The backend excludes them too, see NON_WILDLIFE_LABELS in
 * shared/shared/independence_filter.py.
 */
export const DETECTOR_CATEGORIES = new Set(['empty', 'person', 'vehicle']);

/** True when the label is a real species rather than a detector category. */
export const isWildlifeLabel = (label: string): boolean =>
  !DETECTOR_CATEGORIES.has(label.toLowerCase());
