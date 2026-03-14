/**
 * Taxonomy mapping page
 *
 * Upload/manage CSV mapping for SpeciesNet walk-up taxonomy algorithm.
 */
import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Upload,
  CheckCircle2,
  XCircle,
  Loader2,
  Trash2,
  FileSpreadsheet,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { ServerPageLayout } from '../../components/layout/ServerPageLayout';
import { adminApi } from '../../api/admin';

export const TaxonomyMappingPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [uploadMessage, setUploadMessage] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Fetch current mapping
  const { data, isLoading } = useQuery({
    queryKey: ['taxonomy-mapping'],
    queryFn: adminApi.getTaxonomyMapping,
  });

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: adminApi.uploadTaxonomyMapping,
    onSuccess: (result) => {
      setUploadStatus('success');
      const msg = result.reprocessed_count
        ? `Uploaded ${result.count} entries. ${result.reprocessed_count} classifications reprocessed.`
        : `Uploaded ${result.count} entries.`;
      setUploadMessage(msg);
      queryClient.invalidateQueries({ queryKey: ['taxonomy-mapping'] });
      setTimeout(() => setUploadStatus('idle'), 8000);
    },
    onError: (error: any) => {
      setUploadStatus('error');
      setUploadMessage(error.response?.data?.detail || 'Upload failed');
      setTimeout(() => setUploadStatus('idle'), 8000);
    },
  });

  // Clear mutation
  const clearMutation = useMutation({
    mutationFn: adminApi.clearTaxonomyMapping,
    onSuccess: () => {
      setShowClearConfirm(false);
      queryClient.invalidateQueries({ queryKey: ['taxonomy-mapping'] });
    },
  });

  // Dropzone
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        setUploadStatus('uploading');
        setUploadMessage('');
        uploadMutation.mutate(acceptedFiles[0]);
      }
    },
    [uploadMutation]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'] },
    multiple: false,
  });

  const entries = data?.entries || [];

  return (
    <ServerPageLayout
      title="Taxonomy mapping"
      description="Upload a CSV to map SpeciesNet predictions to human-readable species names"
    >
      {/* Upload card */}
      <Card>
        <CardHeader>
          <CardTitle>CSV upload</CardTitle>
          <CardDescription>
            Upload a CSV with <code>latin</code> and <code>common</code> columns.
            This replaces any existing mapping and reprocesses all existing classifications.
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
              <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">
                  {isDragActive ? 'Drop CSV here...' : 'Drag and drop a CSV file here, or click to select'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Required columns: latin, common. Extra columns are ignored.
                </p>
              </div>
            </div>
          </div>

          {/* Upload status */}
          {uploadStatus !== 'idle' && (
            <div className="mt-4 flex items-center gap-2 text-sm">
              {uploadStatus === 'uploading' && (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Uploading...</span>
                </>
              )}
              {uploadStatus === 'success' && (
                <>
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span className="text-green-600">{uploadMessage}</span>
                </>
              )}
              {uploadStatus === 'error' && (
                <>
                  <XCircle className="h-4 w-4 text-red-600" />
                  <span className="text-red-600">{uploadMessage}</span>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Current mapping card */}
      <Card className="mt-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Current mapping</CardTitle>
              {entries.length > 0 && (
                <CardDescription>{entries.length} entries</CardDescription>
              )}
            </div>
            {entries.length > 0 && (
              <div>
                {showClearConfirm ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Are you sure?</span>
                    <button
                      onClick={() => clearMutation.mutate()}
                      disabled={clearMutation.isPending}
                      className="px-3 py-1.5 text-sm bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 disabled:opacity-50"
                    >
                      {clearMutation.isPending ? 'Clearing...' : 'Yes, clear'}
                    </button>
                    <button
                      onClick={() => setShowClearConfirm(false)}
                      className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-accent"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowClearConfirm(true)}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm text-destructive border border-destructive/30 rounded-md hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4" />
                    Clear mapping
                  </button>
                )}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Upload className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No taxonomy mapping configured. Upload a CSV to get started.</p>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-left px-4 py-2">Latin</th>
                      <th className="text-left px-4 py-2">Common name</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr key={entry.id} className="border-t">
                        <td className="px-4 py-2 font-mono text-xs">{entry.latin}</td>
                        <td className="px-4 py-2">{entry.common}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </ServerPageLayout>
  );
};
