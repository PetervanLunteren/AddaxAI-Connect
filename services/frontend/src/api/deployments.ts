/**
 * Deployment API endpoints.
 *
 * A deployment is one camera at one site for a time range, auto-created by GPS
 * ingestion. It carries no free-text metadata; the only human-editable thing is
 * which site it belongs to. Assigning a site, one at a time or in bulk, marks
 * the deployment site_source='manual', recording that a human confirmed the
 * site rather than GPS. That flag only drives the badge and filter on the
 * Deployments page; it does not change ingestion.
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
  label: string | null;
}

export interface UpdateDeploymentRequest {
  site_id?: number | null;
  label?: string | null;
}

// `merged` is how many deployments the reassignment merged away (a camera's
// adjacent same-site deployments collapse into one); 0 in the common case.
export interface UpdateDeploymentResponse {
  merged: number;
}

export interface BulkAssignSiteResponse {
  updated: number;
  merged: number;
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
  ): Promise<UpdateDeploymentResponse> => {
    const { data } = await apiClient.patch(`${base(projectId)}/${deploymentId}`, body);
    return data;
  },
  bulkAssignSite: async (
    projectId: number,
    deploymentIds: number[],
    siteId: number | null,
  ): Promise<BulkAssignSiteResponse> => {
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
