/**
 * Full-screen modal for server-level administration
 *
 * Provides a clear context switch from project-level to server-level operations
 */
import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { X, Settings, Bug, Camera } from 'lucide-react';
import { cn } from '../lib/utils';

interface ServerModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export const ServerModal: React.FC<ServerModalProps> = ({ open, onClose, children }) => {
  // Close on escape key
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (open) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [open, onClose]);

  if (!open) return null;

  // Server navigation items
  const navItems = [
    { to: '/server-settings', icon: Settings, label: 'Server Settings' },
    { to: '/debug', icon: Bug, label: 'Dev Tools' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal Container - Almost full screen */}
      <div className="relative z-50 w-[95vw] h-[95vh] bg-background rounded-lg shadow-2xl flex overflow-hidden border border-border">
        {/* Sidebar */}
        <aside className="w-64 bg-card border-r border-border flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between h-16 px-6 border-b border-border">
            <div className="flex items-center space-x-3">
              <Camera className="h-6 w-6 text-primary" />
              <span className="text-lg font-semibold">Server Admin</span>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-4 py-4 space-y-1 mt-4">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
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

          {/* Footer info */}
          <div className="px-6 py-4 border-t border-border bg-muted/30">
            <p className="text-xs text-muted-foreground">
              Server-wide administration panel
            </p>
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Close Button */}
          <div className="flex justify-end p-4 border-b border-border bg-card">
            <button
              onClick={onClose}
              className="p-2 rounded-md hover:bg-accent transition-colors"
              title="Close server admin (Esc)"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            <div className="p-8">
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
