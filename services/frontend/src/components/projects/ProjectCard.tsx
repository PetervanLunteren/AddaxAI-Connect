/**
 * Project Card Component
 *
 * Displays a project with image, name, description, and user's role.
 * Shows three-dot menu for project admins/server admins to edit/delete.
 * Clicking the card navigates to the dashboard with the project selected.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MoreVertical, Edit, Trash2, FolderOpen, Shield, Eye, Users } from 'lucide-react';
import { Card, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/DropdownMenu';
import { EditProjectModal } from './EditProjectModal';
import { DeleteProjectModal } from './DeleteProjectModal';
import type { ProjectWithRole } from '../../api/types';

interface ProjectCardProps {
  project: ProjectWithRole;
  canManage: boolean;
}

// Role badge component
const RoleBadge: React.FC<{ role: string }> = ({ role }) => {
  const getRoleConfig = (role: string) => {
    switch (role) {
      case 'server-admin':
        return {
          label: 'server admin',
          icon: Shield,
          className: 'bg-purple-100 text-purple-700 border-purple-200',
        };
      case 'project-admin':
        return {
          label: 'project admin',
          icon: Users,
          className: 'bg-blue-100 text-blue-700 border-blue-200',
        };
      case 'project-viewer':
        return {
          label: 'project viewer',
          icon: Eye,
          className: 'bg-gray-100 text-gray-700 border-gray-200',
        };
      default:
        return {
          label: role,
          icon: Shield,
          className: 'bg-gray-100 text-gray-700 border-gray-200',
        };
    }
  };

  const config = getRoleConfig(role);
  const Icon = config.icon;

  return (
    <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border ${config.className}`}>
      <Icon className="h-3 w-3" />
      <span>{config.label}</span>
    </div>
  );
};

export const ProjectCard: React.FC<ProjectCardProps> = ({ project, canManage }) => {
  const navigate = useNavigate();
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const handleCardClick = () => {
    // Navigate to project dashboard
    navigate(`/projects/${project.id}/dashboard`);
  };

  const handleMenuClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent card click when clicking menu
  };

  return (
    <>
      <Card
        className="cursor-pointer hover:shadow-lg transition-shadow duration-200"
        onClick={handleCardClick}
      >
        {/* Project Image */}
        <div className="relative w-full bg-gray-200 overflow-hidden" style={{ aspectRatio: '4/3' }}>
          {project.thumbnail_url ? (
            <img
              src={project.thumbnail_url}
              alt={project.name}
              className="w-full h-full object-contain"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-green-400 to-blue-500">
              <FolderOpen className="h-16 w-16 text-white opacity-50" />
            </div>
          )}

          {/* Three-dot menu (superuser only) */}
          {canManage && (
            <div className="absolute top-2 right-2" onClick={handleMenuClick}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 bg-white/90 hover:bg-white"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setShowEditModal(true)}>
                    <Edit className="h-4 w-4 mr-2" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setShowDeleteModal(true)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>

        {/* Project Info */}
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2 mb-2">
            <h3 className="font-semibold text-lg line-clamp-1 flex-1">{project.name}</h3>
          </div>
          <div className="mb-2">
            <RoleBadge role={project.role} />
          </div>
          {project.description && (
            <p className="text-sm text-muted-foreground line-clamp-2">
              {project.description}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Edit Modal */}
      {canManage && (
        <EditProjectModal
          project={project}
          open={showEditModal}
          onClose={() => setShowEditModal(false)}
        />
      )}

      {/* Delete Modal */}
      {canManage && (
        <DeleteProjectModal
          project={project}
          open={showDeleteModal}
          onClose={() => setShowDeleteModal(false)}
        />
      )}
    </>
  );
};
