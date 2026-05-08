/**
 * Scheduled project reminders API client.
 *
 * Project admins create one-shot reminders tied to a project. The daily
 * cron emails the creator on the date. List + create + cancel — no edit
 * in v1; admins cancel and recreate if they need to change something.
 */
import apiClient from './client';

export interface Reminder {
  id: number;
  send_on: string;            // YYYY-MM-DD
  message: string;
  created_by_user_id: number;
  created_by_email: string | null;
  sent_at: string | null;
  cancelled_at: string | null;
  cancelled_by_user_id: number | null;
  cancelled_by_email: string | null;
  created_at: string;
}

export const remindersApi = {
  list: async (projectId: number): Promise<Reminder[]> => {
    const response = await apiClient.get<Reminder[]>(
      `/api/projects/${projectId}/reminders`,
    );
    return response.data;
  },

  create: async (
    projectId: number,
    sendOn: string,
    message: string,
  ): Promise<Reminder> => {
    const response = await apiClient.post<Reminder>(
      `/api/projects/${projectId}/reminders`,
      { send_on: sendOn, message },
    );
    return response.data;
  },

  cancel: async (projectId: number, reminderId: number): Promise<void> => {
    await apiClient.delete(
      `/api/projects/${projectId}/reminders/${reminderId}`,
    );
  },
};
