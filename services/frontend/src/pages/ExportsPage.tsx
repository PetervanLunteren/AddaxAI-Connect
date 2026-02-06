/**
 * Exports page for downloading project data in standardized formats
 */
import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Download, Loader2, AlertCircle, Package } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card';
import { Checkbox } from '../components/ui/Checkbox';
import { useProject } from '../contexts/ProjectContext';
import { exportApi } from '../api/export';

export const ExportsPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const projectIdNum = parseInt(projectId || '0', 10);
  const { selectedProject } = useProject();

  const [includeMedia, setIncludeMedia] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownloadCamtrapDP = async () => {
    if (!projectIdNum) return;

    setIsExporting(true);
    setError(null);

    try {
      const blob = await exportApi.downloadCamtrapDP(projectIdNum, includeMedia);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;

      const projectSlug = (selectedProject?.name || 'project')
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_]+/g, '-');
      const today = new Date().toISOString().split('T')[0];
      a.download = `camtrap-dp-${projectSlug}-${today}.zip`;

      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      // Try to extract error message from blob response
      if (err.response?.data instanceof Blob) {
        try {
          const text = await err.response.data.text();
          const json = JSON.parse(text);
          setError(json.detail || 'Export failed');
        } catch {
          setError('Export failed. Please try again.');
        }
      } else {
        setError(err.response?.data?.detail || err.message || 'Export failed');
      }
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-0">Exports</h1>
      <p className="text-sm text-gray-600 mt-1 mb-6">Export your project data in standardized formats</p>

      <div className="space-y-6">
        {/* CamTrap DP export card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              <CardTitle>CamTrap DP</CardTitle>
            </div>
            <CardDescription>
              Camera Trap Data Package — the standard format for sharing camera trap data with GBIF and other biodiversity platforms.
              The export includes deployment periods, image metadata, and species observations (AI detections, human verifications, and blanks).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Checkbox
              id="include-media"
              checked={includeMedia}
              onChange={setIncludeMedia}
              label="Include thumbnail images in the package"
            />
            <p className="text-sm text-muted-foreground ml-8 -mt-2">
              Adds thumbnail images to the ZIP file (~10-20 MB for a typical project).
              Without thumbnails, the package contains metadata only.
            </p>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {error}
              </div>
            )}

            <button
              onClick={handleDownloadCamtrapDP}
              disabled={isExporting}
              className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2 transition-colors"
            >
              {isExporting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Preparing export...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  Download CamTrap DP
                </>
              )}
            </button>
          </CardContent>
        </Card>

        {/* Placeholder for future formats */}
        <Card className="opacity-60">
          <CardHeader>
            <CardTitle>More formats coming soon</CardTitle>
            <CardDescription>
              CSV, Excel, JSON, and image exports will be available here in a future update.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
};
