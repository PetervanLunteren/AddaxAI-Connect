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
};
