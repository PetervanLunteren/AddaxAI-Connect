/**
 * Authentication API functions
 */
import apiClient from './client';
import { ProjectWithRole } from './types';

export interface LoginRequest {
  username: string; // FastAPI-Users uses 'username' field for email
  password: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  token: string; // Required invitation token
}

export interface InviteTokenValidationResponse {
  email: string;
  role: string;
  project_name: string | null;
}

export interface User {
  id: number;
  email: string;
  is_active: boolean;
  is_superuser: boolean;
  is_verified: boolean;
}

export interface UserProjectsResponse {
  projects: ProjectWithRole[];
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  password: string;
}

export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
}

export interface VerifyEmailRequest {
  token: string;
}

/**
 * Login with email and password
 */
export const login = async (email: string, password: string): Promise<LoginResponse> => {
  // FastAPI-Users expects application/x-www-form-urlencoded
  const params = new URLSearchParams();
  params.append('username', email); // FastAPI-Users expects 'username' field
  params.append('password', password);

  const response = await apiClient.post<LoginResponse>('/auth/login', params, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  return response.data;
};

/**
 * Logout (client-side only - clear token)
 */
export const logout = async (): Promise<void> => {
  // FastAPI-Users doesn't have server-side logout for JWT
  // Just clear client-side token
  localStorage.removeItem('access_token');
  localStorage.removeItem('user');
};

/**
 * Validate invitation token
 */
export const validateInviteToken = async (token: string): Promise<InviteTokenValidationResponse> => {
  const response = await apiClient.get<InviteTokenValidationResponse>(`/auth/invite/validate?token=${token}`);
  return response.data;
};

/**
 * Register new user with invitation token
 */
export const register = async (email: string, password: string, token: string): Promise<User> => {
  const response = await apiClient.post<User>('/auth/register', {
    email,
    password,
    token,
  });

  return response.data;
};

/**
 * Get current user info
 */
export const getCurrentUser = async (): Promise<User> => {
  const response = await apiClient.get<User>('/users/me');
  return response.data;
};

/**
 * Get current user's projects with roles
 */
export const getUserProjects = async (): Promise<ProjectWithRole[]> => {
  const response = await apiClient.get<UserProjectsResponse>('/users/me/projects');
  return response.data.projects;
};

/**
 * Verify email with token
 */
export const verifyEmail = async (token: string): Promise<User> => {
  const response = await apiClient.post<User>('/auth/verify', {
    token,
  });

  return response.data;
};

/**
 * Request password reset email
 */
export const forgotPassword = async (email: string): Promise<void> => {
  await apiClient.post('/auth/forgot-password', {
    email,
  });
};

/**
 * Reset password with token
 */
export const resetPassword = async (token: string, password: string): Promise<void> => {
  await apiClient.post('/auth/reset-password', {
    token,
    password,
  });
};

/**
 * Change password for authenticated user
 */
export const changePassword = async (currentPassword: string, newPassword: string): Promise<void> => {
  await apiClient.post('/auth/change-password', {
    current_password: currentPassword,
    new_password: newPassword,
  });
};
