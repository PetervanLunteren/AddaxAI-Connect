/**
 * Exports page for downloading project data in standardized formats
 */
import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Download, Loader2, AlertCircle, Package, Table } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card';
import { Checkbox } from '../components/ui/Checkbox';
import { useProject } from '../contexts/ProjectContext';
import { exportApi } from '../api/export';

/**
 * Trigger a file download from a blob response.
 */
function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

/**
 * Extract an error message from a failed blob response.
 */
async function extractErrorMessage(err: any): Promise<string> {
  if (err.response?.data instanceof Blob) {
    try {
      const text = await err.response.data.text();
      const json = JSON.parse(text);
      return json.detail || 'Export failed';
    } catch {
      return 'Export failed. Please try again.';
    }
  }
  return err.response?.data?.detail || err.message || 'Export failed';
}

export const ExportsPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const projectIdNum = parseInt(projectId || '0', 10);
  const { selectedProject } = useProject();

  const [includeMedia, setIncludeMedia] = useState(true);
  const [isExportingDP, setIsExportingDP] = useState(false);
  const [dpError, setDpError] = useState<string | null>(null);
  const [isExportingCSV, setIsExportingCSV] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);

  const projectSlug = (selectedProject?.name || 'project')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-');
  const today = new Date().toISOString().split('T')[0];

  const handleDownloadCamtrapDP = async () => {
    if (!projectIdNum) return;

    setIsExportingDP(true);
    setDpError(null);

    try {
      const blob = await exportApi.downloadCamtrapDP(projectIdNum, includeMedia);
      downloadBlob(blob, `camtrap-dp-${projectSlug}-${today}.zip`);
    } catch (err: any) {
      setDpError(await extractErrorMessage(err));
    } finally {
      setIsExportingDP(false);
    }
  };

  const handleDownloadCSV = async () => {
    if (!projectIdNum) return;

    setIsExportingCSV(true);
    setCsvError(null);

    try {
      const blob = await exportApi.downloadCSV(projectIdNum);
      downloadBlob(blob, `observations-${projectSlug}-${today}.csv`);
    } catch (err: any) {
      setCsvError(await extractErrorMessage(err));
    } finally {
      setIsExportingCSV(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-0">Exports</h1>
      <p className="text-sm text-gray-600 mt-1 mb-6">Export your project data in standardized formats</p>

      <div className="space-y-6">
        {/* CSV export card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Table className="h-5 w-5" />
              <CardTitle>CSV</CardTitle>
            </div>
            <CardDescription>
              Simple observations spreadsheet for analysis in Excel or R.
              One row per species per image, including species, count, confidence, location, and verification status.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {csvError && (
              <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {csvError}
              </div>
            )}

            <button
              onClick={handleDownloadCSV}
              disabled={isExportingCSV}
              className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2 transition-colors"
            >
              {isExportingCSV ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Preparing export...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  Download CSV
                </>
              )}
            </button>
          </CardContent>
        </Card>

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

            {dpError && (
              <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {dpError}
              </div>
            )}

            <button
              onClick={handleDownloadCamtrapDP}
              disabled={isExportingDP}
              className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2 transition-colors"
            >
              {isExportingDP ? (
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
      </div>
    </div>
  );
};
