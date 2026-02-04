/**
 * Camera color utilities for consistent styling across table and map views
 */
import type { Camera } from '../api/types';

// Status colors matching the app's color palette
export const STATUS_COLORS = {
  active: '#0f6064',
  inactive: '#882000',
  never_reported: '#71b7ba',
} as const;

export const STATUS_LABELS = {
  active: 'Active',
  inactive: 'Inactive',
  never_reported: 'Never reported',
} as const;

// Unknown/null value color
export const UNKNOWN_COLOR = '#9ca3af';

export type ColorByMetric = 'status' | 'battery' | 'signal';

/**
 * Get color for camera status
 */
export function getStatusColor(status: string): string {
  return STATUS_COLORS[status as keyof typeof STATUS_COLORS] || UNKNOWN_COLOR;
}

/**
 * Get color for battery percentage
 * >70% = good (teal), 40-70% = medium (light teal), <40% = bad (red)
 */
export function getBatteryColor(percentage: number | null): string {
  if (percentage === null) return UNKNOWN_COLOR;
  if (percentage > 70) return '#0f6064';
  if (percentage > 40) return '#71b7ba';
  return '#882000';
}

/**
 * Get color for signal quality (CSQ value)
 * >=15 = good, 10-15 = medium, <10 = poor
 */
export function getSignalColor(csq: number | null): string {
  if (csq === null) return UNKNOWN_COLOR;
  if (csq >= 15) return '#0f6064';
  if (csq >= 10) return '#71b7ba';
  return '#882000';
}

/**
 * Get marker color for a camera based on the selected metric
 */
export function getCameraMarkerColor(
  camera: Camera,
  colorBy: ColorByMetric
): string {
  switch (colorBy) {
    case 'status':
      return getStatusColor(camera.status);
    case 'battery':
      return getBatteryColor(camera.battery_percentage);
    case 'signal':
      return getSignalColor(camera.signal_quality);
  }
}

/**
 * Legend items for each color-by metric
 */
export interface LegendItem {
  color: string;
  label: string;
}

export function getLegendItems(colorBy: ColorByMetric): LegendItem[] {
  switch (colorBy) {
    case 'status':
      return [
        { color: STATUS_COLORS.active, label: 'Active' },
        { color: STATUS_COLORS.inactive, label: 'Inactive' },
        { color: STATUS_COLORS.never_reported, label: 'Never reported' },
      ];
    case 'battery':
      return [
        { color: '#0f6064', label: 'Good (>70%)' },
        { color: '#71b7ba', label: 'Medium (40-70%)' },
        { color: '#882000', label: 'Low (<40%)' },
        { color: UNKNOWN_COLOR, label: 'Unknown' },
      ];
    case 'signal':
      return [
        { color: '#0f6064', label: 'Good (\u226515)' },
        { color: '#71b7ba', label: 'Medium (10-15)' },
        { color: '#882000', label: 'Poor (<10)' },
        { color: UNKNOWN_COLOR, label: 'Unknown' },
      ];
  }
}
