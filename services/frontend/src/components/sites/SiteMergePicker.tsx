/**
 * Site merge target-picker.
 *
 * Merging fixes GPS-noise duplicates (two pins that are really the same place),
 * so the choice is spatial. The map (SitePickMap, shared with Set site) shows
 * every site: the source (the site being removed) in red, the picked target
 * (the survivor) in magenta, the other sites teal. Click a site to pick it as
 * the target. Seeing
 * how close two pins sit is the clearest confirmation that they are one place.
 *
 * Selection only; the parent owns the chosen target id and runs the merge.
 */
import { useMemo } from 'react';
import type { SiteListItem } from '../../api/sites';
import { ALERT_COLOR, FOCUS_COLOR, SITE_COLOR, dotCss } from '../map/marker-style';
import { SitePickMap } from './SitePickMap';

// The shared map colours (marker-style.ts): the site a merge removes is
// the alert red, the one it keeps the focus magenta, the rest plain sites.
const REMOVED_COLOR = ALERT_COLOR;
const KEPT_COLOR = FOCUS_COLOR;
const OTHER_COLOR = SITE_COLOR;

interface Props {
  sites: SiteListItem[];
  // The site being merged away (fixed, not selectable).
  sourceSiteId: number;
  selectedTargetId: number | null;
  onSelectTarget: (siteId: number) => void;
  height?: number;
}

function LegendDot({ color }: { color: string }) {
  return <span className="inline-block align-middle" style={dotCss(color, 12)} />;
}

export function SiteMergePicker({
  sites,
  sourceSiteId,
  selectedTargetId,
  onSelectTarget,
  height = 420,
}: Props) {
  // Every site has a NOT NULL location, so this filter is defensive only.
  const located = useMemo(
    () => sites.filter((s) => s.latitude != null && s.longitude != null),
    [sites],
  );
  const source = located.find((s) => s.id === sourceSiteId) ?? null;
  const others = useMemo(
    () => located.filter((s) => s.id !== sourceSiteId),
    [located, sourceSiteId],
  );
  const target =
    selectedTargetId != null
      ? others.find((s) => s.id === selectedTargetId) ?? null
      : null;

  if (others.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        There is no other site to merge into.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <SitePickMap
        sites={sites}
        selectedId={selectedTargetId}
        onSelect={onSelectTarget}
        fixed={{ id: sourceSiteId, color: REMOVED_COLOR }}
        height={height}
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <LegendDot color={REMOVED_COLOR} /> Removed
        </span>
        <span className="flex items-center gap-1.5">
          <LegendDot color={KEPT_COLOR} /> Destination
        </span>
        <span className="flex items-center gap-1.5">
          <LegendDot color={OTHER_COLOR} /> Other sites
        </span>
      </div>

      {/* Live summary of the merge that will run. Updates as the target is
          picked, so the action is explicit before confirming. */}
      <div className="rounded-md border bg-muted/40 p-3 text-sm">
        {target ? (
          <p>
            <span className="font-medium">{source?.name}</span> will be merged
            into <span className="font-medium">{target.name}</span>. Its{' '}
            {plural(source?.deployment_count ?? 0, 'deployment')} and{' '}
            {plural(source?.image_count ?? 0, 'image')} move to{' '}
            <span className="font-medium">{target.name}</span>, then{' '}
            <span className="font-medium">{source?.name}</span> is removed. This
            cannot be undone.
          </p>
        ) : (
          <p className="text-muted-foreground">
            Pick a site on the map to merge{' '}
            <span className="font-medium">{source?.name}</span> into.
          </p>
        )}
      </div>
    </div>
  );
}

// "3 deployments", "1 image" (count formatted with thousands separators).
function plural(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`;
}
