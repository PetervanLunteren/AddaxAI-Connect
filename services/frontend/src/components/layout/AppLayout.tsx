/**
 * Main application layout with sidebar
 */
import React, { useState } from 'react';
import { Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { TopBar, TopBarLogo } from './TopBar';
import { DevServerBanner } from '../DevServerBanner';
import { InstallHint } from '../InstallApp';

interface AppLayoutProps {
  children: React.ReactNode;
}

// The page's content column. The top bar uses the same one, so the avatar
// lines up with the page.
const PAGE_COLUMN = 'mx-auto max-w-7xl px-4 sm:px-6 lg:px-8';

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="lg:pl-64 min-h-screen">
        <DevServerBanner />
        {/* On a phone the bar also opens the navigation and shows the logo.
            On desktop the sidebar does both, and the bar holds the account
            menu only. */}
        <TopBar
          columnClassName={PAGE_COLUMN}
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

        <div className={`${PAGE_COLUMN} py-6 sm:py-8`}>
          {children}
        </div>
      </main>

      {/* One-time install discovery hint. Lives here so it only shows after
          login, never on the shared demo login page. */}
      <InstallHint />
    </div>
  );
};
