/**
 * Health check API functions
 */
import apiClient from './client';

export interface ServiceStatus {
  name: string;
  status: 'healthy' | 'unhealthy';
  message: string;
}

export interface ServicesHealthResponse {
  services: ServiceStatus[];
}

/**
 * Get health status of all system services (server admin only)
 */
export const getServicesHealth = async (): Promise<ServicesHealthResponse> => {
  const response = await apiClient.get<ServicesHealthResponse>('/api/health/services');
  return response.data;
};
