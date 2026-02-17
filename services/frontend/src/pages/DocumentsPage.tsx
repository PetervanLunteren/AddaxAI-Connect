/**
 * Documents page for per-project file storage
 *
 * Admins can upload/delete files; all project members can view and download.
 */
import React, { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
import { FileText, Upload, Download, Trash2, Loader2, AlertCircle } from 'lucide-react';
import { documentsApi } from '../api/documents';
import { useProject } from '../contexts/ProjectContext';
import { Card, CardContent } from '../components/ui/Card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/Table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/Dialog';
import { Button } from '../components/ui/Button';
import type { ProjectDocument } from '../api/types';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

export const DocumentsPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const projectIdNum = parseInt(projectId || '0', 10);
  const { canAdminCurrentProject } = useProject();
  const queryClient = useQueryClient();

  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectDocument | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  // Fetch documents
  const { data: documents, isLoading } = useQuery({
    queryKey: ['project-documents', projectId],
    queryFn: () => documentsApi.list(projectIdNum),
    enabled: !!projectIdNum,
  });

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: () => documentsApi.upload(projectIdNum, uploadFile!, uploadDescription || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-documents', projectId] });
      setShowUploadDialog(false);
      setUploadFile(null);
      setUploadDescription('');
      setUploadError(null);
    },
    onError: (err: any) => {
      setUploadError(err.response?.data?.detail || 'Upload failed');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (documentId: number) => documentsApi.delete(projectIdNum, documentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-documents', projectId] });
      setShowDeleteDialog(false);
      setDeleteTarget(null);
    },
  });

  // Dropzone
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setUploadFile(acceptedFiles[0]);
      setUploadError(null);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    maxSize: 10 * 1024 * 1024, // 10 MB
    onDropRejected: (rejections) => {
      if (rejections[0]?.errors[0]?.code === 'file-too-large') {
        setUploadError('File too large. Maximum size is 10 MB.');
      }
    },
  });

  const handleDownload = async (doc: ProjectDocument) => {
    setDownloadingId(doc.id);
    try {
      const blob = await documentsApi.download(projectIdNum, doc.id);
      downloadBlob(blob, doc.original_filename);
    } catch {
      // Error logged by API client interceptor
    } finally {
      setDownloadingId(null);
    }
  };

  const handleUploadSubmit = () => {
    if (!uploadFile) return;
    uploadMutation.mutate();
  };

  const openDeleteDialog = (doc: ProjectDocument) => {
    setDeleteTarget(doc);
    setShowDeleteDialog(true);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-0">Documents</h1>
          <p className="text-sm text-gray-600 mt-1">
            Project files such as permits, field notes, and configuration files
          </p>
        </div>
        {canAdminCurrentProject && (
          <Button onClick={() => { setShowUploadDialog(true); setUploadFile(null); setUploadDescription(''); setUploadError(null); }}>
            <Upload className="h-4 w-4 mr-2" />
            Upload document
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !documents || documents.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground text-sm">No documents uploaded yet</p>
            {canAdminCurrentProject && (
              <p className="text-muted-foreground text-xs mt-1">
                Click "Upload document" to add files to this project
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Filename</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Uploaded by</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc) => (
                <TableRow key={doc.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <span className="truncate max-w-[200px]">{doc.original_filename}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-muted-foreground text-sm truncate max-w-[200px] block">
                      {doc.description || '-'}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {formatFileSize(doc.file_size)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {doc.uploaded_by_email || '-'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {new Date(doc.uploaded_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleDownload(doc)}
                        disabled={downloadingId === doc.id}
                        className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                        title="Download"
                      >
                        {downloadingId === doc.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                      </button>
                      {canAdminCurrentProject && (
                        <button
                          onClick={() => openDeleteDialog(doc)}
                          className="p-2 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Upload Dialog */}
      <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
        <DialogContent onClose={() => setShowUploadDialog(false)}>
          <DialogHeader>
            <DialogTitle>Upload document</DialogTitle>
            <DialogDescription>
              Upload a file to this project. Maximum size: 10 MB.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {uploadError && (
              <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {uploadError}
              </div>
            )}

            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                isDragActive
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              <input {...getInputProps()} />
              {uploadFile ? (
                <div className="flex items-center justify-center gap-2">
                  <FileText className="h-5 w-5 text-primary" />
                  <span className="text-sm font-medium">{uploadFile.name}</span>
                  <span className="text-xs text-muted-foreground">
                    ({formatFileSize(uploadFile.size)})
                  </span>
                </div>
              ) : (
                <div>
                  <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">
                    Drag & drop a file here, or click to browse
                  </p>
                </div>
              )}
            </div>

            <div>
              <label htmlFor="doc-description" className="block text-sm font-medium mb-1">
                Description (optional)
              </label>
              <input
                id="doc-description"
                type="text"
                value={uploadDescription}
                onChange={(e) => setUploadDescription(e.target.value)}
                placeholder="e.g., Research permit 2026"
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowUploadDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUploadSubmit}
              disabled={!uploadFile || uploadMutation.isPending}
            >
              {uploadMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Uploading...
                </>
              ) : (
                'Upload'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent onClose={() => setShowDeleteDialog(false)}>
          <DialogHeader>
            <DialogTitle>Delete document</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deleteTarget?.original_filename}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
