/**
 * Deployment API endpoints.
 *
 * A deployment is one camera at one site for a time range. The server
 * rebuilds deployments from photo GPS plus fixed periods: a fixed period says
 * where a camera stood from one day to another, and the GPS does not change
 * it. Setting a deployment writes a fixed period; removing one takes it back.
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

export interface SetDeploymentRequest {
  camera_id: number;
  site_id: number;
  from_date: string; // YYYY-MM-DD
  until_date: string | null; // YYYY-MM-DD, the last day; null = still there
}

// `merged` is how many deployments fewer the camera has afterwards: periods
// at one site back to back become one. 0 in the common case.
export interface SetDeploymentResponse {
  merged: number;
}

export interface FixedPeriod {
  id: number;
  site_id: number;
  site_name: string;
  from_date: string; // YYYY-MM-DD
  until_date: string | null; // the last day, null = still there
  // 'person', 'upload' or 'carried_over' (kept from before the update)
  source: string;
  created_by: string | null; // email, null when the account is gone
  created_at: string;
}

const base = (projectId: number) => `/api/projects/${projectId}/deployments`;

export const deploymentsApi = {
  list: async (projectId: number): Promise<DeploymentListItem[]> => {
    const { data } = await apiClient.get(base(projectId));
    return data;
  },
  set: async (projectId: number, body: SetDeploymentRequest): Promise<SetDeploymentResponse> => {
    const { data } = await apiClient.post(`${base(projectId)}/statements`, body);
    return data;
  },
  fixedPeriods: async (projectId: number, cameraId: number): Promise<FixedPeriod[]> => {
    const { data } = await apiClient.get(`${base(projectId)}/statements`, {
      params: { camera_id: cameraId },
    });
    return data;
  },
  removeFixedPeriod: async (projectId: number, statementId: number): Promise<void> => {
    await apiClient.delete(`${base(projectId)}/statements/${statementId}`);
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
