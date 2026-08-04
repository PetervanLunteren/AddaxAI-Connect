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
 * The species bar chart is gone, replaced by rows with a photograph each. The
 * bars were coloured from a continuous scale even though the name was already
 * on the axis, so the colour said nothing while implying an order.
 *
 * The three plain counters gained a comparison, because a total with nothing
 * to compare it against cannot be judged.
 *
 * Holds only cards whose endpoint ignores species, so nothing here is affected
 * by the species filter on the Explore tab.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { FilterBar } from '../../components/ui/FilterBar';
import { statisticsApi } from '../../api/statistics';
import { imagesApi } from '../../api/images';
import { isWildlifeLabel } from '../../utils/labels';
import type { DateRange } from '../../components/dashboard';
import { VerificationProgressCard } from '../../components/dashboard/VerificationProgressCard';
import { LastDetectionCard } from '../../components/dashboard/LastDetectionCard';
import { SpeciesPortraitList } from '../../components/dashboard/SpeciesPortraitList';
import { AttentionList } from '../../components/dashboard/AttentionList';
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

  const withContent =
    (pipeline?.animal_count ?? 0) + (pipeline?.person_count ?? 0) + (pipeline?.vehicle_count ?? 0);
  const totalClassified = withContent + (pipeline?.empty_count ?? 0);
  const emptyShare = totalClassified > 0 ? (pipeline?.empty_count ?? 0) / totalClassified : 0;

  const allVerified = verification?.rows.find((r) => r.label === 'all');

  return (
    <div className="space-y-6">
      <FilterBar
        fields={filterFields}
        values={filterValues}
        onChange={onFilterChange}
        onClearAll={onClearAll}
      />

      {/* Tile sizes carry priority. The photograph and the species list get the
          most room; single numbers get the least. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <LastDetectionCard
          projectId={projectId}
          siteIds={siteIdsFromTags}
          wildlifeSpecies={wildlifeSpecies}
          className="md:col-span-2 lg:row-span-2"
        />

        <StatTile
          label="Total images"
          value={(overview?.total_images ?? 0).toLocaleString()}
          delta={delta}
          note={
            delta === null
              ? overview?.last_image_date
                ? `Last image ${overview.last_image_date}`
                : 'No images yet'
              : undefined
          }
          series={dailyCounts}
          loading={overviewLoading}
        />
        <StatTile
          label="Images with animals"
          value={(pipeline?.animal_count ?? 0).toLocaleString()}
          note={
            totalClassified > 0
              ? `${Math.round(((pipeline?.animal_count ?? 0) / totalClassified) * 100)}% of all images`
              : undefined
          }
        />
        <StatTile
          label="Empty images"
          value={`${Math.round(emptyShare * 100)}%`}
          note={`${(pipeline?.empty_count ?? 0).toLocaleString()} images with nothing in them`}
          progress={emptyShare}
        />
        <StatTile
          label="Verified"
          value={`${allVerified?.percentage ?? 0}%`}
          note={
            allVerified
              ? `${allVerified.verified.toLocaleString()} of ${allVerified.total.toLocaleString()} images`
              : undefined
          }
          progress={(allVerified?.percentage ?? 0) / 100}
        />

        <div className="md:col-span-2">
          <AttentionList projectId={projectId} siteIds={siteIdsFromTags} />
        </div>
        <div className="md:col-span-2">
          <SpeciesPortraitList projectId={projectId} siteIds={siteIdsFromTags} />
        </div>

        <div className="md:col-span-2 lg:col-span-4">
          <VerificationProgressCard
            dateRange={ALL_TIME}
            projectId={projectId}
            siteIds={siteIdsFromTags}
          />
        </div>
      </div>
    </div>
  );
};
