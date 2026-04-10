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
  device_id: string | null;
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

export interface UploadFile {
  filename: string;
  filepath: string;
  size_bytes: number;
  timestamp: number;
}

export interface UploadFilesResponse {
  total_count: number;
  files: UploadFile[];
}

/**
 * Get files currently in the uploads folder awaiting processing (server admin only)
 */
export const getUploadFiles = async (): Promise<UploadFilesResponse> => {
  const response = await apiClient.get<UploadFilesResponse>(
    '/api/ingestion-monitoring/upload-files'
  );
  return response.data;
};

// Uploads directory tree

export interface TreeNode {
  name: string;
  type: 'file' | 'directory';
  path: string;
  size_bytes?: number;
  modified_at?: number;
  children?: TreeNode[];
}

export interface UploadsTreeResponse {
  tree: TreeNode[];
  total_files: number;
  total_dirs: number;
  total_size_bytes: number;
}

/**
 * Get the recursive directory tree of the uploads folder (server admin only)
 */
export const getUploadsTree = async (): Promise<UploadsTreeResponse> => {
  const response = await apiClient.get<UploadsTreeResponse>(
    '/api/ingestion-monitoring/uploads-tree'
  );
  return response.data;
};

/**
 * Delete a single file from the uploads directory (server admin only)
 */
export const deleteUploadFile = async (filepath: string): Promise<void> => {
  await apiClient.post('/api/ingestion-monitoring/uploads-tree/delete', { filepath });
};
