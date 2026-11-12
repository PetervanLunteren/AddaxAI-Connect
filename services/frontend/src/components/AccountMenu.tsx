/**
 * Account menu
 *
 * The circle with the first letter of the user's email, on the right of the
 * top bar on every page. Behind it is everything about the account itself,
 * and for server admins the server pages. Tools that belong to one project
 * are not here, they are in that project's sidebar.
 */
import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Upload, Settings, Activity, LogOut, Info, KeyRound, BookOpen, ShieldCheck } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../hooks/useAuth';
import { useProject } from '../contexts/ProjectContext';
import { ChangePasswordModal } from './ChangePasswordModal';
import { TwoFactorModal } from './TwoFactorModal';

export const AccountMenu: React.FC = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { isServerAdmin } = useProject();
  const [isOpen, setIsOpen] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showTwoFactor, setShowTwoFactor] = useState(false);
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

  if (!user) return null;

  // General items (visible to all users)
  const generalItems = [
    {
      icon: Info,
      label: 'About',
      onClick: () => handleNavigate('/about'),
    },
  ];

  // Server admin items (only visible to server admins)
  const serverAdminItems = [
    {
      icon: Activity,
      label: 'System health',
      onClick: () => handleNavigate('/server/health'),
    },
    {
      icon: Users,
      label: 'Server admins',
      onClick: () => handleNavigate('/server/server-admin-management'),
    },
    {
      icon: Settings,
      label: 'Server settings',
      onClick: () => handleNavigate('/server/settings'),
    },
    {
      icon: Upload,
      label: 'File management',
      onClick: () => handleNavigate('/server/file-management'),
    },
  ];

  return (
    <div className="relative" ref={menuRef}>
      {/* The avatar: the first letter of the email. Accounts have no name
          and no photo, and a letter still tells two accounts apart. */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground transition-shadow',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          isOpen ? 'ring-2 ring-ring ring-offset-2' : 'hover:ring-2 hover:ring-ring hover:ring-offset-2'
        )}
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        {user.email.charAt(0).toUpperCase()}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 bg-card border border-border rounded-md shadow-lg z-50">
          {/* Header: Email */}
          <div className="px-4 py-3 border-b border-border">
            <p className="text-sm text-muted-foreground truncate">{user.email}</p>
          </div>

          {/* Account Actions */}
          <div className="py-1">
            <button
              onClick={() => { setIsOpen(false); setShowChangePassword(true); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-left hover:bg-accent"
            >
              <KeyRound className="h-4 w-4" />
              <span>Change password</span>
            </button>
            <button
              onClick={() => { setIsOpen(false); setShowTwoFactor(true); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-left hover:bg-accent"
            >
              <ShieldCheck className="h-4 w-4" />
              <span>Two-factor login</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {user.two_factor_enabled ? 'On' : 'Off'}
              </span>
            </button>
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
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-left hover:bg-accent"
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Footer: Documentation and About */}
          <div className="border-t border-border my-1" />
          <div className="py-1">
            <a
              href="https://connect.addaxai.com/"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setIsOpen(false)}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-left hover:bg-accent"
            >
              <BookOpen className="h-4 w-4" />
              <span>Documentation</span>
            </a>
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

          {/* Log out, last, where people look for it */}
          <div className="border-t border-border my-1" />
          <div className="py-1">
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-left hover:bg-accent"
            >
              <LogOut className="h-4 w-4" />
              <span>Log out</span>
            </button>
          </div>
        </div>
      )}

      <ChangePasswordModal
        open={showChangePassword}
        onClose={() => setShowChangePassword(false)}
      />
      <TwoFactorModal
        open={showTwoFactor}
        onClose={() => setShowTwoFactor(false)}
      />
    </div>
  );
};
