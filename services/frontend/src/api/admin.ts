/**
 * Admin API client
 */
import apiClient from './client';
import type {
  UserWithMemberships,
  ProjectMembershipInfo,
  AddUserToProjectRequest,
  UpdateProjectUserRoleRequest,
  InviteUserRequest,
  InvitationResponse,
  SignalConfig,
  SignalRegisterRequest,
  SignalUpdateConfigRequest,
  TelegramConfig,
  TelegramConfigureRequest
} from './types';

export const adminApi = {
  /**
   * Get all users with their project memberships
   */
  listUsers: async (): Promise<UserWithMemberships[]> => {
    const response = await apiClient.get<UserWithMemberships[]>('/api/admin/users');
    return response.data;
  },

  /**
   * Get user's project memberships
   */
  getUserProjects: async (userId: number): Promise<ProjectMembershipInfo[]> => {
    const response = await apiClient.get<{ memberships: ProjectMembershipInfo[] }>(
      `/api/admin/users/${userId}/projects`
    );
    return response.data.memberships;
  },

  /**
   * Add user to project with role
   */
  addUserToProject: async (userId: number, projectId: number, role: string): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>(
      `/api/admin/users/${userId}/projects`,
      { project_id: projectId, role }
    );
    return response.data;
  },

  /**
   * Update user's role in project
   */
  updateUserProjectRole: async (userId: number, projectId: number, role: string): Promise<{ message: string }> => {
    const response = await apiClient.patch<{ message: string }>(
      `/api/admin/users/${userId}/projects/${projectId}`,
      { role }
    );
    return response.data;
  },

  /**
   * Remove user from project
   */
  removeUserFromProject: async (userId: number, projectId: number): Promise<{ message: string }> => {
    const response = await apiClient.delete<{ message: string }>(
      `/api/admin/users/${userId}/projects/${projectId}`
    );
    return response.data;
  },

  /**
   * Invite a new user (server admin only)
   */
  inviteUser: async (data: InviteUserRequest): Promise<InvitationResponse> => {
    const response = await apiClient.post<InvitationResponse>('/api/admin/users/invite', data);
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

  /**
   * Send test Signal message
   */
  sendTestSignalMessage: async (recipient: string, message: string): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>('/api/admin/signal/send-test', {
      recipient,
      message
    });
    return response.data;
  },

  /**
   * Submit rate limit challenge CAPTCHA
   */
  submitRateLimitChallenge: async (challengeToken: string, captcha: string): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>('/api/admin/signal/submit-rate-limit-challenge', {
      challenge_token: challengeToken,
      captcha
    });
    return response.data;
  },

  // Telegram Configuration
  /**
   * Get Telegram configuration
   */
  getTelegramConfig: async (): Promise<TelegramConfig> => {
    const response = await apiClient.get<TelegramConfig>('/api/admin/telegram/config');
    return response.data;
  },

  /**
   * Configure Telegram bot
   */
  configureTelegram: async (data: TelegramConfigureRequest): Promise<TelegramConfig> => {
    const response = await apiClient.post<TelegramConfig>('/api/admin/telegram/configure', data);
    return response.data;
  },

  /**
   * Remove Telegram configuration
   */
  unconfigureTelegram: async (): Promise<void> => {
    await apiClient.delete('/api/admin/telegram');
  },

  /**
   * Check Telegram bot health
   */
  checkTelegramHealth: async (): Promise<{ health_status: string }> => {
    const response = await apiClient.get<{ health_status: string }>('/api/admin/telegram/health');
    return response.data;
  },

  /**
   * Send test Telegram message
   */
  sendTestTelegramMessage: async (chatId: string, message: string): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>('/api/admin/telegram/test-message', {
      chat_id: chatId,
      message
    });
    return response.data;
  },
};
