/**
 * Camera condition alert rules API client.
 *
 * Any project member creates private rules (battery below a threshold,
 * SD card above a threshold, camera silent for days, rejected files per
 * day). A daily cron
 * evaluates them and notifies the creator once per incident, by email
 * and/or Telegram.
 */
import apiClient from './client';

export type AlertRuleType = 'battery_low' | 'sd_full' | 'camera_silent' | 'rejections';

export interface AlertRule {
  id: number;
  rule_type: AlertRuleType;
  threshold: number;
  camera_ids: number[] | null;  // null = all cameras of the project
  channels: string[];           // subset of ['email', 'telegram', 'earthranger']
  is_active: boolean;
  notified_camera_ids: number[];
  created_at: string;
}

export interface AlertRulePayload {
  rule_type: AlertRuleType;
  threshold: number;
  camera_ids: number[] | null;
  channels: string[];
}

export const cameraAlertRulesApi = {
  // channel=earthranger lists every rule of the project on that channel
  // (project admins), for the integration page; otherwise your own rules.
  list: async (projectId: number, channel?: string): Promise<AlertRule[]> => {
    const response = await apiClient.get<AlertRule[]>(
      `/api/projects/${projectId}/alert-rules`,
      { params: channel ? { channel } : undefined },
    );
    return response.data;
  },

  create: async (projectId: number, payload: AlertRulePayload): Promise<AlertRule> => {
    const response = await apiClient.post<AlertRule>(
      `/api/projects/${projectId}/alert-rules`,
      payload,
    );
    return response.data;
  },

  update: async (
    projectId: number,
    ruleId: number,
    payload: Partial<AlertRulePayload> & { is_active?: boolean; scope_all?: boolean },
  ): Promise<AlertRule> => {
    const response = await apiClient.patch<AlertRule>(
      `/api/projects/${projectId}/alert-rules/${ruleId}`,
      payload,
    );
    return response.data;
  },

  remove: async (projectId: number, ruleId: number): Promise<void> => {
    await apiClient.delete(`/api/projects/${projectId}/alert-rules/${ruleId}`);
  },
};
