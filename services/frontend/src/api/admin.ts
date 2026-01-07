/**
 * Admin API client
 */
import apiClient from './client';
import type {
  UserWithProject,
  SignalConfig,
  SignalRegisterRequest,
  SignalUpdateConfigRequest
} from './types';

export const adminApi = {
  /**
   * Get all users with their project assignments
   */
  listUsers: async (): Promise<UserWithProject[]> => {
    const response = await apiClient.get<UserWithProject[]>('/api/admin/users');
    return response.data;
  },

  /**
   * Assign user to project
   */
  assignUserToProject: async (userId: number, projectId: number | null): Promise<UserWithProject> => {
    const response = await apiClient.patch<UserWithProject>(
      `/api/admin/users/${userId}/project`,
      { project_id: projectId }
    );
    return response.data;
  },

  // Signal Configuration
  /**
   * Get Signal configuration
   */
  getSignalConfig: async (): Promise<SignalConfig> => {
    const response = await apiClient.get<SignalConfig>('/api/admin/signal/config');
    return response.data;
  },

  /**
   * Register Signal phone number
   */
  registerSignal: async (data: SignalRegisterRequest): Promise<SignalConfig> => {
    const response = await apiClient.post<SignalConfig>('/api/admin/signal/register', data);
    return response.data;
  },

  /**
   * Update Signal configuration
   */
  updateSignalConfig: async (data: SignalUpdateConfigRequest): Promise<SignalConfig> => {
    const response = await apiClient.put<SignalConfig>('/api/admin/signal/config', data);
    return response.data;
  },

  /**
   * Unregister Signal
   */
  unregisterSignal: async (): Promise<void> => {
    await apiClient.delete('/api/admin/signal/config');
  },

  /**
   * Submit CAPTCHA token
   */
  submitSignalCaptcha: async (captcha: string): Promise<SignalConfig> => {
    const response = await apiClient.post<SignalConfig>('/api/admin/signal/submit-captcha', { captcha });
    return response.data;
  },

  /**
   * Submit SMS verification code
   */
  verifySignalCode: async (code: string): Promise<SignalConfig> => {
    const response = await apiClient.post<SignalConfig>('/api/admin/signal/verify-code', { code });
    return response.data;
  },
};
