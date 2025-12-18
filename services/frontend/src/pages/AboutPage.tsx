/**
 * About page - placeholder
 */
import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Camera } from 'lucide-react';

export const AboutPage: React.FC = () => {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">About AddaxAI Connect</h1>

      <Card>
        <CardHeader>
          <div className="flex items-center space-x-3">
            <Camera className="h-8 w-8 text-primary" />
            <CardTitle>AddaxAI Connect v0.1.0</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h3 className="font-semibold mb-2">Project Description</h3>
            <p className="text-sm text-muted-foreground">
              AddaxAI Connect is a containerized microservices platform for processing camera trap images
              through machine learning models. The system automatically ingests images from remote camera traps
              via FTPS, runs object detection and species classification, and provides real-time updates via
              a web interface.
            </p>
          </div>

          <div>
            <h3 className="font-semibold mb-2">A Collaboration</h3>
            <p className="text-sm text-muted-foreground">
              Between <strong>Addax Data Science</strong> and <strong>Smart Parks</strong>
            </p>
          </div>

          <div>
            <h3 className="font-semibold mb-2">Technology Stack</h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• Backend: Python, FastAPI, PostgreSQL with PostGIS</li>
              <li>• ML Pipeline: MegaDetector v1000, DeepFaune v1.4</li>
              <li>• Frontend: React, TypeScript, Tailwind CSS</li>
              <li>• Infrastructure: Docker Compose, MinIO, Redis, Prometheus</li>
            </ul>
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
    </div>
  );
};
