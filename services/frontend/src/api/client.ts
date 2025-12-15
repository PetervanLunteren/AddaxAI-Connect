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

// Response interceptor - handle errors and log failures
apiClient.interceptors.response.use(
  (response) => response,
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
      window.location.href = '/login';
    }

    return Promise.reject(error);
  }
);

export default apiClient;
