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
  DetectionRateMapFilters,
  ActivityPatternResponse,
  ActivityPatternFilters,
  SpeciesAccumulationPoint,
  DateRangeFilters,
  DetectionTrendPoint,
  DetectionTrendFilters,
  ConfidenceBin,
  OccupancyMatrixResponse,
  PipelineStatusResponse,
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

  // =========================================================================
  // Dashboard visualization endpoints
  // =========================================================================

  /**
   * Get activity pattern (hourly detection counts)
   */
  getActivityPattern: async (filters?: ActivityPatternFilters): Promise<ActivityPatternResponse> => {
    const params = new URLSearchParams();
    if (filters?.species) params.append('species', filters.species);
    if (filters?.start_date) params.append('start_date', filters.start_date);
    if (filters?.end_date) params.append('end_date', filters.end_date);

    const queryString = params.toString();
    const url = queryString
      ? `/api/statistics/activity-pattern?${queryString}`
      : '/api/statistics/activity-pattern';

    const response = await apiClient.get<ActivityPatternResponse>(url);
    return response.data;
  },

  /**
   * Get species accumulation curve
   */
  getSpeciesAccumulation: async (filters?: DateRangeFilters): Promise<SpeciesAccumulationPoint[]> => {
    const params = new URLSearchParams();
    if (filters?.start_date) params.append('start_date', filters.start_date);
    if (filters?.end_date) params.append('end_date', filters.end_date);

    const queryString = params.toString();
    const url = queryString
      ? `/api/statistics/species-accumulation?${queryString}`
      : '/api/statistics/species-accumulation';

    const response = await apiClient.get<SpeciesAccumulationPoint[]>(url);
    return response.data;
  },

  /**
   * Get detection trend (daily counts)
   */
  getDetectionTrend: async (filters?: DetectionTrendFilters): Promise<DetectionTrendPoint[]> => {
    const params = new URLSearchParams();
    if (filters?.species) params.append('species', filters.species);
    if (filters?.start_date) params.append('start_date', filters.start_date);
    if (filters?.end_date) params.append('end_date', filters.end_date);

    const queryString = params.toString();
    const url = queryString
      ? `/api/statistics/detection-trend?${queryString}`
      : '/api/statistics/detection-trend';

    const response = await apiClient.get<DetectionTrendPoint[]>(url);
    return response.data;
  },

  /**
   * Get detection confidence distribution
   */
  getConfidenceDistribution: async (filters?: DateRangeFilters): Promise<ConfidenceBin[]> => {
    const params = new URLSearchParams();
    if (filters?.start_date) params.append('start_date', filters.start_date);
    if (filters?.end_date) params.append('end_date', filters.end_date);

    const queryString = params.toString();
    const url = queryString
      ? `/api/statistics/confidence-distribution?${queryString}`
      : '/api/statistics/confidence-distribution';

    const response = await apiClient.get<ConfidenceBin[]>(url);
    return response.data;
  },

  /**
   * Get occupancy matrix (species x camera)
   */
  getOccupancyMatrix: async (filters?: DateRangeFilters): Promise<OccupancyMatrixResponse> => {
    const params = new URLSearchParams();
    if (filters?.start_date) params.append('start_date', filters.start_date);
    if (filters?.end_date) params.append('end_date', filters.end_date);

    const queryString = params.toString();
    const url = queryString
      ? `/api/statistics/occupancy-matrix?${queryString}`
      : '/api/statistics/occupancy-matrix';

    const response = await apiClient.get<OccupancyMatrixResponse>(url);
    return response.data;
  },

  /**
   * Get pipeline status (pending/classified counts)
   */
  getPipelineStatus: async (): Promise<PipelineStatusResponse> => {
    const response = await apiClient.get<PipelineStatusResponse>('/api/statistics/pipeline-status');
    return response.data;
  },
};
