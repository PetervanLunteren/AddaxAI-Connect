/**
 * Bulk image upload API client
 *
 * Project-admin endpoints. The flow is two-phase: upload a ZIP, the
 * server inspects and writes a manifest, the user reviews and confirms
 * with a camera_id, then the worker processes the pipeline.
 */
import apiClient from './client';

export interface BulkUploadManifest {
  total_entries: number;
  valid_count: number;
  by_status: Record<string, number>;
  date_range: {
    start: string | null;
    end: string | null;
  };
  suggested_camera: {
    camera_id: number;
    camera_name: string;
    device_id: string | null;
    match_count: number;
  } | null;
  // Added by the worker once the process phase finishes. Lets the UI
  // split "duplicates" out from "other skips" so a re-upload of an
  // already-imported SD card reads as "all duplicates" rather than
  // the misleading "0 of 30 processed".
  process_summary?: {
    queued_for_pipeline: number;
    duplicates: number;
    other_skipped: number;
  };
}

export interface BulkUploadJob {
  uuid: string;
  project_id: number;
  camera_id: number | null;
  camera_name: string | null;
  original_filename: string;
  status:
    | 'queued'
    | 'inspecting'
    | 'awaiting_confirmation'
    | 'processing'
    | 'done'
    | 'failed';
  total_files: number;
  processed_files: number;
  skipped_files: number;
  error_message: string | null;
  manifest: BulkUploadManifest | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  created_by_email: string | null;
}

export const bulkUploadApi = {
  /**
   * Upload a ZIP and queue it for inspection. Returns the job in
   * `queued` status; the worker will move it to `inspecting` then
   * `awaiting_confirmation`. The frontend polls until it sees the
   * manifest, then prompts the user to confirm with a camera.
   */
  upload: async (
    projectId: number,
    file: File,
    onProgress?: (percent: number) => void,
  ): Promise<BulkUploadJob> => {
    const data = new FormData();
    data.append('file', file);
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

  confirm: async (
    projectId: number,
    jobUuid: string,
    cameraId: number,
  ): Promise<BulkUploadJob> => {
    const response = await apiClient.post<BulkUploadJob>(
      `/api/projects/${projectId}/bulk-upload/jobs/${jobUuid}/confirm`,
      { camera_id: cameraId },
    );
    return response.data;
  },

  cancel: async (projectId: number, jobUuid: string): Promise<BulkUploadJob> => {
    const response = await apiClient.post<BulkUploadJob>(
      `/api/projects/${projectId}/bulk-upload/jobs/${jobUuid}/cancel`,
    );
    return response.data;
  },
};
