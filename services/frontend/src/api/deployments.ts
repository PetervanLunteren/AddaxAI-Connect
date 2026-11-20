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
  end_date: string | null; // the last day, null = still there
  start_at: string; // camera clock, exact
  end_at: string | null;
  last_photo_at: string | null;
  image_count: number;
  // 'manual' when a fixed period made it, 'auto' when the GPS did.
  site_source: string;
  // Runs of days with photos, both ends included.
  photo_days: DaySpan[];
  // When a person checked it on the Deployments page, null = still to check.
  // Only deployments the GPS made (site_source 'auto') are ever to check.
  checked_at: string | null;
  checked_by: string | null; // email
}

export interface DaySpan {
  start: string; // YYYY-MM-DD
  end: string;
}

// Photo days of one camera that no deployment covers: no site yet.
export interface UnplacedPhotos {
  camera_id: number;
  camera_label: string;
  photo_days: DaySpan[];
}

export interface DeploymentsOverview {
  deployments: DeploymentListItem[];
  unplaced: UnplacedPhotos[];
}

// The GPS of a camera's photos, grouped per deployment and spot.
export interface ReadingDot {
  deployment_id: number | null;
  latitude: number;
  longitude: number;
  count: number;
}

// How a deployment started. 'first': the camera's first photos, or the
// first after a fixed period ended. 'moved': the GPS rule saw a move.
// 'fixed': a fixed period starts here.
export interface DeploymentStart {
  deployment_id: number;
  kind: 'first' | 'moved' | 'fixed';
  distance_m: number | null;
  readings: number | null;
  first_at: string | null;
}

export interface CameraReadings {
  threshold_m: number;
  dots: ReadingDot[];
  starts: DeploymentStart[];
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
  list: async (projectId: number): Promise<DeploymentsOverview> => {
    const { data } = await apiClient.get(base(projectId));
    return data;
  },
  setChecked: async (projectId: number, deploymentIds: number[], checked: boolean): Promise<void> => {
    await apiClient.put(`${base(projectId)}/checked`, { deployment_ids: deploymentIds, checked });
  },
  toCheckCount: async (projectId: number): Promise<number> => {
    const { data } = await apiClient.get(`${base(projectId)}/to-check-count`);
    return data.count;
  },
  // The GPS saw a move that did not happen: back to the site before it.
  notMoved: async (projectId: number, deploymentId: number): Promise<SetDeploymentResponse> => {
    const { data } = await apiClient.post(`${base(projectId)}/${deploymentId}/not-moved`);
    return data;
  },
  readings: async (projectId: number, cameraId: number): Promise<CameraReadings> => {
    const { data } = await apiClient.get(`${base(projectId)}/cameras/${cameraId}/readings`);
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
