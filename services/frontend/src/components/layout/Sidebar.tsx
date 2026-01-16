/**
 * Sidebar navigation component
 */
import React, { useState } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import {
  Camera,
  LayoutDashboard,
  Images,
  Bell,
  Info,
  X,
  Menu,
  VideoIcon,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ShieldAlert,
  Filter,
  Users
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useProject } from '../../contexts/ProjectContext';
import { cn } from '../../lib/utils';
import { LastUpdate } from '../LastUpdate';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  const { user } = useAuth();
  const { selectedProject, isServerAdmin, isProjectAdmin } = useProject();
  const { projectId } = useParams<{ projectId: string }>();
  const [adminToolsOpen, setAdminToolsOpen] = useState(false);

  // Navigation items (all project-specific)
  const navItems = [
    { to: `/projects/${projectId}/dashboard`, icon: LayoutDashboard, label: 'Dashboard' },
    { to: `/projects/${projectId}/cameras`, icon: Camera, label: 'Cameras' },
    { to: `/projects/${projectId}/images`, icon: Images, label: 'Images' },
    { to: `/projects/${projectId}/notifications`, icon: Bell, label: 'Notifications' },
    { to: `/projects/${projectId}/about`, icon: Info, label: 'About' },
  ];

  // Admin tools - visible to project admins and server admins
  const adminTools = [
    { to: `/projects/${projectId}/species-management`, icon: Filter, label: 'Species Management' },
    { to: `/projects/${projectId}/camera-management`, icon: VideoIcon, label: 'Camera Management' },
    { to: `/projects/${projectId}/users`, icon: Users, label: 'Project Users', requiresAdmin: true },
  ];

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed top-0 left-0 z-50 h-screen w-64 bg-card border-r border-border transition-transform duration-300',
          'lg:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between h-16 px-6 border-b border-border">
          <div className="flex items-center space-x-3">
            <Camera className="h-6 w-6 text-primary" />
            <span className="text-lg font-semibold">AddaxAI Connect</span>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden p-2 hover:bg-accent rounded-md"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 py-4 space-y-1 mt-4">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  'flex items-center space-x-3 px-4 py-3 rounded-md text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )
              }
            >
              <item.icon className="h-5 w-5" />
              <span>{item.label}</span>
            </NavLink>
          ))}

          {/* Admin Tools Section (project admin or server admin) */}
          {isProjectAdmin && (
            <div className="mt-2">
              <button
                onClick={() => setAdminToolsOpen(!adminToolsOpen)}
                className="flex items-center justify-between w-full px-4 py-3 rounded-md text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <ShieldAlert className="h-5 w-5" />
                  <span>Admin Tools</span>
                </div>
                {adminToolsOpen ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>

              {/* Admin Tools Submenu */}
              {adminToolsOpen && (
                <div className="ml-4 mt-1 space-y-1">
                  {adminTools.map((tool) => (
                    <NavLink
                      key={tool.to}
                      to={tool.to}
                      onClick={onClose}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center space-x-3 px-4 py-2 rounded-md text-sm font-medium transition-colors',
                          isActive
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                        )
                      }
                    >
                      <tool.icon className="h-4 w-4" />
                      <span>{tool.label}</span>
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )}
        </nav>

        {/* Bottom section with project info, Last Update, and User info */}
        <div className="absolute bottom-0 left-0 right-0 bg-card">
          {/* Current Project Display with Back to Projects */}
          {selectedProject && (
            <div className="px-4 py-3 border-t border-border bg-muted/30">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-muted-foreground">Current Project</p>
                <NavLink
                  to="/projects"
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="h-3 w-3" />
                  Back
                </NavLink>
              </div>
              <p className="truncate text-sm font-semibold">
                {selectedProject.name}
              </p>
            </div>
          )}

          {/* Last Update Widget */}
          <LastUpdate />
        </div>
      </aside>
    </>
  );
};

interface MobileMenuButtonProps {
  onClick: () => void;
}

export const MobileMenuButton: React.FC<MobileMenuButtonProps> = ({ onClick }) => {
  return (
    <button
      onClick={onClick}
      className="lg:hidden fixed top-4 left-4 z-30 p-2 rounded-md bg-card border border-border shadow-md hover:bg-accent"
    >
      <Menu className="h-5 w-5" />
    </button>
  );
};
