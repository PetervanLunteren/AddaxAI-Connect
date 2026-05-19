/**
 * Detection Trend Chart - Shows detection counts with day/week/month granularity
 */
import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
  ChartOptions,
} from 'chart.js';
import type { ChartData } from 'chart.js';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Select, SelectItem } from '../ui/Select';
import { imagesApi } from '../../api/images';
import { statisticsApi } from '../../api/statistics';
import { formatDateShort, formatMonth } from '../../utils/datetime';
import { getSpeciesColor } from '../../utils/species-colors';
import { normalizeLabel } from '../../utils/labels';
import type { DateRange } from './DateRangeFilter';

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

interface DetectionTrendChartProps {
  dateRange: DateRange;
  projectId?: number;
  cameraIds?: string;
  // Project's full image-date extent. Used as the fallback x-axis span
  // and granularity hint when the user has not set an explicit date
  // range, so a sparse species shows its spike in the context of the
  // full project lifetime instead of collapsing to a single dot.
  projectFirstDate?: string | null;
  projectLastDate?: string | null;
}

type Granularity = 'day' | 'week' | 'month';

// Calculate optimal granularity based on date range span. Picks the
// bucket size that keeps multi-year projects readable while still
// showing useful detail on short ones. Falls back to month only when
// there is no span hint at all (no filter + no project extent yet).
function getOptimalGranularity(startDate: string | null, endDate: string | null): Granularity {
  if (!startDate || !endDate) return 'month';

  const start = new Date(startDate);
  const end = new Date(endDate);
  const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

  if (daysDiff <= 30) return 'day';
  if (daysDiff <= 90) return 'week';
  return 'month';
}

// Rolling-average window per granularity, picked so the window maps
// to a natural cycle (a week, a month, a year). That makes the line
// readable as "the recent period that matters" instead of an
// arbitrary 7-of-whatever.
function getSmoothingWindow(granularity: Granularity): { size: number; label: string } {
  if (granularity === 'day') return { size: 7, label: '7-day avg' };
  if (granularity === 'week') return { size: 4, label: '4-week avg' };
  return { size: 12, label: '12-month avg' };
}

// Trailing simple moving average. Returns an array the same length as
// input; the first (window-1) slots are null so the chart leaves a
// visual gap during warm-up rather than drawing a partial average.
function trailingMovingAverage(values: number[], window: number): (number | null)[] {
  if (values.length < window) return values.map(() => null);
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    out.push(i >= window - 1 ? sum / window : null);
  }
  return out;
}

