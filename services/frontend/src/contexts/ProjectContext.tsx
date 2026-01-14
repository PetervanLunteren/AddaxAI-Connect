/**
 * Project context provider
 *
 * Manages selected project state and provides project selection functions.
 * Projects are fetched with user roles:
 * - Server admins see all projects with 'server-admin' role
 * - Regular users see only their assigned projects with their specific roles
 * - Auto-selects project from URL when on project-specific pages
 */
import React, { createContext, useState, useEffect, useContext, ReactNode, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useLocation } from 'react-router-dom';
import { getUserProjects } from '../api/auth';
import { useAuth } from '../hooks/useAuth';
import type { ProjectWithRole } from '../api/types';

interface ProjectContextType {
  selectedProject: ProjectWithRole | null;
  projects: ProjectWithRole[] | undefined;
  selectedProjectRole: string | null;
  isServerAdmin: boolean;
  isProjectAdmin: boolean;
  isProjectViewer: boolean;
  canAdminCurrentProject: boolean;
  loading: boolean;
  selectProject: (project: ProjectWithRole) => void;
  refreshProjects: () => void;
}

export const ProjectContext = createContext<ProjectContextType>({
  selectedProject: null,
  projects: undefined,
  selectedProjectRole: null,
  isServerAdmin: false,
  isProjectAdmin: false,
  isProjectViewer: false,
  canAdminCurrentProject: false,
  loading: true,
  selectProject: () => {},
  refreshProjects: () => {},
});

interface ProjectProviderProps {
  children: ReactNode;
}

export const ProjectProvider: React.FC<ProjectProviderProps> = ({ children }) => {
  const [selectedProject, setSelectedProject] = useState<ProjectWithRole | null>(null);
  const { user } = useAuth();
  const { projectId } = useParams<{ projectId: string }>();
  const location = useLocation();

  // Check if user is authenticated
  const isAuthenticated = !!localStorage.getItem('access_token');

  // Fetch user's projects with roles (only if authenticated)
  const { data: projects, isLoading, refetch } = useQuery({
    queryKey: ['user-projects'],
    queryFn: () => getUserProjects(),
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
    enabled: isAuthenticated, // Only fetch if user is authenticated
  });

  // Role checking helpers
  const selectedProjectRole = selectedProject?.role || null;
  const isServerAdmin = user?.is_server_admin || false;
  const isProjectAdmin = selectedProjectRole === 'project-admin' || isServerAdmin;
  const isProjectViewer = selectedProjectRole === 'project-viewer';
  const canAdminCurrentProject = isProjectAdmin;

  // Auto-select project from URL or localStorage
  useEffect(() => {
    if (!projects || projects.length === 0) return;

    // If we're on a project-specific route, select that project
    if (projectId) {
      const project = projects.find(p => p.id === parseInt(projectId));
      if (project) {
        setSelectedProject(project);
        localStorage.setItem('selected_project_id', project.id.toString());
        return;
      }
    }

    // Otherwise, try to load from localStorage
    const storedProjectId = localStorage.getItem('selected_project_id');
    if (storedProjectId) {
      const project = projects.find(p => p.id === parseInt(storedProjectId));
      if (project) {
        setSelectedProject(project);
        return;
      }
    }

    // Fallback: select first project
    if (projects.length > 0 && !selectedProject) {
      setSelectedProject(projects[0]);
      localStorage.setItem('selected_project_id', projects[0].id.toString());
    }
  }, [projects, projectId, location.pathname]);

  const selectProject = (project: ProjectWithRole) => {
    // Only allow selecting projects the user has access to
    if (projects?.find(p => p.id === project.id)) {
      setSelectedProject(project);
      localStorage.setItem('selected_project_id', project.id.toString());
    }
  };

  const refreshProjects = () => {
    refetch();
  };

  return (
    <ProjectContext.Provider
      value={{
        selectedProject,
        projects,
        selectedProjectRole,
        isServerAdmin,
        isProjectAdmin,
        isProjectViewer,
        canAdminCurrentProject,
        loading: isLoading,
        selectProject,
        refreshProjects,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
};

/**
 * Custom hook to use project context
 */
export const useProject = () => {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    throw new Error('useProject must be used within a ProjectProvider');
  }
  return context;
};
