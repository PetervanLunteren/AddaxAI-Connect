/**
 * Version and system info API client
 *
 * Fetches version and model information from the backend API
 */
import apiClient from './client';

export interface VersionResponse {
  version: string;
  // Short commit hash the api image was built from, "unknown" outside a
  // container build.
  commit: string;
}

export interface ClassificationModelResponse {
  name: string;
  url: string;
  description: string;
}

export const versionApi = {
  /**
   * Get application version and build commit from API
   */
  getVersion: async (): Promise<VersionResponse> => {
    const response = await apiClient.get<VersionResponse>('/api/version');
    return response.data;
  },

  /**
   * Get classification model display info
   */
  getClassificationModel: async (): Promise<ClassificationModelResponse> => {
    const response = await apiClient.get<ClassificationModelResponse>('/api/classification-model');
    return response.data;
  },
};
