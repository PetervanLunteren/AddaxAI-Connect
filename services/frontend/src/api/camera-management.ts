/**
 * API client for camera management endpoints
 */
import apiClient from './client';

export interface Camera {
  id: number;
  name: string;
  imei?: string;
  serial_number?: string;
  box?: string;
  order?: string;
  scanned_date?: string;  // ISO date string
  firmware?: string;
  remark?: string;
  has_sim?: boolean;
  imsi?: string;
  iccid?: string;
  location?: { lat: number; lon: number };
  battery_percentage?: number;
  temperature?: number;
  signal_quality?: number;
  sd_utilization_percentage?: number;
  last_report_timestamp?: string;
  status: string;
  total_images?: number;
  sent_images?: number;
}

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

/**
 * Get all cameras (optionally filtered by project)
 */
export const getCameras = async (projectId?: number): Promise<Camera[]> => {
  const params = projectId ? { project_id: projectId } : {};
  const response = await apiClient.get<Camera[]>('/api/cameras', { params });
  return response.data;
};

/**
 * Create a new camera (superuser only)
 */
export const createCamera = async (data: CreateCameraRequest): Promise<Camera> => {
  const response = await apiClient.post<Camera>('/api/cameras', data);
  return response.data;
};

/**
 * Update camera metadata (superuser only)
 */
export const updateCamera = async (id: number, data: UpdateCameraRequest): Promise<Camera> => {
  const response = await apiClient.put<Camera>(`/api/cameras/${id}`, data);
  return response.data;
};

/**
 * Delete camera (superuser only)
 */
export const deleteCamera = async (id: number): Promise<void> => {
  await apiClient.delete(`/api/cameras/${id}`);
};

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

/**
 * Import cameras from CSV file (superuser only)
 */
export const importCamerasCSV = async (
  file: File,
  projectId?: number
): Promise<BulkImportResponse> => {
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
};
