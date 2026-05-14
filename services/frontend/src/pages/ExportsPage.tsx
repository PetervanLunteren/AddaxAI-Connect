/**
 * Exports page for downloading project data in standardized formats.
 *
 * One Card with a row per export. Each row has a bold title and muted
 * description on the left and a single Download button on the right
 * that opens a dropdown of format options. The dropdown pattern is
 * used even for single-option exports so the page reads as one tidy
 * column of consistent controls.
 */
import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Download, Loader2, AlertCircle, ChevronDown } from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../components/ui/DropdownMenu';
import { useProject } from '../contexts/ProjectContext';
import { exportApi } from '../api/export';
import { statisticsApi } from '../api/statistics';

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

interface DownloadOption {
  value: string;
  label: string;
}

interface DownloadDropdownProps {
  options: DownloadOption[];
  onSelect: (value: string) => void;
  isLoading: boolean;
}

function DownloadDropdown({ options, onSelect, isLoading }: DownloadDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" disabled={isLoading} className="gap-2">
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Preparing export...
            </>
          ) : (
            <>
              <Download className="h-4 w-4" />
              Download
              <ChevronDown className="h-4 w-4" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {options.map((opt) => (
          <DropdownMenuItem key={opt.value} onClick={() => onSelect(opt.value)}>
            {opt.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ExportRowProps {
  title: string;
  description: React.ReactNode;
  options: DownloadOption[];
  isLoading: boolean;
  onSelect: (value: string) => void;
  error: string | null;
}

function ExportRow({ title, description, options, isLoading, onSelect, error }: ExportRowProps) {
  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-8">
        <div className="w-full sm:w-1/2 sm:shrink-0">
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
        <div className="flex-1 sm:flex sm:justify-end">
          <DownloadDropdown options={options} onSelect={onSelect} isLoading={isLoading} />
        </div>
      </div>
      {error && (
        <div className="mt-3 flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
}

const OBSERVATION_OPTIONS: DownloadOption[] = [
  { value: 'csv', label: 'CSV' },
  { value: 'xlsx', label: 'XLSX' },
  { value: 'tsv', label: 'TSV' },
];
const CAMERAS_OPTIONS = OBSERVATION_OPTIONS;
const SPATIAL_OPTIONS: DownloadOption[] = [
  { value: 'geojson', label: 'GeoJSON' },
  { value: 'shapefile', label: 'Shapefile' },
  { value: 'gpkg', label: 'GeoPackage' },
];
const CAMTRAP_DP_OPTIONS: DownloadOption[] = [
  { value: 'metadata', label: 'Metadata only' },
  { value: 'with-thumbnails', label: 'Metadata and thumbnails' },
];
const DETECTION_HISTORY_OPTIONS: DownloadOption[] = [{ value: 'csv', label: 'CSV' }];

type ObservationFormat = 'csv' | 'xlsx' | 'tsv';
type CamerasFormat = 'csv' | 'xlsx' | 'tsv';
type SpatialFormat = 'geojson' | 'shapefile' | 'gpkg';

const SPATIAL_EXTENSIONS: Record<SpatialFormat, string> = {
  geojson: 'geojson',
  shapefile: 'zip',
  gpkg: 'gpkg',
};

export const ExportsPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const projectIdNum = parseInt(projectId || '0', 10);
  const { selectedProject } = useProject();

  const [isExportingObs, setIsExportingObs] = useState(false);
  const [obsError, setObsError] = useState<string | null>(null);
  const [isExportingCameras, setIsExportingCameras] = useState(false);
  const [camerasError, setCamerasError] = useState<string | null>(null);
  const [isExportingSpatial, setIsExportingSpatial] = useState(false);
  const [spatialError, setSpatialError] = useState<string | null>(null);
  const [isExportingDP, setIsExportingDP] = useState(false);
  const [dpError, setDpError] = useState<string | null>(null);
  const [isExportingDh, setIsExportingDh] = useState(false);
  const [dhError, setDhError] = useState<string | null>(null);

  const projectSlug = (selectedProject?.name || 'project')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-');
  const today = new Date().toISOString().split('T')[0];

  const handleObservations = async (format: string) => {
    if (!projectIdNum) return;
    setIsExportingObs(true);
    setObsError(null);
    try {
      const blob = await exportApi.downloadObservations(projectIdNum, format as ObservationFormat);
      downloadBlob(blob, `observations-${projectSlug}-${today}.${format}`);
    } catch (err: any) {
      setObsError(await extractErrorMessage(err));
    } finally {
      setIsExportingObs(false);
    }
  };

  const handleCameras = async (format: string) => {
    if (!projectIdNum) return;
    setIsExportingCameras(true);
    setCamerasError(null);
    try {
      const blob = await exportApi.downloadCameras(projectIdNum, format as CamerasFormat);
      downloadBlob(blob, `cameras-${projectSlug}-${today}.${format}`);
    } catch (err: any) {
      setCamerasError(await extractErrorMessage(err));
    } finally {
      setIsExportingCameras(false);
    }
  };

  const handleSpatial = async (format: string) => {
    if (!projectIdNum) return;
    setIsExportingSpatial(true);
    setSpatialError(null);
    try {
      const fmt = format as SpatialFormat;
      const blob = await exportApi.downloadSpatial(projectIdNum, fmt);
      downloadBlob(blob, `spatial-${projectSlug}-${today}.${SPATIAL_EXTENSIONS[fmt]}`);
    } catch (err: any) {
      setSpatialError(await extractErrorMessage(err));
    } finally {
      setIsExportingSpatial(false);
    }
  };

  const handleCamtrapDP = async (selection: string) => {
    if (!projectIdNum) return;
    const includeMedia = selection === 'with-thumbnails';
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

  const handleDetectionHistory = async (_value: string) => {
    if (!projectIdNum) return;
    setIsExportingDh(true);
    setDhError(null);
    try {
      const overview = await statisticsApi.getOverview(projectIdNum);
      if (!overview.first_image_date || !overview.last_image_date) {
        throw new Error('No images available to build a detection history');
      }
      const { blob, filename } = await statisticsApi.downloadDetectionHistoryCsv(
        projectIdNum,
        overview.first_image_date,
        overview.last_image_date,
        { occasionLengthDays: 1 },
      );
      downloadBlob(blob, filename);
    } catch (err: any) {
      setDhError(await extractErrorMessage(err));
    } finally {
      setIsExportingDh(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-0">Exports</h1>
      <p className="text-sm text-gray-600 mt-1 mb-6">
        Export your project data in standardized formats
      </p>

      <Card>
        <CardContent className="pt-6">
          <ExportRow
            title="Observations"
            description="Species observations spreadsheet (one row per species per image)."
            options={OBSERVATION_OPTIONS}
            isLoading={isExportingObs}
            onSelect={handleObservations}
            error={obsError}
          />

          <div className="border-t my-6" />

          <ExportRow
            title="Cameras"
            description="Cameras list with identity, last health snapshot, and any custom fields (one row per camera)."
            options={CAMERAS_OPTIONS}
            isLoading={isExportingCameras}
            onSelect={handleCameras}
            error={camerasError}
          />

          <div className="border-t my-6" />

          <ExportRow
            title="Spatial"
            description="Geographic point data for GIS tools (QGIS, ArcGIS)."
            options={SPATIAL_OPTIONS}
            isLoading={isExportingSpatial}
            onSelect={handleSpatial}
            error={spatialError}
          />

          <div className="border-t my-6" />

          <ExportRow
            title="Detection history (R)"
            description={
              <>
                Site by occasion presence/absence matrix for occupancy analysis in R with{' '}
                <code className="bg-muted px-1 py-0.5 rounded">unmarked</code> or{' '}
                <code className="bg-muted px-1 py-0.5 rounded">camtrapR</code>.
              </>
            }
            options={DETECTION_HISTORY_OPTIONS}
            isLoading={isExportingDh}
            onSelect={handleDetectionHistory}
            error={dhError}
          />

          <div className="border-t my-6" />

          <ExportRow
            title="Camtrap DP"
            description="Camera Trap Data Package for sharing with GBIF and biodiversity platforms."
            options={CAMTRAP_DP_OPTIONS}
            isLoading={isExportingDP}
            onSelect={handleCamtrapDP}
            error={dpError}
          />
        </CardContent>
      </Card>
    </div>
  );
};
