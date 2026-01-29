/**
 * Color scale utilities for detection rate map visualization
 * Uses chroma.js for color interpolation
 */
import chroma from 'chroma-js';

/**
 * Generate color from detection rate using blue-yellow-red gradient
 *
 * Color scheme:
 * - Blue (#3b82f6): Low detection rates (0-33rd percentile)
 * - Yellow (#eab308): Medium detection rates (33rd-66th percentile)
 * - Red (#ef4444): High detection rates (66th-100th percentile)
 *
 * @param rate - Detection rate per 100 trap-days
 * @param maxRate - Maximum rate for scaling (auto-calculated if not provided)
 * @returns Hex color string
 */
export function getDetectionRateColor(rate: number, maxRate?: number): string {
  // Handle zero/negative rates
  if (rate <= 0) {
    return '#94a3b8';  // Gray for zero detections
  }

  // Create color scale: blue -> yellow -> red
  const colorScale = chroma.scale(['#3b82f6', '#eab308', '#ef4444']).mode('lab');

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

  // Zero detections (gray)
  items.push({
    color: '#94a3b8',
    label: '0',
  });

  if (domain.max > 0) {
    // Low (blue)
    items.push({
      color: '#3b82f6',
      label: `${domain.min.toFixed(1)} - ${domain.p33.toFixed(1)}`,
    });

    // Medium (yellow)
    items.push({
      color: '#eab308',
      label: `${domain.p33.toFixed(1)} - ${domain.p66.toFixed(1)}`,
    });

    // High (red)
    items.push({
      color: '#ef4444',
      label: `${domain.p66.toFixed(1)} - ${domain.max.toFixed(1)}`,
    });
  }

  return items;
}
