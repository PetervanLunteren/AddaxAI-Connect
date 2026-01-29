/**
 * Statistics API endpoints
 */
import apiClient from './client';
import type {
  StatisticsOverview,
  TimelineDataPoint,
  SpeciesCount,
  CameraActivitySummary,
  LastUpdateResponse,
  DetectionRateMapResponse,
  DetectionRateMapFilters
} from './types';

export const statisticsApi = {
  /**
   * Get dashboard overview statistics
   */
  getOverview: async (): Promise<StatisticsOverview> => {
    const response = await apiClient.get<StatisticsOverview>('/api/statistics/overview');
    return response.data;
  },

  /**
   * Get images timeline (last 30 days)
   */
  getImagesTimeline: async (): Promise<TimelineDataPoint[]> => {
    const response = await apiClient.get<TimelineDataPoint[]>('/api/statistics/images-timeline');
    return response.data;
  },

  /**
   * Get species distribution (top 10)
   */
  getSpeciesDistribution: async (): Promise<SpeciesCount[]> => {
    const response = await apiClient.get<SpeciesCount[]>('/api/statistics/species-distribution');
    return response.data;
  },

  /**
   * Get camera activity summary
   */
  getCameraActivity: async (): Promise<CameraActivitySummary> => {
    const response = await apiClient.get<CameraActivitySummary>('/api/statistics/camera-activity');
    return response.data;
  },

  /**
   * Get last update timestamp
   */
  getLastUpdate: async (): Promise<LastUpdateResponse> => {
    const response = await apiClient.get<LastUpdateResponse>('/api/statistics/last-update');
    return response.data;
  },

  /**
   * Get detection rate map data (GeoJSON)
   */
  getDetectionRateMap: async (filters?: DetectionRateMapFilters): Promise<DetectionRateMapResponse> => {
    const params = new URLSearchParams();
    if (filters?.species) params.append('species', filters.species);
    if (filters?.start_date) params.append('start_date', filters.start_date);
    if (filters?.end_date) params.append('end_date', filters.end_date);

    const queryString = params.toString();
    const url = queryString
      ? `/api/statistics/detection-rate-map?${queryString}`
      : '/api/statistics/detection-rate-map';

    const response = await apiClient.get<DetectionRateMapResponse>(url);
    return response.data;
  },
};
