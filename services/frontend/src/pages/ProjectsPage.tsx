/**
 * Projects Page
 *
 * Shows all projects as cards with user's role in each.
 * Server admins see all projects, regular users see their assigned projects.
 * Server admins and project admins can manage their projects.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Camera } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useProject } from '../contexts/ProjectContext';
import { Card, CardContent } from '../components/ui/Card';
import { ProjectCard } from '../components/projects/ProjectCard';
import { CreateProjectModal } from '../components/projects/CreateProjectModal';
import { UserMenu } from '../components/UserMenu';

export const ProjectsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { projects, loading, isServerAdmin } = useProject();
  const [showCreateModal, setShowCreateModal] = useState(false);

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
                  onCreateProject={() => setShowCreateModal(true)}
                  onLogout={handleLogout}
                />
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-8">
        <div className="mb-6">
          <h2 className="text-2xl font-bold">Projects</h2>
          <p className="text-muted-foreground mt-1">
            {isServerAdmin
              ? 'Manage wildlife monitoring projects'
              : 'Your assigned projects'
            }
          </p>
        </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : !projects || projects.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              {isServerAdmin
                ? 'No projects yet. Use the menu above to create your first project.'
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
