/**
 * Debug API functions
 */
import apiClient from './client';

export interface UploadResponse {
  success: boolean;
  filename: string;
  message: string;
}

export interface ClearDataResponse {
  success: boolean;
  message: string;
  deleted_counts: {
    classifications: number;
    detections: number;
    images: number;
    cameras: number;
    minio_raw_images: number;
    minio_crops: number;
    minio_thumbnails: number;
    ftps_files: number;
  };
}

/**
 * Upload file directly to FTPS directory (superuser only)
 */
export const uploadFile = async (file: File): Promise<UploadResponse> => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await apiClient.post<UploadResponse>(
    '/api/debug/upload',
    formData,
    {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    }
  );

  return response.data;
};

/**
 * Clear all data from database, MinIO, and FTPS directory (superuser only)
 */
export const clearAllData = async (): Promise<ClearDataResponse> => {
  const response = await apiClient.post<ClearDataResponse>('/api/debug/clear-all-data');
  return response.data;
};
