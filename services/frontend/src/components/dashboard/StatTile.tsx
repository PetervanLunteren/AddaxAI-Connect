/**
 * One headline number, in the shape the dashboard literature agrees on:
 * label, value, change against the previous period, timeframe, then one small
 * visual. One visual only, never a sparkline and a bar together.
 *
 * A number with no comparison cannot be judged, which is why `delta` and
 * `note` exist and why at least one of them should always be passed.
 *
 * The value, the delta and the series must all describe the same quantity.
 * A cumulative total with a week-on-week change under it reads as "the
 * project grew 22% last week" when the change really refers to arrivals, so
 * the caller measures one thing and shows that thing three ways.
 */
import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { Card, CardContent } from '../ui/Card';
import { Sparkline } from './Sparkline';

interface StatTileProps {
  label: string;
  value: string;
  /** Percent change against the previous period. Omit when there is nothing to compare. */
  delta?: number | null;
  /** Plain sub-line, used when a percentage change would be meaningless. */
  note?: string;
  /** Daily series behind the value. Drawn only when there is no progress bar. */
  series?: number[];
  /** 0 to 1. Draws a progress bar instead of a sparkline. */
  progress?: number;
  /** Colours the value when the number itself is the warning. */
  tone?: 'normal' | 'bad';
  loading?: boolean;
  /** Grid placement from the page. The tile does not choose its own width. */
  className?: string;
}

export const StatTile: React.FC<StatTileProps> = ({
  label,
  value,
  delta,
  note,
  series,
  progress,
  tone = 'normal',
  loading = false,
  className = '',
}) => {
  const hasDelta = typeof delta === 'number' && Number.isFinite(delta);
  const up = hasDelta && (delta as number) >= 0;

  return (
    <Card className={`h-full ${className}`}>
      <CardContent className="flex h-full flex-col gap-2 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p
          className={`text-2xl font-bold tabular-nums leading-none ${
            tone === 'bad' ? 'text-[#882000] dark:text-[#f0917a]' : ''
          }`}
        >
          {loading ? '...' : value}
        </p>

        {/* Delta and note can both show. The delta says which way it moved,
            the note says what the number sits inside. */}
        {hasDelta && (
          <p
            className={`flex items-center gap-1 text-xs tabular-nums ${
              up ? 'text-primary' : 'text-[#882000] dark:text-[#f0917a]'
            }`}
          >
            {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {up ? '+' : ''}
            {Math.round(delta as number)}% vs previous week
          </p>
        )}
        {note && <p className="text-xs text-muted-foreground">{note}</p>}

        {progress !== undefined ? (
          <div className="mt-auto h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
            />
          </div>
        ) : series && series.length > 1 ? (
          // A definite height, not flex-1. Without one the svg's h-full has
          // nothing to resolve against and it falls back to sizing itself from
          // its own viewBox, which made a 547px-wide tile draw a 131px chart
          // and pushed the whole row taller than anything asked for.
          <div className="mt-auto h-16 pt-2">
            <Sparkline values={series} className="h-full" />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};
