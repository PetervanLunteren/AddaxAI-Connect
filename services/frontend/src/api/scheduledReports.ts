/**
 * Scheduled species report rules API client.
 *
 * Any project member creates private rules that email an analytical
 * species summary at a fixed rhythm, weekly, monthly, or quarterly. The
 * creator is the only recipient, email only. Site-restricted viewers
 * cannot create rules because the report covers the whole project.
 */
import apiClient from './client';

export type ReportFrequency = 'weekly' | 'monthly' | 'quarterly';

export interface SpeciesReportRule {
  id: number;
  species: string[];            // labels, including person/vehicle
  frequency: ReportFrequency;
  is_active: boolean;
  created_at: string;
}

export interface SpeciesReportPayload {
  species: string[];
  frequency: ReportFrequency;
}

export const scheduledReportsApi = {
  list: async (projectId: number): Promise<SpeciesReportRule[]> => {
    const response = await apiClient.get<SpeciesReportRule[]>(
      `/api/projects/${projectId}/species-reports`,
    );
    return response.data;
  },

  create: async (projectId: number, payload: SpeciesReportPayload): Promise<SpeciesReportRule> => {
    const response = await apiClient.post<SpeciesReportRule>(
      `/api/projects/${projectId}/species-reports`,
      payload,
    );
    return response.data;
  },

  update: async (
    projectId: number,
    ruleId: number,
    payload: Partial<SpeciesReportPayload> & { is_active?: boolean },
  ): Promise<SpeciesReportRule> => {
    const response = await apiClient.patch<SpeciesReportRule>(
      `/api/projects/${projectId}/species-reports/${ruleId}`,
      payload,
    );
    return response.data;
  },

  remove: async (projectId: number, ruleId: number): Promise<void> => {
    await apiClient.delete(`/api/projects/${projectId}/species-reports/${ruleId}`);
  },
};
