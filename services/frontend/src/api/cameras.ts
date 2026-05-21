/**
 * Camera API endpoints
 *
 * Includes both health monitoring (for all users) and management (admin only) operations.
 */
import apiClient from './client';
import type { Camera, HealthHistoryResponse, HealthHistoryFilters } from './types';

// Request types for camera management
export interface CreateCameraRequest {
  device_id: string;
  friendly_name?: string;
  notes?: string;
  custom_fields?: Record<string, string>;
  tags?: string[];
  project_id: number;
  sim_expiry_date?: string | null;  // YYYY-MM-DD, null clears
}

export interface UpdateCameraRequest {
  friendly_name?: string;
  custom_fields?: Record<string, string>;
  notes?: string;
  tags?: string[];
  sim_expiry_date?: string | null;  // YYYY-MM-DD; null clears the field
}

export interface CameraImportRow {
  row_number: number;
  device_id: string;
  success: boolean;
  error?: string;
  camera_id?: number;
}

export interface BulkImportResponse {
  success_count: number;
  failed_count: number;
  results: CameraImportRow[];
}

export interface BulkUpdateResponse {
  updated_count: number;
}

export interface CameraDeployment {
  id: number;
  deployment_number: number;
  site_id: number | null;
  site_name: string | null;
  label: string | null;
  latitude: number | null;
  longitude: number | null;
  start_date: string | null;
  end_date: string | null;
  image_count: number;
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

  /**
   * Append the given tags to every selected camera. Existing tags are
   * kept; duplicates collapse via the backend's normalize_tags helper.
   */
  bulkAddTags: async (cameraIds: number[], tags: string[]): Promise<BulkUpdateResponse> => {
    const response = await apiClient.post<BulkUpdateResponse>(
      '/api/cameras/bulk-add-tags',
      { camera_ids: cameraIds, tags },
    );
    return response.data;
  },

  /**
   * Remove the given tags from every selected camera. Tags not present
   * on a row are a no-op for that row.
   */
  bulkRemoveTags: async (cameraIds: number[], tags: string[]): Promise<BulkUpdateResponse> => {
    const response = await apiClient.post<BulkUpdateResponse>(
      '/api/cameras/bulk-remove-tags',
      { camera_ids: cameraIds, tags },
    );
    return response.data;
  },

  /**
   * Set sim_expiry_date on every selected camera. Pass null to clear.
   */
  bulkSetSimExpiry: async (
    cameraIds: number[],
    simExpiryDate: string | null,
  ): Promise<BulkUpdateResponse> => {
    const response = await apiClient.post<BulkUpdateResponse>(
      '/api/cameras/bulk-set-sim-expiry',
      { camera_ids: cameraIds, sim_expiry_date: simExpiryDate },
    );
    return response.data;
  },

  /**
   * Replace notes on every selected camera with the given string. Empty
   * string clears the field on each row.
   */
  bulkSetNotes: async (cameraIds: number[], notes: string): Promise<BulkUpdateResponse> => {
    const response = await apiClient.post<BulkUpdateResponse>(
      '/api/cameras/bulk-set-notes',
      { camera_ids: cameraIds, notes },
    );
    return response.data;
  },

  /**
   * Get all unique tags across cameras in a project
   */
  getTags: async (projectId?: number): Promise<string[]> => {
    const params: Record<string, string> = {};
    if (projectId !== undefined) params.project_id = projectId.toString();
    const response = await apiClient.get<string[]>('/api/cameras/tags', { params });
    return response.data;
  },

  /**
   * Get camera health history for charts
   */
  getHealthHistory: async (id: number, filters?: HealthHistoryFilters): Promise<HealthHistoryResponse> => {
    const params = new URLSearchParams();
    if (filters?.days) params.append('days', filters.days.toString());
    if (filters?.start_date) params.append('start_date', filters.start_date);
    if (filters?.end_date) params.append('end_date', filters.end_date);

    const queryString = params.toString();
    const url = queryString
      ? `/api/cameras/${id}/health-history?${queryString}`
      : `/api/cameras/${id}/health-history`;

    const response = await apiClient.get<HealthHistoryResponse>(url);
    return response.data;
  },

  /**
   * Upload a reference image for a camera (project admin or server admin)
   */
  uploadReferenceImage: async (id: number, file: File): Promise<Camera> => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await apiClient.post<Camera>(
      `/api/cameras/${id}/reference-image`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return response.data;
  },

  /**
   * Delete a camera's reference image
   */
  deleteReferenceImage: async (id: number): Promise<Camera> => {
    const response = await apiClient.delete<Camera>(`/api/cameras/${id}/reference-image`);
    return response.data;
  },

  /**
   * Deployment history for a camera (where it has been, oldest first).
   */
  getDeployments: async (id: number): Promise<CameraDeployment[]> => {
    const response = await apiClient.get<CameraDeployment[]>(`/api/cameras/${id}/deployments`);
    return response.data;
  },
};
