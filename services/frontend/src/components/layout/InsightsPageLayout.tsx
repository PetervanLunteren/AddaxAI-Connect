/**
 * Shared shell for pages under /insights.
 *
 * Sits inside AppLayout (so the sidebar is still there) and provides the
 * title row + main container that every Insights page wears. Mirrors the
 * pattern used by AddaxAI WebUI's insights pages so the two products feel
 * the same in this section.
 */
import React from 'react';

interface InsightsPageLayoutProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export const InsightsPageLayout: React.FC<InsightsPageLayoutProps> = ({
  title,
  subtitle,
  actions,
  children,
}) => {
  return (
    <div className="-mx-4 -my-6 sm:-mx-6 sm:-my-8 lg:-mx-8">
      <header className="border-b bg-card/80 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
              {subtitle && (
                <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
              )}
            </div>
            {actions}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
        {children}
      </main>
    </div>
  );
};
