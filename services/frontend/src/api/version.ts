/**
 * Version API client
 *
 * Fetches version information from the backend API
 */
import apiClient from './client';

export interface VersionInfo {
  message: string;
  status: string;
  version: string;
}

export const versionApi = {
  /**
   * Get application version from API
   */
  getVersion: async (): Promise<string> => {
    const response = await apiClient.get<VersionInfo>('/');
    return response.data.version;
  },
};
