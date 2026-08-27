/**
 * Cameras that want a visit, as one compact strip.
 *
 * Lives here rather than on the Cameras page because the dashboard shows the
 * same thing. Two versions of "what is wrong with the cameras" would drift
 * apart, and the thresholds are the part that must not.
 *
 * It renders nothing at all when everything is fine. A card that says "all
 * good" costs the same space as one that says something useful, and the
 * absence of the strip is already the message.
 *
 * Chips act differently depending on who is asking. The Cameras page passes
 * onSelect and filters its own table in place. The dashboard passes projectId
 * instead and gets links into that page with the filter already applied,
 * which works because the camera filters live in the URL.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { Card, CardContent } from '../ui/Card';
import { Button, buttonVariants } from '../ui/Button';
import type { FilterValue } from '../ui/FilterBar';
import type { Camera } from '../../api/types';

/**
 * Must match the battery and SD buckets in the Cameras page filter, or a chip
 * would show a count the filtered table then disagrees with.
 */
export const LOW_BATTERY_PERCENT = 30;
export const SD_NEARLY_FULL_PERCENT = 80;
/**
 * The chip keys on recency, not on the 30-day count. Nearly every camera
 * has one old rejection (the setup shot before its first GPS fix), so
 * "any rejected file" would flag the whole project and hide the one
 * camera that started rejecting everything this morning.
 */
export const REJECTED_RECENT_DAYS = 7;

export const hasRecentRejection = (c: Camera, now = Date.now()): boolean =>
  !!c.last_rejected_at &&
  now - new Date(c.last_rejected_at).getTime() < REJECTED_RECENT_DAYS * 24 * 3600 * 1000;

interface AttentionItem {
  count: number;
  /** Reads as a whole phrase, because the dashboard has no camera table
   *  around it to supply the context the Cameras page used to. */
  label: string;
  patch: Record<string, string>;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

interface CameraAttentionBarProps {
  cameras: Camera[] | undefined;
  /** Filter in place. Given by the Cameras page, omitted by the dashboard. */
  onSelect?: (patch: Record<string, FilterValue>) => void;
  /** Needed to build links when onSelect is absent. */
  projectId?: number;
}

export const CameraAttentionBar: React.FC<CameraAttentionBarProps> = ({
  cameras,
  onSelect,
  projectId,
}) => {
  if (!cameras || cameras.length === 0) return null;

  const inactive = cameras.filter((c) => c.status === 'inactive').length;
  const lowBattery = cameras.filter(
    (c) => c.battery_percentage != null && c.battery_percentage < LOW_BATTERY_PERCENT,
  ).length;
  const sdNearlyFull = cameras.filter(
    (c) =>
      c.sd_utilization_percentage != null &&
      c.sd_utilization_percentage > SD_NEARLY_FULL_PERCENT,
  ).length;
  // Files the server refused but could tie to the camera (no GPS fix, no
  // date), recently. Null means the viewer sees no rejections at all.
  const withRejected = cameras.filter((c) => hasRecentRejection(c)).length;

  const candidates: AttentionItem[] = [
    {
      count: inactive,
      label: `${inactive} inactive ${plural(inactive, 'camera', 'cameras')}`,
      patch: { status: 'inactive' },
    },
    {
      count: lowBattery,
      label: `${lowBattery} ${plural(lowBattery, 'camera', 'cameras')} low on battery`,
      patch: { battery: 'low' },
    },
    {
      count: sdNearlyFull,
      label: `${sdNearlyFull} SD ${plural(sdNearlyFull, 'card', 'cards')} nearly full`,
      patch: { sd_usage: 'high' },
    },
    {
      count: withRejected,
      label: `${withRejected} ${plural(withRejected, 'camera', 'cameras')} with rejected files in the last ${REJECTED_RECENT_DAYS} days`,
      patch: { rejected: 'recent' },
    },
  ];

  const items = candidates.filter((item) => item.count > 0);
  if (items.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Needs attention
          </span>
          {items.map((item) =>
            onSelect ? (
              <Button
                key={item.label}
                variant="outline"
                size="sm"
                onClick={() => onSelect(item.patch)}
              >
                {item.label}
              </Button>
            ) : (
              <Link
                key={item.label}
                to={`/projects/${projectId}/cameras?${new URLSearchParams(item.patch).toString()}`}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                {item.label}
              </Link>
            ),
          )}
        </div>
      </CardContent>
    </Card>
  );
};
