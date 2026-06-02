/**
 * Deployment API endpoints.
 *
 * A deployment is one camera at one site for a time range, auto-created by GPS
 * ingestion. It carries no free-text metadata; the only human-editable thing is
 * which site it belongs to (the manual pin). Assigning a site, one at a time or
 * in bulk, marks the deployment site_source='manual' so ingestion stops
 * re-resolving it.
 */
import apiClient from './client';

export interface DeploymentListItem {
  id: number;
  deployment_number: number;
  camera_id: number;
  camera_label: string | null;
  site_id: number | null;
  site_name: string | null;
  latitude: number | null;
  longitude: number | null;
  start_date: string | null;
  end_date: string | null;
  image_count: number;
  site_source: string;
}

export interface UpdateDeploymentRequest {
  site_id?: number | null;
}

export interface DeploymentDetail {
  id: number;
  deployment_number: number;
  camera_id: number;
  site_id: number | null;
  site_source: string;
}

const base = (projectId: number) => `/api/projects/${projectId}/deployments`;

export const deploymentsApi = {
  list: async (projectId: number): Promise<DeploymentListItem[]> => {
    const { data } = await apiClient.get(base(projectId));
    return data;
  },
  update: async (
    projectId: number,
    deploymentId: number,
    body: UpdateDeploymentRequest,
  ): Promise<DeploymentDetail> => {
    const { data } = await apiClient.patch(`${base(projectId)}/${deploymentId}`, body);
    return data;
  },
  bulkAssignSite: async (
    projectId: number,
    deploymentIds: number[],
    siteId: number | null,
  ): Promise<{ updated: number }> => {
    const { data } = await apiClient.post(`${base(projectId)}/bulk-site`, {
      deployment_ids: deploymentIds,
      site_id: siteId,
    });
    return data;
  },
  thumbnails: async (
    projectId: number,
    deploymentId: number,
    limit = 6,
  ): Promise<string[]> => {
    const { data } = await apiClient.get(`${base(projectId)}/${deploymentId}/thumbnails`, {
      params: { limit },
    });
    return data.uuids as string[];
  },
};
