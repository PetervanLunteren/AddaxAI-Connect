/**
 * Color scale utilities for detection rate map visualization
 * Uses chroma.js for color interpolation
 */
import chroma from 'chroma-js';

/**
 * Generate color from detection rate using peach-to-purple gradient
 *
 * Color scheme (inspired by sequential hexbin maps):
 * - Light peach (#f4d7b0): Low detection rates
 * - Coral (#f29e7c): Low-medium detection rates
 * - Pink/magenta (#d9537c): Medium detection rates
 * - Purple (#9c4f8f): Medium-high detection rates
 * - Dark purple (#6b3a7c): High detection rates
 *
 * @param rate - Detection rate per 100 trap-days
 * @param maxRate - Maximum rate for scaling (auto-calculated if not provided)
 * @returns Hex color string
 */
export function getDetectionRateColor(rate: number, maxRate?: number): string {
  // Handle zero/negative rates
  if (rate <= 0) {
    return '#d1d5db';  // Light gray for zero detections
  }

  // Create color scale: light peach -> coral -> pink -> purple -> dark purple
  const colorScale = chroma.scale([
    '#f4d7b0',  // Light peach
    '#f29e7c',  // Coral
    '#d9537c',  // Pink/magenta
    '#9c4f8f',  // Purple
    '#6b3a7c',  // Dark purple
  ]).mode('lab');

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

  // Zero detections (light gray)
  items.push({
    color: '#d1d5db',
    label: '0',
  });

  if (domain.max > 0) {
    // Low (light peach)
    items.push({
      color: '#f4d7b0',
      label: `${domain.min.toFixed(1)} - ${domain.p33.toFixed(1)}`,
    });

    // Medium (pink/magenta)
    items.push({
      color: '#d9537c',
      label: `${domain.p33.toFixed(1)} - ${domain.p66.toFixed(1)}`,
    });

    // High (dark purple)
    items.push({
      color: '#6b3a7c',
      label: `${domain.p66.toFixed(1)} - ${domain.max.toFixed(1)}`,
    });
  }

  return items;
}
