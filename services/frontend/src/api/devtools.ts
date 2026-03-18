/**
 * Dev tools API functions
 */
import apiClient from './client';

export interface UploadResponse {
  success: boolean;
  filename: string;
  message: string;
}

/**
 * Upload file directly to FTPS directory (superuser only)
 */
export const uploadFile = async (file: File): Promise<UploadResponse> => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await apiClient.post<UploadResponse>(
    '/api/devtools/upload',
    formData,
    {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    }
  );

  return response.data;
};

