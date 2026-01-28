/**
 * About page
 *
 * Server-level page showing system information and version
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Camera } from 'lucide-react';
import { ServerPageLayout } from '../components/layout/ServerPageLayout';
import { versionApi } from '../api/version';

export const AboutPage: React.FC = () => {
  // Fetch version from API
  const { data: version, isLoading } = useQuery({
    queryKey: ['version'],
    queryFn: versionApi.getVersion,
    staleTime: Infinity, // Version doesn't change during runtime
  });

  return (
    <ServerPageLayout
      title="About"
      description="System information and version"
    >
      <Card>
        <CardHeader>
          <div className="flex items-center space-x-3">
            <Camera className="h-8 w-8 text-primary" />
            <CardTitle>
              AddaxAI Connect {isLoading ? '...' : version || 'v0.1.0'}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h3 className="font-semibold mb-2">Project Description</h3>
            <p className="text-sm text-muted-foreground">
              AddaxAI Connect is an open-source platform that helps wildlife conservationists monitor and protect endangered species. By automatically analyzing camera trap images with AI, it enables conservation teams to track wildlife populations and respond quickly to threats in protected areas.
            </p>
          </div>

          <div>
            <h3 className="font-semibold mb-2">A Collaboration</h3>
            <p className="text-sm text-muted-foreground">
              Between <strong>Addax Data Science</strong> and <strong>Smart Parks</strong>
            </p>
          </div>

          <div>
            <h3 className="font-semibold mb-2">Links</h3>
            <div className="space-y-2">
              <p className="text-sm">
                <a
                  href="https://github.com/PetervanLunteren/addaxai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  AddaxAI GitHub Repository
                </a>
              </p>
              <p className="text-sm">
                <a
                  href="https://addaxdatascience.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Addax Data Science
                </a>
              </p>
              <p className="text-sm">
                <a
                  href="https://www.smartparks.org"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Smart Parks
                </a>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </ServerPageLayout>
  );
};
