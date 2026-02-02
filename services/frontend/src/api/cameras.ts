/**
 * Camera API endpoints
 *
 * Includes both health monitoring (for all users) and management (admin only) operations.
 */
import apiClient from './client';
import type { Camera } from './types';

// Request types for camera management
export interface CreateCameraRequest {
  imei: string;
  friendly_name?: string;
  serial_number?: string;
  box?: string;
  order?: string;
  scanned_date?: string;  // ISO date string (YYYY-MM-DD)
  firmware?: string;
  remark?: string;
  has_sim?: boolean;
  imsi?: string;
  iccid?: string;
  project_id: number;
}

export interface UpdateCameraRequest {
  friendly_name?: string;
  serial_number?: string;
  box?: string;
  order?: string;
  scanned_date?: string;  // ISO date string (YYYY-MM-DD)
  firmware?: string;
  remark?: string;
  has_sim?: boolean;
  imsi?: string;
  iccid?: string;
  notes?: string;
}

export interface CameraImportRow {
  row_number: number;
  imei: string;
  success: boolean;
  error?: string;
  camera_id?: number;
}

export interface BulkImportResponse {
  success_count: number;
  failed_count: number;
  results: CameraImportRow[];
}

export const camerasApi = {
  /**
   * Get all cameras with health status (optionally filtered by project)
   */
  getAll: async (projectId?: number): Promise<Camera[]> => {
    const params = projectId ? { project_id: projectId } : {};
    const response = await apiClient.get<Camera[]>('/api/cameras', { params });
    return response.data;
  },

  /**
   * Get single camera by ID
   */
  getById: async (id: number): Promise<Camera> => {
    const response = await apiClient.get<Camera>(`/api/cameras/${id}`);
    return response.data;
  },

  /**
   * Create a new camera (admin only)
   */
  create: async (data: CreateCameraRequest): Promise<Camera> => {
    const response = await apiClient.post<Camera>('/api/cameras', data);
    return response.data;
  },

  /**
   * Update camera metadata (admin only)
   */
  update: async (id: number, data: UpdateCameraRequest): Promise<Camera> => {
    const response = await apiClient.put<Camera>(`/api/cameras/${id}`, data);
    return response.data;
  },

  /**
   * Delete camera (admin only)
   */
  delete: async (id: number): Promise<void> => {
    await apiClient.delete(`/api/cameras/${id}`);
  },

  /**
   * Import cameras from CSV file (admin only)
   */
  importCSV: async (file: File, projectId?: number): Promise<BulkImportResponse> => {
    const formData = new FormData();
    formData.append('file', file);
    if (projectId !== undefined) {
      formData.append('project_id', projectId.toString());
    }

    const response = await apiClient.post<BulkImportResponse>('/api/cameras/import-csv', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },
};
