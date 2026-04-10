/**
 * File Management Page
 *
 * Upload files to FTPS and manage rejected files in one place
 */
import React, { useState, useMemo, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Upload,
  CheckCircle2,
  XCircle,
  Loader2,
  FileText,
  Image as ImageIcon,
  RefreshCw,
  AlertTriangle,
  Trash2,
  ArrowUpCircle,
  Folder,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../components/ui/Dialog';
import { ServerPageLayout } from '../../components/layout/ServerPageLayout';
import { uploadFile } from '../../api/devtools';
import {
  getRejectedFiles,
  deleteRejectedFiles,
  reprocessRejectedFiles,
  getUploadFiles,
  getUploadsTree,
  deleteUploadFile,
  type RejectedFile,
  type TreeNode as TreeNodeData,
} from '../../api/ingestion-monitoring';

interface FileUploadStatus {
  filename: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  message?: string;
}

type SortField = 'filename' | 'reason' | 'device_id' | 'size_bytes' | 'timestamp';
type SortDirection = 'asc' | 'desc';

/**
 * Recursive tree node for the upload directory viewer.
 */
function UploadTreeNode({
  node,
  depth,
  onDelete,
}: {
  node: TreeNodeData;
  depth: number;
  onDelete: (path: string, name: string) => void;
}) {
  const paddingLeft = depth * 20;

  const formatRelativeTime = (unixTimestamp: number): string => {
    const seconds = Math.floor(Date.now() / 1000 - unixTimestamp);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (node.type === 'directory') {
    return (
      <>
        <div className="flex items-center py-1" style={{ paddingLeft }}>
          <Folder className="h-4 w-4 mr-2 text-blue-500 shrink-0" />
          <span className="text-foreground">{node.name}/</span>
        </div>
        {node.children?.map((child) => (
          <UploadTreeNode key={child.path} node={child} depth={depth + 1} onDelete={onDelete} />
        ))}
      </>
    );
  }

  return (
    <div className="flex items-center py-1 group" style={{ paddingLeft }}>
      <FileText className="h-4 w-4 mr-2 text-muted-foreground shrink-0" />
      <span className="text-foreground truncate">{node.name}</span>
      <span className="ml-auto flex items-center gap-3 text-muted-foreground text-xs shrink-0 pl-4">
        {node.size_bytes != null && <span>{formatSize(node.size_bytes)}</span>}
        {node.modified_at != null && <span>{formatRelativeTime(node.modified_at)}</span>}
        <button
          onClick={() => onDelete(node.path, node.name)}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
          title="Delete file"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </span>
    </div>
  );
}


export const FileManagementPage: React.FC = () => {
  const queryClient = useQueryClient();

  // Upload state
  const [fileStatuses, setFileStatuses] = useState<FileUploadStatus[]>([]);

  // Rejected files state
  const [selectedFile, setSelectedFile] = useState<RejectedFile | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>('timestamp');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showReprocessConfirm, setShowReprocessConfirm] = useState(false);

  // Upload logic
  const uploadFiles = async (files: File[]) => {
    const initialStatuses: FileUploadStatus[] = files.map(file => ({
      filename: file.name,
      status: 'pending' as const,
    }));
    setFileStatuses(initialStatuses);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      setFileStatuses(prev =>
        prev.map((status, idx) =>
          idx === i ? { ...status, status: 'uploading' as const } : status
        )
      );

      try {
        const result = await uploadFile(file);
        setFileStatuses(prev =>
          prev.map((status, idx) =>
            idx === i ? { ...status, status: 'success' as const, message: result.message } : status
          )
        );
      } catch (error: any) {
        setFileStatuses(prev =>
          prev.map((status, idx) =>
            idx === i
              ? { ...status, status: 'error' as const, message: error.response?.data?.detail || 'Upload failed' }
              : status
          )
        );
      }
    }

    setTimeout(() => {
      setFileStatuses([]);
    }, 10000);
  };

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

  // Rejected files queries
  const { data: rejectedFilesData, isLoading, refetch: refetchFiles } = useQuery({
    queryKey: ['rejected-files'],
    queryFn: getRejectedFiles,
    refetchInterval: 30000,
  });

  const { data: uploadFilesData, refetch: refetchUploads } = useQuery({
    queryKey: ['upload-files'],
    queryFn: getUploadFiles,
    refetchInterval: 30000,
  });

  // Upload directory tree state
  const [deleteFilePath, setDeleteFilePath] = useState<string | null>(null);
  const [deleteFileName, setDeleteFileName] = useState<string>('');

  const { data: uploadsTreeData, isLoading: isTreeLoading, refetch: refetchTree } = useQuery({
    queryKey: ['uploads-tree'],
    queryFn: getUploadsTree,
  });

  const deleteUploadFileMutation = useMutation({
    mutationFn: deleteUploadFile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['uploads-tree'] });
      setDeleteFilePath(null);
    },
    onError: (error: any) => {
      alert(`Failed to delete file: ${error.response?.data?.detail || error.message}`);
    },
  });

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

  const allFiles = useMemo(() => {
    if (!rejectedFilesData) return [];
    return Object.values(rejectedFilesData.by_reason).flat();
  }, [rejectedFilesData]);

  const sortedFiles = useMemo(() => {
    const sorted = [...allFiles];
    sorted.sort((a, b) => {
      let aVal: any = a[sortField];
      let bVal: any = b[sortField];

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
    missing_device_id: 'Missing camera ID',
    missing_imei: 'Missing camera ID',
    missing_datetime: 'Missing DateTime',
    validation_failed: 'Validation Failed',
    duplicate: 'Duplicate',
    parse_failed: 'Parse Failed',
    unsupported_file_type: 'Unsupported File Type',
    exif_extraction_failed: 'EXIF Extraction Failed',
  };

  return (
    <ServerPageLayout
      title="File management"
      description="Upload and monitor files for processing"
    >
      {/* Card 1: Upload files */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Upload files</CardTitle>
          <CardDescription>
            Upload image files (.jpg) and daily report text files (.txt) directly to the FTPS
            ingestion folder.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
              isDragActive
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/50 hover:bg-accent/50'
            }`}
          >
            <input {...getInputProps()} />
            <div className="flex flex-col items-center space-y-3">
              <div className="flex space-x-2">
                <ImageIcon className="h-6 w-6 text-muted-foreground" />
                <FileText className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">
                {isDragActive ? 'Drop files here...' : 'Drop files here, or click to select'}
              </p>
            </div>
          </div>

          {/* Upload status table */}
          {fileStatuses.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2">File</th>
                    <th className="text-left py-2 px-2">Status</th>
                    <th className="text-left py-2 px-2 hidden sm:table-cell">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {fileStatuses.map((fileStatus, idx) => (
                    <tr key={idx} className="border-b last:border-0">
                      <td className="py-2 px-2 font-medium break-all">{fileStatus.filename}</td>
                      <td className="py-2 px-2">
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
                      <td className="py-2 px-2 text-muted-foreground hidden sm:table-cell">
                        {fileStatus.message || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Card 2: Upload directory tree */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <CardTitle>Upload directory</CardTitle>
              <CardDescription>
                Files and folders currently in the upload directory. Excludes rejected files.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchTree()}
              disabled={isTreeLoading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isTreeLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isTreeLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !uploadsTreeData || (uploadsTreeData.total_files === 0 && uploadsTreeData.total_dirs === 0) ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 mb-2" />
              <p className="text-sm">Upload directory is empty</p>
            </div>
          ) : (
            <>
              <div className="space-y-0.5 text-sm font-mono">
                {uploadsTreeData.tree.map((node) => (
                  <UploadTreeNode
                    key={node.path}
                    node={node}
                    depth={0}
                    onDelete={(path, name) => {
                      setDeleteFilePath(path);
                      setDeleteFileName(name);
                    }}
                  />
                ))}
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                {uploadsTreeData.total_files} {uploadsTreeData.total_files === 1 ? 'file' : 'files'}
                {uploadsTreeData.total_dirs > 0 && (
                  <>, {uploadsTreeData.total_dirs} {uploadsTreeData.total_dirs === 1 ? 'folder' : 'folders'}</>
                )}
                , {formatFileSize(uploadsTreeData.total_size_bytes)} total
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Delete upload file confirmation dialog */}
      <Dialog open={deleteFilePath !== null} onOpenChange={(open) => { if (!open) setDeleteFilePath(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete file</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <span className="font-medium">{deleteFileName}</span>?
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteFilePath(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteFilePath) deleteUploadFileMutation.mutate(deleteFilePath);
              }}
              disabled={deleteUploadFileMutation.isPending}
            >
              {deleteUploadFileMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Card 3: Rejected files */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <CardTitle>Rejected files</CardTitle>
              <CardDescription>
                Files rejected by the ingestion pipeline. Rejected files older than 30 days are
                automatically deleted daily at midnight UTC.
                {uploadFilesData && uploadFilesData.total_count > 0 && (
                  <>
                    {' '}
                    <span className="font-medium text-amber-600">
                      {uploadFilesData.total_count} file{uploadFilesData.total_count !== 1 ? 's' : ''} waiting in the uploads folder.
                    </span>
                  </>
                )}
              </CardDescription>
            </div>
            <Button onClick={() => { refetchFiles(); refetchUploads(); }} variant="outline" size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg">
            {isLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : !rejectedFilesData ? (
              <div className="py-6 text-center">
                <p className="text-muted-foreground">Failed to load rejected files</p>
              </div>
            ) : rejectedFilesData.total_count === 0 ? (
              <div className="py-6 text-center">
                <CheckCircle2 className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-muted-foreground">No rejected files</p>
                <p className="text-sm text-muted-foreground mt-2">
                  All uploaded files are being processed successfully
                </p>
              </div>
            ) : (
              <>
                {/* Summary stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 m-4">
                  <div className="border rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Total rejected</p>
                        <p className="text-2xl font-bold">{rejectedFilesData.total_count}</p>
                      </div>
                      <AlertTriangle className="h-8 w-8 text-orange-500" />
                    </div>
                  </div>
                  <div className="border rounded-lg p-4">
                    <p className="text-sm text-muted-foreground">Rejection reasons</p>
                    <p className="text-2xl font-bold">{Object.keys(rejectedFilesData.by_reason).length}</p>
                  </div>
                  <div className="border rounded-lg p-4">
                    <p className="text-sm text-muted-foreground">Selected</p>
                    <p className="text-2xl font-bold">{selectedFiles.size}</p>
                  </div>
                </div>

                {/* Bulk actions toolbar */}
                {selectedFiles.size > 0 && (
                  <div className="border rounded-lg p-3 mx-4 mb-4">
                    <div className="flex items-center justify-between flex-wrap gap-2">
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
                  </div>
                )}

                {/* Rejected files table */}
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
                          className="text-left py-2 px-2 cursor-pointer hover:bg-accent/50 hidden sm:table-cell"
                          onClick={() => handleSort('device_id')}
                        >
                          Camera ID {sortField === 'device_id' && (sortDirection === 'asc' ? '↑' : '↓')}
                        </th>
                        <th
                          className="text-left py-2 px-2 cursor-pointer hover:bg-accent/50 hidden md:table-cell"
                          onClick={() => handleSort('size_bytes')}
                        >
                          Size {sortField === 'size_bytes' && (sortDirection === 'asc' ? '↑' : '↓')}
                        </th>
                        <th
                          className="text-left py-2 px-2 cursor-pointer hover:bg-accent/50 hidden lg:table-cell"
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
                          <td className="py-2 px-2 font-mono text-xs hidden sm:table-cell">
                            {file.device_id || <span className="text-muted-foreground">-</span>}
                          </td>
                          <td className="py-2 px-2 whitespace-nowrap hidden md:table-cell">
                            {formatFileSize(file.size_bytes)}
                          </td>
                          <td className="py-2 px-2 whitespace-nowrap text-muted-foreground hidden lg:table-cell">
                            {formatTimestamp(file.timestamp)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* File details modal */}
      <Dialog open={showDetailsModal} onOpenChange={setShowDetailsModal}>
        <DialogContent onClose={() => setShowDetailsModal(false)}>
          <DialogHeader>
            <DialogTitle>Rejected file details</DialogTitle>
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
                <label className="text-sm font-medium text-muted-foreground">Rejection reason</label>
                <p className="mt-1">
                  <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-orange-100 text-orange-800">
                    {reasonLabels[selectedFile.reason] || selectedFile.reason}
                  </span>
                </p>
              </div>

              {selectedFile.device_id && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Camera ID</label>
                  <p className="font-mono text-sm mt-1">{selectedFile.device_id}</p>
                </div>
              )}

              {selectedFile.error_details && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Error details</label>
                  <p className="text-sm mt-1 p-3 bg-muted rounded-md">{selectedFile.error_details}</p>
                </div>
              )}

              {selectedFile.exif_metadata && Object.keys(selectedFile.exif_metadata).length > 0 && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">EXIF metadata present</label>
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
                <label className="text-sm font-medium text-muted-foreground">File size</label>
                <p className="text-sm mt-1">{formatFileSize(selectedFile.size_bytes)}</p>
              </div>

              {selectedFile.rejected_at && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Rejected at</label>
                  <p className="text-sm mt-1">
                    {new Date(selectedFile.rejected_at).toLocaleString()}
                  </p>
                </div>
              )}

              <div>
                <label className="text-sm font-medium text-muted-foreground">File path</label>
                <p className="font-mono text-xs text-muted-foreground mt-1 break-all">
                  {selectedFile.filepath}
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent onClose={() => setShowDeleteConfirm(false)}>
          <DialogHeader>
            <DialogTitle>Delete rejected files</DialogTitle>
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

      {/* Reprocess confirmation dialog */}
      <Dialog open={showReprocessConfirm} onOpenChange={setShowReprocessConfirm}>
        <DialogContent onClose={() => setShowReprocessConfirm(false)}>
          <DialogHeader>
            <DialogTitle>Reprocess rejected files</DialogTitle>
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
    </ServerPageLayout>
  );
};
