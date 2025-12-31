/**
 * Projects Page
 *
 * Shows all projects as cards (superusers see all, regular users see only their assigned project).
 * Superusers can create, edit, and delete projects.
 */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, Loader2, Camera, LogOut, Settings } from 'lucide-react';
import { projectsApi } from '../api/projects';
import { useAuth } from '../hooks/useAuth';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { ProjectCard } from '../components/projects/ProjectCard';
import { CreateProjectModal } from '../components/projects/CreateProjectModal';
import type { Project } from '../api/types';

export const ProjectsPage: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [showCreateModal, setShowCreateModal] = useState(false);

  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: projectsApi.getAll,
  });

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // Filter projects based on user role
  const visibleProjects = React.useMemo(() => {
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

  const canManageProjects = user?.is_superuser || false;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Camera className="h-8 w-8 text-primary" />
              <div>
                <h1 className="text-xl font-bold">AddaxAI Connect</h1>
                <p className="text-xs text-muted-foreground">Wildlife Monitoring Projects</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {canManageProjects && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/server-settings')}
                >
                  <Settings className="h-4 w-4 mr-2" />
                  Server Settings
                </Button>
              )}
              <div className="border-l pl-4 ml-2 flex items-center gap-3">
                <p className="text-sm font-medium">{user?.email}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLogout}
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Logout
                </Button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold">Projects</h2>
            <p className="text-muted-foreground mt-1">
              {canManageProjects
                ? 'Manage wildlife monitoring projects'
                : 'Your assigned project'
              }
            </p>
          </div>
          {canManageProjects && (
            <Button onClick={() => setShowCreateModal(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Project
            </Button>
          )}
        </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : visibleProjects.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              {canManageProjects
                ? 'No projects yet. Create your first project to get started.'
                : 'No project assigned. Contact an administrator.'
              }
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {visibleProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              canManage={canManageProjects}
            />
          ))}
        </div>
      )}

        {/* Create Project Modal */}
        {canManageProjects && (
          <CreateProjectModal
            open={showCreateModal}
            onClose={() => setShowCreateModal(false)}
          />
        )}
      </main>
    </div>
  );
};
