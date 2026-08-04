/**
 * Sex, age class and behaviour, as three stacked bars in one card.
 *
 * Replaces three separate cards that each drew a doughnut or a bar chart.
 * Two problems drove the change.
 *
 * First, these fields are almost always "unknown" until somebody has done a
 * lot of verifying. A doughnut with one slice is a ring, and three of those
 * side by side filled half the page while saying nothing. The old card had a
 * good empty state but it only appeared when the total was zero, so 414
 * observations that are all unknown still drew the useless chart. Now a
 * single-category result collapses to one line that says so and links to the
 * work that fixes it.
 *
 * Second, the colours came from the teal-to-yellow scale, which turned
 * "female" and "male" into two points on a ramp. They are two names, not two
 * magnitudes, so the palette is now fixed and assigned by position.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { statisticsApi } from '../../api/statistics';
import type { DateRange } from './DateRangeFilter';

/** Four-value palette from FRONTEND_CONVENTIONS.md, assigned by position. */
const SERIES_COLORS = ['#0f6064', '#ff8945', '#71b7ba', '#882000'];

/** Behaviour has eleven values. Beyond this they collapse into "Other". */
const MAX_SEGMENTS = 4;

type FieldKey = 'sex' | 'life_stage' | 'behavior';

interface DemographicsData {
  values: { value: string; count: number }[];
  total: number;
}

interface Segment {
  label: string;
  count: number;
  share: number;
  /** null means "unknown", which is drawn neutral rather than in a series colour. */
  color: string | null;
}

interface DemographicsCardProps {
  dateRange: DateRange;
  projectId?: number;
  siteIds?: string;
  species?: string;
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Turn raw counts into at most MAX_SEGMENTS bars, biggest first, with unknown
 * always last so the eye starts on what is actually known.
 */
function toSegments(values: { value: string; count: number }[], total: number): Segment[] {
  const known = values.filter((v) => v.value !== 'unknown').sort((a, b) => b.count - a.count);
  const unknown = values.find((v) => v.value === 'unknown');

  const head = known.slice(0, MAX_SEGMENTS - 1);
  const tail = known.slice(MAX_SEGMENTS - 1);
  const tailCount = tail.reduce((sum, v) => sum + v.count, 0);

  const segments: Segment[] = head.map((v, i) => ({
    label: capitalise(v.value),
    count: v.count,
    share: v.count / total,
    color: SERIES_COLORS[i % SERIES_COLORS.length],
  }));

  if (tailCount > 0) {
    segments.push({
      label: 'Other',
      count: tailCount,
      share: tailCount / total,
      color: SERIES_COLORS[Math.min(head.length, SERIES_COLORS.length - 1)],
    });
  }

  if (unknown && unknown.count > 0) {
    segments.push({
      label: 'Unknown',
      count: unknown.count,
      share: unknown.count / total,
      color: null,
    });
  }

  return segments;
}

/** True when this field holds nothing but "unknown". */
function isBlank(data: DemographicsData | undefined): boolean {
  const values = data?.values ?? [];
  return values.length <= 1 && (values[0]?.value ?? 'unknown') === 'unknown';
}

const FieldRow: React.FC<{ label: string; data: DemographicsData | undefined }> = ({
  label,
  data,
}) => {
  if (!data || data.total === 0) return null;

  const segments = toSegments(data.values, data.total);
  const summary = segments.map((s) => `${s.label} ${Math.round(s.share * 100)}%`).join(' · ');

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{summary}</span>
      </div>
      <div className="flex h-3.5 w-full overflow-hidden rounded bg-muted">
        {segments.map((s) => (
          <span
            key={s.label}
            title={`${s.label}: ${s.count.toLocaleString()}`}
            className={`block h-full ${s.color === null ? 'bg-muted-foreground/25' : ''}`}
            style={{
              width: `${s.share * 100}%`,
              backgroundColor: s.color ?? undefined,
            }}
          />
        ))}
      </div>
    </div>
  );
};

export const DemographicsCard: React.FC<DemographicsCardProps> = ({
  dateRange,
  projectId,
  siteIds,
  species,
}) => {
  const queryFor = (field: FieldKey) => ({
    queryKey: [
      'statistics',
      'demographics',
      projectId,
      field,
      species ?? 'all',
      dateRange.startDate,
      dateRange.endDate,
      siteIds,
    ],
    queryFn: () =>
      statisticsApi.getDemographics(projectId!, {
        field,
        species: species || undefined,
        start_date: dateRange.startDate || undefined,
        end_date: dateRange.endDate || undefined,
        site_ids: siteIds,
      }),
    enabled: projectId !== undefined,
  });

  // Three explicit hooks rather than a loop, so the hook order can never move.
  const sex = useQuery(queryFor('sex'));
  const lifeStage = useQuery(queryFor('life_stage'));
  const behavior = useQuery(queryFor('behavior'));

  const loading = sex.isLoading || lifeStage.isLoading || behavior.isLoading;
  const total = sex.data?.total ?? 0;
  const nothingRecorded =
    total > 0 && isBlank(sex.data) && isBlank(lifeStage.data) && isBlank(behavior.data);

  const base = projectId !== undefined ? `/projects/${projectId}` : '';

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Sex, age class and behaviour</CardTitle>
        <p className="text-sm text-muted-foreground">
          {total > 0
            ? `From ${total.toLocaleString()} verified observations`
            : 'From verified observations'}
        </p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Loading...</p>
        ) : total === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            No verified observations yet for this selection.
          </p>
        ) : nothingRecorded ? (
          <div className="flex items-center gap-3">
            <span className="h-8 w-1.5 shrink-0 rounded-full bg-[#ff8945]" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Nothing recorded yet</p>
              <p className="text-xs text-muted-foreground">
                All {total.toLocaleString()} observations have these three fields set to
                unknown. They are filled in while verifying an image.
              </p>
            </div>
            <Link
              to={`${base}/images?verified=false`}
              className="shrink-0 text-xs font-medium text-primary hover:underline"
            >
              Verify
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <FieldRow label="Sex" data={sex.data} />
            <FieldRow label="Age class" data={lifeStage.data} />
            <FieldRow label="Behaviour" data={behavior.data} />
          </div>
        )}
      </CardContent>
    </Card>
  );
};
