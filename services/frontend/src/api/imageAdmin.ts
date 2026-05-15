/**
 * Image admin API endpoints
 */
import apiClient from './client';
import type { ImageListItem, PaginatedResponse } from './types';

export interface AdminImageFilterParams {
  camera_id?: number;
  start_date?: string;
  end_date?: string;
  species?: string;
  verified?: string;
  hidden?: string;
  search?: string;
  tags?: string;
  liked?: string;
  needs_review?: string;
  min_detection_confidence?: number;
  max_detection_confidence?: number;
  min_classification_confidence?: number;
  max_classification_confidence?: number;
}

export interface AdminImageListFilters extends AdminImageFilterParams {
  project_id: number;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_dir?: string;
}

export interface BulkActionResponse {
  success_count: number;
  failed_count: number;
  errors: string[];
}

/**
 * Bulk action target. Either an explicit uuid list (per-page selection)
 * or a filter set that the backend resolves on the fly (select all
 * matching across pages).
 */
export type BulkActionTarget =
  | { image_uuids: string[]; filters?: undefined }
  | { filters: AdminImageFilterParams; image_uuids?: undefined };

export const imageAdminApi = {
  getAll: async (filters: AdminImageListFilters): Promise<PaginatedResponse<ImageListItem>> => {
    const response = await apiClient.get<PaginatedResponse<ImageListItem>>('/api/admin/images', {
      params: filters,
    });
    return response.data;
  },

  bulkHide: async (projectId: number, target: BulkActionTarget): Promise<BulkActionResponse> => {
    const response = await apiClient.post<BulkActionResponse>(
      '/api/admin/images/hide',
      target,
      { params: { project_id: projectId } },
    );
    return response.data;
  },

  bulkUnhide: async (projectId: number, target: BulkActionTarget): Promise<BulkActionResponse> => {
    const response = await apiClient.post<BulkActionResponse>(
      '/api/admin/images/unhide',
      target,
      { params: { project_id: projectId } },
    );
    return response.data;
  },

  bulkDelete: async (projectId: number, target: BulkActionTarget): Promise<BulkActionResponse> => {
    const response = await apiClient.post<BulkActionResponse>(
      '/api/admin/images/delete',
      target,
      { params: { project_id: projectId } },
    );
    return response.data;
  },

  bulkDownload: async (projectId: number, target: BulkActionTarget): Promise<{ blob: Blob; filename: string }> => {
    const response = await apiClient.post<Blob>(
      '/api/admin/images/download',
      target,
      { params: { project_id: projectId }, responseType: 'blob' },
    );
    const disposition = response.headers['content-disposition'] ?? '';
    const match = /filename="([^"]+)"/.exec(disposition);
    const filename = match?.[1] ?? `images-${projectId}.zip`;
    return { blob: response.data, filename };
  },
};
