/**
 * Main application layout with sidebar
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { useProject } from '../../contexts/ProjectContext';
import { Sidebar } from './Sidebar';
import { TopBar, TopBarLogo } from './TopBar';
import { InstallHint } from '../InstallApp';

interface AppLayoutProps {
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { missingProject } = useProject();

  return (
    <div className="min-h-screen bg-background">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="lg:pl-64 min-h-screen">
        {/* On a phone the bar also opens the navigation and shows the logo.
            On desktop the sidebar does both, and the bar holds the account
            menu only. */}
        <TopBar
          left={
            <div className="flex items-center gap-3 lg:hidden">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open menu"
                className="p-2 -ml-2 rounded-md hover:bg-accent"
              >
                <Menu className="h-5 w-5" />
              </button>
              <TopBarLogo />
            </div>
          }
        />

        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          {/* The address names a project this user cannot open: say so,
              instead of a page that waits for a project forever. */}
          {missingProject ? (
            <div className="py-16 text-center space-y-3">
              <p className="text-muted-foreground">This project does not exist, or you have no access to it.</p>
              <Link to="/projects" className="text-sm text-primary hover:underline">Back to projects</Link>
            </div>
          ) : (
            children
          )}
        </div>
      </main>

      {/* One-time install discovery hint. Lives here so it only shows after
          login, never on the shared demo login page. */}
      <InstallHint />
    </div>
  );
};
