/**
 * Sex, age class and behaviour, as three stacked bars in one card.
 *
 * Replaces three separate cards that each drew a doughnut or a bar chart.
 * Two problems drove the change.
 *
 * First, these fields are almost always "unknown" until somebody has done a
 * lot of verifying. A doughnut with one slice is a ring, and three of those
 * side by side filled half the page while saying nothing. Three stacked bars
 * fit in the height one ring used.
 *
 * The three bars always render, including when every value is unknown and all
 * three read 100%. An earlier version collapsed that case into a line urging
 * the reader to go and verify. That was the wrong message: the classifier does
 * the work and filling these fields in is optional, so an empty bar is a fact
 * about what has been recorded, not a task anyone has failed to do. Keeping
 * the bars also means the card does not change shape as data arrives.
 *
 * Second, the colours came from the teal-to-yellow scale, which turned
 * "female" and "male" into two points on a ramp. They are two names, not two
 * magnitudes, so the palette is now fixed and assigned by position.
 */
import React from 'react';
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

const FieldRow: React.FC<{ label: string; data: DemographicsData | undefined }> = ({
  label,
  data,
}) => {
  if (!data || data.total === 0) return null;

  const segments = toSegments(data.values, data.total);
  // A recorded value must never print as 0%. Behaviour has 12 foraging out of
  // 6,855, which rounds to zero and then reads as "we looked and found none"
  // rather than "almost nobody has filled this in".
  const share = (value: number) => {
    const percent = value * 100;
    if (percent > 0 && percent < 0.5) return '<1%';
    return `${Math.round(percent)}%`;
  };
  const summary = segments.map((s) => `${s.label} ${share(s.share)}`).join(' · ');

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
