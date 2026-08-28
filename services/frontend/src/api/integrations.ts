/**
 * Project integrations API client. EarthRanger (via Gundi) is the first.
 *
 * Project admins save the Gundi API key, read the connection's recorded
 * state, remove the key, and send a test event. The key itself never comes
 * back from the server, only its last characters.
 */
import apiClient from './client';

export interface EarthRangerStatus {
  is_configured: boolean;
  is_enabled: boolean;
  api_key_hint: string | null;
  health_status: 'healthy' | 'error' | null;
  last_health_check: string | null;
  last_sent_at: string | null;
  last_error: string | null;
  events_sent: number;
}

export const integrationsApi = {
  getEarthRanger: async (projectId: number): Promise<EarthRangerStatus> => {
    const response = await apiClient.get<EarthRangerStatus>(
      `/api/projects/${projectId}/integrations/earthranger`,
    );
    return response.data;
  },

  configureEarthRanger: async (projectId: number, apiKey: string): Promise<EarthRangerStatus> => {
    const response = await apiClient.put<EarthRangerStatus>(
      `/api/projects/${projectId}/integrations/earthranger`,
      { api_key: apiKey },
    );
    return response.data;
  },

  removeEarthRanger: async (projectId: number): Promise<void> => {
    await apiClient.delete(`/api/projects/${projectId}/integrations/earthranger`);
  },

  testEarthRanger: async (projectId: number): Promise<{ object_id: string }> => {
    const response = await apiClient.post<{ object_id: string }>(
      `/api/projects/${projectId}/integrations/earthranger/test`,
    );
    return response.data;
  },
};
