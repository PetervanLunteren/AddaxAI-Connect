/**
 * Cameras page with health status table and management functionality
 *
 * All users can view camera health metrics.
 * Server admins can add, delete cameras and import from CSV.
 * Project admins can edit camera notes (friendly name, remarks).
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Battery,
  ExternalLink,
  Camera as CameraIcon,
  HardDrive,
  Activity,
  Plus,
  Upload,
  Loader2,
  CheckCircle,
  XCircle,
  Map as MapIcon,
  Table as TableIcon,
  Search,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/Table';
import { Button } from '../components/ui/Button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../components/ui/Dialog';
import { useProject } from '../contexts/ProjectContext';
import { CameraDetailSheet } from '../components/CameraDetailSheet';
import {
  camerasApi,
  type CreateCameraRequest,
  type BulkImportResponse,
} from '../api/cameras';
import type { Camera } from '../api/types';
import { CameraMapView } from '../components/cameras/CameraMapView';
import { CameraFilters, defaultCameraFilters, type CameraFilterState } from '../components/CameraFilters';
import type { Option } from '../components/ui/MultiSelect';
import { cn } from '../lib/utils';
import { useDropzone } from 'react-dropzone';

type SortColumn = 'name' | 'tags' | 'status' | 'battery' | 'signal' | 'sd_used' | 'last_report' | 'last_image' | 'location' | 'device_id';

const SortableHeader: React.FC<{
  label: string;
  column: SortColumn;
  sort: { column: SortColumn | null; direction: 'asc' | 'desc' };
  onSort: (column: SortColumn) => void;
}> = ({ label, column, sort, onSort }) => {
  const isActive = sort.column === column;
  return (
    <button
      type="button"
      className="flex items-center gap-1 hover:text-foreground transition-colors -my-1"
      onClick={() => onSort(column)}
    >
      {label}
      {isActive ? (
        sort.direction === 'asc'
          ? <ArrowUp className="h-3.5 w-3.5" />
          : <ArrowDown className="h-3.5 w-3.5" />
      ) : (
        <ArrowUpDown className="h-3.5 w-3.5 opacity-30" />
      )}
    </button>
  );
};

export const CamerasPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { selectedProject: currentProject, canAdminCurrentProject, isServerAdmin } = useProject();

  // View mode state (table or map)
  const [viewMode, setViewMode] = useState<'table' | 'map'>(() => {
    const saved = localStorage.getItem('cameras-view-mode');
    return saved === 'map' || saved === 'table' ? saved : 'table';
  });

  // Persist view mode preference
  useEffect(() => {
    localStorage.setItem('cameras-view-mode', viewMode);
  }, [viewMode]);

  // Side panel state
  const [selectedCamera, setSelectedCamera] = useState<Camera | null>(null);
  const [showDetailSheet, setShowDetailSheet] = useState(false);

  // Add camera dialog state
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newCameraDeviceId, setNewCameraDeviceId] = useState('');
  const [newCameraName, setNewCameraName] = useState('');
  const [newCameraNotes, setNewCameraNotes] = useState('');
  const [customFields, setCustomFields] = useState<{key: string, value: string}[]>([]);

  // CSV Import state
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importResults, setImportResults] = useState<BulkImportResponse | null>(null);

  // Filter/sort state
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<CameraFilterState>(defaultCameraFilters);
  const [sort, setSort] = useState<{ column: SortColumn | null; direction: 'asc' | 'desc' }>({
    column: null,
    direction: 'asc',
  });

  // Fetch cameras for current project
  const { data: cameras, isLoading } = useQuery({
    queryKey: ['cameras', currentProject?.id],
    queryFn: () => camerasApi.getAll(currentProject?.id),
    enabled: !!currentProject,
  });

  // Create camera mutation
  const createMutation = useMutation({
    mutationFn: camerasApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      setShowAddDialog(false);
      resetAddForm();
    },
    onError: (error: any) => {
      alert(`Failed to create camera: ${error.response?.data?.detail || error.message}`);
    },
  });

  // CSV Import mutation
  const importMutation = useMutation({
    mutationFn: ({ file, projectId }: { file: File; projectId?: number }) =>
      camerasApi.importCSV(file, projectId),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      setImportResults(data);
      setCsvFile(null);
    },
    onError: (error: any) => {
      alert(`Failed to import CSV: ${error.response?.data?.detail || error.message}`);
    },
  });

  const resetAddForm = () => {
    setNewCameraDeviceId('');
    setNewCameraName('');
    setNewCameraNotes('');
    setCustomFields([]);
  };

  const handleAddCamera = () => {
    if (!newCameraDeviceId.trim()) {
      alert('Camera ID is required');
      return;
    }
    if (!currentProject) {
      alert('Please select a project first');
      return;
    }

    // Build custom_fields from custom fields (skip empty keys)
    const custom_fields: Record<string, string> = {};
    for (const field of customFields) {
      const key = field.key.trim();
      const value = field.value.trim();
      if (key && value) {
        custom_fields[key] = value;
      }
    }

    const data: CreateCameraRequest = {
      device_id: newCameraDeviceId.trim(),
      friendly_name: newCameraName.trim() || undefined,
      notes: newCameraNotes.trim() || undefined,
      custom_fields: Object.keys(custom_fields).length > 0 ? custom_fields : undefined,
      project_id: currentProject.id,
    };

    createMutation.mutate(data);
  };

  const handleImportCSV = () => {
    if (!csvFile) {
      alert('Please select a CSV file');
      return;
    }
    if (!currentProject) {
      alert('Please select a project first');
      return;
    }
    importMutation.mutate({ file: csvFile, projectId: currentProject.id });
  };

  const onDropCsv = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setCsvFile(acceptedFiles[0]);
      setImportResults(null);
    }
  }, []);

  const { getRootProps: getCsvRootProps, getInputProps: getCsvInputProps, isDragActive: isCsvDragActive } = useDropzone({
    onDrop: onDropCsv,
    accept: { 'text/csv': ['.csv'] },
    multiple: false,
  });

  const openImportDialog = () => {
    setCsvFile(null);
    setImportResults(null);
    setShowImportDialog(true);
  };

  const handleRowClick = (camera: Camera) => {
    setSelectedCamera(camera);
    setShowDetailSheet(true);
  };

  // Tag options for filter popover
  const { data: allTags } = useQuery({
    queryKey: ['camera-tags', currentProject?.id],
    queryFn: () => camerasApi.getTags(currentProject?.id),
    enabled: !!currentProject,
  });
  const tagOptions: Option[] = (allTags || []).map((t) => ({ label: t, value: t }));

  const handleFilterChange = (key: keyof CameraFilterState, value: any) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const handleClearFilters = () => setFilters(defaultCameraFilters);

  const handleSort = (column: SortColumn) => {
    setSort((prev) =>
      prev.column === column
        ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { column, direction: 'asc' }
    );
  };

  // Helper functions for formatting
  const getStatusBadge = (status: string) => {
    const colors = {
      active: '#0f6064',
      inactive: '#882000',
      never_reported: '#71b7ba',
    };
    const labels = {
      active: 'Active',
      inactive: 'Inactive',
      never_reported: 'Never reported',
    };
    return (
      <span className="inline-flex items-center gap-1.5 text-sm">
        <span
          className="w-3 h-3 rounded-full"
          style={{ backgroundColor: colors[status as keyof typeof colors] }}
        />
        {labels[status as keyof typeof labels]}
      </span>
    );
  };

  const getBatteryColor = (percentage: number | null) => {
    if (percentage === null) return '#9ca3af';
    if (percentage > 70) return '#0f6064';
    if (percentage > 40) return '#71b7ba';
    return '#882000';
  };

  const getSignalLabel = (csq: number | null) => {
    if (csq === null) return 'N/A';
    if (csq >= 20) return 'Excellent';
    if (csq >= 15) return 'Good';
    if (csq >= 10) return 'Fair';
    if (csq >= 2) return 'Poor';
    return 'No signal';
  };

  const getSignalColor = (csq: number | null) => {
    if (csq === null) return '#9ca3af';
    if (csq >= 15) return '#0f6064';
    if (csq >= 10) return '#71b7ba';
    return '#882000';
  };

  const getSDColor = (sdUsed: number | null) => {
    if (sdUsed === null) return '#9ca3af';
    if (sdUsed < 50) return '#0f6064';      // Green: less than 50% used
    if (sdUsed < 80) return '#71b7ba';      // Teal: 50-80% used
    return '#882000';                        // Red: more than 80% used
  };

  const getTimestampColor = (timestamp: string | null) => {
    if (!timestamp) return '#9ca3af';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays <= 1) return '#0f6064';
    if (diffDays <= 7) return '#71b7ba';
    return '#882000';
  };

  const formatTimestamp = (timestamp: string | null) => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  const getGoogleMapsUrl = (location: { lat: number; lon: number }) => {
    return `https://www.google.com/maps?q=${location.lat},${location.lon}`;
  };

  // Filter + sort pipeline
  const filteredCameras = useMemo(() => {
    if (!cameras) return [];
    let result = [...cameras];

    // Text search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((c) => {
        const fields = [
          c.name,
          c.device_id,
          c.status,
          c.notes,
          ...(c.tags || []),
          ...(c.custom_fields ? Object.keys(c.custom_fields).concat(Object.values(c.custom_fields)) : []),
          getSignalLabel(c.signal_quality),
          formatTimestamp(c.last_report_timestamp),
          formatTimestamp(c.last_image_timestamp),
          c.location ? 'known' : 'unknown',
          c.battery_percentage !== null ? `${c.battery_percentage}%` : 'N/A',
          c.sd_utilization_percentage !== null ? `${Math.round(c.sd_utilization_percentage)}%` : 'N/A',
        ];
        return fields.some((f) => f && f.toLowerCase().includes(q));
      });
    }

    // Structured filters
    if (filters.status.length > 0) {
      const vals = new Set(filters.status.map((o) => o.value));
      result = result.filter((c) => vals.has(c.status));
    }
    if (filters.tags.length > 0) {
      const vals = new Set(filters.tags.map((o) => o.value));
      result = result.filter((c) => c.tags?.some((t) => vals.has(t)));
    }
    if (filters.battery) {
      result = result.filter((c) => {
        const b = c.battery_percentage;
        if (filters.battery === 'unknown') return b === null;
        if (b === null) return false;
        if (filters.battery === 'low') return b < 30;
        if (filters.battery === 'medium') return b >= 30 && b <= 70;
        return b > 70; // high
      });
    }
    if (filters.signal) {
      result = result.filter((c) => {
        const s = c.signal_quality;
        if (filters.signal === 'unknown') return s === null;
        if (s === null) return false;
        if (filters.signal === 'excellent') return s >= 20;
        if (filters.signal === 'good') return s >= 15 && s <= 19;
        if (filters.signal === 'fair') return s >= 10 && s <= 14;
        if (filters.signal === 'poor') return s >= 2 && s <= 9;
        return s <= 1; // no_signal
      });
    }
    if (filters.sd_usage) {
      result = result.filter((c) => {
        const sd = c.sd_utilization_percentage;
        if (filters.sd_usage === 'unknown') return sd === null;
        if (sd === null) return false;
        if (filters.sd_usage === 'low') return sd < 50;
        if (filters.sd_usage === 'medium') return sd >= 50 && sd <= 80;
        return sd > 80; // high
      });
    }
    if (filters.location) {
      result = result.filter((c) =>
        filters.location === 'known' ? c.location !== null : c.location === null
      );
    }

    // Sort (nulls last)
    if (sort.column) {
      const dir = sort.direction === 'asc' ? 1 : -1;
      result.sort((a, b) => {
        const getValue = (c: Camera): string | number | null => {
          switch (sort.column) {
            case 'name': return c.name.toLowerCase();
            case 'tags': return (c.tags || []).join(', ').toLowerCase() || null;
            case 'status': return c.status;
            case 'battery': return c.battery_percentage;
            case 'signal': return c.signal_quality;
            case 'sd_used': return c.sd_utilization_percentage;
            case 'last_report': return c.last_report_timestamp;
            case 'last_image': return c.last_image_timestamp;
            case 'location': return c.location ? 1 : 0;
            case 'device_id': return c.device_id?.toLowerCase() ?? null;
            default: return null;
          }
        };
        const va = getValue(a);
        const vb = getValue(b);
        if (va === null && vb === null) return 0;
        if (va === null) return 1;
        if (vb === null) return -1;
        if (va < vb) return -dir;
        if (va > vb) return dir;
        return 0;
      });
    }

    return result;
  }, [cameras, searchQuery, filters, sort]);

  const isFiltered = searchQuery.trim() !== '' ||
    filters.status.length > 0 || filters.tags.length > 0 ||
    !!filters.battery || !!filters.signal || !!filters.sd_usage || !!filters.location;

  if (!currentProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Please select a project to view cameras.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Header with title and admin actions */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-0">Cameras</h1>
          <p className="text-sm text-gray-600 mt-1">
            Monitor camera health, battery levels, and connectivity status
          </p>
        </div>
        {isServerAdmin && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={openImportDialog}>
              <Upload className="h-4 w-4 mr-2" />
              Import CSV
            </Button>
            <Button onClick={() => setShowAddDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add camera
            </Button>
          </div>
        )}
      </div>

      {/* Tab navigation */}
      <div className="flex border-b mb-6">
        <button
          onClick={() => setViewMode('table')}
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 transition-colors',
            viewMode === 'table'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          <TableIcon className="h-4 w-4" />
          Table
        </button>
        <button
          onClick={() => setViewMode('map')}
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 transition-colors',
            viewMode === 'map'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          <MapIcon className="h-4 w-4" />
          Map
        </button>
      </div>

      {/* Search + filters toolbar */}
      {cameras && cameras.length > 0 && (
        <div className="flex items-center gap-3 mb-4">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search cameras..."
              className="w-full h-9 pl-9 pr-3 border border-input rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <CameraFilters
            filters={filters}
            onFilterChange={handleFilterChange}
            onClearAll={handleClearFilters}
            tagOptions={tagOptions}
          />
          {isFiltered && (
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              {filteredCameras.length} of {cameras.length} cameras
            </span>
          )}
        </div>
      )}

      {/* Map view */}
      {viewMode === 'map' && cameras && (
        <CameraMapView cameras={filteredCameras} onCameraClick={handleRowClick} />
      )}

      {/* Table view content */}
      {viewMode === 'table' && (
        <>
          {/* Summary Statistics */}
          {cameras && cameras.length > 0 && (() => {
        const activeCount = filteredCameras.filter((c: Camera) => c.status === 'active').length;
        const inactiveCount = filteredCameras.filter((c: Camera) => c.status === 'inactive').length;
        const neverReportedCount = filteredCameras.filter((c: Camera) => c.status === 'never_reported').length;
        const total = filteredCameras.length;
        const activePercent = total > 0 ? (activeCount / total) * 100 : 0;
        const inactivePercent = total > 0 ? (inactiveCount / total) * 100 : 0;
        const neverReportedPercent = total > 0 ? (neverReportedCount / total) * 100 : 0;

        const camerasWithBattery = filteredCameras.filter((c: Camera) => c.battery_percentage !== null);
        const avgBattery = camerasWithBattery.length > 0
          ? Math.round(camerasWithBattery.reduce((sum: number, c: Camera) => sum + (c.battery_percentage || 0), 0) / camerasWithBattery.length)
          : 0;

        const camerasWithSD = filteredCameras.filter((c: Camera) => c.sd_utilization_percentage !== null);
        const avgSD = camerasWithSD.length > 0
          ? Math.round(camerasWithSD.reduce((sum: number, c: Camera) => sum + (c.sd_utilization_percentage || 0), 0) / camerasWithSD.length)
          : 0;

        return (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-6">
            {/* Camera status bar */}
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex-1 mr-4">
                    <p className="text-sm font-medium text-muted-foreground mb-3">Camera status</p>
                    <div className="flex h-3 rounded-full overflow-hidden">
                      {activePercent > 0 && (
                        <div
                          className="cursor-default"
                          style={{ width: `${activePercent}%`, backgroundColor: '#0f6064' }}
                          title={`${activeCount} active`}
                        />
                      )}
                      {inactivePercent > 0 && (
                        <div
                          className="cursor-default"
                          style={{ width: `${inactivePercent}%`, backgroundColor: '#882000' }}
                          title={`${inactiveCount} inactive`}
                        />
                      )}
                      {neverReportedPercent > 0 && (
                        <div
                          className="cursor-default"
                          style={{ width: `${neverReportedPercent}%`, backgroundColor: '#71b7ba' }}
                          title={`${neverReportedCount} never reported`}
                        />
                      )}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg" style={{ backgroundColor: '#0f606420' }}>
                    <Activity className="h-6 w-6" style={{ color: '#0f6064' }} />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Total cameras */}
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total cameras</p>
                    <p className="text-2xl font-bold mt-1">{total}</p>
                  </div>
                  <div className="p-3 rounded-lg" style={{ backgroundColor: '#0f606420' }}>
                    <CameraIcon className="h-6 w-6" style={{ color: '#0f6064' }} />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Average battery */}
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Average battery</p>
                    <p className="text-2xl font-bold mt-1">{avgBattery}%</p>
                  </div>
                  <div className="p-3 rounded-lg" style={{ backgroundColor: '#0f606420' }}>
                    <Battery className="h-6 w-6" style={{ color: '#0f6064' }} />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Average SD card */}
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Average SD used</p>
                    <p className="text-2xl font-bold mt-1">{avgSD}%</p>
                  </div>
                  <div className="p-3 rounded-lg" style={{ backgroundColor: '#0f606420' }}>
                    <HardDrive className="h-6 w-6" style={{ color: '#0f6064' }} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        );
      })()}

      {/* Camera table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <p className="text-muted-foreground">Loading cameras...</p>
        </div>
      ) : cameras && cameras.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead><SortableHeader label="Name" column="name" sort={sort} onSort={handleSort} /></TableHead>
                    <TableHead><SortableHeader label="Tags" column="tags" sort={sort} onSort={handleSort} /></TableHead>
                    <TableHead><SortableHeader label="Status" column="status" sort={sort} onSort={handleSort} /></TableHead>
                    <TableHead><SortableHeader label="Battery" column="battery" sort={sort} onSort={handleSort} /></TableHead>
                    <TableHead><SortableHeader label="Signal" column="signal" sort={sort} onSort={handleSort} /></TableHead>
                    <TableHead><SortableHeader label="SD used" column="sd_used" sort={sort} onSort={handleSort} /></TableHead>
                    <TableHead><SortableHeader label="Last report" column="last_report" sort={sort} onSort={handleSort} /></TableHead>
                    <TableHead><SortableHeader label="Last image" column="last_image" sort={sort} onSort={handleSort} /></TableHead>
                    <TableHead><SortableHeader label="Location" column="location" sort={sort} onSort={handleSort} /></TableHead>
                    {canAdminCurrentProject && (
                      <TableHead><SortableHeader label="Camera ID" column="device_id" sort={sort} onSort={handleSort} /></TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCameras.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={canAdminCurrentProject ? 10 : 9} className="text-center py-8 text-muted-foreground">
                        No cameras match your filters.
                      </TableCell>
                    </TableRow>
                  )}
                  {filteredCameras.map((camera: Camera) => (
                    <TableRow
                      key={camera.id}
                      className="cursor-pointer"
                      onClick={() => handleRowClick(camera)}
                    >
                      <TableCell className="font-medium">{camera.name}</TableCell>
                      <TableCell>
                        {camera.tags && camera.tags.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {camera.tags.slice(0, 2).map((tag) => (
                              <span
                                key={tag}
                                className="px-2 py-0.5 text-xs font-medium rounded-full bg-accent text-accent-foreground"
                              >
                                {tag}
                              </span>
                            ))}
                            {camera.tags.length > 2 && (
                              <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-muted text-muted-foreground">
                                +{camera.tags.length - 2}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>{getStatusBadge(camera.status)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: getBatteryColor(camera.battery_percentage) }}
                          />
                          <span className="text-sm">
                            {camera.battery_percentage !== null
                              ? `${camera.battery_percentage}%`
                              : 'N/A'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: getSignalColor(camera.signal_quality) }}
                          />
                          <span className="text-sm">{getSignalLabel(camera.signal_quality)}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: getSDColor(camera.sd_utilization_percentage) }}
                          />
                          <span className="text-sm">
                            {camera.sd_utilization_percentage !== null
                              ? `${Math.round(camera.sd_utilization_percentage)}%`
                              : 'N/A'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: getTimestampColor(camera.last_report_timestamp) }}
                          />
                          <span className="text-sm">{formatTimestamp(camera.last_report_timestamp)}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: getTimestampColor(camera.last_image_timestamp) }}
                          />
                          <span className="text-sm">{formatTimestamp(camera.last_image_timestamp)}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: camera.location ? '#0f6064' : '#882000' }}
                          />
                          <span className="text-sm">{camera.location ? 'Known' : 'Unknown'}</span>
                          {camera.location && (
                            <a
                              href={getGoogleMapsUrl(camera.location)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                      </TableCell>
                      {canAdminCurrentProject && (
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {camera.device_id || '-'}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex items-center justify-center py-8">
          <p className="text-muted-foreground">No cameras registered yet.</p>
        </div>
      )}
        </>
      )}

      {/* Camera Detail Side Panel */}
      <CameraDetailSheet
        camera={selectedCamera}
        isOpen={showDetailSheet}
        onClose={() => {
          setShowDetailSheet(false);
          setSelectedCamera(null);
        }}
        canAdmin={canAdminCurrentProject}
        isServerAdmin={isServerAdmin}
        projectId={currentProject?.id}
        onUpdate={(updatedCamera) => setSelectedCamera(updatedCamera)}
      />

      {/* Add Camera Dialog (server admins only) */}
      {isServerAdmin && (
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogContent onClose={() => setShowAddDialog(false)}>
            <DialogHeader>
              <DialogTitle>Add camera</DialogTitle>
              <DialogDescription>
                Create a new camera for project: {currentProject?.name}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4 px-1 -mx-1 max-h-[60vh] overflow-y-auto">
              <div>
                <label htmlFor="device-id" className="block text-sm font-medium mb-2">
                  Camera ID <span className="text-destructive">*</span>
                </label>
                <input
                  id="device-id"
                  type="text"
                  value={newCameraDeviceId}
                  onChange={(e) => setNewCameraDeviceId(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="e.g., 860946063660255"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Unique camera identifier (IMEI, serial number, or custom ID)
                </p>
              </div>

              <div>
                <label htmlFor="name" className="block text-sm font-medium mb-2">
                  Friendly name
                </label>
                <input
                  id="name"
                  type="text"
                  value={newCameraName}
                  onChange={(e) => setNewCameraName(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="e.g., Camera A - North Ridge"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Leave empty to use the camera ID as the display name
                </p>
              </div>

              <div>
                <label htmlFor="notes" className="block text-sm font-medium mb-2">
                  Remarks
                </label>
                <textarea
                  id="notes"
                  value={newCameraNotes}
                  onChange={(e) => setNewCameraNotes(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="e.g., Mounted on oak tree, facing north"
                  rows={3}
                />
              </div>

              {/* Custom key-value metadata fields */}
              {customFields.length > 0 && (
                <div>
                  <label className="block text-sm font-medium mb-2">Additional fields</label>
                  <div className="space-y-2">
                    {customFields.map((field, index) => (
                      <div key={index} className="flex gap-2 items-center">
                        <input
                          type="text"
                          value={field.key}
                          onChange={(e) => {
                            const updated = [...customFields];
                            updated[index] = { ...updated[index], key: e.target.value };
                            setCustomFields(updated);
                          }}
                          className="w-1/3 px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                          placeholder="Key"
                        />
                        <input
                          type="text"
                          value={field.value}
                          onChange={(e) => {
                            const updated = [...customFields];
                            updated[index] = { ...updated[index], value: e.target.value };
                            setCustomFields(updated);
                          }}
                          className="flex-1 px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                          placeholder="Value"
                        />
                        <button
                          type="button"
                          onClick={() => setCustomFields(customFields.filter((_, i) => i !== index))}
                          className="p-2 text-muted-foreground hover:text-destructive rounded-md hover:bg-accent"
                        >
                          <XCircle className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCustomFields([...customFields, { key: '', value: '' }])}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add field
              </Button>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleAddCamera}
                disabled={createMutation.isPending || !newCameraDeviceId.trim()}
              >
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    Create camera
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* CSV Import Dialog (server admins only) */}
      {isServerAdmin && (
        <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
          <DialogContent onClose={() => setShowImportDialog(false)} className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>Import cameras from CSV</DialogTitle>
              <DialogDescription>
                Upload a CSV file to register multiple cameras at once.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 pt-1 pb-4">
              {!importResults ? (
                <>
                  <div className="bg-accent/50 p-4 rounded-md space-y-3">
                    <div className="grid grid-cols-[1fr,1.2fr] gap-x-4 items-start">
                      <div>
                        <p className="text-sm font-medium">All you need is a list of camera IDs</p>
                        <p className="text-xs text-muted-foreground mt-0.5">A camera ID is any unique identifier per camera (e.g. IMEI, serial number, or custom label).</p>
                      </div>
                      <pre className="text-[11px] leading-relaxed bg-background p-2 rounded overflow-x-auto">
{`CameraID
860946063660255
860946063660256`}
                      </pre>
                    </div>

                    <div className="border-t border-border/50" />

                    <div className="grid grid-cols-[1fr,1.2fr] gap-x-4 items-start">
                      <div>
                        <p className="text-sm font-medium">Optionally add a name and notes</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Add <code className="bg-background px-1 rounded">Name</code> and <code className="bg-background px-1 rounded">Notes</code> columns. Empty names default to the camera ID.
                        </p>
                      </div>
                      <pre className="text-[11px] leading-relaxed bg-background p-2 rounded overflow-x-auto">
{`CameraID,Name,Notes
860946063660255,,
860946063660256,Camera north,Oak tree`}
                      </pre>
                    </div>

                    <div className="border-t border-border/50" />

                    <div className="grid grid-cols-[1fr,1.2fr] gap-x-4 items-start">
                      <div>
                        <p className="text-sm font-medium">Add any extra columns you like</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Extra columns are stored as custom fields. Not used by the system but searchable.</p>
                      </div>
                      <pre className="text-[11px] leading-relaxed bg-background p-2 rounded overflow-x-auto">
{`CameraID,Name,Notes,Habitat,Mounted on
860946063660255,,,,
860946063660256,Camera north,Near stream,Wetland,Pole`}
                      </pre>
                    </div>
                  </div>

                  <div
                    {...getCsvRootProps()}
                    className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                      isCsvDragActive
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50 hover:bg-accent/50'
                    }`}
                  >
                    <input {...getCsvInputProps()} />
                    {csvFile ? (
                      <div className="flex items-center justify-center gap-2">
                        <Upload className="h-5 w-5 text-primary" />
                        <span className="text-sm font-medium">{csvFile.name}</span>
                        <span className="text-xs text-muted-foreground">
                          ({(csvFile.size / 1024).toFixed(1)} KB)
                        </span>
                      </div>
                    ) : (
                      <div>
                        <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">
                          {isCsvDragActive ? 'Drop CSV file here...' : 'Drag and drop a CSV file here, or click to browse'}
                        </p>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-4 p-4 bg-accent/50 rounded-md">
                    <div className="flex items-center gap-2 text-green-600">
                      <CheckCircle className="h-5 w-5" />
                      <span className="font-medium">Success: {importResults.success_count}</span>
                    </div>
                    {importResults.failed_count > 0 && (
                      <div className="flex items-center gap-2 text-destructive">
                        <XCircle className="h-5 w-5" />
                        <span className="font-medium">Failed: {importResults.failed_count}</span>
                      </div>
                    )}
                  </div>

                  <div className="max-h-96 overflow-y-auto border rounded-md">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-accent border-b">
                        <tr>
                          <th className="text-left py-2 px-3">Row</th>
                          <th className="text-left py-2 px-3">Camera ID</th>
                          <th className="text-left py-2 px-3">Status</th>
                          <th className="text-left py-2 px-3">Message</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importResults.results.map((result) => (
                          <tr key={result.row_number} className="border-b hover:bg-accent/50">
                            <td className="py-2 px-3">{result.row_number}</td>
                            <td className="py-2 px-3 font-mono text-xs">{result.device_id}</td>
                            <td className="py-2 px-3">
                              {result.success ? (
                                <span className="inline-flex items-center gap-1 text-green-600">
                                  <CheckCircle className="h-4 w-4" />
                                  Success
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-destructive">
                                  <XCircle className="h-4 w-4" />
                                  Failed
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-muted-foreground">
                              {result.success ? `Camera ID: ${result.camera_id}` : result.error}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowImportDialog(false)}>
                {importResults ? 'Close' : 'Cancel'}
              </Button>
              {!importResults && (
                <Button onClick={handleImportCSV} disabled={importMutation.isPending || !csvFile}>
                  {importMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" />
                      Import
                    </>
                  )}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};
