/**
 * Notifications API client
 */
import apiClient from './client';
import type { NotificationPreference, NotificationPreferenceUpdate } from './types';

export const notificationsApi = {
  /**
   * Get current user's notification preferences
   */
  getPreferences: async (): Promise<NotificationPreference> => {
    const response = await apiClient.get<NotificationPreference>('/api/users/me/notification-preferences');
    return response.data;
  },

  /**
   * Update current user's notification preferences
   */
  updatePreferences: async (data: NotificationPreferenceUpdate): Promise<NotificationPreference> => {
    const response = await apiClient.put<NotificationPreference>('/api/users/me/notification-preferences', data);
    return response.data;
  },
};
