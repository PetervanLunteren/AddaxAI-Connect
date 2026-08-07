/**
 * Metric definitions for the detection rate map.
 *
 * One metric describes how a site's number is derived, how several sites
 * pool into a hexbin or cluster, when a marker renders hollow (no data),
 * and how values are formatted. Pooling must live here because it differs
 * per metric: abundance is an effort-weighted ratio of sums, richness is
 * a set union of species, effort is a plain sum, and Shannon needs the
 * pooled per-species counts. A single per-site number cannot be
 * aggregated correctly without knowing which metric it is.
 *
 * Richness and Shannon count wildlife only. Person and vehicle are
 * detector categories, not species, so they never contribute to
 * biodiversity numbers. Abundance keeps counting them, unchanged.
 */
import type { SiteFeatureProperties } from '../api/types';
import { isWildlifeLabel } from './labels';

export type MapMetricId = 'abundance' | 'richness' | 'effort' | 'shannon';

export const DEFAULT_MAP_METRIC: MapMetricId = 'abundance';

export interface MapMetric {
  id: MapMetricId;
  /** Option label in the metric select and popup row label. */
  label: string;
  /** Two-line legend title. */
  legendLines: [string, string];
  /** Legend footer for the hollow marker, null hides the footer. */
  emptyLabel: string | null;
  /** The number for a single site. */
  siteValue(p: SiteFeatureProperties): number;
  /** The number for a hexbin or cluster of sites. */
  aggregate(list: SiteFeatureProperties[]): number;
  /** True when the site has no data for this metric (hollow marker). */
  isEmpty(p: SiteFeatureProperties): boolean;
  /** Popup value, with units. */
  formatValue(v: number): string;
  /** Short form for the cluster circle and legend ticks. */
  formatShort(v: number): string;
}

/** Per-species counts with the detector categories (person, vehicle) dropped. */
const wildlifeCounts = (p: SiteFeatureProperties): number[] =>
  Object.entries(p.species_counts)
    .filter(([species]) => isWildlifeLabel(species))
    .map(([, count]) => count);

const wildlifeSpecies = (p: SiteFeatureProperties): string[] =>
  Object.keys(p.species_counts).filter(isWildlifeLabel);

/** Shannon index H' = -sum(p_i ln p_i). Zero for empty or single-species. */
const shannonIndex = (counts: number[]): number => {
  const total = counts.reduce((s, c) => s + c, 0);
  if (total === 0) return 0;
  return -counts.reduce((h, c) => {
    if (c === 0) return h;
    const p = c / total;
    return h + p * Math.log(p);
  }, 0);
};

/** Pooled per-species counts across sites, wildlife only. */
const pooledWildlifeCounts = (list: SiteFeatureProperties[]): number[] => {
  const pooled: Record<string, number> = {};
  for (const p of list) {
    for (const [species, count] of Object.entries(p.species_counts)) {
      if (isWildlifeLabel(species)) {
        pooled[species] = (pooled[species] ?? 0) + count;
      }
    }
  }
  return Object.values(pooled);
};

export const MAP_METRICS: Record<MapMetricId, MapMetric> = {
  abundance: {
    id: 'abundance',
    label: 'Abundance',
    legendLines: ['Detections per', '100 trap-days'],
    emptyLabel: 'No detections',
    siteValue: (p) => p.detection_rate_per_100,
    // Effort-weighted ratio of sums, identical to the pre-metric behaviour
    aggregate: (list) => {
      const detections = list.reduce((s, p) => s + p.detection_count, 0);
      const trapDays = list.reduce((s, p) => s + p.trap_days, 0);
      return trapDays > 0 ? (detections / trapDays) * 100 : 0;
    },
    isEmpty: (p) => p.detection_count === 0,
    formatValue: (v) => `${v.toFixed(2)} per 100 trap-days`,
    formatShort: (v) => String(Math.round(v)),
  },
  richness: {
    id: 'richness',
    label: 'Species richness',
    legendLines: ['Species', 'observed'],
    emptyLabel: 'No wildlife',
    siteValue: (p) => wildlifeSpecies(p).length,
    // Union of species across the pooled sites, not a sum
    aggregate: (list) => {
      const union = new Set<string>();
      for (const p of list) {
        for (const species of wildlifeSpecies(p)) union.add(species);
      }
      return union.size;
    },
    isEmpty: (p) => wildlifeSpecies(p).length === 0,
    formatValue: (v) => `${v} species`,
    formatShort: (v) => String(v),
  },
  effort: {
    id: 'effort',
    label: 'Trap effort',
    legendLines: ['Trap-days', 'of effort'],
    emptyLabel: null,
    siteValue: (p) => p.trap_days,
    aggregate: (list) => list.reduce((s, p) => s + p.trap_days, 0),
    // A deployed site always has effort, so never hollow
    isEmpty: () => false,
    formatValue: (v) => `${v} trap-days`,
    formatShort: (v) => String(Math.round(v)),
  },
  shannon: {
    id: 'shannon',
    label: 'Shannon diversity',
    legendLines: ['Shannon', "diversity H'"],
    emptyLabel: 'No wildlife',
    siteValue: (p) => shannonIndex(wildlifeCounts(p)),
    // H' of the pooled per-species counts, not a mean of site indices
    aggregate: (list) => shannonIndex(pooledWildlifeCounts(list)),
    isEmpty: (p) => wildlifeSpecies(p).length === 0,
    formatValue: (v) => `H' = ${v.toFixed(2)}`,
    formatShort: (v) => v.toFixed(1),
  },
};
