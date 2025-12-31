/**
 * Project Card Component
 *
 * Displays a project with image, name, and description.
 * Shows three-dot menu for superusers to edit/delete.
 * Clicking the card navigates to the dashboard with the project selected.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MoreVertical, Edit, Trash2, FolderOpen } from 'lucide-react';
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
import type { Project } from '../../api/types';

interface ProjectCardProps {
  project: Project;
  canManage: boolean;
}

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
        <div className="relative w-full h-48 bg-gray-200 overflow-hidden">
          {project.thumbnail_url ? (
            <img
              src={project.thumbnail_url}
              alt={project.name}
              className="w-full h-full object-cover"
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
          <h3 className="font-semibold text-lg mb-1 line-clamp-1">{project.name}</h3>
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
