/**
 * The service-action vocabulary, its labels, and small helpers shared by
 * the Service page, its dialogs and the slide-out summaries.
 *
 * The value set mirrors ACTION_LABELS in services/api/routers/service.py;
 * a backend test pins it there.
 */
import type { MaintenanceActionType } from '../api/types';

export const ACTION_LABELS: Record<MaintenanceActionType, string> = {
  battery_change: 'Battery change',
  sd_card_swap: 'SD card swap',
  cleaning: 'Cleaning',
  vegetation_clearing: 'Vegetation clearing',
  inspection: 'Inspection / check',
  // In-place angle change only. Moving a camera to a new site is a
  // placement change, handled on the Placements tab, not here.
  angle_adjustment: 'Adjusted angle',
  repair: 'Repair',
  other: 'Other',
};

export const ACTION_TYPES = Object.keys(ACTION_LABELS) as MaintenanceActionType[];

// Keep in sync with NOTE_MAX_LENGTH in services/api/routers/service.py.
export const NOTE_MAX_LENGTH = 2000;

/** Today as YYYY-MM-DD in the browser's local timezone. toISOString()
 * would be UTC and one day off in the evening east of Greenwich. */
export function localToday(): string {
  return new Date().toLocaleDateString('sv');
}

/** A YYYY-MM-DD date as "20 Oct 2026", without timezone shifts. */
export function formatServiceDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
