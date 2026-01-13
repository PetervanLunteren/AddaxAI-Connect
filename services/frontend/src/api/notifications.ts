/**
 * Notifications API client
 */
import apiClient from './client';
import type { NotificationPreference, NotificationPreferenceUpdate } from './types';

export const notificationsApi = {
  /**
   * Get current user's notification preferences for a project
   */
  getPreferences: async (projectId: number): Promise<NotificationPreference> => {
    const response = await apiClient.get<NotificationPreference>(`/api/projects/${projectId}/notification-preferences`);
    return response.data;
  },

  /**
   * Update current user's notification preferences for a project
   */
  updatePreferences: async (projectId: number, data: NotificationPreferenceUpdate): Promise<NotificationPreference> => {
    const response = await apiClient.put<NotificationPreference>(`/api/projects/${projectId}/notification-preferences`, data);
    return response.data;
  },

  /**
   * Generate a Telegram linking token for automated account linking
   */
  generateTelegramLinkToken: async (projectId: number): Promise<{
    token: string;
    deep_link: string;
    expires_at: string;
  }> => {
    const response = await apiClient.post(`/api/projects/${projectId}/telegram/generate-link-token`);
    return response.data;
  },

  /**
   * Check if user has linked their Telegram account
   */
  checkTelegramLinkStatus: async (projectId: number): Promise<{
    linked: boolean;
    chat_id: string | null;
  }> => {
    const response = await apiClient.get(`/api/projects/${projectId}/telegram/link-status`);
    return response.data;
  },

  /**
   * Unlink Telegram account (remove chat ID)
   */
  unlinkTelegram: async (projectId: number): Promise<void> => {
    await apiClient.delete(`/api/projects/${projectId}/telegram/unlink`);
  },
};
