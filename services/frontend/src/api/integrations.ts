/**
 * Project integrations API client. EarthRanger (via Gundi) and Sensing
 * Clues (via Central).
 *
 * Project admins save the integration's one setting (a Gundi API key, a
 * Cluey group id), read the connection's recorded state, remove it, and
 * send a test. A key never comes back from the server, only its last
 * characters. For Sensing Clues the account is server level, so the status
 * also says whether this server offers the integration at all.
 */
import apiClient from './client';

export interface IntegrationStatus {
  is_available: boolean;
  is_configured: boolean;
  is_enabled: boolean;
  api_key_hint: string | null;
  group_id: number | null;
  health_status: 'healthy' | 'error' | null;
  last_health_check: string | null;
  last_sent_at: string | null;
  last_error: string | null;
  events_sent: number;
}

export const integrationsApi = {
  getEarthRanger: async (projectId: number): Promise<IntegrationStatus> => {
    const response = await apiClient.get<IntegrationStatus>(
      `/api/projects/${projectId}/integrations/earthranger`,
    );
    return response.data;
  },

  configureEarthRanger: async (projectId: number, apiKey: string): Promise<IntegrationStatus> => {
    const response = await apiClient.put<IntegrationStatus>(
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

  getSensingClues: async (projectId: number): Promise<IntegrationStatus> => {
    const response = await apiClient.get<IntegrationStatus>(
      `/api/projects/${projectId}/integrations/sensingclues`,
    );
    return response.data;
  },

  configureSensingClues: async (projectId: number, groupId: number): Promise<IntegrationStatus> => {
    const response = await apiClient.put<IntegrationStatus>(
      `/api/projects/${projectId}/integrations/sensingclues`,
      { group_id: groupId },
    );
    return response.data;
  },

  removeSensingClues: async (projectId: number): Promise<void> => {
    await apiClient.delete(`/api/projects/${projectId}/integrations/sensingclues`);
  },

  testSensingClues: async (projectId: number): Promise<{ alert_id: string }> => {
    const response = await apiClient.post<{ alert_id: string }>(
      `/api/projects/${projectId}/integrations/sensingclues/test`,
    );
    return response.data;
  },
};
