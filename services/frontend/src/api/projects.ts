/**
 * Projects API client
 */
import apiClient from './client';
import type {
  Project,
  ProjectCreate,
  ProjectUpdate,
  ProjectDeleteResponse,
  ProjectUserInfo,
  AddUserToProjectRequest,
  UpdateProjectUserRoleRequest,
  InvitationResponse,
  AddProjectUserByEmailRequest,
  AddProjectUserByEmailResponse
} from './types';

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

  /**
   * Get users in project (project admin or server admin)
   */
  getUsers: async (projectId: number): Promise<ProjectUserInfo[]> => {
    const response = await apiClient.get<{ users: ProjectUserInfo[] }>(
      `/api/projects/${projectId}/users`
    );
    return response.data.users;
  },

  /**
   * Add user to project with role (project admin or server admin)
   */
  addUser: async (projectId: number, userId: number, role: string): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>(
      `/api/projects/${projectId}/users`,
      { user_id: userId, role }
    );
    return response.data;
  },

  /**
   * Update user's role in project (project admin or server admin)
   */
  updateUserRole: async (projectId: number, userId: number, role: string): Promise<{ message: string }> => {
    const response = await apiClient.patch<{ message: string }>(
      `/api/projects/${projectId}/users/${userId}`,
      { role }
    );
    return response.data;
  },

  /**
   * Remove user from project (project admin or server admin)
   */
  removeUser: async (projectId: number, userId: number): Promise<{ message: string }> => {
    const response = await apiClient.delete<{ message: string }>(
      `/api/projects/${projectId}/users/${userId}`
    );
    return response.data;
  },

  /**
   * Invite a new user to project (project admin or server admin)
   */
  inviteUser: async (projectId: number, email: string, role: string): Promise<InvitationResponse> => {
    const response = await apiClient.post<InvitationResponse>(
      `/api/projects/${projectId}/users/invite`,
      { email, role }
    );
    return response.data;
  },

  /**
   * Add user by email (unified add/invite) - automatically handles existing users and new invitations
   */
  addUserByEmail: async (projectId: number, data: AddProjectUserByEmailRequest): Promise<AddProjectUserByEmailResponse> => {
    const response = await apiClient.post<AddProjectUserByEmailResponse>(
      `/api/projects/${projectId}/users/add`,
      data
    );
    return response.data;
  },
};
