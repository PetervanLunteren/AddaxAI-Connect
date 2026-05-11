/**
 * Activity overlap chart — page-wide Cartesian KDE comparison of 1 or 2
 * species' temporal activity patterns.
 *
 * Visual conventions follow the R `overlap` package:
 *   - 0..24h x-axis (clock or sun-anchored, controlled by the parent)
 *   - one smooth von Mises KDE curve per species (the backend ships a
 *     pre-fit 240-point density grid, so the chart just plots it)
 *   - shaded overlap region = pointwise min(species_a, species_b)
 *   - twilight bands (dawn / sunrise / sunset / dusk) as a background plugin
 *   - rug ticks under the curves for raw detection times
 *
 * The math (KDE fit, sun-band computation) lives server-side in
 * services/api/utils/activity_analysis.py so this file is purely visual.
 * Ported from AddaxAI WebUI's ActivityOverlapChart.tsx.
 */
import { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
  type Plugin,
} from 'chart.js';

import type { ActivityOverlapResponse, SunBands } from '../../api/types';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
);

export const SPECIES_A_COLOR = '#0f6064';
export const SPECIES_B_COLOR = '#ff8945';
const OVERLAP_FILL = 'rgba(120, 120, 120, 0.28)';
const RUG_HEIGHT_PX = 6;

const twilightBandsPlugin: Plugin<'line'> = {
  id: 'twilightBands',
  beforeDatasetsDraw(chart, _args, options) {
    const opts = options as { sunBands?: SunBands | null; visible?: boolean };
    if (!opts.visible || !opts.sunBands) return;
    const { dawn, sunrise, sunset, dusk } = opts.sunBands;
    const { ctx, chartArea, scales } = chart;
    const xScale = scales.x;
    if (!xScale) return;
    const top = chartArea.top;
    const bottom = chartArea.bottom;
    const xAt = (h: number) => xScale.getPixelForValue(h);

    ctx.save();
    ctx.fillStyle = 'rgba(30, 41, 59, 0.06)';
    ctx.fillRect(chartArea.left, top, xAt(dawn) - chartArea.left, bottom - top);
    ctx.fillRect(xAt(dusk), top, chartArea.right - xAt(dusk), bottom - top);
    ctx.fillStyle = 'rgba(255, 165, 0, 0.10)';
    ctx.fillRect(xAt(dawn), top, xAt(sunrise) - xAt(dawn), bottom - top);
    ctx.fillRect(xAt(sunset), top, xAt(dusk) - xAt(sunset), bottom - top);
    ctx.restore();
  },
};

const rugTicksPlugin: Plugin<'line'> = {
  id: 'rugTicks',
  afterDatasetsDraw(chart, _args, options) {
    const opts = options as {
      speciesA?: number[];
      speciesB?: number[];
      colorA?: string;
      colorB?: string;
    };
    const { ctx, chartArea, scales } = chart;
    const xScale = scales.x;
    if (!xScale) return;

    const drawRug = (times: number[] | undefined, y: number, color: string) => {
      if (!times || times.length === 0) return;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.6;
      for (const t of times) {
        const x = xScale.getPixelForValue(t);
        if (x < chartArea.left || x > chartArea.right) continue;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + RUG_HEIGHT_PX);
        ctx.stroke();
      }
      ctx.restore();
    };

    drawRug(opts.speciesA, chartArea.bottom - 2 * RUG_HEIGHT_PX - 2, opts.colorA ?? SPECIES_A_COLOR);
    drawRug(opts.speciesB, chartArea.bottom - RUG_HEIGHT_PX, opts.colorB ?? SPECIES_B_COLOR);
  },
};

ChartJS.register(twilightBandsPlugin, rugTicksPlugin);

interface ActivityOverlapChartProps {
  data: ActivityOverlapResponse;
}

const SAMPLES = 240;
const GRID_HOURS: number[] = Array.from({ length: SAMPLES }, (_, i) => (24 * i) / SAMPLES);

