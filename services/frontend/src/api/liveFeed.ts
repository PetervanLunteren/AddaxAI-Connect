/**
 * Live feed API endpoints
 */
import apiClient from './client';

export type LiveFeedKind = 'image' | 'rejection';

export interface LiveFeedItem {
  kind: LiveFeedKind;
  timestamp: string;  // server wall-clock, ISO 8601
  device_id?: string | null;
  filename: string;

  // image only
  uuid?: string | null;
  status?: string | null;
  captured_at?: string | null;
  thumbnail_url?: string | null;

  // rejection only
  rejection_id?: number | null;
  reason?: string | null;
  details?: string | null;
  image_url?: string | null;
}

export const liveFeedApi = {
  get: async (projectId: number, limit = 20): Promise<LiveFeedItem[]> => {
    const response = await apiClient.get<LiveFeedItem[]>(
      `/api/projects/${projectId}/live-feed`,
      { params: { limit } },
    );
    return response.data;
  },
};
