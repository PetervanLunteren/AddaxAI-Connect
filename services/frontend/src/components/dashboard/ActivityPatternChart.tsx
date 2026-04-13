/**
 * Activity Pattern Chart - 24-hour clock face showing hourly detection counts
 */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Select, SelectItem } from '../ui/Select';
import { statisticsApi } from '../../api/statistics';
import { normalizeLabel } from '../../utils/labels';
import type { HourlyActivityPoint, SunBands } from '../../api/types';
import type { DateRange } from './DateRangeFilter';

interface ActivityPatternChartProps {
  dateRange: DateRange;
  projectId?: number;
  cameraIds?: string;
}

// Time-of-day color buckets (palette from FRONTEND_CONVENTIONS.md)
const NIGHT = '#0f6064';
const TWILIGHT = '#ff8945';
const DAY = '#71b7ba';

function getHourColor(hour: number, bands: SunBands | null): string {
  if (bands) {
    // Each bar covers a one-hour slot [hour, hour+1]. Colour by overlap
    // with the astronomical bands rather than midpoint sampling, otherwise
    // narrow twilight windows can slip between two adjacent hour midpoints
    // and the dusk band disappears entirely (e.g. dusk 20:36-21:13 falls
    // between the midpoints of hour 20 and hour 21).
    const slot0 = hour;
    const slot1 = hour + 1;
    const overlap = (a0: number, a1: number, b0: number, b1: number) =>
      Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
    const twilightOverlap =
      overlap(slot0, slot1, bands.dawn, bands.sunrise) +
      overlap(slot0, slot1, bands.sunset, bands.dusk);
    // 15 minutes of twilight in the hour is enough to colour the whole bar.
    if (twilightOverlap >= 0.25) return TWILIGHT;
    const t = hour + 0.5;
    if (t >= bands.sunrise && t < bands.sunset) return DAY;
    return NIGHT;
  }
  // Fallback used when the project has no camera GPS, when the cross-project
  // view is active, or when the sun never sets / never rises on this date
  // (polar day or polar night).
  const t = hour + 0.5;
  if (t >= 21 || t < 5) return NIGHT;
  if (t < 7 || t >= 17) return TWILIGHT;
  return DAY;
}

interface ActivityClockProps {
  hours: HourlyActivityPoint[];
  sunBands: SunBands | null;
}

