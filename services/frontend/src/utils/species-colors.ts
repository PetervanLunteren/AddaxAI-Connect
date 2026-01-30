/**
 * Species color mapping utility
 *
 * Generates consistent colors for species names using the viridis palette.
 * Same species always gets the same color across all visualizations.
 */
import chroma from 'chroma-js';

// Viridis palette - perceptually uniform, colorblind-friendly
const viridisScale = chroma.scale('viridis');

/**
 * Generate a deterministic hash from a string.
 * Same input always produces same output.
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Get a consistent color for a species name.
 * Uses hash of species name to pick position on viridis scale.
 *
 * @param species - Species name (e.g., "fox", "roe_deer")
 * @returns Hex color string (e.g., "#440154")
 */
export function getSpeciesColor(species: string): string {
  const hash = hashString(species.toLowerCase());
  const position = (hash % 1000) / 1000; // 0.0 to 1.0
  return viridisScale(position).hex();
}

/**
 * Get colors for an array of species.
 * Each species gets its consistent color.
 *
 * @param speciesList - Array of species names
 * @returns Array of hex color strings
 */
export function getSpeciesColors(speciesList: string[]): string[] {
  return speciesList.map(species => getSpeciesColor(species));
}

/**
 * Get a species color with transparency for backgrounds.
 *
 * @param species - Species name
 * @param alpha - Opacity (0.0 to 1.0), defaults to 0.8
 * @returns CSS color string with alpha (e.g., "rgba(68, 1, 84, 0.8)")
 */
export function getSpeciesColorWithAlpha(species: string, alpha: number = 0.8): string {
  const hash = hashString(species.toLowerCase());
  const position = (hash % 1000) / 1000;
  return viridisScale(position).alpha(alpha).css();
}

/**
 * Get border and background colors for a species (for Chart.js datasets).
 *
 * @param species - Species name
 * @param backgroundAlpha - Background opacity, defaults to 0.8
 * @returns Object with borderColor and backgroundColor
 */
export function getSpeciesChartColors(species: string, backgroundAlpha: number = 0.8): {
  borderColor: string;
  backgroundColor: string;
} {
  return {
    borderColor: getSpeciesColor(species),
    backgroundColor: getSpeciesColorWithAlpha(species, backgroundAlpha),
  };
}
