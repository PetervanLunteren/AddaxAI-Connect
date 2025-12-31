/**
 * Server-level layout with sidebar for admin/server pages
 */
import React, { useState } from 'react';
import { ServerSidebar, MobileMenuButton } from './ServerSidebar';

interface ServerLayoutProps {
  children: React.ReactNode;
}

export const ServerLayout: React.FC<ServerLayoutProps> = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar */}
      <ServerSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Mobile menu button */}
      <MobileMenuButton onClick={() => setSidebarOpen(true)} />

      {/* Main content */}
      <main className="lg:pl-64 min-h-screen">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          {children}
        </div>
      </main>
    </div>
  );
};
