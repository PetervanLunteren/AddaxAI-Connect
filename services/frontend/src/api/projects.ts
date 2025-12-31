/**
 * Projects API client
 */
import apiClient from './client';
import type { Project, ProjectCreate, ProjectUpdate, ProjectDeleteResponse } from './types';

export const projectsApi = {
  /**
   * Get all projects
   */
  getAll: async (): Promise<Project[]> => {
    const response = await apiClient.get<Project[]>('/api/projects');
    return response.data;
  },

  /**
   * Get single project by ID
   */
  getById: async (id: number): Promise<Project> => {
    const response = await apiClient.get<Project>(`/api/projects/${id}`);
    return response.data;
  },

  /**
   * Create new project
   */
  create: async (data: ProjectCreate): Promise<Project> => {
    const response = await apiClient.post<Project>('/api/projects', data);
    return response.data;
  },

  /**
   * Update existing project
   */
  update: async (id: number, data: ProjectUpdate): Promise<Project> => {
    const response = await apiClient.patch<Project>(`/api/projects/${id}`, data);
    return response.data;
  },

  /**
   * Upload project image
   */
  uploadImage: async (id: number, file: File): Promise<Project> => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await apiClient.post<Project>(`/api/projects/${id}/image`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  /**
   * Delete project image
   */
  deleteImage: async (id: number): Promise<Project> => {
    const response = await apiClient.delete<Project>(`/api/projects/${id}/image`);
    return response.data;
  },

  /**
   * Delete project with cascade deletion
   */
  delete: async (id: number, confirmName: string): Promise<ProjectDeleteResponse> => {
    const response = await apiClient.delete<ProjectDeleteResponse>(
      `/api/projects/${id}?confirm=${encodeURIComponent(confirmName)}`
    );
    return response.data;
  },
};
