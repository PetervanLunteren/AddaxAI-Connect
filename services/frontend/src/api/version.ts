/**
 * Version and system info API client
 *
 * Fetches version information from the backend API
 */
import apiClient from './client';

export interface VersionResponse {
  version: string;
  // Short commit hash the api image was built from, "unknown" outside a
  // container build.
  commit: string;
}

export const versionApi = {
  /**
   * Get application version and build commit from API
   */
  getVersion: async (): Promise<VersionResponse> => {
    const response = await apiClient.get<VersionResponse>('/api/version');
    return response.data;
  },
};
