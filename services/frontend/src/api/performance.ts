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

export const performanceApi = {
  get: async (projectId: number): Promise<PerformanceData> => {
    const response = await apiClient.get<PerformanceData>(
      '/api/statistics/performance',
      { params: { project_id: projectId } },
    );
    return response.data;
  },
};
