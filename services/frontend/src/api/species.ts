/**
 * Species API endpoints
 */
import apiClient from './client';

export interface AvailableSpeciesResponse {
  model: string;
  species: string[];
}

export const speciesApi = {
  getAvailable: async (): Promise<AvailableSpeciesResponse> => {
    const response = await apiClient.get<AvailableSpeciesResponse>('/api/species/available');
    return response.data;
  },
};
