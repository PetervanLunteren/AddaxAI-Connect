/**
 * Main application layout with sidebar
 */
import React, { useState } from 'react';
import { Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { DevServerBanner } from '../DevServerBanner';
import { InstallHint } from '../InstallApp';

interface AppLayoutProps {
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="lg:pl-64 min-h-screen">
        <DevServerBanner />
        {/* Mobile top bar. Sticks below the status bar strip (body::before)
            in the installed app; the offset is 0 in normal browsers. */}
        <div className="lg:hidden sticky top-[env(safe-area-inset-top)] z-30 flex h-14 items-center gap-3 border-b border-border bg-card px-4">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
            className="p-2 rounded-md hover:bg-accent"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <img src="/logo-wide.png" alt="AddaxAI Connect" className="h-7 w-auto shrink-0" />
          </div>
        </div>

        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          {children}
        </div>
      </main>

      {/* One-time install discovery hint. Lives here so it only shows after
          login, never on the shared demo login page. */}
      <InstallHint />
    </div>
  );
};
