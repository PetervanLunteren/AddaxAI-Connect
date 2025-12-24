/**
 * Project context provider
 *
 * Manages selected project state and provides project selection functions
 */
import React, { createContext, useState, useEffect, useContext, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { projectsApi } from '../api/projects';
import type { Project } from '../api/types';

interface ProjectContextType {
  selectedProject: Project | null;
  projects: Project[] | undefined;
  loading: boolean;
  selectProject: (project: Project) => void;
  refreshProjects: () => void;
}

export const ProjectContext = createContext<ProjectContextType>({
  selectedProject: null,
  projects: undefined,
  loading: true,
  selectProject: () => {},
  refreshProjects: () => {},
});

interface ProjectProviderProps {
  children: ReactNode;
}

export const ProjectProvider: React.FC<ProjectProviderProps> = ({ children }) => {
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);

  // Check if user is authenticated
  const isAuthenticated = !!localStorage.getItem('access_token');

  // Fetch all projects (only if authenticated)
  const { data: projects, isLoading, refetch } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.getAll(),
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
    enabled: isAuthenticated, // Only fetch if user is authenticated
  });

  // Load selected project from localStorage on mount
  useEffect(() => {
    const storedProjectId = localStorage.getItem('selected_project_id');

    if (storedProjectId && projects) {
      const project = projects.find(p => p.id === parseInt(storedProjectId));
      if (project) {
        setSelectedProject(project);
      } else {
        // Stored project not found, clear it and select first available
        localStorage.removeItem('selected_project_id');
        if (projects.length > 0) {
          setSelectedProject(projects[0]);
          localStorage.setItem('selected_project_id', projects[0].id.toString());
        }
      }
    } else if (projects && projects.length > 0 && !selectedProject) {
      // No stored project, select first available
      setSelectedProject(projects[0]);
      localStorage.setItem('selected_project_id', projects[0].id.toString());
    }
  }, [projects]);

  const selectProject = (project: Project) => {
    setSelectedProject(project);
    localStorage.setItem('selected_project_id', project.id.toString());
  };

  const refreshProjects = () => {
    refetch();
  };

  return (
    <ProjectContext.Provider
      value={{
        selectedProject,
        projects,
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
