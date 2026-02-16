/**
 * Projects Page
 *
 * Shows all projects as cards with user's role in each.
 * Server admins see all projects, regular users see their assigned projects.
 * Server admins and project admins can manage their projects.
 */
import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Camera, AlertCircle, Plus } from 'lucide-react';
import { adminApi } from '../api/admin';
import { useAuth } from '../hooks/useAuth';
import { useProject } from '../contexts/ProjectContext';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { ProjectCard } from '../components/projects/ProjectCard';
import { CreateProjectModal } from '../components/projects/CreateProjectModal';
import { UserMenu } from '../components/UserMenu';

export const ProjectsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { projects, loading, isServerAdmin } = useProject();
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Check if timezone is configured (server admins only)
  const { data: tzStatus } = useQuery({
    queryKey: ['timezone-configured'],
    queryFn: adminApi.isTimezoneConfigured,
    enabled: isServerAdmin,
  });

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

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
            <div className="flex items-center gap-4">
              {user && (
                <UserMenu
                  user={user}
                  isServerAdmin={isServerAdmin}
                  onLogout={handleLogout}
                />
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-8">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold">Projects</h2>
            <p className="text-muted-foreground mt-1">
              {isServerAdmin
                ? 'Manage wildlife monitoring projects'
                : 'Your assigned projects'
              }
            </p>
          </div>
          {isServerAdmin && (
            <Button size="sm" onClick={() => setShowCreateModal(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add project
            </Button>
          )}
        </div>

        {/* Timezone not configured banner (server admins only) */}
        {isServerAdmin && tzStatus && !tzStatus.configured && (
          <div className="mb-6 bg-amber-50 border border-amber-200 text-amber-800 rounded-md p-3 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span className="text-sm">
              Camera timezone hasn't been configured yet.{' '}
              <Link to="/server/settings" className="underline font-medium">Set it in Server Settings</Link>
            </span>
          </div>
        )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : !projects || projects.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              {isServerAdmin
                ? 'No projects yet. Click "Add project" above to create your first project.'
                : 'No projects assigned. Contact an administrator.'
              }
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              canManage={project.role === 'server-admin' || project.role === 'project-admin'}
            />
          ))}
        </div>
      )}

        {/* Create Project Modal */}
        {isServerAdmin && (
          <CreateProjectModal
            open={showCreateModal}
            onClose={() => setShowCreateModal(false)}
          />
        )}
      </main>
    </div>
  );
};
