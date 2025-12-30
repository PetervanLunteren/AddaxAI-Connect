/**
 * API client for ingestion monitoring endpoints
 */
import apiClient from './client';

export interface RejectedFile {
  filename: string;
  reason: string;
  filepath: string;
  timestamp: number;
  size_bytes: number;
  imei: string | null;
  error_details: string | null;
  rejected_at: string | null;
  exif_metadata: Record<string, any> | null;
}

export interface RejectedFilesResponse {
  total_count: number;
  by_reason: Record<string, RejectedFile[]>;
}

export interface BulkActionResponse {
  success_count: number;
  failed_count: number;
  errors: string[];
}

/**
 * Get all rejected files grouped by rejection reason (superuser only)
 */
export const getRejectedFiles = async (): Promise<RejectedFilesResponse> => {
  const response = await apiClient.get<RejectedFilesResponse>(
    '/api/ingestion-monitoring/rejected-files'
  );
  return response.data;
};

/**
 * Delete rejected files and their error logs (superuser only)
 */
export const deleteRejectedFiles = async (filepaths: string[]): Promise<BulkActionResponse> => {
  const response = await apiClient.post<BulkActionResponse>(
    '/api/ingestion-monitoring/rejected-files/delete',
    { filepaths }
  );
  return response.data;
};

/**
 * Move rejected files back to uploads directory for reprocessing (superuser only)
 */
export const reprocessRejectedFiles = async (filepaths: string[]): Promise<BulkActionResponse> => {
  const response = await apiClient.post<BulkActionResponse>(
    '/api/ingestion-monitoring/rejected-files/reprocess',
    { filepaths }
  );
  return response.data;
};