export function ActivityOverlapChart({ data }: ActivityOverlapChartProps) {
  const timeAxis = data.time_axis;
  const sunShift =
    timeAxis === 'sun' && data.anchor_sun_bands ? data.anchor_sun_bands.sunrise : 0;

  const gridX = useMemo(() => GRID_HOURS.map((h) => h - sunShift), [sunShift]);

  const overlapMin = useMemo(() => {
    if (!data.species_b) return null;
    const a = data.species_a.kde_density;
    const b = data.species_b.kde_density;
    return a.map((v, i) => Math.min(v, b[i] ?? 0));
  }, [data]);

  const chartData: ChartData<'line'> = useMemo(() => {
    const datasets: ChartData<'line'>['datasets'] = [];

    if (overlapMin && data.species_b) {
      datasets.push({
        label: 'Overlap',
        data: overlapMin,
        borderColor: 'transparent',
        backgroundColor: OVERLAP_FILL,
        fill: 'origin',
        pointRadius: 0,
        tension: 0.4,
        order: 3,
      });
    }

    datasets.push({
      label: data.species_a.label,
      data: data.species_a.kde_density,
      borderColor: SPECIES_A_COLOR,
      backgroundColor: 'transparent',
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.4,
      fill: false,
      order: 1,
    });

    if (data.species_b) {
      datasets.push({
        label: data.species_b.label,
        data: data.species_b.kde_density,
        borderColor: SPECIES_B_COLOR,
        backgroundColor: 'transparent',
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.4,
        fill: false,
        order: 2,
      });
    }

    return { labels: gridX, datasets };
  }, [data, overlapMin, gridX]);

  const options: ChartOptions<'line'> = useMemo(() => {
    const isSun = timeAxis === 'sun';
    const xTitle = isSun ? '' : 'Hour of day (server local)';
    const rawBands = isSun ? data.anchor_sun_bands : data.sun_bands;
    const bandsForMode = rawBands
      ? {
          dawn: rawBands.dawn - sunShift,
          sunrise: rawBands.sunrise - sunShift,
          sunset: rawBands.sunset - sunShift,
          dusk: rawBands.dusk - sunShift,
        }
      : null;
    const xMin = 0 - sunShift;
    const xMax = 24 - sunShift;
    const dayLength = rawBands ? rawBands.sunset - rawBands.sunrise : 0;
    const dawnPos = bandsForMode?.dawn ?? 0;
    const sunrisePos = 0;
    const noonPos = dayLength / 2;
    const sunsetPos = dayLength;
    const duskPos = bandsForMode?.dusk ?? 0;
    const TOL = 0.01;
    const fmtTick = (value: number): string => {
      if (!isSun) return `${String(value).padStart(2, '0')}:00`;
      if (Math.abs(value - xMin) < TOL || Math.abs(value - xMax) < TOL) return 'midnight';
      if (Math.abs(value - dawnPos) < TOL) return 'dawn';
      if (Math.abs(value - sunrisePos) < TOL) return 'sunrise';
      if (Math.abs(value - noonPos) < TOL) return 'noon';
      if (Math.abs(value - sunsetPos) < TOL) return 'sunset';
      if (Math.abs(value - duskPos) < TOL) return 'dusk';
      return '';
    };
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 200 },
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          type: 'linear',
          min: xMin,
          max: xMax,
          ticks: {
            ...(isSun
              ? { autoSkip: false, callback: (v) => fmtTick(Number(v)) }
              : { stepSize: 3, callback: (v) => fmtTick(Number(v)) }),
          },
          afterBuildTicks:
            isSun && rawBands
              ? (scale) => {
                  scale.ticks = [
                    { value: xMin },
                    { value: sunrisePos },
                    { value: noonPos },
                    { value: sunsetPos },
                    { value: xMax },
                  ];
                }
              : undefined,
          title: { display: !!xTitle, text: xTitle },
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Activity density' },
          ticks: { callback: (value) => Number(value).toFixed(2) },
        },
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { filter: (item) => item.text !== 'Overlap' },
        },
        tooltip: {
          callbacks: {
            title: (items) => {
              const x = Number(items[0]?.label ?? 0);
              if (isSun) {
                if (x < dawnPos) return 'night';
                if (x < sunrisePos) return 'dawn';
                if (x < sunsetPos) return 'day';
                if (x < duskPos) return 'dusk';
                return 'night';
              }
              const h = Math.floor(x);
              const m = Math.round((x - h) * 60);
              return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            },
            label: (item) => {
              if (item.dataset.label === 'Overlap') return '';
              return `${item.dataset.label} ${item.parsed.y.toFixed(3)}`;
            },
          },
        },
        // @ts-expect-error custom plugin options aren't in Chart.js's typings
        twilightBands: { sunBands: bandsForMode, visible: bandsForMode !== null },
        // @ts-expect-error custom plugin options aren't in Chart.js's typings
        rugTicks: {
          speciesA: data.species_a.raw_detection_times.map((t) => t - sunShift),
          speciesB: data.species_b?.raw_detection_times.map((t) => t - sunShift),
          colorA: SPECIES_A_COLOR,
          colorB: SPECIES_B_COLOR,
        },
      },
    };
  }, [data, timeAxis, sunShift]);

  return (
    <div className="h-full w-full">
      <Line data={chartData} options={options} />
    </div>
  );
}
