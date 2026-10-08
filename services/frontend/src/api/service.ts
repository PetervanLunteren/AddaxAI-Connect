/**
 * Service API client: the service log (visits) and planned tasks.
 *
 * Everything is project scoped. Every member can read, admins write. A
 * task is open work only: completing it logs a visit and removes the
 * task, cancelling removes it.
 */
import apiClient from './client';
import type { MaintenanceActionType } from './types';

export interface ServiceVisit {
  id: number;
  camera_id: number;
  camera_label: string;
  // The site the camera stood at on the visit date, null when none.
  site_id: number | null;
  site_name: string | null;
  event_date: string; // YYYY-MM-DD
  action_types: MaintenanceActionType[];
  performed_by_user_id: number | null;
  performed_by_email: string | null;
  note: string | null;
}

export interface ServiceTask {
  id: number;
  camera_id: number;
  camera_label: string;
  // The camera's current site, null when none.
  site_id: number | null;
  site_name: string | null;
  action_types: MaintenanceActionType[];
  note: string | null;
  due_date: string | null; // YYYY-MM-DD
  overdue: boolean;
  assigned_to_user_id: number | null;
  assigned_to_email: string | null;
}

export interface VisitFields {
  event_date: string;
  action_types: MaintenanceActionType[];
  performed_by_user_id: number | null;
  note: string | null;
}

export interface TaskFields {
  action_types: MaintenanceActionType[];
  note: string | null;
  due_date: string | null;
  assigned_to_user_id: number | null;
  notify: boolean;
}

export const serviceApi = {
  listVisits: async (projectId: number): Promise<ServiceVisit[]> =>
    (await apiClient.get<ServiceVisit[]>(`/api/projects/${projectId}/service-visits`)).data,

  logVisits: async (projectId: number, cameraIds: number[], fields: VisitFields): Promise<void> => {
    await apiClient.post(`/api/projects/${projectId}/service-visits`, { camera_ids: cameraIds, ...fields });
  },

  deleteVisit: async (projectId: number, visitId: number): Promise<void> => {
    await apiClient.delete(`/api/projects/${projectId}/service-visits/${visitId}`);
  },

  listTasks: async (projectId: number): Promise<ServiceTask[]> =>
    (await apiClient.get<ServiceTask[]>(`/api/projects/${projectId}/service-tasks`)).data,

  planTasks: async (projectId: number, cameraIds: number[], fields: TaskFields): Promise<void> => {
    await apiClient.post(`/api/projects/${projectId}/service-tasks`, { camera_ids: cameraIds, ...fields });
  },

  updateTask: async (projectId: number, taskId: number, fields: TaskFields): Promise<void> => {
    await apiClient.patch(`/api/projects/${projectId}/service-tasks/${taskId}`, fields);
  },

  cancelTask: async (projectId: number, taskId: number): Promise<void> => {
    await apiClient.delete(`/api/projects/${projectId}/service-tasks/${taskId}`);
  },

  completeTask: async (projectId: number, taskId: number, fields: VisitFields): Promise<void> => {
    await apiClient.post(`/api/projects/${projectId}/service-tasks/${taskId}/complete`, fields);
  },
};

/** Query keys, shared so the page, sidebar badge, dashboard chip and
 * slide-out summaries all refresh from one invalidation. */
export const serviceKeys = {
  tasks: (projectId: number) => ['service-tasks', projectId] as const,
  visits: (projectId: number) => ['service-visits', projectId] as const,
};
