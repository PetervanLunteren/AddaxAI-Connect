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
}

export interface PerformanceFilters {
  /** Comma-separated site IDs */
  site_ids?: string;
  /** YYYY-MM-DD */
  start_date?: string;
  /** YYYY-MM-DD */
  end_date?: string;
}

export const performanceApi = {
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
