/**
 * Dev tools page for superusers
 *
 * Provides tools for:
 * - Uploading files directly to FTPS directory
 * - Clearing all data from the system
 */
import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import { useMutation } from '@tanstack/react-query';
import {
  Upload,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  FileText,
  Image as ImageIcon,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../components/ui/Dialog';
import { useAuth } from '../hooks/useAuth';
import { uploadFile, clearAllData, type ClearDataResponse } from '../api/devtools';

interface FileUploadStatus {
  filename: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  message?: string;
}

export const DevToolsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [fileStatuses, setFileStatuses] = useState<FileUploadStatus[]>([]);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [clearResults, setClearResults] = useState<ClearDataResponse | null>(null);

  // Redirect if not superuser
  React.useEffect(() => {
    if (user && !user.is_superuser) {
      navigate('/dashboard');
    }
  }, [user, navigate]);

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

  // Clear data mutation
  const clearMutation = useMutation({
    mutationFn: clearAllData,
    onSuccess: (data) => {
      setClearResults(data);
      setShowClearDialog(false);
      setConfirmText('');
    },
    onError: (error: any) => {
      alert(`Failed to clear data: ${error.response?.data?.detail || 'Unknown error'}`);
      setShowClearDialog(false);
      setConfirmText('');
    },
  });

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

  const handleClearData = () => {
    if (confirmText === 'DELETE') {
      clearMutation.mutate();
    }
  };

  // Don't render anything if not superuser
  if (!user?.is_superuser) {
    return null;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dev tools</h1>

      <div className="grid gap-6">
        {/* File Upload Card */}
        <Card>
          <CardHeader>
            <CardTitle>Upload Files to FTPS Directory</CardTitle>
            <CardDescription>
              Drag and drop camera trap images (.jpg, .jpeg) or daily reports (.txt) to upload them
              directly to the FTPS directory for testing the ingestion pipeline. Multiple files can be
              uploaded at once.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
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
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-left px-4 py-2">File</th>
                        <th className="text-left px-4 py-2">Status</th>
                        <th className="text-left px-4 py-2">Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fileStatuses.map((fileStatus, idx) => (
                        <tr key={idx} className="border-t">
                          <td className="px-4 py-2 font-medium">{fileStatus.filename}</td>
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
                          <td className="px-4 py-2 text-muted-foreground">
                            {fileStatus.message || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Clear All Data Card */}
        <Card className="border-destructive">
          <CardHeader>
            <div className="flex items-center space-x-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <CardTitle className="text-destructive">Danger Zone</CardTitle>
            </div>
            <CardDescription>
              Permanently delete all data from the system. This action cannot be undone.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 mb-4">
              <p className="text-sm text-destructive font-medium mb-2">This will delete:</p>
              <ul className="text-sm text-destructive/80 space-y-1 ml-4 list-disc">
                <li>All images, detections, and classifications from database</li>
                <li>All camera records and health metrics</li>
                <li>All files from MinIO buckets (raw-images, crops, thumbnails)</li>
                <li>All files from FTPS upload directory</li>
              </ul>

              <p className="text-sm font-medium mb-2 mt-4">This will NOT delete:</p>
              <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
                <li>Projects - Your projects remain intact</li>
                <li>Users - All user accounts remain</li>
                <li>Email allowlist - Email permissions remain</li>
              </ul>
            </div>

            <Button
              variant="destructive"
              onClick={() => setShowClearDialog(true)}
              className="w-full sm:w-auto"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Clear All Data
            </Button>

            {/* Clear Results */}
            {clearResults && (
              <div className="mt-4 p-4 bg-muted rounded-lg">
                <div className="flex items-center space-x-2 mb-3">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  <p className="text-sm font-medium">Data cleared successfully</p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Classifications:</span>{' '}
                    <span className="font-medium">{clearResults.deleted_counts.classifications}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Detections:</span>{' '}
                    <span className="font-medium">{clearResults.deleted_counts.detections}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Images:</span>{' '}
                    <span className="font-medium">{clearResults.deleted_counts.images}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Cameras:</span>{' '}
                    <span className="font-medium">{clearResults.deleted_counts.cameras}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">MinIO Raw:</span>{' '}
                    <span className="font-medium">{clearResults.deleted_counts.minio_raw_images}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">MinIO Crops:</span>{' '}
                    <span className="font-medium">{clearResults.deleted_counts.minio_crops}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">MinIO Thumbs:</span>{' '}
                    <span className="font-medium">{clearResults.deleted_counts.minio_thumbnails}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">FTPS Files:</span>{' '}
                    <span className="font-medium">{clearResults.deleted_counts.ftps_files}</span>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Confirmation Dialog */}
      <Dialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <DialogContent onClose={() => setShowClearDialog(false)}>
          <DialogHeader>
            <DialogTitle>Confirm Data Deletion</DialogTitle>
            <DialogDescription>
              This action cannot be undone. All data will be permanently deleted from the database, MinIO
              storage, and FTPS upload directory.
              <br /><br />
              <strong>Note:</strong> Projects, users, and email allowlist will NOT be deleted.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <label htmlFor="confirm-input" className="text-sm font-medium mb-2 block">
              Type <span className="font-mono bg-muted px-1 rounded">DELETE</span> to confirm:
            </label>
            <input
              id="confirm-input"
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="DELETE"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowClearDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleClearData}
              disabled={confirmText !== 'DELETE' || clearMutation.isPending}
            >
              {clearMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Clearing...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Everything
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
