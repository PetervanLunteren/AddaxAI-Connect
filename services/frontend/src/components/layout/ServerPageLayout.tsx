/**
 * Shared layout for server administration pages
 * Provides consistent header with back button and page title
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '../ui/Button';

interface ServerPageLayoutProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

export const ServerPageLayout: React.FC<ServerPageLayoutProps> = ({
  title,
  description,
  children
}) => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="container mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/projects')}
              className="flex items-center gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Back to Projects</span>
              <span className="sm:hidden">Back</span>
            </Button>
            <div className="border-l pl-4 ml-2">
              <h1 className="text-xl sm:text-2xl font-bold">{title}</h1>
              {description && (
                <p className="text-sm text-muted-foreground mt-1 hidden sm:block">
                  {description}
                </p>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {children}
      </main>
    </div>
  );
};
