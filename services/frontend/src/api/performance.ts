/**
 * Performance API endpoint.
 *
 * Returns both a per-species aggregate (instance-level human vs AI counts)
 * and an image-level top-1 confusion matrix for a project.
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
}

export interface PerformanceFilters {
  /** Comma-separated camera IDs */
  camera_ids?: string;
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
          camera_ids: filters?.camera_ids,
          start_date: filters?.start_date,
          end_date: filters?.end_date,
        },
      },
    );
    return response.data;
  },
};