// ISO week key, "YYYY-WNN", anchored on the Thursday of the week so it lines
// up with calendar weeks regardless of where the input date falls.
function getWeekKey(dateStr: string): string {
  const d = new Date(dateStr);
  const temp = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  temp.setDate(temp.getDate() + 3 - ((temp.getDay() + 6) % 7));
  const yearStart = new Date(temp.getFullYear(), 0, 1);
  const weekNum = Math.ceil((((temp.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${temp.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function getMonthKey(dateStr: string): string {
  return dateStr.slice(0, 7); // "YYYY-MM"
}

// Generate every bucket key between `from` and `to` inclusive at the given
// granularity. Walks day-by-day in UTC and dedupes so week and month keys
// come out without gaps even though those bins span irregular calendar days.
function denseRangeKeys(
  from: Date,
  to: Date,
  keyOf: (dateStr: string) => string,
): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const cursor = new Date(from);
  while (cursor.getTime() <= to.getTime()) {
    const iso = cursor.toISOString().slice(0, 10);
    const k = keyOf(iso);
    if (!seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

export const DetectionTrendChart: React.FC<DetectionTrendChartProps> = ({
  dateRange,
  projectId,
  cameraIds,
  projectFirstDate,
  projectLastDate,
}) => {
  const [selectedSpecies, setSelectedSpecies] = useState<string | null>(null);

  // Effective span = user filter when set, else the project's full
  // image-date extent. Drives granularity and the chart's x-axis range
  // so picking a sparse species shows its spike against the full
  // project timeline instead of just the species' first/last day.
  const effectiveStart = dateRange.startDate ?? projectFirstDate ?? null;
  const effectiveEnd = dateRange.endDate ?? projectLastDate ?? null;

  const [granularity, setGranularity] = useState<Granularity>(() =>
    getOptimalGranularity(effectiveStart, effectiveEnd)
  );

  useEffect(() => {
    setGranularity(getOptimalGranularity(effectiveStart, effectiveEnd));
  }, [effectiveStart, effectiveEnd]);

  // Full species list for the selector. Same source the Images-page
  // filter uses, so the dropdown matches what users see there. The
  // dashboard's species-distribution endpoint is top-10 and was hiding
  // anything past the 10th most-detected species from this picker.
  const { data: allSpeciesList } = useQuery({
    queryKey: ['species', projectId],
    queryFn: () => imagesApi.getSpecies(projectId),
    enabled: projectId !== undefined,
  });

  // Top-N by count, used only to pick the most-detected species as the
  // default selection on first load. Not used to populate the dropdown.
  const { data: topSpeciesList } = useQuery({
    queryKey: ['statistics', 'species', projectId],
    queryFn: () => statisticsApi.getSpeciesDistribution(projectId),
    enabled: projectId !== undefined,
  });

  // Default to most observed species when data loads
  useEffect(() => {
    if (topSpeciesList && topSpeciesList.length > 0 && selectedSpecies === null) {
      setSelectedSpecies(topSpeciesList[0].species);
    }
  }, [topSpeciesList, selectedSpecies]);

  // Detection counts per day (sparse: only days with at least one
  // detection are returned).
  const { data: rawData, isLoading } = useQuery({
    queryKey: ['statistics', 'detection-trend', projectId, selectedSpecies, dateRange.startDate, dateRange.endDate, cameraIds],
    queryFn: () =>
      statisticsApi.getDetectionTrend(projectId, {
        species: selectedSpecies === 'all' || !selectedSpecies ? undefined : selectedSpecies,
        start_date: dateRange.startDate || undefined,
        end_date: dateRange.endDate || undefined,
        camera_ids: cameraIds,
      }),
    enabled: projectId !== undefined && selectedSpecies !== null,
  });

  // Daily active-camera counts. Always fetched so the user can toggle
  // to per-100-trap-nights without a wait, and so the bucketed series
  // stays aligned with the detection series.
  const { data: trapEffort } = useQuery({
    queryKey: ['statistics', 'trap-effort', projectId, dateRange.startDate, dateRange.endDate, cameraIds],
    queryFn: () =>
      statisticsApi.getTrapEffort(projectId, {
        start_date: dateRange.startDate || undefined,
        end_date: dateRange.endDate || undefined,
        camera_ids: cameraIds,
      }),
    enabled: projectId !== undefined,
  });

  // Bucket detections AND trap-nights to the same key set, zero-filled
  // across the effective span so days/weeks/months without detections
  // still appear on the chart.
  const data = useMemo(() => {
    if (!rawData) return null;

    const keyOf: (d: string) => string =
      granularity === 'day'
        ? (d) => d
        : granularity === 'week'
          ? getWeekKey
          : getMonthKey;

    const detBucketed = new Map<string, number>();
    rawData.forEach((point) => {
      const k = keyOf(point.date);
      detBucketed.set(k, (detBucketed.get(k) ?? 0) + point.count);
    });

    const trapBucketed = new Map<string, number>();
    (trapEffort ?? []).forEach((point) => {
      const k = keyOf(point.date);
      trapBucketed.set(k, (trapBucketed.get(k) ?? 0) + point.active_cameras);
    });

    const from = effectiveStart ?? rawData[0]?.date ?? null;
    const to = effectiveEnd ?? rawData[rawData.length - 1]?.date ?? null;
    if (!from || !to) return [];

    const keys = denseRangeKeys(new Date(from), new Date(to), keyOf);
    return keys.map((key) => ({
      key,
      count: detBucketed.get(key) ?? 0,
      trapNights: trapBucketed.get(key) ?? 0,
    }));
  }, [rawData, trapEffort, granularity, effectiveStart, effectiveEnd]);

  // Use species color if selected, otherwise teal
  const lineColor =
    selectedSpecies && selectedSpecies !== 'all'
      ? getSpeciesColor(selectedSpecies)
      : '#0f6064';

  // Create gradient for fill
  const createGradient = (ctx: CanvasRenderingContext2D, chartArea: { top: number; bottom: number }, color: string) => {
    // Parse color to get RGB values
    const isHex = color.startsWith('#');
    let r: number, g: number, b: number;
    if (isHex) {
      const hex = color.slice(1);
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    } else {
      // Default to teal
      r = 15; g = 96; b = 100;
    }

    const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.05)`);
    gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.3)`);
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0.6)`);
    return gradient;
  };

  // Format raw bucket keys for display. Day keys become short dates, week
  // keys stay as "YYYY-WNN", month keys become localized "Mon YYYY".
  const formatLabel = (key: string) => {
    if (granularity === 'day') return formatDateShort(key);
    if (granularity === 'month') {
      const [y, m] = key.split('-');
      return formatMonth(new Date(Number(y), Number(m) - 1));
    }
    return key;
  };

  // Always show the relative-abundance index (detections per 100
  // trap-nights). This is the standard wildlife camera-trap metric
  // and the only view people care about, so a toggle would add UI
  // noise without adding insight.
  const displayValues = useMemo(() => {
    if (!data) return [];
    return data.map((d) => (d.trapNights > 0 ? (d.count / d.trapNights) * 100 : 0));
  }, [data]);

  const { size: smoothingWindow, label: smoothingLabel } = getSmoothingWindow(granularity);
  const rollingAvg = useMemo(
    () => trailingMovingAverage(displayValues, smoothingWindow),
    [displayValues, smoothingWindow],
  );

  const chartData: ChartData<'line'> = {
    labels: data?.map((d) => formatLabel(d.key)) ?? [],
    datasets: [
      {
        label: 'Detections per 100 trap-nights',
        data: displayValues,
        borderColor: lineColor,
        backgroundColor: (context) => {
          const chart = context.chart;
          const { ctx, chartArea } = chart;
          if (!chartArea) return 'rgba(15, 96, 100, 0.2)';
          return createGradient(ctx, chartArea, lineColor);
        },
        tension: 0.3,
        fill: true,
        pointRadius: data && data.length < 30 ? 3 : 0,
        pointHoverRadius: 5,
      },
      {
        label: smoothingLabel,
        data: rollingAvg,
        borderColor: 'rgba(75, 85, 99, 0.75)',
        borderWidth: 1.5,
        borderDash: [6, 4],
        tension: 0.3,
        fill: false,
        pointRadius: 0,
        pointHoverRadius: 4,
        spanGaps: false,
      },
    ],
  };

  const chartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    // Hover anywhere in a column shows the raw count and the
    // rolling-average value side by side, so the user reads the
    // smoothed trend without having to chase the dashed line with
    // the cursor.
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: {
        display: true,
        position: 'top' as const,
        align: 'end' as const,
        labels: {
          // Use a single solid dot per dataset, otherwise Chart.js draws
          // the dataset's borderDash inside the legend swatch and the
          // dashed line ends up rendered as awkward partial repeats. The
          // chart itself still carries the solid/dashed distinction.
          usePointStyle: true,
          pointStyle: 'circle',
          boxWidth: 6,
          boxHeight: 6,
          padding: 12,
          font: { size: 11 },
        },
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            const val = context.raw as number | null;
            if (val === null || val === undefined) return '';
            const dsLabel = context.dataset.label ?? '';
            if (dsLabel.endsWith('avg')) return `${dsLabel}: ${val.toFixed(2)}`;
            return `${val.toFixed(2)} per 100 trap-nights`;
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          precision: 2,
        },
      },
      x: {
        grid: {
          display: false,
        },
      },
    },
  };

  const totalDetections = data?.reduce((sum, d) => sum + d.count, 0) ?? 0;
  const totalTrapNights = data?.reduce((sum, d) => sum + d.trapNights, 0) ?? 0;
  const periodCount = data?.length ?? 0;
  const overallRate = totalTrapNights > 0 ? (totalDetections / totalTrapNights) * 100 : 0;

  const granularityLabel = granularity === 'day' ? 'days' : granularity === 'week' ? 'weeks' : 'months';

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-lg">Detection trend</CardTitle>
          <div className="flex items-center gap-2">
            <Select
              value={granularity}
              onValueChange={(v) => setGranularity(v as Granularity)}
              className="w-28 h-9 text-sm"
            >
              <SelectItem value="day">By day</SelectItem>
              <SelectItem value="week">By week</SelectItem>
              <SelectItem value="month">By month</SelectItem>
            </Select>
            <Select
              value={selectedSpecies ?? ''}
              onValueChange={setSelectedSpecies}
              className="w-40 h-9 text-sm"
            >
              <SelectItem value="all">All species</SelectItem>
              {allSpeciesList?.map((s) => (
                <SelectItem key={String(s.value)} value={String(s.value)}>
                  {normalizeLabel(String(s.value))}
                </SelectItem>
              ))}
            </Select>
          </div>
        </div>
        {data && data.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Average {overallRate.toFixed(1)} detections per 100 trap-nights across {periodCount} {granularityLabel}
          </p>
        )}
      </CardHeader>
      <CardContent>
        <div className="h-72">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-muted-foreground">Loading...</p>
            </div>
          ) : data && data.length > 0 ? (
            <Line data={chartData} options={chartOptions} />
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-muted-foreground">No detection data available</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
