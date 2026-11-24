/**
 * Camera health color utilities for consistent styling across the cameras
 * table, the camera status badge, and the sites map (which colours each site
 * by the worst camera there).
 */
import { ALERT_COLOR } from '../components/map/marker-style';

// Status colors. Red is the shared alert red of the maps (marker-style.ts),
// bright enough to read on satellite imagery too; the old dark red sank.
export const STATUS_COLORS = {
  active: '#0f6064',
  inactive: ALERT_COLOR,
  never_reported: '#71b7ba',
  // Grey on purpose, a retired camera is neither good nor bad news.
  retired: '#9ca3af',
} as const;

export const STATUS_LABELS = {
  active: 'Active',
  inactive: 'Inactive',
  never_reported: 'No live signal yet',
  retired: 'Retired',
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

// The server's limits (LOW_BATTERY_PERCENT and SD_NEARLY_FULL_PERCENT in
// shared/camera_status.py). Kept here for the colour scales only: the sites
// map colours a site by its lowest battery, a number, not a camera. Every
// warning and filter reads the camera flags instead.
const LOW_BATTERY_PERCENT = 30;
const SD_NEARLY_FULL_PERCENT = 80;

/**
 * Get color for battery percentage
 * >70% = good (teal), 30-70% = medium (light teal), <30% = low (red)
 */
export function getBatteryColor(percentage: number | null): string {
  if (percentage === null) return UNKNOWN_COLOR;
  if (percentage > 70) return '#0f6064';
  if (percentage >= LOW_BATTERY_PERCENT) return '#71b7ba';
  return ALERT_COLOR;
}

/** SD card use: under 50% teal, up to 80% light teal, over 80% red. */
export function getSdColor(percentage: number | null): string {
  if (percentage === null) return UNKNOWN_COLOR;
  if (percentage < 50) return '#0f6064';
  if (percentage <= SD_NEARLY_FULL_PERCENT) return '#71b7ba';
  return ALERT_COLOR;
}

/** How long ago a camera-clock time was: a day teal, a week light teal,
 *  older red. */
export function getTimestampColor(timestamp: string | null): string {
  if (!timestamp) return UNKNOWN_COLOR;
  const days = Math.floor((Date.now() - new Date(timestamp).getTime()) / 86400000);
  if (days <= 1) return '#0f6064';
  if (days <= 7) return '#71b7ba';
  return ALERT_COLOR;
}

/**
 * Get color for signal quality (CSQ value)
 * >=15 = good, 10-15 = medium, <10 = poor
 */
export function getSignalColor(csq: number | null): string {
  if (csq === null) return UNKNOWN_COLOR;
  if (csq >= 15) return '#0f6064';
  if (csq >= 10) return '#71b7ba';
  return ALERT_COLOR;
}

/**
 * Human label for a raw cellular signal quality value (CSQ, 0-31).
 * The number alone means nothing to a user, so map it to words.
 */
export function getSignalLabel(csq: number | null): string {
  if (csq === null) return 'N/A';
  if (csq >= 20) return 'Excellent';
  if (csq >= 15) return 'Good';
  if (csq >= 10) return 'Fair';
  if (csq >= 2) return 'Poor';
  return 'No signal';
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
        { color: STATUS_COLORS.never_reported, label: 'No live signal yet' },
        { color: STATUS_COLORS.retired, label: 'Retired' },
      ];
    case 'battery':
      return [
        { color: '#0f6064', label: 'Good (>70%)' },
        { color: '#71b7ba', label: 'Medium (30-70%)' },
        { color: ALERT_COLOR, label: 'Low (<30%)' },
        { color: UNKNOWN_COLOR, label: 'Unknown' },
      ];
    case 'signal':
      return [
        { color: '#0f6064', label: 'Good (\u226515)' },
        { color: '#71b7ba', label: 'Medium (10-15)' },
        { color: ALERT_COLOR, label: 'Poor (<10)' },
        { color: UNKNOWN_COLOR, label: 'Unknown' },
      ];
  }
}
