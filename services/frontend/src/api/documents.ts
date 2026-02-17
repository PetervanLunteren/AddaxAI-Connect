/**
 * Project documents API client
 */
import apiClient from './client';
import { ProjectDocument } from './types';

export const documentsApi = {
  list: async (projectId: number): Promise<ProjectDocument[]> => {
    const response = await apiClient.get(`/api/projects/${projectId}/documents/`);
    return response.data;
  },

  upload: async (projectId: number, file: File, description?: string): Promise<ProjectDocument> => {
    const formData = new FormData();
    formData.append('file', file);
    if (description) {
      formData.append('description', description);
    }
    const response = await apiClient.post(
      `/api/projects/${projectId}/documents/`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return response.data;
  },

  download: async (projectId: number, documentId: number): Promise<Blob> => {
    const response = await apiClient.get(
      `/api/projects/${projectId}/documents/${documentId}/download`,
      { responseType: 'blob' },
    );
    return response.data;
  },

  delete: async (projectId: number, documentId: number): Promise<void> => {
    await apiClient.delete(`/api/projects/${projectId}/documents/${documentId}`);
  },
};
