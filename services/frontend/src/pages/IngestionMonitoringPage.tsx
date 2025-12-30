/**
 * Ingestion Monitoring Page (Superuser Only)
 *
 * Displays rejected files from the ingestion pipeline.
 * Functional and utilitarian - helps superusers understand what's happening with ingestion.
 */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Loader2, AlertTriangle, FileX } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../components/ui/Dialog';
import { getRejectedFiles, type RejectedFile } from '../api/ingestion-monitoring';

export const IngestionMonitoringPage: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<RejectedFile | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['rejected-files'],
    queryFn: getRejectedFiles,
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  });

  const handleRowClick = (file: RejectedFile) => {
    setSelectedFile(file);
    setShowDetailsModal(true);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatTimestamp = (timestamp: number): string => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString();
  };

  const reasonLabels: Record<string, string> = {
    unknown_camera: 'Unknown Camera',
    unsupported_camera: 'Unsupported Camera',
    missing_imei: 'Missing IMEI',
    validation_failed: 'Validation Failed',
    duplicate: 'Duplicate',
    conversion_failed: 'Conversion Failed',
    parse_failed: 'Parse Failed',
    unsupported_file_type: 'Unsupported File Type',
  };

  const reasonDescriptions: Record<string, string> = {
    unknown_camera: 'Camera not registered in database. Create camera first.',
    unsupported_camera: 'Camera model not supported by any profile.',
    missing_imei: 'Could not extract IMEI from file.',
    validation_failed: 'File failed basic validation checks.',
    duplicate: 'File already exists in database.',
    conversion_failed: 'Failed to convert file format.',
    parse_failed: 'Failed to parse file content.',
    unsupported_file_type: 'File extension not recognized.',
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Ingestion Monitoring</h1>
          <p className="text-muted-foreground mt-1">
            Monitor rejected files from the ingestion pipeline
          </p>
        </div>
        <Button onClick={() => refetch()} variant="outline">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : !data ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Failed to load rejected files</p>
          </CardContent>
        </Card>
      ) : data.total_count === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileX className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No rejected files found</p>
            <p className="text-sm text-muted-foreground mt-2">
              All uploaded files are being processed successfully
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Rejected</p>
                    <p className="text-2xl font-bold">{data.total_count}</p>
                  </div>
                  <AlertTriangle className="h-8 w-8 text-orange-500" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <div>
                  <p className="text-sm text-muted-foreground">Rejection Reasons</p>
                  <p className="text-2xl font-bold">{Object.keys(data.by_reason).length}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <div>
                  <p className="text-sm text-muted-foreground">Most Common</p>
                  <p className="text-lg font-bold">
                    {Object.entries(data.by_reason).sort((a, b) => b[1].length - a[1].length)[0]?.[0] || 'N/A'}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Rejected Files by Reason */}
          <div className="space-y-4">
            {Object.entries(data.by_reason)
              .sort((a, b) => b[1].length - a[1].length)
              .map(([reason, files]) => (
                <Card key={reason}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-lg">
                          {reasonLabels[reason] || reason}
                        </CardTitle>
                        <CardDescription>{reasonDescriptions[reason] || 'Unknown reason'}</CardDescription>
                      </div>
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-orange-100 text-orange-800">
                        {files.length} file{files.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-2 px-2">Filename</th>
                            <th className="text-left py-2 px-2">IMEI</th>
                            <th className="text-left py-2 px-2">Size</th>
                            <th className="text-left py-2 px-2">Timestamp</th>
                          </tr>
                        </thead>
                        <tbody>
                          {files.map((file, index) => (
                            <tr
                              key={index}
                              onClick={() => handleRowClick(file)}
                              className="border-b last:border-0 cursor-pointer hover:bg-accent/50 transition-colors"
                            >
                              <td className="py-2 px-2 font-mono text-xs break-all">
                                {file.filename}
                              </td>
                              <td className="py-2 px-2 font-mono text-xs">
                                {file.imei || <span className="text-muted-foreground">-</span>}
                              </td>
                              <td className="py-2 px-2 whitespace-nowrap">
                                {formatFileSize(file.size_bytes)}
                              </td>
                              <td className="py-2 px-2 whitespace-nowrap text-muted-foreground">
                                {formatTimestamp(file.timestamp)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              ))}
          </div>
        </>
      )}

      {/* File Details Modal */}
      <Dialog open={showDetailsModal} onOpenChange={setShowDetailsModal}>
        <DialogContent onClose={() => setShowDetailsModal(false)}>
          <DialogHeader>
            <DialogTitle>Rejected File Details</DialogTitle>
            <DialogDescription>
              Information about why this file was rejected
            </DialogDescription>
          </DialogHeader>

          {selectedFile && (
            <div className="space-y-4 py-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">Filename</label>
                <p className="font-mono text-sm break-all mt-1">{selectedFile.filename}</p>
              </div>

              <div>
                <label className="text-sm font-medium text-muted-foreground">Rejection Reason</label>
                <p className="mt-1">
                  <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-orange-100 text-orange-800">
                    {reasonLabels[selectedFile.reason] || selectedFile.reason}
                  </span>
                </p>
              </div>

              {selectedFile.imei && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">IMEI</label>
                  <p className="font-mono text-sm mt-1">{selectedFile.imei}</p>
                </div>
              )}

              {selectedFile.error_details && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Error Details</label>
                  <p className="text-sm mt-1 p-3 bg-muted rounded-md">{selectedFile.error_details}</p>
                </div>
              )}

              <div>
                <label className="text-sm font-medium text-muted-foreground">File Size</label>
                <p className="text-sm mt-1">{formatFileSize(selectedFile.size_bytes)}</p>
              </div>

              {selectedFile.rejected_at && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Rejected At</label>
                  <p className="text-sm mt-1">
                    {new Date(selectedFile.rejected_at).toLocaleString()}
                  </p>
                </div>
              )}

              <div>
                <label className="text-sm font-medium text-muted-foreground">File Path</label>
                <p className="font-mono text-xs text-muted-foreground mt-1 break-all">
                  {selectedFile.filepath}
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
