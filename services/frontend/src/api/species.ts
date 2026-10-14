/**
 * Species API endpoints
 */
import apiClient from './client';

export interface AvailableSpeciesResponse {
  model: string;
  species: string[];
}

export const speciesApi = {
  /** The project's label list for the server's classification model */
  getAvailable: async (projectId: number): Promise<AvailableSpeciesResponse> => {
    const response = await apiClient.get<AvailableSpeciesResponse>('/api/species/available', {
      params: { project_id: projectId },
    });
    return response.data;
  },
};
