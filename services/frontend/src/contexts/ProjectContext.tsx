/**
 * Project context provider
 *
 * Manages selected project state and provides project selection functions.
 * Projects are fetched with user roles:
 * - Server admins see all projects with 'server-admin' role
 * - Regular users see only their assigned projects with their specific roles
 * - Auto-selects project from URL when on project-specific pages
 * - A project in the URL that is not in the user's list (deleted, no access)
 *   selects nothing and sets missingProject, so the layout says so. It never
 *   falls back to another project: that showed one project's data under
 *   another's address.
 * - The list can still be loading, or fail to load (projectsFailed). The
 *   layout (AppLayout) shows a project page only once its project is
 *   selected, and says which of these it is waiting for.
 */
import React, { createContext, useState, useEffect, useContext, useRef, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { getUserProjects } from '../api/auth';
import { useAuth } from '../hooks/useAuth';
import type { ProjectWithRole } from '../api/types';

/** Extract project ID from URL path since useParams doesn't work above Routes */
function getProjectIdFromPath(pathname: string): string | undefined {
  const match = pathname.match(/^\/projects\/(\d+)/);
  return match ? match[1] : undefined;
}

interface ProjectContextType {
  selectedProject: ProjectWithRole | null;
  projects: ProjectWithRole[] | undefined;
  selectedProjectRole: string | null;
  isServerAdmin: boolean;
  isProjectAdmin: boolean;
  isProjectViewer: boolean;
  canAdminCurrentProject: boolean;
  loading: boolean;
  // The project list could not be loaded. refreshProjects tries again.
  projectsFailed: boolean;
  // The URL names a project the user cannot open (deleted, or no access).
  missingProject: boolean;
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
  projectsFailed: false,
  missingProject: false,
  selectProject: () => {},
  refreshProjects: () => {},
});

interface ProjectProviderProps {
  children: ReactNode;
}

export const ProjectProvider: React.FC<ProjectProviderProps> = ({ children }) => {
  const [selectedProject, setSelectedProject] = useState<ProjectWithRole | null>(null);
  const [missingProject, setMissingProject] = useState(false);
  // The project id the list was fetched again for, once, before giving up.
  const refetchedFor = useRef<string | null>(null);
  const { user } = useAuth();
  const location = useLocation();
  const projectId = getProjectIdFromPath(location.pathname);

  // Fetch user's projects with roles (only if authenticated)
  const { data: projects, isLoading, isError, refetch } = useQuery({
    queryKey: ['user-projects'],
    queryFn: () => getUserProjects(),
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
    // Only once the user has loaded. The user load waits out an API that is
    // briefly down (AuthContext), so the project list does not fail then
    // and leave the page empty.
    enabled: !!user,
  });

  // Role checking helpers
  const selectedProjectRole = selectedProject?.role || null;
  const isServerAdmin = user?.is_superuser || false;
  const isProjectAdmin = selectedProjectRole === 'project-admin' || isServerAdmin;
  const isProjectViewer = selectedProjectRole === 'project-viewer';
  const canAdminCurrentProject = isProjectAdmin;

  // Auto-select project from URL or localStorage
  useEffect(() => {
    if (!projects) return;

    // If we're on a project-specific route, select that project
    if (projectId) {
      const project = projects.find(p => p.id === parseInt(projectId));
      if (project) {
        setMissingProject(false);
        setSelectedProject(project);
        localStorage.setItem('selected_project_id', project.id.toString());
        return;
      }
      // Not in the list. The list is kept five minutes, so a project made or
      // shared since then is asked for once more before giving up.
      const giveUp = () => {
        setSelectedProject(null);
        setMissingProject(true);
      };
      if (refetchedFor.current !== projectId) {
        refetchedFor.current = projectId;
        refetch().then(({ data }) => {
          if (!data?.some(p => p.id === parseInt(projectId))) giveUp();
        });
      } else {
        giveUp();
      }
      return;
    }
    setMissingProject(false);

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
        projectsFailed: isError,
        missingProject,
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
