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
  DateRangeFilters,
  DetectionTrendPoint,
  DetectionTrendFilters,
  PipelineStatusResponse,
  DetectionCountResponse,
  IndependenceSummaryResponse,
} from './types';

export const statisticsApi = {
  /**
   * Get dashboard overview statistics
   */
  getOverview: async (projectId?: number): Promise<StatisticsOverview> => {
    const params: Record<string, string> = {};
    if (projectId !== undefined) params.project_id = projectId.toString();
    const response = await apiClient.get<StatisticsOverview>('/api/statistics/overview', { params });
    return response.data;
  },

  /**
   * Get images timeline
   */
  getImagesTimeline: async (projectId?: number, days?: number): Promise<TimelineDataPoint[]> => {
    const params = new URLSearchParams();
    if (projectId !== undefined) params.append('project_id', projectId.toString());
    if (days !== undefined) params.append('days', days.toString());
    const queryString = params.toString();
    const url = queryString
      ? `/api/statistics/images-timeline?${queryString}`
      : '/api/statistics/images-timeline';
    const response = await apiClient.get<TimelineDataPoint[]>(url);
    return response.data;
  },

  /**
   * Get species distribution (top 10)
   */
  getSpeciesDistribution: async (projectId?: number): Promise<SpeciesCount[]> => {
    const params: Record<string, string> = {};
    if (projectId !== undefined) params.project_id = projectId.toString();
    const response = await apiClient.get<SpeciesCount[]>('/api/statistics/species-distribution', { params });
    return response.data;
  },

  /**
   * Get camera activity summary
   */
  getCameraActivity: async (projectId?: number): Promise<CameraActivitySummary> => {
    const params: Record<string, string> = {};
    if (projectId !== undefined) params.project_id = projectId.toString();
    const response = await apiClient.get<CameraActivitySummary>('/api/statistics/camera-activity', { params });
    return response.data;
  },

  /**
   * Get last update timestamp
   */
  getLastUpdate: async (projectId?: number): Promise<LastUpdateResponse> => {
    const params: Record<string, string> = {};
    if (projectId !== undefined) params.project_id = projectId.toString();
    const response = await apiClient.get<LastUpdateResponse>('/api/statistics/last-update', { params });
    return response.data;
  },

  /**
   * Get detection rate map data (GeoJSON)
   */
  getDetectionRateMap: async (projectId?: number, filters?: DetectionRateMapFilters): Promise<DetectionRateMapResponse> => {
    const params = new URLSearchParams();
    if (projectId !== undefined) params.append('project_id', projectId.toString());
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
  getActivityPattern: async (projectId?: number, filters?: ActivityPatternFilters): Promise<ActivityPatternResponse> => {
    const params = new URLSearchParams();
    if (projectId !== undefined) params.append('project_id', projectId.toString());
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
   * Get detection trend (daily counts)
   */
  getDetectionTrend: async (projectId?: number, filters?: DetectionTrendFilters): Promise<DetectionTrendPoint[]> => {
    const params = new URLSearchParams();
    if (projectId !== undefined) params.append('project_id', projectId.toString());
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
   * Get pipeline status (pending/classified counts)
   */
  getPipelineStatus: async (projectId?: number): Promise<PipelineStatusResponse> => {
    const params: Record<string, string> = {};
    if (projectId !== undefined) params.project_id = projectId.toString();
    const response = await apiClient.get<PipelineStatusResponse>('/api/statistics/pipeline-status', { params });
    return response.data;
  },

  getDetectionCount: async (projectId: number, threshold: number): Promise<DetectionCountResponse> => {
    const response = await apiClient.get<DetectionCountResponse>(
      '/api/statistics/detection-count',
      { params: { project_id: projectId.toString(), threshold: threshold.toString() } }
    );
    return response.data;
  },

  getIndependenceSummary: async (projectId: number, intervalMinutes?: number): Promise<IndependenceSummaryResponse> => {
    const params: Record<string, string> = { project_id: projectId.toString() };
    if (intervalMinutes !== undefined) params.interval_minutes = intervalMinutes.toString();
    const response = await apiClient.get<IndependenceSummaryResponse>(
      '/api/statistics/independence-summary',
      { params }
    );
    return response.data;
  },
};
