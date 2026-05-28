/**
 * Site API endpoints.
 *
 * A site is a physical place that groups deployments (one camera at the site
 * for a time range). Reads are open to project members, writes need admin.
 */
import apiClient from './client';

export interface SiteListItem {
  id: number;
  uuid: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  habitat_type: string | null;
  camera_count: number;
  deployment_count: number;
  image_count: number;
  last_activity: string | null;
}

export interface DeploymentSummary {
  id: number;
  deployment_number: number;
  camera_id: number;
  camera_name: string;
  label: string | null;
  notes: string | null;
  start_date: string | null;
  end_date: string | null;
  image_count: number;
}

export interface SiteDetail {
  id: number;
  uuid: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  habitat_type: string | null;
  notes: string | null;
  tags: unknown;
  camera_count: number;
  deployment_count: number;
  image_count: number;
  deployments: DeploymentSummary[];
}

export interface CreateSiteRequest {
  name: string;
  latitude: number;
  longitude: number;
  habitat_type?: string | null;
  notes?: string | null;
}

export interface UpdateSiteRequest {
  name?: string;
  habitat_type?: string | null;
  notes?: string | null;
}

export interface UpdateDeploymentRequest {
  name?: string | null;
  notes?: string | null;
}

export interface DeploymentDetail {
  id: number;
  deployment_number: number;
  camera_id: number;
  site_id: number | null;
  name: string | null;
  notes: string | null;
}

const base = (projectId: number) => `/api/projects/${projectId}/sites`;

export const sitesApi = {
  list: async (projectId: number): Promise<SiteListItem[]> => {
    const { data } = await apiClient.get(base(projectId));
    return data;
  },
  get: async (projectId: number, siteId: number): Promise<SiteDetail> => {
    const { data } = await apiClient.get(`${base(projectId)}/${siteId}`);
    return data;
  },
  create: async (projectId: number, body: CreateSiteRequest): Promise<SiteDetail> => {
    const { data } = await apiClient.post(base(projectId), body);
    return data;
  },
  update: async (
    projectId: number,
    siteId: number,
    body: UpdateSiteRequest,
  ): Promise<SiteDetail> => {
    const { data } = await apiClient.patch(`${base(projectId)}/${siteId}`, body);
    return data;
  },
  merge: async (
    projectId: number,
    sourceSiteId: number,
    targetSiteId: number,
  ): Promise<SiteDetail> => {
    const { data } = await apiClient.post(`${base(projectId)}/${sourceSiteId}/merge`, {
      target_site_id: targetSiteId,
    });
    return data;
  },
  remove: async (projectId: number, siteId: number): Promise<void> => {
    await apiClient.delete(`${base(projectId)}/${siteId}`);
  },
  updateDeployment: async (
    projectId: number,
    deploymentId: number,
    body: UpdateDeploymentRequest,
  ): Promise<DeploymentDetail> => {
    const { data } = await apiClient.patch(
      `/api/projects/${projectId}/deployments/${deploymentId}`,
      body,
    );
    return data;
  },
};