function ActivityClock({ hours, sunBands }: ActivityClockProps) {
  // Geometry: viewBox is 200x200 with center at (100, 100)
  const cx = 100;
  const cy = 100;
  const innerR = 30;   // bars start here (leaves a small empty inner circle)
  const outerR = 82;   // max bar end (leaves room for hour labels outside)
  const labelR = 92;   // hour label radius
  const barWidth = 5;
  const maxBarLength = outerR - innerR;

  const maxCount = Math.max(1, ...hours.map((h) => h.count));

  // hour 0 -> top of the circle: subtract 90 degrees from the standard
  // SVG angle (0 deg = right, increasing clockwise).
  const hourAngle = (hour: number) => ((hour * 15 - 90) * Math.PI) / 180;

  const [hoveredHour, setHoveredHour] = useState<number | null>(null);
  const hoveredEntry =
    hoveredHour !== null ? hours.find((h) => h.hour === hoveredHour) ?? null : null;

  // Convert cursor position to the closest hour. Anywhere inside the
  // outer circle counts as a hover; outside clears it.
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 200;
    const y = ((e.clientY - rect.top) / rect.height) * 200;
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > outerR + 6) {
      setHoveredHour(null);
      return;
    }
    // atan2 returns angle in [-pi, pi] with 0 at the right side.
    // Rotate by +90 deg so 0 is at the top, then snap to the nearest 15 deg slot.
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    deg = (deg + 90 + 360) % 360;
    setHoveredHour(Math.round(deg / 15) % 24);
  };

  return (
    <svg
      viewBox="0 0 200 200"
      className="w-full h-full"
      role="img"
      aria-label="Hourly activity clock"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoveredHour(null)}
    >
      {/* Faint guide circles for visual scale */}
      <circle
        cx={cx}
        cy={cy}
        r={innerR + maxBarLength * 0.5}
        fill="none"
        stroke="rgba(0, 0, 0, 0.08)"
        strokeWidth={0.5}
      />
      <circle
        cx={cx}
        cy={cy}
        r={outerR}
        fill="none"
        stroke="rgba(0, 0, 0, 0.08)"
        strokeWidth={0.5}
      />

      {/* 24 radial bars */}
      {hours.map(({ hour, count }) => {
        const angle = hourAngle(hour);
        const length = (count / maxCount) * maxBarLength;
        const x1 = cx + innerR * Math.cos(angle);
        const y1 = cy + innerR * Math.sin(angle);
        const x2 = cx + (innerR + length) * Math.cos(angle);
        const y2 = cy + (innerR + length) * Math.sin(angle);
        const isHovered = hoveredHour === hour;
        return (
          <line
            key={hour}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={getHourColor(hour, sunBands)}
            strokeWidth={isHovered ? barWidth + 2 : barWidth}
            strokeLinecap="round"
          />
        );
      })}

      {/* 8 hour labels every 3 hours, around the rim */}
      {[0, 3, 6, 9, 12, 15, 18, 21].map((hour) => {
        const angle = hourAngle(hour);
        const x = cx + labelR * Math.cos(angle);
        const y = cy + labelR * Math.sin(angle);
        return (
          <text
            key={hour}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={9}
            fill="currentColor"
            className="text-muted-foreground"
          >
            {hour}
          </text>
        );
      })}

      {/* Hover details in the center of the clock */}
      {hoveredEntry && (
        <g style={{ pointerEvents: 'none' }}>
          {/* Card background — drawn on top of the bars so the text stays
              readable even when the count label is wider than the inner circle */}
          <rect
            x={cx - 35}
            y={cy - 14}
            width={70}
            height={28}
            rx={3}
            style={{
              fill: 'hsl(var(--card))',
              stroke: 'hsl(var(--border))',
              strokeWidth: 0.5,
            }}
          />
          <text
            x={cx}
            y={cy - 3}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={10}
            fontWeight="bold"
            fill="currentColor"
            className="text-foreground"
          >
            {`${hoveredEntry.hour.toString().padStart(2, '0')}:00`}
          </text>
          <text
            x={cx}
            y={cy + 8}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={7}
            fill="currentColor"
            className="text-muted-foreground"
          >
            {`${hoveredEntry.count} detection${hoveredEntry.count === 1 ? '' : 's'}`}
          </text>
        </g>
      )}
    </svg>
  );
}

export const ActivityPatternChart: React.FC<ActivityPatternChartProps> = ({ dateRange, projectId, cameraIds }) => {
  const [selectedSpecies, setSelectedSpecies] = useState<string>('all');

  // Fetch species list for the selector
  const { data: speciesList } = useQuery({
    queryKey: ['statistics', 'species', projectId],
    queryFn: () => statisticsApi.getSpeciesDistribution(projectId),
    enabled: projectId !== undefined,
  });

  // Fetch activity pattern data
  const { data, isLoading } = useQuery({
    queryKey: ['statistics', 'activity-pattern', projectId, selectedSpecies, dateRange.startDate, dateRange.endDate, cameraIds],
    queryFn: () =>
      statisticsApi.getActivityPattern(projectId, {
        species: selectedSpecies === 'all' ? undefined : selectedSpecies,
        start_date: dateRange.startDate || undefined,
        end_date: dateRange.endDate || undefined,
        camera_ids: cameraIds,
      }),
    enabled: projectId !== undefined,
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-lg">Activity pattern</CardTitle>
          <Select
            value={selectedSpecies}
            onValueChange={setSelectedSpecies}
            className="w-36 h-9 text-sm"
          >
            <SelectItem value="all">All species</SelectItem>
            {speciesList?.map((s) => (
              <SelectItem key={s.species} value={s.species}>
                {normalizeLabel(s.species)}
              </SelectItem>
            ))}
          </Select>
        </div>
        <p className="text-sm text-muted-foreground">
          24-hour pattern{data ? `, ${data.total_detections.toLocaleString()} total detections` : ''}
        </p>
      </CardHeader>
      <CardContent>
        <div className="aspect-square w-full max-h-72 mx-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-muted-foreground">Loading...</p>
            </div>
          ) : data && data.hours.some((h) => h.count > 0) ? (
            <ActivityClock hours={data.hours} sunBands={data.sun_bands} />
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-muted-foreground">No activity data available</p>
            </div>
          )}
        </div>
        {/* Legend for time-of-day colors */}
        <div className="flex items-center justify-center gap-4 mt-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: NIGHT }} />
            <span>Night</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: TWILIGHT }} />
            <span>Dawn/Dusk</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: DAY }} />
            <span>Day</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
