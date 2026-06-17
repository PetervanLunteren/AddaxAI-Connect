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
    | 'failed'
    | 'cancelled';
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

export interface ScanProfileEntry {
  make: string | null;
  model: string | null;
  serial: string | null;
  filename: string;
}

export interface ScanProfileResponse {
  // "profile" = an EXIF camera profile matched (Mode A, no site prompt).
  // "manual" = no profile, the user must pick a site (Mode B).
  mode: 'profile' | 'manual';
  device_id: string | null;
  profile_name: string | null;
  camera_registered: boolean;
  camera_id: number | null;
  // Set when the sample resolves more than one camera; the batch must be
  // split per camera before uploading.
  multiple_cameras: boolean;
  device_ids: string[];
}

export const bulkUploadApi = {
  /**
   * Run the same camera-profile hunt as live ingestion against the EXIF read
   * locally, to decide the upload mode before any byte is sent. Returns
   * 'profile' mode with the resolved device_id, or 'manual' mode (pick a site).
   */
  scanProfile: async (
    projectId: number,
    entries: ScanProfileEntry[],
  ): Promise<ScanProfileResponse> => {
    const response = await apiClient.post<ScanProfileResponse>(
      `/api/projects/${projectId}/bulk-upload/scan-profile`,
      { entries },
    );
    return response.data;
  },

  /**
   * For the picked camera, return a map of naive EXIF timestamps to
   * the number of Image rows that already exist at that timestamp.
   * The client applies a 1:1 safety rule before deciding to skip:
   * only skip when both the scan and the DB have exactly one entry
   * at a timestamp. Multi-match cases (burst mode) go through and
   * server-side content-hash dedup sorts them out.
   */
  checkDuplicates: async (
    projectId: number,
    cameraId: number,
    capturedAts: string[],
  ): Promise<Record<string, number>> => {
    if (capturedAts.length === 0) return {};
    const response = await apiClient.post<{ duplicate_counts: Record<string, number> }>(
      `/api/projects/${projectId}/bulk-upload/check-duplicates`,
      { camera_id: cameraId, captured_ats: capturedAts },
    );
    return response.data.duplicate_counts;
  },

  /**
   * Create an empty job. Returns the job uuid which the client uses
   * for every per-file POST.
   */
  createJob: async (
    projectId: number,
    body: {
      folder_name: string;
      // Exactly one of device_id (Mode A, profile-matched camera) or site_id
      // (Mode B, manual site + synthetic camera).
      device_id?: string;
      site_id?: number;
      total_files: number;
      total_bytes: number;
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

  /**
   * List the file indexes already in the job's staging prefix. Used
   * by the client during resume to skip files that landed before the
   * previous tab closed.
   */
  uploadedIndexes: async (
    projectId: number,
    jobUuid: string,
  ): Promise<number[]> => {
    const response = await apiClient.get<{ indexes: number[] }>(
      `/api/projects/${projectId}/bulk-upload/jobs/${jobUuid}/uploaded-indexes`,
    );
    return response.data.indexes;
  },

  /**
   * URL for the per-file CSV log of a job. Used as the href on the
   * "Download log" button so the browser handles the streamed
   * download natively.
   */
  logCsvUrl: (projectId: number, jobUuid: string): string =>
    `/api/projects/${projectId}/bulk-upload/jobs/${jobUuid}/log.csv`,

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

  /**
   * Delete every image imported by this job (cleanup after stopping it).
   * The job row stays; discard it separately.
   */
  deleteImages: async (
    projectId: number,
    jobUuid: string,
  ): Promise<{ deleted: number; failed: number }> => {
    const response = await apiClient.delete<{ deleted: number; failed: number }>(
      `/api/projects/${projectId}/bulk-upload/jobs/${jobUuid}/images`,
    );
    return response.data;
  },
};
