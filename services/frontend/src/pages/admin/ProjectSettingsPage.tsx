/**
 * Project Settings Page
 *
 * Allows project admins and server admins to adjust project-level settings.
 * Currently manages detection confidence threshold.
 * More settings will be added here in the future.
 */
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Settings, Save, AlertCircle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { getUserProjects } from '../../api/auth';
import { adminApi } from '../../api/admin';
import type { ProjectWithRole } from '../../api/types';

export const ProjectSettingsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [thresholds, setThresholds] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Fetch projects user has access to
  const { data: projects, isLoading } = useQuery({
    queryKey: ['user-projects'],
    queryFn: () => getUserProjects(),
  });

  // Filter to only show projects where user is admin (project-admin or server-admin)
  const adminProjects = projects?.filter(
    (p) => p.role === 'project-admin' || p.role === 'server-admin'
  );

  // Initialize thresholds when projects load
  React.useEffect(() => {
    if (adminProjects) {
      const initialThresholds: Record<number, number> = {};
      adminProjects.forEach((project) => {
        initialThresholds[project.id] = project.detection_threshold;
      });
      setThresholds(initialThresholds);
    }
  }, [adminProjects]);

  const updateMutation = useMutation({
    mutationFn: async ({ projectId, threshold }: { projectId: number; threshold: number }) => {
      return await adminApi.updateDetectionThreshold(projectId, threshold);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['user-projects'] });
      setEditingProjectId(null);
      setSuccessMessage(`Updated threshold for ${data.project_name} to ${data.detection_threshold}`);
      setError(null);
      setTimeout(() => setSuccessMessage(null), 3000);
    },
    onError: (error: any) => {
      setError(error.response?.data?.detail || error.message || 'Failed to update threshold');
      setTimeout(() => setError(null), 5000);
    },
  });

  const handleThresholdChange = (projectId: number, value: number) => {
    setThresholds((prev) => ({
      ...prev,
      [projectId]: value,
    }));
  };

  const handleSave = (project: ProjectWithRole) => {
    const newThreshold = thresholds[project.id];
    if (newThreshold !== undefined && newThreshold !== project.detection_threshold) {
      updateMutation.mutate({ projectId: project.id, threshold: newThreshold });
    }
  };

  const handleCancel = (project: ProjectWithRole) => {
    setThresholds((prev) => ({
      ...prev,
      [project.id]: project.detection_threshold,
    }));
    setEditingProjectId(null);
  };

  const hasUnsavedChanges = (project: ProjectWithRole) => {
    return thresholds[project.id] !== undefined && thresholds[project.id] !== project.detection_threshold;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!adminProjects || adminProjects.length === 0) {
    return (
      <div className="container mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold mb-6">Project settings</h1>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              No projects available. You must be a project admin or server admin to access project settings.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Settings className="h-6 w-6" />
          Project settings
        </h1>
        <p className="text-muted-foreground mt-1">
          Manage project-level settings for your projects
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

      {/* Projects List */}
      <div className="space-y-4">
        {adminProjects.map((project) => (
          <Card key={project.id}>
            <CardHeader>
              <CardTitle className="text-lg">{project.name}</CardTitle>
              {project.description && (
                <p className="text-sm text-muted-foreground">{project.description}</p>
              )}
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Detection Threshold Setting */}
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
                      value={thresholds[project.id] ?? project.detection_threshold}
                      onChange={(e) => {
                        handleThresholdChange(project.id, parseFloat(e.target.value));
                        setEditingProjectId(project.id);
                      }}
                      className="flex-1"
                      disabled={updateMutation.isPending}
                    />
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.05"
                      value={thresholds[project.id] ?? project.detection_threshold}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val) && val >= 0 && val <= 1) {
                          handleThresholdChange(project.id, val);
                          setEditingProjectId(project.id);
                        }
                      }}
                      className="w-20 px-2 py-1 border rounded-md text-center"
                      disabled={updateMutation.isPending}
                    />
                    <span className="text-sm text-muted-foreground w-20 text-right">
                      {((thresholds[project.id] ?? project.detection_threshold) * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Only show detections with confidence above this value. Affects statistics, charts, and image display.
                    Works on all historic data immediately.
                  </p>
                </div>

                {/* Action Buttons */}
                {hasUnsavedChanges(project) && (
                  <div className="flex items-center gap-2 pt-2 border-t">
                    <Button
                      onClick={() => handleSave(project)}
                      disabled={updateMutation.isPending}
                      size="sm"
                    >
                      {updateMutation.isPending && editingProjectId === project.id ? (
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
                      onClick={() => handleCancel(project)}
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
        ))}
      </div>
    </div>
  );
};
