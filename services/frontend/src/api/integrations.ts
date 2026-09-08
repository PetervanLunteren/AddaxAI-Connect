/**
 * Project integrations API client. EarthRanger (via Gundi) and Sensing
 * Clues (via Central).
 *
 * Project admins save what the integration needs (a Gundi API key, or a
 * Cluey account and the group it posts into), read the connection's
 * recorded state, remove it, and send a test. A credential never comes
 * back from the server: for EarthRanger only the key's last characters,
 * for Sensing Clues the address, the username and the group.
 */
import apiClient from './client';

export interface IntegrationStatus {
  is_configured: boolean;
  is_enabled: boolean;
  api_key_hint: string | null;
  group_id: number | null;
  group_name: string | null;
  username: string | null;
  base_url: string | null;
  health_status: 'healthy' | 'error' | null;
  last_health_check: string | null;
  last_sent_at: string | null;
  last_error: string | null;
  events_sent: number;
}

export interface SensingCluesConfig {
  base_url: string;
  username: string;
  password: string;
  group_id: number;
  group_name?: string;
}

/** The account fields on their own, before anything is saved. */
export interface SensingCluesAccount {
  base_url: string;
  username: string;
  password: string;
}

export interface SensingCluesGroup {
  id: number;
  name: string;
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

  configureSensingClues: async (
    projectId: number, config: SensingCluesConfig,
  ): Promise<IntegrationStatus> => {
    const response = await apiClient.put<IntegrationStatus>(
      `/api/projects/${projectId}/integrations/sensingclues`,
      config,
    );
    return response.data;
  },

  /** The groups the account can post into, for the setup dropdown. Asked
   *  while the form is being filled, so the account travels in the body and
   *  nothing is stored. */
  listSensingCluesGroups: async (
    projectId: number, account: SensingCluesAccount,
  ): Promise<SensingCluesGroup[]> => {
    const response = await apiClient.post<{ groups: SensingCluesGroup[] }>(
      `/api/projects/${projectId}/integrations/sensingclues/groups`,
      account,
    );
    return response.data.groups;
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
