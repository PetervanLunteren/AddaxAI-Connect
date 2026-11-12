/**
 * Shared layout for the pages outside a project: the server administration
 * pages, About and Account. The top bar, then the page title with a link
 * back to the projects, then the page.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { TopBar, TopBarLogo } from './TopBar';

interface ServerPageLayoutProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

// The page's content column. The top bar uses the same one, so the logo and
// the avatar line up with the page.
const PAGE_COLUMN = 'container mx-auto px-4 sm:px-6';

export const ServerPageLayout: React.FC<ServerPageLayoutProps> = ({
  title,
  description,
  children
}) => (
  <div className="min-h-screen bg-background">
    <TopBar left={<TopBarLogo />} columnClassName={PAGE_COLUMN} />

    <main className={`${PAGE_COLUMN} py-6 sm:py-8`}>
      <div className="mb-6">
        <Link
          to="/projects"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to projects
        </Link>
        <h1 className="mt-2 text-2xl font-bold">{title}</h1>
        {description && (
          <p className="text-muted-foreground mt-1">{description}</p>
        )}
      </div>
      {children}
    </main>
  </div>
);
