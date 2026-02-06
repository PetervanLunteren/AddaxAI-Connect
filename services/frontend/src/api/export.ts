/**
 * Export API client
 */
import apiClient from './client';

export const exportApi = {
  /**
   * Download a CamTrap DP package as a ZIP file
   */
  downloadCamtrapDP: async (projectId: number, includeMedia: boolean): Promise<Blob> => {
    const response = await apiClient.get(
      `/api/projects/${projectId}/export/camtrap-dp`,
      { params: { include_media: includeMedia }, responseType: 'blob' },
    );
    return response.data;
  },
};
