/**
 * Images API endpoints
 */
import apiClient from './client';
import type { ImageListItem, ImageDetail, PaginatedResponse, SaveVerificationRequest, SaveVerificationResponse, SetLikeResponse, SetNeedsReviewResponse } from './types';

export interface ImageFilters {
  page?: number;
  limit?: number;
  camera_id?: string;
  start_date?: string;
  end_date?: string;
  species?: string;
  human_top?: string;  // Image-level top-1 human observation species (confusion-matrix click)
  ai_top?: string;     // Image-level top-1 AI prediction species (confusion-matrix click)
  show_empty?: boolean;
  verified?: string;  // "true", "false", or undefined for all
  liked?: string;  // "true", "false", or undefined for all
  needs_review?: string;  // "true", "false", or undefined for all
  tags?: string;  // Comma-separated camera tags
  min_detection_confidence?: number;
  max_detection_confidence?: number;
  min_classification_confidence?: number;
  max_classification_confidence?: number;
  project_id?: number;
  site_id?: number;        // all images at one site, via their deployment
  deployment_id?: number;  // images of one deployment
}

export interface SpeciesOption {
  label: string;
  value: string;
}

export const imagesApi = {
  /**
   * Get paginated list of images with filters
   */
  getAll: async (filters?: ImageFilters): Promise<PaginatedResponse<ImageListItem>> => {
    const response = await apiClient.get<PaginatedResponse<ImageListItem>>('/api/images', {
      params: filters,
    });
    return response.data;
  },

  /**
   * Get single image detail by UUID
   */
  getByUuid: async (uuid: string): Promise<ImageDetail> => {
    const response = await apiClient.get<ImageDetail>(`/api/images/${uuid}`);
    return response.data;
  },

  /**
   * Get list of unique species for filter dropdown
   */
  getSpecies: async (projectId?: number): Promise<SpeciesOption[]> => {
    const params: Record<string, string> = {};
    if (projectId !== undefined) params.project_id = projectId.toString();
    const response = await apiClient.get<SpeciesOption[]>('/api/images/species', { params });
    return response.data;
  },

  /**
   * Save human verification for an image
   */
  saveVerification: async (uuid: string, data: SaveVerificationRequest): Promise<SaveVerificationResponse> => {
    const response = await apiClient.put<SaveVerificationResponse>(`/api/images/${uuid}/verification`, data);
    return response.data;
  },

  /**
   * Toggle the project-wide "liked" flag on an image
   */
  setLike: async (uuid: string, isLiked: boolean): Promise<SetLikeResponse> => {
    const response = await apiClient.put<SetLikeResponse>(
      `/api/images/${uuid}/like`,
      { is_liked: isLiked },
    );
    return response.data;
  },

  /**
   * Toggle the project-wide "needs review" flag on an image
   */
  setNeedsReview: async (uuid: string, needsReview: boolean): Promise<SetNeedsReviewResponse> => {
    const response = await apiClient.put<SetNeedsReviewResponse>(
      `/api/images/${uuid}/needs-review`,
      { needs_review: needsReview },
    );
    return response.data;
  },
};
