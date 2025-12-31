/**
 * Server sidebar navigation component for server-level pages
 */
import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Camera,
  Settings,
  Bug,
  X,
  Menu,
  ArrowLeft,
  LogOut,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { cn } from '../../lib/utils';

interface ServerSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ServerSidebar: React.FC<ServerSidebarProps> = ({ isOpen, onClose }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  // Server navigation items (superuser only)
  const navItems = [
    { to: '/server-settings', icon: Settings, label: 'Server Settings' },
    { to: '/debug', icon: Bug, label: 'Dev Tools' },
  ];

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

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
        </nav>

        {/* Bottom section with Back to Projects and User info */}
        <div className="absolute bottom-0 left-0 right-0 bg-card">
          {/* Back to Projects */}
          <div className="px-4 py-3 border-t border-border">
            <NavLink
              to="/projects"
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Projects
            </NavLink>
          </div>

          {/* User Info */}
          {user && (
            <div className="px-4 py-3 border-t border-border bg-muted/30">
              <p className="text-xs font-medium text-muted-foreground mb-1">Logged in as</p>
              <p className="text-sm font-semibold truncate mb-2">{user.email}</p>
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            </div>
          )}
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
