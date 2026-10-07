/**
 * Performance API endpoint.
 *
 * Returns both a per-species aggregate (human vs AI counts) and a confusion
 * matrix for a project. Both count subjects, not images: an image holding a
 * person next to a car contributes two cells, so a correct prediction on a
 * multi-subject image cannot land off the diagonal.
 */
import apiClient from './client';

export interface PerformanceAggregateRow {
  species: string;
  human_count: number;
  ai_count: number;
  diff: number;
}

export interface PerformanceSiteRow {
  /** Null when the image's deployment has no site */
  site_id: number | null;
  site_name: string;
  verified_images: number;
  subjects: number;
  /** Diagonal share of the site's paired subjects, like matrix_accuracy */
  accuracy: number;
  /** Verified images where the validator recorded nothing */
  empty_images: number;
  empty_rate: number;
}

export interface PerformanceData {
  total_verified_images: number;
  aggregate: PerformanceAggregateRow[];
  matrix_classes: string[];
  matrix: number[][];
  matrix_row_totals: number[];
  matrix_col_totals: number[];
  matrix_correct: number;
  matrix_accuracy: number;
  /** Total cells in the matrix, one per paired subject */
  matrix_subjects: number;
  by_site: PerformanceSiteRow[];
}

export interface PerformanceFilters {
  /** Comma-separated site IDs */
  site_ids?: string;
  /** YYYY-MM-DD */
  start_date?: string;
  /** YYYY-MM-DD */
  end_date?: string;
}

export interface ThresholdCheckStep {
  threshold: number;
  /** Null when nothing passes this threshold */
  precision: number | null;
  recall: number | null;
  f1: number | null;
}

export interface ThresholdCheckData {
  /** Null for the detection threshold */
  species: string | null;
  verified_images: number;
  /** True subjects scored, the same at every step */
  support: number;
  min_support: number;
  steps: ThresholdCheckStep[];
  /** Best F1, null below min_support */
  suggested: number | null;
}

export const performanceApi = {
  /** Scores at each threshold on all verified images, admin only. Omit
   * species to check the detection threshold. */
  thresholdCheck: async (
    projectId: number,
    species: string | null,
  ): Promise<ThresholdCheckData> => {
    const response = await apiClient.get<ThresholdCheckData>(
      '/api/statistics/threshold-check',
      { params: { project_id: projectId, species: species ?? undefined } },
    );
    return response.data;
  },

  get: async (
    projectId: number,
    filters?: PerformanceFilters,
  ): Promise<PerformanceData> => {
    const response = await apiClient.get<PerformanceData>(
      '/api/statistics/performance',
      {
        params: {
          project_id: projectId,
          site_ids: filters?.site_ids,
          start_date: filters?.start_date,
          end_date: filters?.end_date,
        },
      },
    );
    return response.data;
  },
};
