/**
 * Ingestion Monitoring Page (Superuser Only)
 *
 * Displays rejected files from the ingestion pipeline.
 * Functional and utilitarian - helps superusers understand what's happening with ingestion.
 */
import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Loader2, AlertTriangle, FileX, Trash2, ArrowUpCircle, Info } from 'lucide-react';
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
import {
  getRejectedFiles,
  deleteRejectedFiles,
  reprocessRejectedFiles,
  type RejectedFile,
} from '../api/ingestion-monitoring';

type SortField = 'filename' | 'reason' | 'imei' | 'size_bytes' | 'timestamp';
type SortDirection = 'asc' | 'desc';

export const IngestionMonitoringPage: React.FC = () => {
  const queryClient = useQueryClient();

  // Modal state
  const [selectedFile, setSelectedFile] = useState<RejectedFile | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  // Selection state
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  // Sorting state
  const [sortField, setSortField] = useState<SortField>('timestamp');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Confirmation dialog state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showReprocessConfirm, setShowReprocessConfirm] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['rejected-files'],
    queryFn: getRejectedFiles,
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: deleteRejectedFiles,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['rejected-files'] });
      setSelectedFiles(new Set());
      setShowDeleteConfirm(false);
      if (result.errors.length > 0) {
        alert(`Deleted ${result.success_count} files. Errors: ${result.errors.join(', ')}`);
      }
    },
    onError: (error: any) => {
      alert(`Failed to delete files: ${error.response?.data?.detail || error.message}`);
    },
  });

  // Reprocess mutation
  const reprocessMutation = useMutation({
    mutationFn: reprocessRejectedFiles,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['rejected-files'] });
      setSelectedFiles(new Set());
      setShowReprocessConfirm(false);
      if (result.errors.length > 0) {
        alert(`Reprocessed ${result.success_count} files. Errors: ${result.errors.join(', ')}`);
      }
    },
    onError: (error: any) => {
      alert(`Failed to reprocess files: ${error.response?.data?.detail || error.message}`);
    },
  });

  // Flatten data from grouped structure to single array
  const allFiles = useMemo(() => {
    if (!data) return [];
    return Object.values(data.by_reason).flat();
  }, [data]);

  // Sort files
  const sortedFiles = useMemo(() => {
    const sorted = [...allFiles];
    sorted.sort((a, b) => {
      let aVal: any = a[sortField];
      let bVal: any = b[sortField];

      // Handle null values
      if (aVal === null || aVal === undefined) aVal = '';
      if (bVal === null || bVal === undefined) bVal = '';

      if (sortDirection === 'asc') {
        return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
      } else {
        return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
      }
    });
    return sorted;
  }, [allFiles, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleRowClick = (file: RejectedFile, event: React.MouseEvent) => {
    // Don't open modal if clicking checkbox
    if ((event.target as HTMLElement).closest('input[type="checkbox"]')) {
      return;
    }
    setSelectedFile(file);
    setShowDetailsModal(true);
  };

  const handleSelectFile = (filepath: string) => {
    const newSelection = new Set(selectedFiles);
    if (newSelection.has(filepath)) {
      newSelection.delete(filepath);
    } else {
      newSelection.add(filepath);
    }
    setSelectedFiles(newSelection);
  };

  const handleSelectAll = () => {
    if (selectedFiles.size === sortedFiles.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(sortedFiles.map((f) => f.filepath)));
    }
  };

  const handleDelete = () => {
    deleteMutation.mutate(Array.from(selectedFiles));
  };

  const handleReprocess = () => {
    reprocessMutation.mutate(Array.from(selectedFiles));
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
    no_camera_exif: 'No Camera EXIF Data',
    unsupported_camera: 'Unsupported Camera',
    missing_imei: 'Missing IMEI',
    missing_datetime: 'Missing DateTime',
    validation_failed: 'Validation Failed',
    duplicate: 'Duplicate',
    conversion_failed: 'Conversion Failed',
    parse_failed: 'Parse Failed',
    unsupported_file_type: 'Unsupported File Type',
    exif_extraction_failed: 'EXIF Extraction Failed',
  };

  const reasonDescriptions: Record<string, string> = {
    unknown_camera: 'Camera not registered in database. Create camera first.',
    no_camera_exif: 'Image has no camera EXIF data (Make/Model missing). File may have been edited or stripped.',
    unsupported_camera: 'Camera model not supported by any profile.',
    missing_imei: 'Could not extract IMEI from file.',
    missing_datetime: 'Could not extract DateTime from EXIF metadata.',
    validation_failed: 'File failed basic validation checks.',
    duplicate: 'File already exists in database.',
    conversion_failed: 'Failed to convert file format.',
    parse_failed: 'Failed to parse file content.',
    unsupported_file_type: 'File extension not recognized.',
    exif_extraction_failed: 'Could not extract any EXIF metadata from file.',
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

      {/* Automatic Cleanup Info */}
      <Card className="mb-6 border-blue-200 bg-blue-50">
        <CardContent className="py-3">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-blue-900">Automatic Cleanup</p>
              <p className="text-blue-700 mt-0.5">
                Rejected files older than 30 days are automatically deleted daily at midnight UTC.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

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
                  <p className="text-sm text-muted-foreground">Selected</p>
                  <p className="text-2xl font-bold">{selectedFiles.size}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Bulk Actions Toolbar */}
          {selectedFiles.size > 0 && (
            <Card className="mb-4">
              <CardContent className="py-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">
                    {selectedFiles.size} file{selectedFiles.size !== 1 ? 's' : ''} selected
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowReprocessConfirm(true)}
                      disabled={reprocessMutation.isPending}
                    >
                      <ArrowUpCircle className="h-4 w-4 mr-2" />
                      Reprocess
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setShowDeleteConfirm(true)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Unified Rejected Files Table */}
          <Card>
            <CardHeader>
              <CardTitle>Rejected Files</CardTitle>
              <CardDescription>
                All rejected files from the ingestion pipeline. Click a row for details.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-2 w-8">
                        <input
                          type="checkbox"
                          checked={sortedFiles.length > 0 && selectedFiles.size === sortedFiles.length}
                          onChange={handleSelectAll}
                          className="cursor-pointer"
                        />
                      </th>
                      <th
                        className="text-left py-2 px-2 cursor-pointer hover:bg-accent/50"
                        onClick={() => handleSort('filename')}
                      >
                        Filename {sortField === 'filename' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                      <th
                        className="text-left py-2 px-2 cursor-pointer hover:bg-accent/50"
                        onClick={() => handleSort('reason')}
                      >
                        Reason {sortField === 'reason' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                      <th
                        className="text-left py-2 px-2 cursor-pointer hover:bg-accent/50"
                        onClick={() => handleSort('imei')}
                      >
                        IMEI {sortField === 'imei' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                      <th
                        className="text-left py-2 px-2 cursor-pointer hover:bg-accent/50"
                        onClick={() => handleSort('size_bytes')}
                      >
                        Size {sortField === 'size_bytes' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                      <th
                        className="text-left py-2 px-2 cursor-pointer hover:bg-accent/50"
                        onClick={() => handleSort('timestamp')}
                      >
                        Timestamp {sortField === 'timestamp' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedFiles.map((file) => (
                      <tr
                        key={file.filepath}
                        onClick={(e) => handleRowClick(file, e)}
                        className="border-b last:border-0 cursor-pointer hover:bg-accent/50 transition-colors"
                      >
                        <td className="py-2 px-2" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedFiles.has(file.filepath)}
                            onChange={() => handleSelectFile(file.filepath)}
                            className="cursor-pointer"
                          />
                        </td>
                        <td className="py-2 px-2 font-mono text-xs break-all max-w-xs">
                          {file.filename}
                        </td>
                        <td className="py-2 px-2">
                          <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-orange-100 text-orange-800">
                            {reasonLabels[file.reason] || file.reason}
                          </span>
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

              {selectedFile.exif_metadata && Object.keys(selectedFile.exif_metadata).length > 0 && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">EXIF Metadata Present</label>
                  <div className="mt-2 p-3 bg-muted rounded-md space-y-1 max-h-60 overflow-y-auto">
                    {Object.entries(selectedFile.exif_metadata).map(([key, value]) => (
                      <div key={key} className="flex gap-2 text-xs">
                        <span className="font-medium text-muted-foreground min-w-[140px]">{key}:</span>
                        <span className="font-mono break-all">
                          {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                        </span>
                      </div>
                    ))}
                  </div>
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

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent onClose={() => setShowDeleteConfirm(false)}>
          <DialogHeader>
            <DialogTitle>Delete Rejected Files</DialogTitle>
            <DialogDescription>
              Are you sure you want to permanently delete {selectedFiles.size} file
              {selectedFiles.size !== 1 ? 's' : ''}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reprocess Confirmation Dialog */}
      <Dialog open={showReprocessConfirm} onOpenChange={setShowReprocessConfirm}>
        <DialogContent onClose={() => setShowReprocessConfirm(false)}>
          <DialogHeader>
            <DialogTitle>Reprocess Rejected Files</DialogTitle>
            <DialogDescription>
              Move {selectedFiles.size} file{selectedFiles.size !== 1 ? 's' : ''} back to the uploads
              directory for reprocessing? Files will be automatically picked up by the ingestion
              pipeline.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReprocessConfirm(false)}>
              Cancel
            </Button>
            <Button onClick={handleReprocess} disabled={reprocessMutation.isPending}>
              {reprocessMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Reprocessing...
                </>
              ) : (
                <>
                  <ArrowUpCircle className="h-4 w-4 mr-2" />
                  Reprocess
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
