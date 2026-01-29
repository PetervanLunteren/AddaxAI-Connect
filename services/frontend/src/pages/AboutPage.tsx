/**
 * About page
 *
 * Server-level page showing system information and version
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Camera, ExternalLink, Tag } from 'lucide-react';
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
              AddaxAI Connect
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h3 className="font-semibold mb-2">Version</h3>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-sm font-mono bg-gray-100 text-gray-700 border border-gray-200">
              <Tag className="h-3.5 w-3.5" />
              {isLoading ? '...' : version || 'v0.1.0'}
            </div>
          </div>

          <div>
            <h3 className="font-semibold mb-2">Project description</h3>
            <p className="text-sm text-muted-foreground">
              AddaxAI Connect is an open-source platform that helps wildlife conservationists monitor and protect biodiversity. By automatically analyzing camera trap images with AI, it enables conservation teams to track wildlife populations and respond quickly to threats in protected areas.
            </p>
          </div>

          <div>
            <h3 className="font-semibold mb-2">AI Models</h3>
            <p className="text-sm text-muted-foreground">
              AddaxAI Connect employs{' '}
              <a
                href="https://github.com/agentmorris/MegaDetector"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-0.5"
              >
                MegaDetector v1000.0.0
                <ExternalLink className="h-3 w-3" />
              </a>
              , a general-purpose object detection model trained on camera trap imagery, to locate animals, people, and vehicles. Detected animals are then passed to{' '}
              <a
                href="https://www.deepfaune.cnrs.fr/en/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-0.5"
              >
                DeepFaune v1.4
                <ExternalLink className="h-3 w-3" />
              </a>
              , a species classification model, to determine the specific wildlife species present in each image.
            </p>
          </div>

          <div>
            <h3 className="font-semibold mb-2">A collaboration</h3>
            <p className="text-sm text-muted-foreground">
              Between{' '}
              <a
                href="https://addaxdatascience.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-0.5"
              >
                Addax Data Science
                <ExternalLink className="h-3 w-3" />
              </a>
              {' '}and{' '}
              <a
                href="https://www.smartparks.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-0.5"
              >
                Smart Parks
                <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          </div>

          <div>
            <h3 className="font-semibold mb-2">Links</h3>
            <div className="space-y-2">
              <p className="text-sm">
                <a
                  href="https://github.com/PetervanLunteren/AddaxAI-Connect"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  AddaxAI Connect GitHub repository
                  <ExternalLink className="h-3 w-3" />
                </a>
              </p>
              <p className="text-sm">
                <a
                  href="https://github.com/PetervanLunteren/AddaxAI"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  AddaxAI GitHub repository
                  <ExternalLink className="h-3 w-3" />
                </a>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </ServerPageLayout>
  );
};
