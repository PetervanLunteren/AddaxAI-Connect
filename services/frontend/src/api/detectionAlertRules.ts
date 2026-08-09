/**
 * Real-time detection alert rules API client.
 *
 * Any project member creates private rules for species detections. A
 * rule names its labels and optionally narrows by site, time of day,
 * group size, a cooldown, and a rarity lookback. Rules are evaluated on
 * the live event path; the creator is the only recipient, by email
 * and/or Telegram.
 */
import apiClient from './client';

export interface DetectionRule {
  id: number;
  species: string[];            // labels, including person/vehicle
  site_ids: number[] | null;    // null = all sites of the project
  channels: string[];           // subset of ['email', 'telegram']
  hour_from: number | null;     // half-open window, wraps past midnight
  hour_to: number | null;
  min_group_size: number | null;
  cooldown_minutes: number | null;
  rarity_days: number | null;
  is_active: boolean;
  created_at: string;
}

export interface DetectionRulePayload {
  species: string[];
  site_ids: number[] | null;
  channels: string[];
  hour_from: number | null;
  hour_to: number | null;
  min_group_size: number | null;
  cooldown_minutes: number | null;
  rarity_days: number | null;
}

export const detectionAlertRulesApi = {
  list: async (projectId: number): Promise<DetectionRule[]> => {
    const response = await apiClient.get<DetectionRule[]>(
      `/api/projects/${projectId}/detection-rules`,
    );
    return response.data;
  },

  create: async (projectId: number, payload: DetectionRulePayload): Promise<DetectionRule> => {
    const response = await apiClient.post<DetectionRule>(
      `/api/projects/${projectId}/detection-rules`,
      payload,
    );
    return response.data;
  },

  update: async (
    projectId: number,
    ruleId: number,
    payload: Partial<DetectionRulePayload> & { is_active?: boolean },
  ): Promise<DetectionRule> => {
    const response = await apiClient.patch<DetectionRule>(
      `/api/projects/${projectId}/detection-rules/${ruleId}`,
      payload,
    );
    return response.data;
  },

  remove: async (projectId: number, ruleId: number): Promise<void> => {
    await apiClient.delete(`/api/projects/${projectId}/detection-rules/${ruleId}`);
  },
};
