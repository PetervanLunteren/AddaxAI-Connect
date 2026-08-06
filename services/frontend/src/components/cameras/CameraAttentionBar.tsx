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

interface AttentionItem {
  count: number;
  label: string;
  patch: Record<string, string>;
}

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

  const candidates: AttentionItem[] = [
    {
      count: cameras.filter((c) => c.status === 'inactive').length,
      label: 'inactive',
      patch: { status: 'inactive' },
    },
    {
      count: cameras.filter(
        (c) => c.battery_percentage != null && c.battery_percentage < LOW_BATTERY_PERCENT,
      ).length,
      label: 'low battery',
      patch: { battery: 'low' },
    },
    {
      count: cameras.filter(
        (c) =>
          c.sd_utilization_percentage != null &&
          c.sd_utilization_percentage > SD_NEARLY_FULL_PERCENT,
      ).length,
      label: 'SD nearly full',
      patch: { sd_usage: 'high' },
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
                {item.count} {item.label}
              </Button>
            ) : (
              <Link
                key={item.label}
                to={`/projects/${projectId}/cameras?${new URLSearchParams(item.patch).toString()}`}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                {item.count} {item.label}
              </Link>
            ),
          )}
        </div>
      </CardContent>
    </Card>
  );
};
