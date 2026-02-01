/**
 * Color scale utilities for detection rate map visualization
 * Uses chroma.js for color interpolation
 *
 * Gradient follows FRONTEND_CONVENTIONS.md:
 * - Light yellow (#f9f871) for low/zero detection rates
 * - Dark teal (#0f6064) for high detection rates
 */
import chroma from 'chroma-js';

/**
 * Generate color from detection rate using app color gradient
 *
 * Uses the standard app gradient from FRONTEND_CONVENTIONS.md:
 * #f9f871 (light yellow, low) -> #0f6064 (dark teal, high)
 *
 * @param rate - Detection rate per 100 trap-days
 * @param maxRate - Maximum rate for scaling (auto-calculated if not provided)
 * @returns Hex color string
 */
export function getDetectionRateColor(rate: number, maxRate?: number): string {
  // App color gradient: light yellow (low) to dark teal (high)
  const colorScale = chroma.scale(['#f9f871', '#0f6064']).mode('lab');

  // For zero rates, return the lightest yellow
  if (rate <= 0) {
    return '#f9f871';
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

  // Zero detections (lightest yellow)
  items.push({
    color: '#f9f871',
    label: '0',
  });

  if (domain.max > 0) {
    // Low (light teal-yellow)
    items.push({
      color: '#b4ca6a',
      label: `${domain.min.toFixed(1)} - ${domain.p33.toFixed(1)}`,
    });

    // Medium (medium teal)
    items.push({
      color: '#5a9868',
      label: `${domain.p33.toFixed(1)} - ${domain.p66.toFixed(1)}`,
    });

    // High (dark teal)
    items.push({
      color: '#0f6064',
      label: `${domain.p66.toFixed(1)} - ${domain.max.toFixed(1)}`,
    });
  }

  return items;
}
