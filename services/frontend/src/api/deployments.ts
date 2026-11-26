/**
 * Deployment API endpoints.
 *
 * A deployment is one camera at one site for a time range. The server
 * rebuilds deployments from photo GPS plus fixed periods: a fixed period says
 * where a camera stood from one day to another, and the GPS does not change
 * it. Setting a deployment writes a fixed period; removing one takes it back.
 */
import apiClient from './client';
import type { CameraDeployment } from './cameras';

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
  // When a person said this update is right, null = nobody answered.
  checked_at: string | null;
  checked_by: string | null; // email
}


export interface DeploymentPhoto {
  uuid: string;
  captured_at: string; // camera clock
}

export interface SetDeploymentRequest {
  camera_id: number;
  site_id: number;
  from_date: string; // YYYY-MM-DD
  until_date: string | null; // YYYY-MM-DD, the last day; null = still there
  // The deployment this edits; its corrections are replaced, so the days
  // the edit leaves out go back to the app. Absent when adding one.
  deployment_id?: number | null;
}

// `merged` is how many deployments fewer the camera has afterwards: periods
// at one site back to back become one. 0 in the common case.
export interface SetDeploymentResponse {
  statement_id: number; // for Undo (removeFixedPeriod)
  merged: number;
}

export interface FixedPeriod {
  id: number;
  camera_id: number;
  camera_label: string;
  site_id: number;
  site_name: string;
  from_date: string; // YYYY-MM-DD
  until_date: string | null; // the last day, null = still there
  // 'person', 'upload' or 'carried_over' (kept from before the update)
  source: string;
  created_by: string | null; // email, null when the account is gone
  created_at: string;
  // What a person changed with Edit or Add deployment: 'site', 'first_day',
  // 'last_day'. Null for other corrections and older ones.
  changes: string[] | null;
}

// The camera's deployments before and after an edit, without saving it: the
// server does the edit and rolls it back (the Edit deployment form).
export interface DeploymentPreview {
  before: CameraDeployment[];
  after: CameraDeployment[];
}

const base = (projectId: number) => `/api/projects/${projectId}/deployments`;

export const deploymentsApi = {
  // Every deployment of the project, oldest first.
  list: async (projectId: number): Promise<DeploymentListItem[]> => {
    const { data } = await apiClient.get(base(projectId));
    return data;
  },
  setChecked: async (projectId: number, deploymentIds: number[], checked: boolean): Promise<void> => {
    await apiClient.put(`${base(projectId)}/checked`, { deployment_ids: deploymentIds, checked });
  },
  // The GPS saw a move that did not happen: back to the site before it.
  notMoved: async (projectId: number, deploymentId: number): Promise<SetDeploymentResponse> => {
    const { data } = await apiClient.post(`${base(projectId)}/${deploymentId}/not-moved`);
    return data;
  },
  set: async (projectId: number, body: SetDeploymentRequest): Promise<SetDeploymentResponse> => {
    const { data } = await apiClient.post(`${base(projectId)}/statements`, body);
    return data;
  },
  preview: async (projectId: number, body: SetDeploymentRequest, signal?: AbortSignal): Promise<DeploymentPreview> => {
    const { data } = await apiClient.post(`${base(projectId)}/statements/preview`, body, { signal });
    return data;
  },
  // Of one camera, or of the whole project without cameraId.
  fixedPeriods: async (projectId: number, cameraId?: number): Promise<FixedPeriod[]> => {
    const { data } = await apiClient.get(`${base(projectId)}/statements`, {
      params: cameraId !== undefined ? { camera_id: cameraId } : {},
    });
    return data;
  },
  removeFixedPeriod: async (projectId: number, statementId: number): Promise<void> => {
    await apiClient.delete(`${base(projectId)}/statements/${statementId}`);
  },
  // A few photos of a deployment: a random sample, the first or the last.
  photos: async (
    projectId: number,
    deploymentId: number,
    order: 'random' | 'first' | 'last',
    limit = 1,
  ): Promise<DeploymentPhoto[]> => {
    const { data } = await apiClient.get(`${base(projectId)}/${deploymentId}/thumbnails`, {
      params: { limit, order },
    });
    return data.photos;
  },
};
