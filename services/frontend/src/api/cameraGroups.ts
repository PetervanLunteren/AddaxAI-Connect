/**
 * Camera groups API client
 */
import apiClient from './client';
import type { CameraGroup } from './types';

export const cameraGroupsApi = {
  list: async (projectId: number): Promise<CameraGroup[]> => {
    const response = await apiClient.get<CameraGroup[]>(
      `/api/projects/${projectId}/camera-groups`
    );
    return response.data;
  },

  create: async (projectId: number, name: string, cameraIds?: number[]): Promise<CameraGroup> => {
    const response = await apiClient.post<CameraGroup>(
      `/api/projects/${projectId}/camera-groups`,
      { name, camera_ids: cameraIds }
    );
    return response.data;
  },

  rename: async (projectId: number, groupId: number, name: string): Promise<CameraGroup> => {
    const response = await apiClient.patch<CameraGroup>(
      `/api/projects/${projectId}/camera-groups/${groupId}`,
      { name }
    );
    return response.data;
  },

  delete: async (projectId: number, groupId: number): Promise<void> => {
    await apiClient.delete(`/api/projects/${projectId}/camera-groups/${groupId}`);
  },

  setCameras: async (projectId: number, groupId: number, cameraIds: number[]): Promise<CameraGroup> => {
    const response = await apiClient.put<CameraGroup>(
      `/api/projects/${projectId}/camera-groups/${groupId}/cameras`,
      { camera_ids: cameraIds }
    );
    return response.data;
  },
};
