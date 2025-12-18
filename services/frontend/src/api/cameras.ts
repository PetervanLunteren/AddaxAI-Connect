/**
 * Camera API endpoints
 */
import apiClient from './client';
import type { Camera } from './types';

export const camerasApi = {
  /**
   * Get all cameras with health status
   */
  getAll: async (): Promise<Camera[]> => {
    const response = await apiClient.get<Camera[]>('/api/cameras');
    return response.data;
  },

  /**
   * Get single camera by ID
   */
  getById: async (id: number): Promise<Camera> => {
    const response = await apiClient.get<Camera>(`/api/cameras/${id}`);
    return response.data;
  },
};
