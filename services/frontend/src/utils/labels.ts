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
