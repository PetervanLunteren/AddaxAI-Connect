/**
 * Axios HTTP client with authentication interceptors
 */
import axios, { AxiosInstance, InternalAxiosRequestConfig, AxiosError } from 'axios';
import { logger } from '../utils/logger';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

// Create axios instance
const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor - add Authorization header if token exists
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem('access_token');
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Keep the login alive while the app is in use. A token lasts an hour; when
// a call succeeds with less than half an hour left, ask for a new one. A tab
// that makes no calls (React Query stops polling in the background) is not
// renewed and logs out after the hour. The
// server refuses (403) from 24 hours after the password was typed, and the
// token then runs out on its own. One refused token is not asked for again.
const RENEW_WHEN_LEFT_MS = 30 * 60 * 1000;
let renewing = false;
let refusedToken: string | null = null;

function tokenExpiresAt(token: string): number | null {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const exp = JSON.parse(atob(payload)).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

function renewTokenIfDue(): void {
  const token = localStorage.getItem('access_token');
  if (!token || renewing || token === refusedToken) return;
  const expiresAt = tokenExpiresAt(token);
  if (expiresAt === null || expiresAt - Date.now() > RENEW_WHEN_LEFT_MS) return;
  renewing = true;
  apiClient
    .post<{ access_token: string }>('/auth/refresh')
    .then((response) => {
      // Skip when the user logged out or in again meanwhile.
      if (localStorage.getItem('access_token') === token) {
        localStorage.setItem('access_token', response.data.access_token);
      }
    })
    .catch((error: AxiosError) => {
      // A network error is tried again on the next call; a refusal is final.
      if (error.response?.status === 403) refusedToken = token;
    })
    .finally(() => {
      renewing = false;
    });
}

// Response interceptor - renew the login, handle errors and log failures
apiClient.interceptors.response.use(
  (response) => {
    renewTokenIfDue();
    return response;
  },
  (error: AxiosError) => {
    // Log API errors (status >= 400)
    if (error.response && error.response.status >= 400) {
      logger.error('API request failed', {
        method: error.config?.method?.toUpperCase(),
        url: error.config?.url,
        status: error.response.status,
        status_text: error.response.statusText,
        error_message: error.message,
        response_data: error.response.data,
      });
    }

    // Handle 401 specifically
    if (error.response?.status === 401) {
      // Token expired or invalid - clear and redirect to login
      localStorage.removeItem('access_token');
      localStorage.removeItem('user');
      const currentPath = window.location.pathname + window.location.search;
      const loginUrl = currentPath && currentPath !== '/'
        ? `/login?from=${encodeURIComponent(currentPath)}`
        : '/login';
      window.location.href = loginUrl;
    }

    return Promise.reject(error);
  }
);

/**
 * A readable message for a failed API call. FastAPI answers a validation
 * error with a list of problems in `detail`, which would otherwise show as
 * "[object Object]".
 */
export function apiErrorMessage(error: unknown): string {
  const err = error as AxiosError<{ detail?: unknown }>;
  const detail = err.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map((d) => (d && typeof d === 'object' && 'msg' in d ? String(d.msg) : String(d))).join(', ');
  }
  return err.message || 'Unknown error';
}

export default apiClient;
