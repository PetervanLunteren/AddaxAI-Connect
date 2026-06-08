/**
 * Site health aggregation for the Sites map.
 *
 * A site has no health of its own; it inherits the health of the cameras
 * currently deployed there. The map colours each site by its WORST camera, so
 * a single dead or low camera shows up at a glance. Cameras link to a site
 * through their current deployment, exposed on the camera as `current_site`.
 *
 * Reuses the camera colour thresholds so a site dot and a camera row speak the
 * same colour language.
 */
import type { Camera } from '../api/types';
import {
  getStatusColor,
  getBatteryColor,
  getSignalColor,
  UNKNOWN_COLOR,
  type ColorByMetric,
} from './camera-colors';

// 'none' shows plain place markers (the original sites map). The other modes
// overlay camera health.
export type SiteColorMode = ColorByMetric | 'none';

export interface SiteHealth {
  worstStatus: Camera['status'] | null;
  minBattery: number | null;
  minSignal: number | null;
  cameraCount: number;
}

// Higher number = more in need of attention. Inactive (was reporting, now
// silent) outranks never_reported (newly placed) outranks active.
const STATUS_SEVERITY: Record<Camera['status'], number> = {
  inactive: 2,
  never_reported: 1,
  active: 0,
};

/**
 * Group project cameras by their current site and reduce each group to its
 * worst-case health. Cameras with no site are skipped (they are not at a place).
 */
export function buildSiteHealth(cameras: Camera[]): Map<number, SiteHealth> {
  const bySite = new Map<number, SiteHealth>();
  for (const cam of cameras) {
    const siteId = cam.current_site?.id;
    if (siteId == null) continue;

    const cur =
      bySite.get(siteId) ??
      { worstStatus: null, minBattery: null, minSignal: null, cameraCount: 0 };

    cur.cameraCount += 1;
    if (cur.worstStatus === null || STATUS_SEVERITY[cam.status] > STATUS_SEVERITY[cur.worstStatus]) {
      cur.worstStatus = cam.status;
    }
    // Min over the cameras that actually report a value, so one silent camera
    // does not mask a real low reading from another.
    if (cam.battery_percentage != null) {
      cur.minBattery = cur.minBattery == null ? cam.battery_percentage : Math.min(cur.minBattery, cam.battery_percentage);
    }
    if (cam.signal_quality != null) {
      cur.minSignal = cur.minSignal == null ? cam.signal_quality : Math.min(cur.minSignal, cam.signal_quality);
    }
    bySite.set(siteId, cur);
  }
  return bySite;
}

/**
 * Colour for a site marker. `none` returns the plain place colour; a health
 * mode returns the worst-camera colour, or unknown grey when the site has no
 * camera reporting that metric.
 */
export function getSiteColor(
  health: SiteHealth | undefined,
  mode: SiteColorMode,
  baseColor: string,
): string {
  if (mode === 'none') return baseColor;
  if (!health) return UNKNOWN_COLOR;
  switch (mode) {
    case 'status':
      return health.worstStatus ? getStatusColor(health.worstStatus) : UNKNOWN_COLOR;
    case 'battery':
      return getBatteryColor(health.minBattery);
    case 'signal':
      return getSignalColor(health.minSignal);
  }
}
