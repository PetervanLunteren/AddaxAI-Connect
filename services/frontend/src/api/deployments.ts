/**
 * Deployment API endpoints.
 *
 * A deployment is one camera at one site for a time range. The server
 * rebuilds deployments from photo GPS plus corrections: a correction says
 * where a camera stood from one day to another, and the GPS does not change
 * it. Edit and Add deployment write a correction; Undo takes one back. (The
 * server stores a correction as a statement, hence the route names.)
 */
import type { QueryClient } from '@tanstack/react-query';
import apiClient from './client';
import type { CameraDeployment } from './cameras';

export interface DeploymentListItem {
  id: number;
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
  image_count: number;
  // 'manual' when a correction made it, 'auto' when the GPS did.
  site_source: string;
  // Looks like a GPS error: the GPS made it and the camera was back at the
  // site it left within a week. The server decides, the same rule as the
  // Needs attention count.
  short_trip: boolean;
  // When a person said this deployment is right, null = nobody answered.
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

export interface SetDeploymentResponse {
  statement_id: number; // the correction written, for Undo (undoCorrection)
}

export interface Correction {
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

// Query keys. Everything of a project sits under ['deployments', projectId],
// so one invalidation refreshes the list, the corrections and the photos.
export const deploymentKeys = {
  list: (projectId: number) => ['deployments', projectId, 'list'] as const,
  corrections: (projectId: number) => ['deployments', projectId, 'corrections'] as const,
  photos: (projectId: number, deploymentId: number | undefined, order: 'first' | 'last', limit: number) =>
    ['deployments', projectId, 'photos', deploymentId, order, limit] as const,
  ofCamera: (cameraId: number) => ['camera-deployments', cameraId] as const,
};

/** After any change to a deployment: refresh everything that shows where a camera stood. */
export function invalidateDeployments(queryClient: QueryClient, projectId: number): void {
  queryClient.invalidateQueries({ queryKey: ['deployments', projectId] });
  queryClient.invalidateQueries({ queryKey: ['camera-deployments'] });
  queryClient.invalidateQueries({ queryKey: ['cameras'] });
  queryClient.invalidateQueries({ queryKey: ['sites', projectId] });
  queryClient.invalidateQueries({ queryKey: ['site', projectId] });
}

export const deploymentsApi = {
  // Every deployment of the project, oldest first.
  list: async (projectId: number): Promise<DeploymentListItem[]> => {
    const { data } = await apiClient.get(base(projectId));
    return data;
  },
  // "Right, it went there" on a suspicious deployment, or that taken back.
  setChecked: async (projectId: number, deploymentId: number, checked: boolean): Promise<void> => {
    await apiClient.put(`${base(projectId)}/${deploymentId}/checked`, { checked });
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
  // The project's corrections in force, newest first.
  corrections: async (projectId: number): Promise<Correction[]> => {
    const { data } = await apiClient.get(`${base(projectId)}/statements`);
    return data;
  },
  undoCorrection: async (projectId: number, correctionId: number): Promise<void> => {
    await apiClient.delete(`${base(projectId)}/statements/${correctionId}`);
  },
  // The first or the last photos of a deployment.
  photos: async (
    projectId: number, deploymentId: number, order: 'first' | 'last', limit: number,
  ): Promise<DeploymentPhoto[]> => {
    const { data } = await apiClient.get(`${base(projectId)}/${deploymentId}/thumbnails`, {
      params: { limit, order },
    });
    return data.photos;
  },
};
