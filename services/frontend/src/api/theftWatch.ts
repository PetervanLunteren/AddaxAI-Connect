/**
 * Theft watch rules API client (beta).
 *
 * Any project member creates private rules. One rule carries two
 * triggers, an instant alert when a person is unusually close to a
 * camera, and an alert when a camera stays silent longer than its own
 * normal rhythm. The creator is the only recipient.
 */
import apiClient from './client';

export type TheftWatchSensitivity = 'low' | 'medium' | 'high';

export interface TheftWatchRule {
  id: number;
  sensitivity: TheftWatchSensitivity;
  site_ids: number[] | null;  // null = all sites of the project
  channels: string[];         // subset of ['email', 'telegram']
  is_active: boolean;
  created_at: string;
}

export interface TheftWatchRulePayload {
  sensitivity: TheftWatchSensitivity;
  site_ids: number[] | null;
  channels: string[];
}

export const theftWatchApi = {
  list: async (projectId: number): Promise<TheftWatchRule[]> => {
    const response = await apiClient.get<TheftWatchRule[]>(
      `/api/projects/${projectId}/theft-watch-rules`,
    );
    return response.data;
  },

  create: async (
    projectId: number,
    payload: TheftWatchRulePayload,
  ): Promise<TheftWatchRule> => {
    const response = await apiClient.post<TheftWatchRule>(
      `/api/projects/${projectId}/theft-watch-rules`,
      payload,
    );
    return response.data;
  },

  update: async (
    projectId: number,
    ruleId: number,
    payload: Partial<TheftWatchRulePayload> & { is_active?: boolean },
  ): Promise<TheftWatchRule> => {
    const response = await apiClient.patch<TheftWatchRule>(
      `/api/projects/${projectId}/theft-watch-rules/${ruleId}`,
      payload,
    );
    return response.data;
  },

  remove: async (projectId: number, ruleId: number): Promise<void> => {
    await apiClient.delete(`/api/projects/${projectId}/theft-watch-rules/${ruleId}`);
  },
};
