/**
 * User Menu (Hamburger Menu)
 *
 * Dropdown menu for all users with role-based items.
 * All users see: email, About, and Logout
 * Server admins additionally see: server admin options
 */
import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, Users, FileX, Upload, Trash2, Plus, MessageCircle, Activity, LogOut, Info, KeyRound } from 'lucide-react';
import { cn } from '../lib/utils';
import { User } from '../api/auth';

interface UserMenuProps {
  user: User;
  isServerAdmin: boolean;
  onCreateProject?: () => void;
  onLogout: () => void;
}

export const UserMenu: React.FC<UserMenuProps> = ({ user, isServerAdmin, onCreateProject, onLogout }) => {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleNavigate = (path: string) => {
    setIsOpen(false);
    navigate(path);
  };

  const handleCreateProject = () => {
    setIsOpen(false);
    if (onCreateProject) {
      onCreateProject();
    }
  };

  const handleLogout = () => {
    setIsOpen(false);
    onLogout();
  };

  // General items (visible to all users)
  const generalItems = [
    {
      icon: KeyRound,
      label: 'Change password',
      onClick: () => handleNavigate('/change-password'),
      variant: 'default' as const,
    },
    {
      icon: Info,
      label: 'About',
      onClick: () => handleNavigate('/about'),
      variant: 'default' as const,
    },
  ];

  // Server admin items (only visible to server admins)
  const serverAdminItems = [
    ...(onCreateProject ? [{
      icon: Plus,
      label: 'Create project',
      onClick: handleCreateProject,
      variant: 'default' as const,
    }] : []),
    {
      icon: Activity,
      label: 'System health',
      onClick: () => handleNavigate('/server/health'),
      variant: 'default' as const,
    },
    {
      icon: Users,
      label: 'Server admins',
      onClick: () => handleNavigate('/server/server-admin-management'),
      variant: 'default' as const,
    },
    {
      icon: MessageCircle,
      label: 'Set up Telegram bot',
      onClick: () => handleNavigate('/server/telegram-config'),
      variant: 'default' as const,
    },
    {
      icon: FileX,
      label: 'Rejected files',
      onClick: () => handleNavigate('/server/rejected-files'),
      variant: 'default' as const,
    },
    {
      icon: Upload,
      label: 'Upload to FTPS',
      onClick: () => handleNavigate('/server/ftps-upload'),
      variant: 'default' as const,
    },
    {
      icon: Trash2,
      label: 'Delete all data',
      onClick: () => handleNavigate('/server/delete-data'),
      variant: 'destructive' as const,
    },
  ];

  return (
    <div className="relative" ref={menuRef}>
      {/* Hamburger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'p-2 rounded-md transition-colors',
          isOpen ? 'bg-accent' : 'hover:bg-accent'
        )}
        aria-label="User menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 bg-card border border-border rounded-md shadow-lg z-50">
          {/* Header: Email */}
          <div className="px-4 py-3 border-b border-border">
            <p className="text-sm text-muted-foreground truncate">{user.email}</p>
          </div>

          {/* General Items (All Users) */}
          <div className="py-1">
            {generalItems.map((item, index) => (
              <button
                key={index}
                onClick={item.onClick}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-left hover:bg-accent"
              >
                <item.icon className="h-4 w-4" />
                <span>{item.label}</span>
              </button>
            ))}
          </div>

          {/* Server Admin Items (Conditionally Rendered) */}
          {isServerAdmin && (
            <>
              <div className="border-t border-border my-1" />
              <div className="py-1">
                {serverAdminItems.map((item, index) => (
                  <button
                    key={index}
                    onClick={item.onClick}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-left',
                      item.variant === 'destructive'
                        ? 'text-destructive hover:bg-destructive/10'
                        : 'hover:bg-accent'
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Footer: Logout */}
          <div className="border-t border-border my-1" />
          <div className="py-1">
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-left hover:bg-accent"
            >
              <LogOut className="h-4 w-4" />
              <span>Logout</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
