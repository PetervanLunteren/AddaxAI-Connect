/**
 * Projects API client
 */
import apiClient from './client';
import type { Project, ProjectCreate, ProjectUpdate } from './types';

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
   * Delete project
   */
  delete: async (id: number): Promise<void> => {
    await apiClient.delete(`/api/projects/${id}`);
  },
};
