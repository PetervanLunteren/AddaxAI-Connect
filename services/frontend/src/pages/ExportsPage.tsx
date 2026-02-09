/**
 * Exports page for downloading project data in standardized formats
 */
import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Download, Loader2, AlertCircle, Package, Table, MapPin } from 'lucide-react';
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

type ObservationFormat = 'csv' | 'xlsx' | 'tsv';
type SpatialFormat = 'geojson' | 'shapefile' | 'gpkg';

export const ExportsPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const projectIdNum = parseInt(projectId || '0', 10);
  const { selectedProject } = useProject();

  const [observationFormat, setObservationFormat] = useState<ObservationFormat>('csv');
  const [isExportingObs, setIsExportingObs] = useState(false);
  const [obsError, setObsError] = useState<string | null>(null);
  const [spatialFormat, setSpatialFormat] = useState<SpatialFormat>('geojson');
  const [isExportingSpatial, setIsExportingSpatial] = useState(false);
  const [spatialError, setSpatialError] = useState<string | null>(null);
  const [includeMedia, setIncludeMedia] = useState(true);
  const [isExportingDP, setIsExportingDP] = useState(false);
  const [dpError, setDpError] = useState<string | null>(null);

  const projectSlug = (selectedProject?.name || 'project')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-');
  const today = new Date().toISOString().split('T')[0];

  const handleDownloadObservations = async () => {
    if (!projectIdNum) return;

    setIsExportingObs(true);
    setObsError(null);

    try {
      const blob = await exportApi.downloadObservations(projectIdNum, observationFormat);
      downloadBlob(blob, `observations-${projectSlug}-${today}.${observationFormat}`);
    } catch (err: any) {
      setObsError(await extractErrorMessage(err));
    } finally {
      setIsExportingObs(false);
    }
  };

  const handleDownloadSpatial = async () => {
    if (!projectIdNum) return;

    setIsExportingSpatial(true);
    setSpatialError(null);

    const extensions: Record<SpatialFormat, string> = {
      geojson: 'geojson',
      shapefile: 'zip',
      gpkg: 'gpkg',
    };

    try {
      const blob = await exportApi.downloadSpatial(projectIdNum, spatialFormat);
      downloadBlob(blob, `spatial-${projectSlug}-${today}.${extensions[spatialFormat]}`);
    } catch (err: any) {
      setSpatialError(await extractErrorMessage(err));
    } finally {
      setIsExportingSpatial(false);
    }
  };

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

  const formatOptions: { value: ObservationFormat; label: string }[] = [
    { value: 'csv', label: 'CSV' },
    { value: 'xlsx', label: 'XLSX' },
    { value: 'tsv', label: 'TSV' },
  ];

  const spatialFormatOptions: { value: SpatialFormat; label: string }[] = [
    { value: 'geojson', label: 'GeoJSON' },
    { value: 'shapefile', label: 'Shapefile' },
    { value: 'gpkg', label: 'GeoPackage' },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-0">Exports</h1>
      <p className="text-sm text-gray-600 mt-1 mb-6">Export your project data in standardized formats</p>

      <div className="space-y-6">
        {/* Observations export card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Table className="h-5 w-5" />
              <CardTitle>Observations</CardTitle>
            </div>
            <CardDescription>
              Species observations spreadsheet (one row per species per image).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {obsError && (
              <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {obsError}
              </div>
            )}

            <div className="flex items-center justify-between gap-4">
              <div className="inline-flex rounded-md overflow-hidden border border-input">
                {formatOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setObservationFormat(opt.value)}
                    className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                      observationFormat === opt.value
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background text-foreground hover:bg-secondary'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <button
                onClick={handleDownloadObservations}
                disabled={isExportingObs}
                className="px-6 py-1.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2 transition-colors"
              >
                {isExportingObs ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Preparing export...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    Download {observationFormat.toUpperCase()}
                  </>
                )}
              </button>
            </div>
          </CardContent>
        </Card>

        {/* Spatial export card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              <CardTitle>Spatial</CardTitle>
            </div>
            <CardDescription>
              Geographic point data for GIS tools (QGIS, ArcGIS).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {spatialError && (
              <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {spatialError}
              </div>
            )}

            <div className="flex items-center justify-between gap-4">
              <div className="inline-flex rounded-md overflow-hidden border border-input">
                {spatialFormatOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setSpatialFormat(opt.value)}
                    className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                      spatialFormat === opt.value
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background text-foreground hover:bg-secondary'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <button
                onClick={handleDownloadSpatial}
                disabled={isExportingSpatial}
                className="px-6 py-1.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2 transition-colors"
              >
                {isExportingSpatial ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Preparing export...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    Download {spatialFormatOptions.find(o => o.value === spatialFormat)?.label}
                  </>
                )}
              </button>
            </div>
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
              Camera Trap Data Package for sharing with GBIF and biodiversity platforms.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {dpError && (
              <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {dpError}
              </div>
            )}

            <div className="flex items-center justify-between gap-4">
              <Checkbox
                id="include-media"
                checked={includeMedia}
                onChange={setIncludeMedia}
                label="Include thumbnails"
              />

              <button
                onClick={handleDownloadCamtrapDP}
                disabled={isExportingDP}
                className="px-6 py-1.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2 transition-colors"
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
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
