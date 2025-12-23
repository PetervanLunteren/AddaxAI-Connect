/**
 * Images API endpoints
 */
import apiClient from './client';
import type { ImageListItem, ImageDetail, PaginatedResponse } from './types';

export interface ImageFilters {
  page?: number;
  limit?: number;
  camera_id?: string;
  start_date?: string;
  end_date?: string;
  species?: string;
  show_empty?: boolean;
}

export interface SpeciesOption {
  label: string;
  value: string;
}

export const imagesApi = {
  /**
   * Get paginated list of images with filters
   */
  getAll: async (filters?: ImageFilters): Promise<PaginatedResponse<ImageListItem>> => {
    const response = await apiClient.get<PaginatedResponse<ImageListItem>>('/api/images', {
      params: filters,
    });
    return response.data;
  },

  /**
   * Get single image detail by UUID
   */
  getByUuid: async (uuid: string): Promise<ImageDetail> => {
    const response = await apiClient.get<ImageDetail>(`/api/images/${uuid}`);
    return response.data;
  },

  /**
   * Get list of unique species for filter dropdown
   */
  getSpecies: async (): Promise<SpeciesOption[]> => {
    const response = await apiClient.get<SpeciesOption[]>('/api/images/species');
    return response.data;
  },
};
