/**
 * Species API endpoints
 */
import apiClient from './client';

export interface AvailableSpeciesResponse {
  /** The project's model id, a key of the classification models catalog */
  model: string;
  /** "fixed" for a fixed-class model, "speciesnet" for SpeciesNet */
  kind: 'fixed' | 'speciesnet';
  species: string[];
}

export const speciesApi = {
  /** The project's label list for its classification model */
  getAvailable: async (projectId: number): Promise<AvailableSpeciesResponse> => {
    const response = await apiClient.get<AvailableSpeciesResponse>('/api/species/available', {
      params: { project_id: projectId },
    });
    return response.data;
  },
};
