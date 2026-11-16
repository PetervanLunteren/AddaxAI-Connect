/**
 * Route guard for pages only a project admin may open.
 *
 * Decides only once the project from the URL is selected. Before that the
 * role is unknown, and redirecting then sent admins away right after
 * logging in, to /projects/undefined/dashboard.
 */
import React from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useProject } from '../contexts/ProjectContext';

export const RequireProjectAdmin: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { projectId } = useParams<{ projectId: string }>();
  const { projects, selectedProject, canAdminCurrentProject } = useProject();
  const id = Number(projectId);

  if (projects && !projects.some((p) => p.id === id)) {
    return <Navigate to="/projects" replace />;
  }
  if (selectedProject?.id !== id) return null;
  if (!canAdminCurrentProject) {
    return <Navigate to={`/projects/${projectId}/dashboard`} replace />;
  }
  return <>{children}</>;
};
