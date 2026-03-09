/**
 * Image admin API endpoints
 */
import apiClient from './client';
import type { ImageListItem, PaginatedResponse } from './types';

export interface AdminImageFilters {
  project_id: number;
  page?: number;
  limit?: number;
  camera_id?: number;
  start_date?: string;
  end_date?: string;
  species?: string;
  verified?: string;
  hidden?: string;
  search?: string;
  sort_by?: string;
  sort_dir?: string;
}

export interface BulkActionResponse {
  success_count: number;
  failed_count: number;
  errors: string[];
}

export const imageAdminApi = {
  getAll: async (filters: AdminImageFilters): Promise<PaginatedResponse<ImageListItem>> => {
    const response = await apiClient.get<PaginatedResponse<ImageListItem>>('/api/admin/images', {
      params: filters,
    });
    return response.data;
  },

  bulkHide: async (projectId: number, uuids: string[]): Promise<BulkActionResponse> => {
    const response = await apiClient.post<BulkActionResponse>(
      '/api/admin/images/hide',
      { image_uuids: uuids },
      { params: { project_id: projectId } },
    );
    return response.data;
  },

  bulkUnhide: async (projectId: number, uuids: string[]): Promise<BulkActionResponse> => {
    const response = await apiClient.post<BulkActionResponse>(
      '/api/admin/images/unhide',
      { image_uuids: uuids },
      { params: { project_id: projectId } },
    );
    return response.data;
  },

  bulkDelete: async (projectId: number, uuids: string[]): Promise<BulkActionResponse> => {
    const response = await apiClient.post<BulkActionResponse>(
      '/api/admin/images/delete',
      { image_uuids: uuids },
      { params: { project_id: projectId } },
    );
    return response.data;
  },
};
