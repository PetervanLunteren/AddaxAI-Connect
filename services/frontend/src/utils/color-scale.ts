/**
 * Color scale utilities for detection rate map visualization
 * Uses chroma.js for color interpolation
 */
import chroma from 'chroma-js';

/**
 * Generate color from detection rate using YlGnBu ColorBrewer palette
 *
 * Color scheme (Yellow-Green-Blue sequential):
 * - Light yellow: Zero/lowest detection rates
 * - Yellow-green: Low detection rates
 * - Green: Medium detection rates
 * - Blue-green: Medium-high detection rates
 * - Dark blue: High detection rates
 *
 * @param rate - Detection rate per 100 trap-days
 * @param maxRate - Maximum rate for scaling (auto-calculated if not provided)
 * @returns Hex color string
 */
export function getDetectionRateColor(rate: number, maxRate?: number): string {
  // Create color scale using ColorBrewer YlGnBu palette
  const colorScale = chroma.scale('YlGnBu').mode('lab');

  // For zero rates, return the lightest color from the scale
  if (rate <= 0) {
    return colorScale(0).hex();  // Lightest yellow for zero detections
  }

  // Normalize rate to 0-1 range
  const normalizedRate = maxRate && maxRate > 0
    ? Math.min(rate / maxRate, 1.0)
    : 0.5;  // Default to middle if no max provided

  return colorScale(normalizedRate).hex();
}

/**
 * Calculate color scale domain from detection rate data
 *
 * @param rates - Array of detection rates
 * @returns Object with min, max, and percentiles for scale calibration
 */
export function calculateColorScaleDomain(rates: number[]): {
  min: number;
  max: number;
  p33: number;
  p66: number;
} {
  if (rates.length === 0) {
    return { min: 0, max: 0, p33: 0, p66: 0 };
  }

  // Filter out zeros for percentile calculation
  const nonZeroRates = rates.filter(r => r > 0);

  if (nonZeroRates.length === 0) {
    return { min: 0, max: 0, p33: 0, p66: 0 };
  }

  const sorted = [...nonZeroRates].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  // Calculate percentiles
  const p33Index = Math.floor(sorted.length * 0.33);
  const p66Index = Math.floor(sorted.length * 0.66);
  const p33 = sorted[p33Index];
  const p66 = sorted[p66Index];

  return { min, max, p33, p66 };
}

/**
 * Generate legend items for map legend
 *
 * @param domain - Color scale domain from calculateColorScaleDomain
 * @returns Array of legend items with color and label
 */
export function generateLegendItems(domain: {
  min: number;
  max: number;
  p33: number;
  p66: number;
}): Array<{ color: string; label: string }> {
  const items = [];
  const colorScale = chroma.scale('YlGnBu').mode('lab');

  // Zero detections (lightest yellow)
  items.push({
    color: colorScale(0).hex(),
    label: '0',
  });

  if (domain.max > 0) {
    // Low (yellow-green)
    items.push({
      color: colorScale(0.33).hex(),
      label: `${domain.min.toFixed(1)} - ${domain.p33.toFixed(1)}`,
    });

    // Medium (green)
    items.push({
      color: colorScale(0.66).hex(),
      label: `${domain.p33.toFixed(1)} - ${domain.p66.toFixed(1)}`,
    });

    // High (dark blue)
    items.push({
      color: colorScale(1.0).hex(),
      label: `${domain.p66.toFixed(1)} - ${domain.max.toFixed(1)}`,
    });
  }

  return items;
}
