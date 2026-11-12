/**
 * Authentication API functions
 */
import apiClient from './client';
import { ProjectWithRole } from './types';

export interface LoginRequest {
  username: string; // FastAPI-Users uses 'username' field for email
  password: string;
}

export interface LoginToken {
  access_token: string;
  token_type: string;
}

/**
 * The password was right, but the login is not done. Either a code is asked
 * (code_required), or a project requires two-factor login and this account
 * must set it up first (setup_required). The pending token is what the next
 * step sends back, it opens nothing else.
 */
export interface LoginTwoFactorStep {
  two_factor: 'code_required' | 'setup_required';
  pending_token: string;
}

export type LoginResponse = LoginToken | LoginTwoFactorStep;

export const isTwoFactorStep = (response: LoginResponse): response is LoginTwoFactorStep =>
  'two_factor' in response;

export interface TwoFactorSetup {
  key: string; // What a user types into the authenticator app
  otpauth_uri: string; // What the QR code holds
}

export interface TwoFactorEnabled {
  recovery_codes: string[];
  access_token?: string; // Only when the setup was part of a login
}

export interface RegisterRequest {
  email: string;
  password: string;
  token: string; // Required invitation token
}

export interface InviteTokenValidationResponse {
  // Number of sites a restricted viewer invitation is limited to,
  // null when the invitation is unrestricted
  restricted_site_count?: number | null;
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
  two_factor_enabled: boolean;
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
 * Change password for authenticated user.
 *
 * The backend invalidates every other JWT for this user the instant the
 * password changes (it stamps password_changed_at and the JWT strategy
 * rejects any token issued before then). To keep the CURRENT browser
 * session usable, the response returns a fresh access_token; we swap it
 * into localStorage so the next request rides the new token instead of
 * the now-invalid old one.
 */
export const changePassword = async (currentPassword: string, newPassword: string): Promise<void> => {
  const response = await apiClient.post<{ access_token?: string; token_type?: string }>(
    '/auth/change-password',
    {
      current_password: currentPassword,
      new_password: newPassword,
    },
  );
  const newToken = response.data?.access_token;
  if (newToken) {
    localStorage.setItem('access_token', newToken);
  }
};

/**
 * Second step of a login, a code from the authenticator app or a recovery code
 */
export const loginWithCode = async (
  pendingToken: string,
  code: string,
  remember: boolean,
): Promise<LoginToken> => {
  const response = await apiClient.post<LoginToken>('/auth/login/two-factor', {
    pending_token: pendingToken,
    code,
    remember,
  });
  return response.data;
};

/**
 * Start a two-factor setup. With a pending token it is part of a login,
 * without one it is for the account that is logged in.
 */
export const setupTwoFactor = async (pendingToken?: string): Promise<TwoFactorSetup> => {
  const response = await apiClient.post<TwoFactorSetup>('/auth/two-factor/setup', {
    pending_token: pendingToken,
  });
  return response.data;
};

/**
 * Confirm a setup with a first code. Returns the recovery codes, this once.
 */
export const enableTwoFactor = async (code: string, pendingToken?: string): Promise<TwoFactorEnabled> => {
  const response = await apiClient.post<TwoFactorEnabled>('/auth/two-factor/enable', {
    code,
    pending_token: pendingToken,
  });
  return response.data;
};

/**
 * Switch two-factor login off, with a code
 */
export const disableTwoFactor = async (code: string): Promise<void> => {
  await apiClient.post('/auth/two-factor/disable', { code });
};

/**
 * The backend's code for an expired pending token. The login page goes back
 * to the password step on it.
 */
export const TWO_FACTOR_PENDING_EXPIRED = 'TWO_FACTOR_PENDING_EXPIRED';

const TWO_FACTOR_MESSAGES: Record<string, string> = {
  TWO_FACTOR_BAD_CODE: 'That code is not right. Check the app and try again.',
  [TWO_FACTOR_PENDING_EXPIRED]: 'That took too long. Log in again.',
  TWO_FACTOR_TOO_MANY_ATTEMPTS: 'Too many wrong codes. Wait 15 minutes and try again.',
  TWO_FACTOR_UNAVAILABLE: 'Two-factor login is not available right now. Try again in a minute.',
  TWO_FACTOR_REQUIRED: 'A project you can open requires two-factor login, so you cannot switch it off.',
  TWO_FACTOR_ALREADY_ON: 'Two-factor login is already on for this account.',
  TWO_FACTOR_NOT_ON: 'Two-factor login is not on for this account.',
  TWO_FACTOR_NO_SETUP: 'Start the setup again.',
  TWO_FACTOR_NOT_FOR_DEMO: 'The demo account cannot use two-factor login.',
};

/**
 * The message to show for a failed two-factor call. One place, so the login
 * page and the account dialog say the same thing.
 */
export const twoFactorErrorMessage = (err: any): string => {
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string' && TWO_FACTOR_MESSAGES[detail]) {
    return TWO_FACTOR_MESSAGES[detail];
  }
  // The web server in front of the app limits requests per address
  const status = err?.response?.status;
  if (status === 429 || status === 503) {
    return 'Too many requests right now. Wait a minute and try again.';
  }
  return 'Something went wrong. Try again.';
};
