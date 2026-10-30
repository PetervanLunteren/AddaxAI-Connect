/**
 * About page
 *
 * Server-level page showing system information, version and the AI models,
 * with the credits their licences ask for.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader, CardContent } from '../components/ui/Card';
import { ExternalLink, Tag } from 'lucide-react';
import { ServerPageLayout } from '../components/layout/ServerPageLayout';
import { versionApi } from '../api/version';
import { classificationModelsApi } from '../api/classificationModels';

const linkClass = 'text-primary hover:underline inline-flex items-center gap-0.5';

export const AboutPage: React.FC = () => {
  // Fetch version from API
  const { data: version, isLoading } = useQuery({
    queryKey: ['version'],
    queryFn: versionApi.getVersion,
    staleTime: Infinity,
  });

  // Every model a project can pick, for the credits
  const { data: models } = useQuery({
    queryKey: ['classification-models'],
    queryFn: classificationModelsApi.list,
    staleTime: Infinity,
  });

  return (
    <ServerPageLayout
      title="About"
      description="System information and version"
    >
      <Card>
        <CardHeader>
          <img src="/logo-wide.png" alt="AddaxAI Connect" className="h-20 w-auto self-start" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h3 className="font-semibold mb-2">Version</h3>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-sm font-mono bg-gray-100 text-gray-700 border border-gray-200">
              <Tag className="h-3.5 w-3.5" />
              {isLoading || !version
                ? '...'
                : version.commit === 'unknown'
                  ? version.version
                  : `${version.version} (${version.commit})`}
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
                className={linkClass}
              >
                MegaDetector v1000.0.0
                <ExternalLink className="h-3 w-3" />
              </a>
              , a general-purpose object detection model trained on camera trap imagery, to locate animals, people, and vehicles. Detected animals are then passed to the species model each project picked at creation. The models a project can pick, with their makers and licences
            </p>
            <ul className="text-sm text-muted-foreground mt-2 space-y-1">
              {(models ?? []).map((model) => (
                <li key={model.id}>
                  {model.emoji}{' '}
                  <a href={model.info_url} target="_blank" rel="noopener noreferrer" className={linkClass}>
                    {model.name}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  {' '}by {model.developer},{' '}
                  <a href={model.licence_url} target="_blank" rel="noopener noreferrer" className={linkClass}>
                    licence
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="font-semibold mb-2">Collaboration</h3>
            <p className="text-sm text-muted-foreground">
              A joint project by{' '}
              <a
                href="https://addaxdatascience.com/"
                target="_blank"
                rel="noopener noreferrer"
                className={linkClass}
              >
                Addax Data Science
                <ExternalLink className="h-3 w-3" />
              </a>
              {' '}and{' '}
              <a
                href="https://www.smartparks.org/"
                target="_blank"
                rel="noopener noreferrer"
                className={linkClass}
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
                  href="https://connect.addaxai.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  AddaxAI Connect documentation
                  <ExternalLink className="h-3 w-3" />
                </a>
              </p>
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
