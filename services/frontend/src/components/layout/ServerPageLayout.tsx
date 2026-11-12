/**
 * Shared layout for every page outside a project: the Projects page, the
 * server administration pages, About and Account. The top bar, then the page
 * title with its caption, then the page.
 *
 * All of them go through here, so the title, the caption and the spacing are
 * in the same place on each and nothing moves when switching between them.
 */
import React from 'react';
import { TopBar, TopBarLogo } from './TopBar';

interface ServerPageLayoutProps {
  title: string;
  description?: string;
  /** The page's main action, right of the title, for example "Add project" */
  action?: React.ReactNode;
  children: React.ReactNode;
}

export const ServerPageLayout: React.FC<ServerPageLayoutProps> = ({
  title,
  description,
  action,
  children
}) => (
  <div className="min-h-screen bg-background">
    <TopBar left={<TopBarLogo />} />

    <main className="container mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          {description && (
            <p className="text-muted-foreground mt-1">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </main>
  </div>
);
