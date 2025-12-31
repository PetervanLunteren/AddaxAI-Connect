/**
 * Admin API client
 */
import apiClient from './client';
import type { UserWithProject } from './types';

export const adminApi = {
  /**
   * Get all users with their project assignments
   */
  listUsers: async (): Promise<UserWithProject[]> => {
    const response = await apiClient.get<UserWithProject[]>('/api/admin/users');
    return response.data;
  },

  /**
   * Assign user to project
   */
  assignUserToProject: async (userId: number, projectId: number | null): Promise<UserWithProject> => {
    const response = await apiClient.patch<UserWithProject>(
      `/api/admin/users/${userId}/project`,
      { project_id: projectId }
    );
    return response.data;
  },
};
