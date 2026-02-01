/**
 * Project Settings Page
 *
 * Allows project admins and server admins to adjust project-level settings.
 * Currently manages detection confidence threshold.
 * More settings will be added here in the future.
 */
import React, { useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Settings, Save, AlertCircle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { useProject } from '../../contexts/ProjectContext';
import { adminApi } from '../../api/admin';

export const ProjectSettingsPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { selectedProject: currentProject, canAdminCurrentProject } = useProject();
  const queryClient = useQueryClient();

  const [threshold, setThreshold] = useState<number>(currentProject?.detection_threshold!);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Update local threshold when project loads
  React.useEffect(() => {
    if (currentProject) {
      if (currentProject.detection_threshold === undefined) {
        throw new Error('Project detection_threshold is undefined - database schema violation');
      }
      setThreshold(currentProject.detection_threshold);
    }
  }, [currentProject]);

  // Redirect if user doesn't have admin access
  if (!canAdminCurrentProject) {
    return <Navigate to={`/projects/${projectId}/dashboard`} replace />;
  }

  if (!currentProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Please select a project to manage settings.</p>
      </div>
    );
  }

  const updateMutation = useMutation({
    mutationFn: async (threshold: number) => {
      return await adminApi.updateDetectionThreshold(currentProject.id, threshold);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['user-projects'] });
      setSuccessMessage(`Updated detection threshold to ${(data.detection_threshold * 100).toFixed(0)}%`);
      setError(null);
      setTimeout(() => setSuccessMessage(null), 3000);
    },
    onError: (error: any) => {
      setError(error.response?.data?.detail || error.message || 'Failed to update threshold');
      setTimeout(() => setError(null), 5000);
    },
  });

  const handleSave = () => {
    if (threshold !== currentProject.detection_threshold) {
      updateMutation.mutate(threshold);
    }
  };

  const handleCancel = () => {
    setThreshold(currentProject.detection_threshold);
  };

  const hasUnsavedChanges = threshold !== currentProject.detection_threshold;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Settings className="h-6 w-6" />
          Project settings
        </h1>
        <p className="text-muted-foreground mt-1">
          Managing settings for: <span className="font-medium">{currentProject.name}</span>
        </p>
      </div>

      {/* Success/Error Messages */}
      {successMessage && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-800 rounded-md">
          {successMessage}
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-800 rounded-md flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Detection confidence threshold</CardTitle>
          <CardDescription>
            Control which detections are visible based on their confidence score
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium block mb-2">
                Detection confidence threshold
              </label>
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={threshold}
                  onChange={(e) => setThreshold(parseFloat(e.target.value))}
                  className="flex-1 h-2 rounded-lg appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, #0f6064 0%, #0f6064 ${threshold * 100}%, #e5e7eb ${threshold * 100}%, #e5e7eb 100%)`,
                  }}
                  disabled={updateMutation.isPending}
                />
                <span className="text-sm font-medium w-16 text-right">
                  {(threshold * 100).toFixed(0)}%
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Only show detections with confidence above this value. Affects statistics, charts, and image display.
                Works on all historic data immediately.
              </p>
            </div>

            {/* Action Buttons */}
            {hasUnsavedChanges && (
              <div className="flex items-center gap-2 pt-2 border-t">
                <Button
                  onClick={handleSave}
                  disabled={updateMutation.isPending}
                  size="sm"
                >
                  {updateMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      Save changes
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleCancel}
                  disabled={updateMutation.isPending}
                  size="sm"
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
