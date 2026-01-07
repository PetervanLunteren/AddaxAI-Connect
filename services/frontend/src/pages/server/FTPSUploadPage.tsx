/**
 * FTPS Upload Page
 *
 * Upload files directly to FTPS directory for testing ingestion pipeline
 */
import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  Upload,
  CheckCircle2,
  XCircle,
  Loader2,
  FileText,
  Image as ImageIcon,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { ServerPageLayout } from '../../components/layout/ServerPageLayout';
import { uploadFile } from '../../api/devtools';

interface FileUploadStatus {
  filename: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  message?: string;
}

export const FTPSUploadPage: React.FC = () => {
  const [fileStatuses, setFileStatuses] = useState<FileUploadStatus[]>([]);

  // Upload files sequentially
  const uploadFiles = async (files: File[]) => {
    // Initialize file statuses
    const initialStatuses: FileUploadStatus[] = files.map(file => ({
      filename: file.name,
      status: 'pending' as const,
    }));
    setFileStatuses(initialStatuses);

    // Upload each file sequentially
    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // Update status to uploading
      setFileStatuses(prev =>
        prev.map((status, idx) =>
          idx === i ? { ...status, status: 'uploading' as const } : status
        )
      );

      try {
        const result = await uploadFile(file);

        // Update status to success
        setFileStatuses(prev =>
          prev.map((status, idx) =>
            idx === i ? { ...status, status: 'success' as const, message: result.message } : status
          )
        );
      } catch (error: any) {
        // Update status to error
        setFileStatuses(prev =>
          prev.map((status, idx) =>
            idx === i
              ? { ...status, status: 'error' as const, message: error.response?.data?.detail || 'Upload failed' }
              : status
          )
        );
      }
    }

    // Clear statuses after 10 seconds
    setTimeout(() => {
      setFileStatuses([]);
    }, 10000);
  };

  // Dropzone configuration
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        uploadFiles(acceptedFiles);
      }
    },
    []
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/jpeg': ['.jpg', '.jpeg'],
      'text/plain': ['.txt'],
    },
    multiple: true,
  });

  return (
    <ServerPageLayout
      title="Upload to FTPS"
      description="Upload camera trap images and daily reports directly to FTPS directory for testing"
    >
      <Card>
        <CardHeader>
          <CardTitle>File Upload</CardTitle>
          <CardDescription>
            Drag and drop camera trap images (.jpg, .jpeg) or daily reports (.txt) to upload them
            directly to the FTPS directory for testing the ingestion pipeline. Multiple files can be
            uploaded at once.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-8 sm:p-12 text-center cursor-pointer transition-colors ${
              isDragActive
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/50 hover:bg-accent/50'
            }`}
          >
            <input {...getInputProps()} />
            <div className="flex flex-col items-center space-y-4">
              <div className="flex space-x-2">
                <ImageIcon className="h-8 w-8 text-muted-foreground" />
                <FileText className="h-8 w-8 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">
                  {isDragActive ? 'Drop files here...' : 'Drag and drop files here, or click to select'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Accepts: .jpg, .jpeg (images), .txt (daily reports). Multiple files supported.
                </p>
              </div>
            </div>
          </div>

          {/* Upload Status Table */}
          {fileStatuses.length > 0 && (
            <div className="mt-4">
              <div className="border rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-left px-4 py-2">File</th>
                        <th className="text-left px-4 py-2">Status</th>
                        <th className="text-left px-4 py-2 hidden sm:table-cell">Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fileStatuses.map((fileStatus, idx) => (
                        <tr key={idx} className="border-t">
                          <td className="px-4 py-2 font-medium break-all">{fileStatus.filename}</td>
                          <td className="px-4 py-2">
                            {fileStatus.status === 'pending' && (
                              <span className="text-muted-foreground">Pending...</span>
                            )}
                            {fileStatus.status === 'uploading' && (
                              <div className="flex items-center space-x-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span>Uploading...</span>
                              </div>
                            )}
                            {fileStatus.status === 'success' && (
                              <div className="flex items-center space-x-2 text-green-600">
                                <CheckCircle2 className="h-4 w-4" />
                                <span>Success</span>
                              </div>
                            )}
                            {fileStatus.status === 'error' && (
                              <div className="flex items-center space-x-2 text-red-600">
                                <XCircle className="h-4 w-4" />
                                <span>Failed</span>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground hidden sm:table-cell">
                            {fileStatus.message || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </ServerPageLayout>
  );
};
