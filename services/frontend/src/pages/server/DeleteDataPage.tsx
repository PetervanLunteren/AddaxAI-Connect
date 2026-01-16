/**
 * Delete All Data Page
 *
 * Danger zone - permanently delete all data from the system
 */
import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Loader2,
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
import { clearAllData, type ClearDataResponse } from '../../api/devtools';

export const DeleteDataPage: React.FC = () => {
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [clearResults, setClearResults] = useState<ClearDataResponse | null>(null);

  // Clear data mutation
  const clearMutation = useMutation({
    mutationFn: clearAllData,
    onSuccess: (data) => {
      setClearResults(data);
      setShowConfirmDialog(false);
      setConfirmText('');
    },
    onError: (error: any) => {
      alert(`Failed to clear data: ${error.response?.data?.detail || 'Unknown error'}`);
      setShowConfirmDialog(false);
      setConfirmText('');
    },
  });

  const handleClearData = () => {
    if (confirmText === 'DELETE') {
      clearMutation.mutate();
    }
  };

  return (
    <ServerPageLayout
      title="Delete All Data"
      description="Permanently delete all data from the system. Use with extreme caution."
    >
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
              <li>All files from MinIO buckets (raw-images, crops, thumbnails)</li>
              <li>All files from FTPS upload directory</li>
            </ul>

            <p className="text-sm font-medium mb-2 mt-4">This will NOT delete:</p>
            <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
              <li>Camera registrations - Hardware inventory remains intact</li>
              <li>Projects - Your projects remain intact</li>
              <li>Users - All user accounts remain</li>
              <li>Email allowlist - Email permissions remain</li>
            </ul>
          </div>

          <Button
            variant="destructive"
            onClick={() => setShowConfirmDialog(true)}
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

      {/* Confirmation Dialog */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent onClose={() => setShowConfirmDialog(false)}>
          <DialogHeader>
            <DialogTitle>Confirm Data Deletion</DialogTitle>
            <DialogDescription>
              This action cannot be undone. All data will be permanently deleted from the database, MinIO
              storage, and FTPS upload directory.
              <br /><br />
              <strong>Note:</strong> Camera registrations, projects, users, and email allowlist will NOT be deleted.
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
            <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>
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
    </ServerPageLayout>
  );
};
