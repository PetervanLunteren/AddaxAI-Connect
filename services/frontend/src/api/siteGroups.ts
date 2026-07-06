/**
 * Site groups API client ("Merged sites")
 */
import apiClient from './client';
import type { SiteGroup } from './types';

export const siteGroupsApi = {
  list: async (projectId: number): Promise<SiteGroup[]> => {
    const response = await apiClient.get<SiteGroup[]>(
      `/api/projects/${projectId}/site-groups`
    );
    return response.data;
  },

  create: async (projectId: number, name: string, siteIds?: number[]): Promise<SiteGroup> => {
    const response = await apiClient.post<SiteGroup>(
      `/api/projects/${projectId}/site-groups`,
      { name, site_ids: siteIds }
    );
    return response.data;
  },

  rename: async (projectId: number, groupId: number, name: string): Promise<SiteGroup> => {
    const response = await apiClient.patch<SiteGroup>(
      `/api/projects/${projectId}/site-groups/${groupId}`,
      { name }
    );
    return response.data;
  },

  delete: async (projectId: number, groupId: number): Promise<void> => {
    await apiClient.delete(`/api/projects/${projectId}/site-groups/${groupId}`);
  },

  setSites: async (projectId: number, groupId: number, siteIds: number[]): Promise<SiteGroup> => {
    const response = await apiClient.put<SiteGroup>(
      `/api/projects/${projectId}/site-groups/${groupId}/sites`,
      { site_ids: siteIds }
    );
    return response.data;
  },
};
