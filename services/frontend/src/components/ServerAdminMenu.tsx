/**
 * Server Administration Hamburger Menu
 *
 * Dropdown menu for server-level admin functions (superuser only)
 */
import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, Users, FileX, Upload, Trash2, LogOut, Plus, Bell, User, MessageCircle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { cn } from '../lib/utils';

interface ServerAdminMenuProps {
  onCreateProject?: () => void;
}

export const ServerAdminMenu: React.FC<ServerAdminMenuProps> = ({ onCreateProject }) => {
  const navigate = useNavigate();
  const { logout } = useAuth();
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

  const handleLogout = async () => {
    setIsOpen(false);
    await logout();
    navigate('/login');
  };

  const handleCreateProject = () => {
    setIsOpen(false);
    if (onCreateProject) {
      onCreateProject();
    }
  };

  const menuItems = [
    ...(onCreateProject ? [{
      icon: Plus,
      label: 'Create Project',
      onClick: handleCreateProject,
      variant: 'default' as const,
    }] : []),
    {
      icon: Users,
      label: 'Manage Users',
      onClick: () => handleNavigate('/server/user-assignment'),
      variant: 'default' as const,
    },
    {
      icon: Bell,
      label: 'Signal Notifications',
      onClick: () => handleNavigate('/server/signal-config'),
      variant: 'default' as const,
    },
    {
      icon: MessageCircle,
      label: 'Telegram Notifications',
      onClick: () => handleNavigate('/server/telegram-config'),
      variant: 'default' as const,
    },
    {
      icon: FileX,
      label: 'Rejected Files',
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
      label: 'Delete All Data',
      onClick: () => handleNavigate('/server/delete-data'),
      variant: 'destructive' as const,
    },
    {
      icon: LogOut,
      label: 'Logout',
      onClick: handleLogout,
      variant: 'default' as const,
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
        aria-label="Server admin menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 bg-card border border-border rounded-md shadow-lg z-50">
          <div className="py-1">
            {menuItems.map((item, index) => (
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
        </div>
      )}
    </div>
  );
};
