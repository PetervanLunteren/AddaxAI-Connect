/**
 * Dashboard Overview tab: the state of the whole project.
 *
 * Laid out as tiles of different sizes, where size is decided by how much the
 * content matters. The old page gave every card the same weight, so the eye
 * had no entry point and settled on whatever had the most ink, which happened
 * to be a red doughnut.
 *
 * What changed and why:
 *
 * The camera activity doughnut is gone. Camera health is a status question,
 * not a proportion question, and it now sits in the attention list with the
 * other things a person can act on.
 *
 * The species bar chart is gone, replaced by a ranked list. The bars were
 * coloured from a continuous scale even though the name was already on the
 * axis, so the colour said nothing while implying an order.
 *
 * The three plain counters gained a comparison, because a total with nothing
 * to compare it against cannot be judged.
 *
 * Photographs appear only where they are big enough to read: the hero tile
 * here, and the wall on the Explore tab. A tried-and-dropped version put a
 * cropped portrait on every species row, and at 44 pixels a night infrared
 * shot is a grey rectangle.
 *
 * Holds only cards whose endpoint ignores species, so nothing here is affected
 * by the species filter on the Explore tab.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { FilterBar } from '../../components/ui/FilterBar';
import { statisticsApi } from '../../api/statistics';
import { imagesApi } from '../../api/images';
import { camerasApi } from '../../api/cameras';
import { isWildlifeLabel } from '../../utils/labels';
import type { DateRange } from '../../components/dashboard';
import { LastDetectionCard } from '../../components/dashboard/LastDetectionCard';
import { SpeciesChart } from '../../components/dashboard/SpeciesChart';
import { VerificationProgressCard } from '../../components/dashboard/VerificationProgressCard';
import { CameraAttentionBar } from '../../components/cameras/CameraAttentionBar';
import { StatTile } from '../../components/dashboard/StatTile';
import { useDashboardFilters } from './useDashboardFilters';

// Overview has no date filter. The URL can still carry a date range because
// the Explore tab uses one, so verification progress is pinned to all time
// here rather than being filtered by a control the user cannot see.
const ALL_TIME: DateRange = { startDate: null, endDate: null };

/** Days of daily counts behind the sparkline. */
const TREND_DAYS = 30;

/**
 * Percent change of the last seven days against the seven before them.
 * Returns null when the earlier week is empty, because "up from nothing" is
 * not a percentage anyone can act on.
 */
function weekOverWeek(counts: number[]): number | null {
  if (counts.length < 14) return null;
  const recent = counts.slice(-7).reduce((a, b) => a + b, 0);
  const previous = counts.slice(-14, -7).reduce((a, b) => a + b, 0);
  if (previous === 0) return null;
  return ((recent - previous) / previous) * 100;
}

