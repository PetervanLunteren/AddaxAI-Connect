/**
 * Version and system info API client
 *
 * Fetches version and model information from the backend API
 */
import apiClient from './client';

export interface VersionResponse {
  version: string;
}

export interface ClassificationModelResponse {
  name: string;
  url: string;
  description: string;
}

export const versionApi = {
  /**
   * Get application version from API
   */
  getVersion: async (): Promise<string> => {
    const response = await apiClient.get<VersionResponse>('/api/version');
    return response.data.version;
  },

  /**
   * Get classification model display info
   */
  getClassificationModel: async (): Promise<ClassificationModelResponse> => {
    const response = await apiClient.get<ClassificationModelResponse>('/api/classification-model');
    return response.data;
  },
};
