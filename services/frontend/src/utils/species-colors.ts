/**
 * Species color mapping utility
 *
 * Generates consistent colors for species names using a custom gradient.
 * Colors are assigned based on alphabetical order of species names.
 * Gradient: #0f6064 (dark teal) -> #f9f871 (light yellow)
 */
import chroma from 'chroma-js';

// Custom gradient scale from dark teal to light yellow
const speciesScale = chroma.scale(['#0f6064', '#f9f871']);

// Cache for storing species -> color mappings within a context
let speciesOrderCache: Map<string, number> = new Map();

/**
 * Set the species order context for color assignment.
 * Call this with all species that will be displayed together.
 * Species are sorted alphabetically and assigned colors along the gradient.
 *
 * @param speciesList - Array of all species names in the current context
 */
export function setSpeciesContext(speciesList: string[]): void {
  speciesOrderCache.clear();
  const sorted = [...speciesList].map(s => s.toLowerCase()).sort();
  sorted.forEach((species, index) => {
    const position = sorted.length > 1 ? index / (sorted.length - 1) : 0.5;
    speciesOrderCache.set(species, position);
  });
}

/**
 * Get a consistent color for a species name.
 * Uses alphabetical position to pick color from gradient.
 * Falls back to middle of gradient if species not in context.
 *
 * @param species - Species name (e.g., "fox", "roe_deer")
 * @returns Hex color string (e.g., "#0f6064")
 */
export function getSpeciesColor(species: string): string {
  const position = speciesOrderCache.get(species.toLowerCase()) ?? 0.5;
  return speciesScale(position).hex();
}

/**
 * Get colors for an array of species.
 * Automatically sets the species context and returns colors.
 *
 * @param speciesList - Array of species names
 * @returns Array of hex color strings
 */
export function getSpeciesColors(speciesList: string[]): string[] {
  setSpeciesContext(speciesList);
  return speciesList.map(species => getSpeciesColor(species));
}

/**
 * Get a species color with transparency for backgrounds.
 *
 * @param species - Species name
 * @param alpha - Opacity (0.0 to 1.0), defaults to 0.8
 * @returns CSS color string with alpha (e.g., "rgba(15, 96, 100, 0.8)")
 */
export function getSpeciesColorWithAlpha(species: string, alpha: number = 0.8): string {
  const position = speciesOrderCache.get(species.toLowerCase()) ?? 0.5;
  return speciesScale(position).alpha(alpha).css();
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

/**
 * Get appropriate text color (white or dark) for a species background.
 * Uses WCAG contrast ratio to determine readability.
 *
 * @param species - Species name
 * @returns "white" or "#1f2937" (dark gray) for optimal contrast
 */
export function getSpeciesTextColor(species: string): string {
  const position = speciesOrderCache.get(species.toLowerCase()) ?? 0.5;
  const bgColor = speciesScale(position);
  // Use chroma's contrast calculation - if contrast with white is >= 4.5, use white
  return chroma.contrast(bgColor, 'white') >= 3 ? 'white' : '#1f2937';
}