export const DashboardOverview: React.FC = () => {
  const {
    projectId,
    siteIdsFromTags,
    overview,
    overviewLoading,
    filterValues,
    filterFields,
    onFilterChange,
    onClearAll,
  } = useDashboardFilters('overview');

  // Same query key as the filter hook, so this is served from cache.
  const { data: allSpeciesList } = useQuery({
    queryKey: ['species', projectId],
    queryFn: () => imagesApi.getSpecies(projectId),
    enabled: projectId !== undefined,
  });

  const { data: cameras } = useQuery({
    queryKey: ['cameras', projectId],
    queryFn: () => camerasApi.getAll(projectId),
    enabled: projectId !== undefined,
  });

  const { data: pipeline } = useQuery({
    queryKey: ['statistics', 'pipeline-status', projectId, siteIdsFromTags],
    queryFn: () => statisticsApi.getPipelineStatus(projectId, siteIdsFromTags),
    enabled: projectId !== undefined,
  });

  const { data: timeline } = useQuery({
    queryKey: ['statistics', 'images-timeline', projectId, TREND_DAYS, siteIdsFromTags],
    queryFn: () => statisticsApi.getImagesTimeline(projectId, TREND_DAYS, siteIdsFromTags),
    enabled: projectId !== undefined,
  });

  const { data: verification } = useQuery({
    queryKey: ['statistics', 'verification-progress-all', projectId, undefined, undefined, siteIdsFromTags],
    queryFn: () =>
      statisticsApi.getVerificationProgressAll(projectId!, { site_ids: siteIdsFromTags }),
    enabled: projectId !== undefined,
  });

  // The hero shows wildlife only. Projects can blur people and vehicles, and
  // most do, so "newest image of anything" would often open on a blurred
  // person. Passing the list explicitly beats filtering after the fact,
  // because the API can then still return exactly one row.
  const wildlifeSpecies = (allSpeciesList ?? [])
    .map((s) => String(s.value))
    .filter((value) => isWildlifeLabel(value))
    .join(',');

  const dailyCounts = (timeline ?? []).map((p) => p.count);
  const delta = weekOverWeek(dailyCounts);
  // The headline is arrivals, matching the delta and the sparkline. Putting
  // the lifetime total up here instead made the tile claim the project grew
  // by the week-on-week percentage, which it never does.
  const imagesThisWeek = dailyCounts.slice(-7).reduce((a, b) => a + b, 0);
  const totalImages = overview?.total_images ?? 0;

  const withContent =
    (pipeline?.animal_count ?? 0) + (pipeline?.person_count ?? 0) + (pipeline?.vehicle_count ?? 0);
  const totalClassified = withContent + (pipeline?.empty_count ?? 0);
  const emptyShare = totalClassified > 0 ? (pipeline?.empty_count ?? 0) / totalClassified : 0;
  // Not-empty rather than animals, so the two shares are one split that adds
  // to a hundred. Animals alone left people and vehicles unaccounted for, and
  // the per-species detail lives in the chart below anyway.
  const detectionShare = totalClassified > 0 ? withContent / totalClassified : 0;

  const allVerified = verification?.rows.find((r) => r.label === 'all');

  return (
    <div className="space-y-6">
      <FilterBar
        fields={filterFields}
        values={filterValues}
        onChange={onFilterChange}
        onClearAll={onClearAll}
      />

      {/* The same strip the Cameras page shows, not a second opinion. It
          renders nothing when every camera is fine, so a healthy project sees
          no card at all rather than a reassuring one. */}
      <CameraAttentionBar cameras={cameras} projectId={projectId} />

      {/* The photograph earns the most room. The stat with a chart in it gets
          double width; the two bare numbers sit beneath at single width. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <LastDetectionCard
          projectId={projectId}
          siteIds={siteIdsFromTags}
          wildlifeSpecies={wildlifeSpecies}
          className="md:col-span-2 lg:row-span-2"
        />

        <StatTile
          className="md:col-span-2"
          label="Images this week"
          value={imagesThisWeek.toLocaleString()}
          delta={delta}
          // When nothing arrived, when it stopped is the more useful fact.
          note={
            imagesThisWeek === 0 && overview?.last_image_date
              ? `Nothing this week, last image ${overview.last_image_date}`
              : `${totalImages.toLocaleString()} in total`
          }
          series={dailyCounts}
          loading={overviewLoading}
        />
        {/* Whether the detector found anything, which is the split that really
            exists. Counting only animals left people and vehicles out, so the
            two percentages never reached a hundred and invited the question. */}
        <StatTile
          label="Images with detections"
          value={withContent.toLocaleString()}
          note={
            totalClassified > 0
              ? `${Math.round(detectionShare * 100)}% of all images, ${Math.round(emptyShare * 100)}% empty`
              : undefined
          }
          progress={totalClassified > 0 ? detectionShare : undefined}
        />
        {/* No progress bar here on purpose. A bar says "on the way to 100%",
            and verifying is optional: the classifier does the work and a
            person confirms as much or as little as they want. The number is
            a fact, not an unfinished task. */}
        <StatTile
          label="Verified"
          value={`${allVerified?.percentage ?? 0}%`}
          note={
            allVerified
              ? `${allVerified.verified.toLocaleString()} of ${allVerified.total.toLocaleString()} images`
              : undefined
          }
        />
      </div>

      {/* What was seen, next to how much of it a person has checked. They no
          longer overlap: the chart is share of all detections, the card is
          share verified. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SpeciesChart projectId={projectId} siteIds={siteIdsFromTags} />
        <VerificationProgressCard
          dateRange={ALL_TIME}
          projectId={projectId}
          siteIds={siteIdsFromTags}
        />
      </div>
    </div>
  );
};
