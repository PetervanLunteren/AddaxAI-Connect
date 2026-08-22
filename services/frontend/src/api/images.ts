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
  human_has?: string;  // Class a validator recorded (confusion-matrix cell click)
  ai_has?: string;     // Class the AI predicted (confusion-matrix cell click)
  show_empty?: boolean;
  /** Only real species, so no person, vehicle or empty frame. Lets a
   *  caller ask for wildlife without first fetching the species list. */
  wildlife_only?: boolean;
  verified?: string;  // "true", "false", or undefined for all
  liked?: string;  // "true", "false", or undefined for all
  needs_review?: string;  // "true", "false", or undefined for all
  validated_by?: string;  // Comma-separated user ids of the verifying user
  hour_from?: number;  // Time-of-day lower bound, camera clock hour (inclusive)
  hour_to?: number;  // Time-of-day upper bound, exclusive; from later than to wraps past midnight
  origin?: string;  // "live", "bulk", or undefined for all
  tags?: string;  // Comma-separated site tags
  image_tags?: string;  // Comma-separated image tags, matches images carrying any of them
  min_detection_confidence?: number;
  max_detection_confidence?: number;
  min_classification_confidence?: number;
  max_classification_confidence?: number;
  project_id?: number;
  site_id?: string;        // images at one or more sites (comma-separated), via their deployment
  /**
   * 'newest' (default) or 'confidence'. Confidence ranks by the strongest
   * classification, narrowed to the species filter when one is set, so the
   * dashboard can lead with a photo that shows the animal clearly.
   */
  sort?: 'newest' | 'confidence';
}

export interface SpeciesOption {
  label: string;
  value: string;
}

export interface ValidatorOption {
  user_id: number;
  email: string;
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
   * Get the users who verified at least one image, for the validated-by
   * filter dropdown
   */
  getValidators: async (projectId?: number): Promise<ValidatorOption[]> => {
    const params: Record<string, string> = {};
    if (projectId !== undefined) params.project_id = projectId.toString();
    const response = await apiClient.get<ValidatorOption[]>('/api/images/validators', { params });
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

  /**
   * Replace an image's tags (user-assigned flags for events of interest)
   */
  setTags: async (uuid: string, tags: string[]): Promise<{ tags: string[] }> => {
    const response = await apiClient.put<{ tags: string[] }>(
      `/api/images/${uuid}/tags`,
      { tags },
    );
    return response.data;
  },

  /**
   * All unique image tags in the project, for TagInput autocomplete
   */
  getTags: async (projectId?: number): Promise<string[]> => {
    const params: Record<string, string> = {};
    if (projectId !== undefined) params.project_id = projectId.toString();
    const response = await apiClient.get<string[]>('/api/images/tags', { params });
    return response.data;
  },
};
