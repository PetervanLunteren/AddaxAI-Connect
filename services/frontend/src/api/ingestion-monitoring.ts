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
}

export interface RejectedFilesResponse {
  total_count: number;
  by_reason: Record<string, RejectedFile[]>;
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
