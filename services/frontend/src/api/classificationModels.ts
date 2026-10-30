/**
 * The classification models a project can pick, with whether a new project
 * on this server could use each one right now.
 */
import apiClient from './client';

export interface ClassificationModelInfo {
  id: string;
  name: string;
  description: string;
  developer: string;
  region: string;
  emoji: string;
  licence_url: string;
  info_url: string;
  kind: 'fixed' | 'speciesnet';
  /** Already in the classification worker's memory */
  loaded: boolean;
  /** Whether a new project may pick it */
  fits: boolean;
  /** Why not, when fits is false */
  reason: string | null;
}

export const classificationModelsApi = {
  list: async (): Promise<ClassificationModelInfo[]> => {
    const response = await apiClient.get<ClassificationModelInfo[]>('/api/classification-models');
    return response.data;
  },
};
