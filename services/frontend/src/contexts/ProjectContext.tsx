/**
 * Project context provider
 *
 * Manages selected project state and provides project selection functions.
 * Filters projects based on user access:
 * - Superusers see all projects
 * - Regular users see only their assigned project
 * - Auto-selects project from URL when on project-specific pages
 */
import React, { createContext, useState, useEffect, useContext, ReactNode, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useLocation } from 'react-router-dom';
import { projectsApi } from '../api/projects';
import { useAuth } from '../hooks/useAuth';
import type { Project } from '../api/types';

interface ProjectContextType {
  selectedProject: Project | null;
  projects: Project[] | undefined;
  visibleProjects: Project[];
  canManageProjects: boolean;
  loading: boolean;
  selectProject: (project: Project) => void;
  refreshProjects: () => void;
}

export const ProjectContext = createContext<ProjectContextType>({
  selectedProject: null,
  projects: undefined,
  visibleProjects: [],
  canManageProjects: false,
  loading: true,
  selectProject: () => {},
  refreshProjects: () => {},
});

interface ProjectProviderProps {
  children: ReactNode;
}

export const ProjectProvider: React.FC<ProjectProviderProps> = ({ children }) => {
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const { user } = useAuth();
  const { projectId } = useParams<{ projectId: string }>();
  const location = useLocation();

  // Check if user is authenticated
  const isAuthenticated = !!localStorage.getItem('access_token');

  // Fetch all projects (only if authenticated)
  const { data: projects, isLoading, refetch } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.getAll(),
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
    enabled: isAuthenticated, // Only fetch if user is authenticated
  });

  // Filter projects based on user access
  const visibleProjects = useMemo(() => {
    if (!projects || !user) return [];

    // Superusers see all projects
    if (user.is_superuser) {
      return projects;
    }

    // Regular users see only their assigned project
    if (user.project_id) {
      return projects.filter(p => p.id === user.project_id);
    }

    // No project assigned = no access
    return [];
  }, [projects, user]);

  // Check if user can manage projects (superuser only)
  const canManageProjects = user?.is_superuser || false;

  // Auto-select project from URL or localStorage
  useEffect(() => {
    if (visibleProjects.length === 0) return;

    // If we're on a project-specific route, select that project
    if (projectId) {
      const project = visibleProjects.find(p => p.id === parseInt(projectId));
      if (project) {
        setSelectedProject(project);
        localStorage.setItem('selected_project_id', project.id.toString());
        return;
      }
    }

    // Otherwise, try to load from localStorage
    const storedProjectId = localStorage.getItem('selected_project_id');
    if (storedProjectId) {
      const project = visibleProjects.find(p => p.id === parseInt(storedProjectId));
      if (project) {
        setSelectedProject(project);
        return;
      }
    }

    // Fallback: select first visible project
    if (visibleProjects.length > 0 && !selectedProject) {
      setSelectedProject(visibleProjects[0]);
      localStorage.setItem('selected_project_id', visibleProjects[0].id.toString());
    }
  }, [visibleProjects, projectId, location.pathname]);

  const selectProject = (project: Project) => {
    // Only allow selecting visible projects
    if (visibleProjects.find(p => p.id === project.id)) {
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
        visibleProjects,
        canManageProjects,
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
