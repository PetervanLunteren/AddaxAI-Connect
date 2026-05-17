/**
 * Bulk image upload API client
 *
 * Per-file flow: the client scans the user's folder locally, picks
 * a camera, asks the server to create an empty job, POSTs every file
 * to the job, then finalizes. The worker takes over for detection
 * and classification.
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
  matched_cameras?: {
    camera_id: number;
    camera_name: string;
    device_id: string | null;
    match_count: number;
  }[];
  // Added by the worker once the process phase finishes. Lets the UI
  // split duplicates out from other skips so a re-upload of an
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
    | 'uploading'
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
  // Only meaningful while status is 'processing'. Number of bulk jobs
  // the worker has to finish before this one starts. 0 = next.
  queue_position: number | null;
  started_at: string | null;
  // When the worker began the actual pipeline work. Drives the
  // self-calibrating ETA in the job list.
  process_started_at: string | null;
  finished_at: string | null;
  created_at: string;
  created_by_email: string | null;
}

export interface ScanSuggestResponse {
  matched_cameras: {
    camera_id: number;
    camera_name: string;
    device_id: string | null;
    match_count: number;
  }[];
  suggested_camera: {
    camera_id: number;
    camera_name: string;
    device_id: string | null;
    match_count: number;
  } | null;
}

export const bulkUploadApi = {
  /**
   * Match EXIF SerialNumbers from the client scan against registered
   * cameras in this project. Returns the auto-suggested camera (if
   * any) and the full match list for the preview UI.
   */
  scanSuggest: async (
    projectId: number,
    serialCounts: Record<string, number>,
  ): Promise<ScanSuggestResponse> => {
    const response = await apiClient.post<ScanSuggestResponse>(
      `/api/projects/${projectId}/bulk-upload/scan-suggest`,
      { serial_counts: serialCounts },
    );
    return response.data;
  },

  /**
   * Create an empty job. Returns the job uuid which the client uses
   * for every per-file POST.
   */
  createJob: async (
    projectId: number,
    body: {
      folder_name: string;
      camera_id: number;
      total_files: number;
      manifest: BulkUploadManifest;
    },
  ): Promise<BulkUploadJob> => {
    const response = await apiClient.post<BulkUploadJob>(
      `/api/projects/${projectId}/bulk-upload/jobs`,
      body,
    );
    return response.data;
  },

  /**
   * Upload one file into a job. The index pins the MinIO key so
   * retries land at the same location (idempotent for resume).
   */
  uploadFile: async (
    projectId: number,
    jobUuid: string,
    index: number,
    file: File,
  ): Promise<void> => {
    const data = new FormData();
    data.append('file', file);
    await apiClient.post(
      `/api/projects/${projectId}/bulk-upload/jobs/${jobUuid}/files?index=${index}`,
      data,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
      },
    );
  },

  /**
   * Mark a job as done uploading and start the worker pipeline.
   */
  finalize: async (
    projectId: number,
    jobUuid: string,
  ): Promise<BulkUploadJob> => {
    const response = await apiClient.post<BulkUploadJob>(
      `/api/projects/${projectId}/bulk-upload/jobs/${jobUuid}/finalize`,
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

  cancel: async (projectId: number, jobUuid: string): Promise<BulkUploadJob> => {
    const response = await apiClient.post<BulkUploadJob>(
      `/api/projects/${projectId}/bulk-upload/jobs/${jobUuid}/cancel`,
    );
    return response.data;
  },

  discard: async (projectId: number, jobUuid: string): Promise<void> => {
    await apiClient.delete(`/api/projects/${projectId}/bulk-upload/jobs/${jobUuid}`);
  },
};
