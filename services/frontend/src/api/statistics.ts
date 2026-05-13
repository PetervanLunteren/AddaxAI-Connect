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
  NaiveOccupancyResponse,
  NaiveOccupancyFilters,
  ActivityOverlapResponse,
  ActivityOverlapFilters,
  TimelineResponse,
  TimelineFilters,
  PipelineStatusResponse,
  DetectionCountResponse,
  IndependenceSummaryResponse,
} from './types';

export const statisticsApi = {
  /**
   * Get dashboard overview statistics
   */
  getOverview: async (projectId?: number, cameraIds?: string): Promise<StatisticsOverview> => {
    const params: Record<string, string> = {};
    if (projectId !== undefined) params.project_id = projectId.toString();
    if (cameraIds) params.camera_ids = cameraIds;
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
  getSpeciesDistribution: async (projectId?: number, cameraIds?: string): Promise<SpeciesCount[]> => {
    const params: Record<string, string> = {};
    if (projectId !== undefined) params.project_id = projectId.toString();
    if (cameraIds) params.camera_ids = cameraIds;
    const response = await apiClient.get<SpeciesCount[]>('/api/statistics/species-distribution', { params });
    return response.data;
  },

  /**
   * Get camera activity summary
   */
  getCameraActivity: async (projectId?: number, cameraIds?: string): Promise<CameraActivitySummary> => {
    const params: Record<string, string> = {};
    if (projectId !== undefined) params.project_id = projectId.toString();
    if (cameraIds) params.camera_ids = cameraIds;
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
    if (filters?.camera_ids) params.append('camera_ids', filters.camera_ids);

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
    if (filters?.camera_ids) params.append('camera_ids', filters.camera_ids);

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
    if (filters?.camera_ids) params.append('camera_ids', filters.camera_ids);

    const queryString = params.toString();
    const url = queryString
      ? `/api/statistics/detection-trend?${queryString}`
      : '/api/statistics/detection-trend';

    const response = await apiClient.get<DetectionTrendPoint[]>(url);
    return response.data;
  },

  /**
   * Deployment timeline: per-camera Gantt + concurrent-cameras strip.
   */
  getTimeline: async (
    projectId: number,
    filters?: TimelineFilters,
  ): Promise<TimelineResponse> => {
    const params = new URLSearchParams();
    params.append('project_id', projectId.toString());
    if (filters?.camera_ids) params.append('camera_ids', filters.camera_ids);
    if (filters?.start_date) params.append('start_date', filters.start_date);
    if (filters?.end_date) params.append('end_date', filters.end_date);
    const response = await apiClient.get<TimelineResponse>(
      `/api/statistics/timeline?${params.toString()}`,
    );
    return response.data;
  },

  /**
   * Activity overlap for 1 or 2 species (KDE + bootstrap CI + diel class).
   */
  getActivityOverlap: async (
    projectId: number,
    filters: ActivityOverlapFilters,
  ): Promise<ActivityOverlapResponse> => {
    const params = new URLSearchParams();
    params.append('project_id', projectId.toString());
    params.append('species_a', filters.species_a);
    if (filters.species_b) params.append('species_b', filters.species_b);
    if (filters.camera_ids) params.append('camera_ids', filters.camera_ids);
    if (filters.start_date) params.append('start_date', filters.start_date);
    if (filters.end_date) params.append('end_date', filters.end_date);
    if (filters.time_axis) params.append('time_axis', filters.time_axis);
    const response = await apiClient.get<ActivityOverlapResponse>(
      `/api/statistics/activity-overlap?${params.toString()}`,
    );
    return response.data;
  },

  /**
   * Naive occupancy per species: sites_detected / sites_total over a window.
   */
  getNaiveOccupancy: async (
    projectId?: number,
    filters?: NaiveOccupancyFilters,
  ): Promise<NaiveOccupancyResponse> => {
    const params = new URLSearchParams();
    if (projectId !== undefined) params.append('project_id', projectId.toString());
    if (filters?.start_date) params.append('start_date', filters.start_date);
    if (filters?.end_date) params.append('end_date', filters.end_date);
    if (filters?.camera_ids) params.append('camera_ids', filters.camera_ids);
    if (filters?.top_n !== undefined) params.append('top_n', filters.top_n.toString());

    const queryString = params.toString();
    const url = queryString
      ? `/api/statistics/naive-occupancy?${queryString}`
      : '/api/statistics/naive-occupancy';

    const response = await apiClient.get<NaiveOccupancyResponse>(url);
    return response.data;
  },

  /**
   * Download the detection-history CSV via the authenticated client.
   * Returns the blob and the filename suggested by the server. Plain
   * window.location.href would lose the JWT, so the caller cannot just
   * point at the URL; this is the only download path.
   */
  downloadDetectionHistoryCsv: async (
    projectId: number,
    startDate: string,
    endDate: string,
    options?: { cameraIds?: string; occasionLengthDays?: number },
  ): Promise<{ blob: Blob; filename: string }> => {
    const params: Record<string, string | number> = {
      project_id: projectId,
      start_date: startDate,
      end_date: endDate,
    };
    if (options?.cameraIds) params.camera_ids = options.cameraIds;
    if (options?.occasionLengthDays !== undefined) {
      params.occasion_length_days = options.occasionLengthDays;
    }
    const response = await apiClient.get('/api/statistics/detection-history.csv', {
      params,
      responseType: 'blob',
    });
    const disposition = response.headers?.['content-disposition'] as string | undefined;
    const match = disposition?.match(/filename="?([^";]+)"?/i);
    const filename =
      match?.[1] ?? `detection-history-project-${projectId}-${startDate}-to-${endDate}.csv`;
    return { blob: response.data as Blob, filename };
  },

  /**
   * Get pipeline status (pending/classified counts)
   */
  getPipelineStatus: async (projectId?: number, cameraIds?: string): Promise<PipelineStatusResponse> => {
    const params: Record<string, string> = {};
    if (projectId !== undefined) params.project_id = projectId.toString();
    if (cameraIds) params.camera_ids = cameraIds;
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

  getDemographics: async (
    projectId: number,
    filters?: { field?: string; species?: string; start_date?: string; end_date?: string; camera_ids?: string },
  ) => {
    const params: Record<string, string> = { project_id: projectId.toString() };
    if (filters?.field) params.field = filters.field;
    if (filters?.species) params.species = filters.species;
    if (filters?.start_date) params.start_date = filters.start_date;
    if (filters?.end_date) params.end_date = filters.end_date;
    if (filters?.camera_ids) params.camera_ids = filters.camera_ids;
    const response = await apiClient.get<{
      field: string;
      species: string | null;
      values: { value: string; count: number }[];
      total: number;
    }>('/api/statistics/demographics', { params });
    return response.data;
  },

  getVerificationProgressAll: async (
    projectId: number,
    filters?: { start_date?: string; end_date?: string; camera_ids?: string },
  ) => {
    const params: Record<string, string> = { project_id: projectId.toString() };
    if (filters?.start_date) params.start_date = filters.start_date;
    if (filters?.end_date) params.end_date = filters.end_date;
    if (filters?.camera_ids) params.camera_ids = filters.camera_ids;
    const response = await apiClient.get<{
      rows: { total: number; verified: number; percentage: number; label: string }[];
    }>('/api/statistics/verification-progress-all', { params });
    return response.data;
  },

  getVerificationProgress: async (
    projectId: number,
    filters?: { label?: string; start_date?: string; end_date?: string; camera_ids?: string },
  ) => {
    const params: Record<string, string> = { project_id: projectId.toString() };
    if (filters?.label) params.label = filters.label;
    if (filters?.start_date) params.start_date = filters.start_date;
    if (filters?.end_date) params.end_date = filters.end_date;
    if (filters?.camera_ids) params.camera_ids = filters.camera_ids;
    const response = await apiClient.get<{
      total: number;
      verified: number;
      percentage: number;
      label: string;
    }>('/api/statistics/verification-progress', { params });
    return response.data;
  },
};
