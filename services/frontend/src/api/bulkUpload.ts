/**
 * Bulk image upload API client
 *
 * Project-admin endpoints for staging a ZIP, queueing the worker, and
 * polling job progress.
 */
import apiClient from './client';

export interface BulkUploadJob {
  uuid: string;
  project_id: number;
  camera_id: number;
  camera_name: string | null;
  original_filename: string;
  status: 'queued' | 'extracting' | 'processing' | 'done' | 'failed';
  total_files: number;
  processed_files: number;
  skipped_files: number;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  created_by_email: string | null;
}

export const bulkUploadApi = {
  /**
   * Upload a ZIP and queue a bulk upload job. Reports upload progress
   * via the optional callback.
   */
  upload: async (
    projectId: number,
    cameraId: number,
    file: File,
    onProgress?: (percent: number) => void,
  ): Promise<BulkUploadJob> => {
    const data = new FormData();
    data.append('file', file);
    data.append('camera_id', String(cameraId));
    const response = await apiClient.post<BulkUploadJob>(
      `/api/projects/${projectId}/bulk-upload`,
      data,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (event) => {
          if (event.total && onProgress) {
            onProgress(Math.round((event.loaded * 100) / event.total));
          }
        },
      },
    );
    return response.data;
  },

  list: async (projectId: number): Promise<BulkUploadJob[]> => {
    const response = await apiClient.get<BulkUploadJob[]>(
      `/api/projects/${projectId}/bulk-upload/jobs`,
    );
    return response.data;
  },

  get: async (projectId: number, jobUuid: string): Promise<BulkUploadJob> => {
    const response = await apiClient.get<BulkUploadJob>(
      `/api/projects/${projectId}/bulk-upload/jobs/${jobUuid}`,
    );
    return response.data;
  },
};
