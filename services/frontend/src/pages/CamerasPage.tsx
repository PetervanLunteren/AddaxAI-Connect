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
  ExternalLink,
  Plus,
  Upload,
  Loader2,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  ChevronDown,
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
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../components/ui/DropdownMenu';
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
import { CameraStatusBadge } from '../components/CameraStatusBadge';
import {
  camerasApi,
  type CreateCameraRequest,
  type BulkImportResponse,
} from '../api/cameras';
import type { Camera } from '../api/types';
import {
  FilterBar,
  type FilterFieldDef,
  type FilterValue,
} from '../components/ui/FilterBar';
import {
  filtersFromSearchParams,
  filtersToSearchParams,
  type FilterSchema,
} from '../lib/filter-url';
import { useSearchParams } from 'react-router-dom';

// Local type now that the old CameraFilters component is gone.
type CameraFilterState = {
  status: string;
  tag: string;
  battery: string;
  signal: string;
  sd_usage: string;
  location: string;
  site: string;
};

const FILTER_SCHEMA: FilterSchema = {
  status: 'string',
  tag: 'string',
  battery: 'string',
  signal: 'string',
  sd_usage: 'string',
  location: 'string',
  site: 'string',
  search: 'string',
};

const asString = (v: string | string[] | undefined): string =>
  typeof v === 'string' ? v : '';
import { ColumnPicker } from '../components/cameras/ColumnPicker';
import {
  BulkAddTagsDialog,
  BulkRemoveTagsDialog,
  BulkSetSimExpiryDialog,
  BulkSetNotesDialog,
} from '../components/cameras/BulkEditDialogs';
import { DeleteCamerasModal } from '../components/cameras/DeleteCamerasModal';
import { useToast } from '../components/ui/Toaster';
import {
  CAMERA_COLUMNS,
  loadVisibleColumns,
  saveVisibleColumns,
  type ColumnId,
} from '../components/cameras/columnDefs';
import { formatRelative } from '../utils/datetime';
import { formatSimExpiryStatus, simExpiryStatusClass } from '../utils/sim-expiry';
import { useDropzone } from 'react-dropzone';

const SortableHeader: React.FC<{
  label: string;
  column: ColumnId;
  sort: { column: ColumnId | null; direction: 'asc' | 'desc' };
  onSort: (column: ColumnId) => void;
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
  const toast = useToast();
  const { selectedProject: currentProject, canAdminCurrentProject, isServerAdmin } = useProject();

  // Filter and view-mode state live in the URL via FILTER_SCHEMA so the
  // bar, the chip row below it, and shareable links all agree.
  const [searchParams, setSearchParams] = useSearchParams();

  // Side panel state
  const [selectedCamera, setSelectedCamera] = useState<Camera | null>(null);
  const [showDetailSheet, setShowDetailSheet] = useState(false);

  // Bulk-edit selection. The Set persists across filter / sort / search
  // changes; the header checkbox only flips what is currently visible.
  const [selectedCameraIds, setSelectedCameraIds] = useState<Set<number>>(new Set());
  const [showBulkAddTags, setShowBulkAddTags] = useState(false);
  const [showBulkRemoveTags, setShowBulkRemoveTags] = useState(false);
  const [showBulkSetSimExpiry, setShowBulkSetSimExpiry] = useState(false);
  const [showBulkSetNotes, setShowBulkSetNotes] = useState(false);
  const [showBulkDelete, setShowBulkDelete] = useState(false);

  // Add camera dialog state
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newCameraDeviceId, setNewCameraDeviceId] = useState('');
  const [newCameraNotes, setNewCameraNotes] = useState('');
  const [newCameraSimExpiry, setNewCameraSimExpiry] = useState('');
  const [customFields, setCustomFields] = useState<{key: string, value: string}[]>([]);

  // CSV Import state
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importResults, setImportResults] = useState<BulkImportResponse | null>(null);

  // Sort state stays local (column toggles do not deserve URL noise).
  const [sort, setSort] = useState<{ column: ColumnId | null; direction: 'asc' | 'desc' }>({
    column: null,
    direction: 'asc',
  });

  const parsedFilters = filtersFromSearchParams(searchParams, FILTER_SCHEMA);
  const filters: CameraFilterState = {
    status: asString(parsedFilters.status),
    tag: asString(parsedFilters.tag),
    battery: asString(parsedFilters.battery),
    signal: asString(parsedFilters.signal),
    sd_usage: asString(parsedFilters.sd_usage),
    location: asString(parsedFilters.location),
    site: asString(parsedFilters.site),
  };
  const searchQuery = asString(parsedFilters.search);

  const filterValues: Record<string, FilterValue> = {
    status: filters.status || undefined,
    tag: filters.tag || undefined,
    battery: filters.battery || undefined,
    signal: filters.signal || undefined,
    sd_usage: filters.sd_usage || undefined,
    location: filters.location || undefined,
    site: filters.site || undefined,
    search: searchQuery || undefined,
  };

  const writeAll = (next: Record<string, FilterValue | undefined>) => {
    const merged: Record<string, FilterValue | undefined> = {
      ...filterValues,
      ...next,
    };
    setSearchParams(filtersToSearchParams(merged, FILTER_SCHEMA), {
      replace: true,
    });
  };
  const onFilterChange = (patch: Record<string, FilterValue>) => writeAll(patch);
  const onClearAll = () =>
    writeAll({
      status: undefined,
      tag: undefined,
      battery: undefined,
      signal: undefined,
      sd_usage: undefined,
      location: undefined,
      site: undefined,
      search: undefined,
    });

  // Visible columns persist per-browser, same pattern as cameras-view-mode.
  const [visibleColumns, setVisibleColumns] = useState<ColumnId[]>(() => loadVisibleColumns());
  useEffect(() => {
    saveVisibleColumns(visibleColumns);
  }, [visibleColumns]);
  const visibleColumnSet = useMemo(() => new Set(visibleColumns), [visibleColumns]);
  const visibleColumnDefs = useMemo(
    () => CAMERA_COLUMNS.filter((c) => visibleColumnSet.has(c.id)),
    [visibleColumnSet],
  );

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
      toast.error(`Failed to create camera: ${error.response?.data?.detail || error.message}`);
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
      toast.error(`Failed to import CSV: ${error.response?.data?.detail || error.message}`);
    },
  });

  // Shared success/error handlers for the four bulk-edit mutations. On
  // success: refresh the cameras query, drop the selection (so the bar
  // disappears), and show a count toast. On error: show the API detail.
  const onBulkSuccess = (res: { updated_count: number }) => {
    queryClient.invalidateQueries({ queryKey: ['cameras'] });
    queryClient.invalidateQueries({ queryKey: ['camera-tags'] });
    setSelectedCameraIds(new Set());
    setShowBulkAddTags(false);
    setShowBulkRemoveTags(false);
    setShowBulkSetSimExpiry(false);
    setShowBulkSetNotes(false);
    toast.success(`Updated ${res.updated_count} camera${res.updated_count === 1 ? '' : 's'}`);
  };
  const onBulkError = (error: any) => {
    toast.error(`Bulk update failed: ${error.response?.data?.detail || error.message}`);
  };

  const bulkAddTagsMutation = useMutation({
    mutationFn: ({ ids, tags }: { ids: number[]; tags: string[] }) =>
      camerasApi.bulkAddTags(ids, tags),
    onSuccess: onBulkSuccess,
    onError: onBulkError,
  });
  const bulkRemoveTagsMutation = useMutation({
    mutationFn: ({ ids, tags }: { ids: number[]; tags: string[] }) =>
      camerasApi.bulkRemoveTags(ids, tags),
    onSuccess: onBulkSuccess,
    onError: onBulkError,
  });
  const bulkSetSimExpiryMutation = useMutation({
    mutationFn: ({ ids, date }: { ids: number[]; date: string | null }) =>
      camerasApi.bulkSetSimExpiry(ids, date),
    onSuccess: onBulkSuccess,
    onError: onBulkError,
  });
  const bulkSetNotesMutation = useMutation({
    mutationFn: ({ ids, notes }: { ids: number[]; notes: string }) =>
      camerasApi.bulkSetNotes(ids, notes),
    onSuccess: onBulkSuccess,
    onError: onBulkError,
  });

  const resetAddForm = () => {
    setNewCameraDeviceId('');
    setNewCameraNotes('');
    setNewCameraSimExpiry('');
    setCustomFields([]);
  };

  const handleAddCamera = () => {
    if (!newCameraDeviceId.trim()) {
      toast.error('Camera ID is required');
      return;
    }
    if (!currentProject) {
      toast.error('Please select a project first');
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
      notes: newCameraNotes.trim() || undefined,
      custom_fields: Object.keys(custom_fields).length > 0 ? custom_fields : undefined,
      project_id: currentProject.id,
      sim_expiry_date: newCameraSimExpiry || undefined,
    };

    createMutation.mutate(data);
  };

  const handleImportCSV = () => {
    if (!csvFile) {
      toast.error('Please select a CSV file');
      return;
    }
    if (!currentProject) {
      toast.error('Please select a project first');
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
  const tagOptions = allTags || [];

  // Site options for the site filter, built from the cameras' current site so
  // there is no extra fetch. A camera links to its site via its deployment.
  const siteOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const c of cameras ?? []) {
      if (c.current_site) byId.set(String(c.current_site.id), c.current_site.name);
    }
    return Array.from(byId, ([value, label]) => ({ value, label })).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }, [cameras]);

  const filterFields: FilterFieldDef[] = [
    {
      kind: 'search',
      key: 'search',
      label: 'Search',
      placeholder: 'Name, device ID, tag, notes...',
    },
    {
      kind: 'select',
      key: 'status',
      label: 'Status',
      options: [
        { value: 'active', label: 'Active' },
        { value: 'inactive', label: 'Inactive' },
        { value: 'never_reported', label: 'Never reported' },
      ],
    },
    {
      kind: 'select',
      key: 'tag',
      label: 'Tag',
      primary: false,
      options: tagOptions.map((t) => ({ value: t, label: t })),
    },
    {
      kind: 'select',
      key: 'site',
      label: 'Site',
      options: siteOptions,
    },
    {
      kind: 'select',
      key: 'battery',
      label: 'Battery',
      options: [
        { value: 'low', label: 'Low (<30%)' },
        { value: 'medium', label: 'Medium (30-70%)' },
        { value: 'high', label: 'High (>70%)' },
        { value: 'unknown', label: 'Unknown' },
      ],
    },
    {
      kind: 'select',
      key: 'signal',
      label: 'Signal quality',
      primary: false,
      options: [
        { value: 'excellent', label: 'Excellent (20+)' },
        { value: 'good', label: 'Good (15-19)' },
        { value: 'fair', label: 'Fair (10-14)' },
        { value: 'poor', label: 'Poor (2-9)' },
        { value: 'no_signal', label: 'No signal (0-1)' },
        { value: 'unknown', label: 'Unknown' },
      ],
    },
    {
      kind: 'select',
      key: 'sd_usage',
      label: 'SD usage',
      primary: false,
      options: [
        { value: 'low', label: 'Low (<50%)' },
        { value: 'medium', label: 'Medium (50-80%)' },
        { value: 'high', label: 'High (>80%)' },
        { value: 'unknown', label: 'Unknown' },
      ],
    },
    {
      kind: 'select',
      key: 'location',
      label: 'Location',
      primary: false,
      options: [
        { value: 'known', label: 'Known' },
        { value: 'unknown', label: 'Unknown' },
      ],
    },
  ];

  const handleSort = (column: ColumnId) => {
    setSort((prev) =>
      prev.column === column
        ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { column, direction: 'asc' }
    );
  };

  const toggleCameraSelection = (id: number) => {
    setSelectedCameraIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearCameraSelection = () => setSelectedCameraIds(new Set());

  // Helper functions for formatting
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
          formatRelative(c.last_report_timestamp),
          formatRelative(c.last_image_timestamp),
          c.location ? 'known' : 'unknown',
          c.battery_percentage !== null ? `${c.battery_percentage}%` : 'N/A',
          c.sd_utilization_percentage !== null ? `${Math.round(c.sd_utilization_percentage)}%` : 'N/A',
        ];
        return fields.some((f) => f && f.toLowerCase().includes(q));
      });
    }

    // Structured filters
    if (filters.status) {
      result = result.filter((c) => c.status === filters.status);
    }
    if (filters.tag) {
      result = result.filter((c) => c.tags?.includes(filters.tag));
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
    if (filters.site) {
      result = result.filter((c) => String(c.current_site?.id) === filters.site);
    }

    // Sort (nulls last). Non-sortable columns return null and fall through
    // to the unsorted branch below if the user somehow ends up sorting on one.
    if (sort.column) {
      const dir = sort.direction === 'asc' ? 1 : -1;
      result.sort((a, b) => {
        const getValue = (c: Camera): string | number | null => {
          switch (sort.column) {
            case 'device_id': return (c.device_id || '').toLowerCase() || null;
            case 'tags': return (c.tags || []).join(', ').toLowerCase() || null;
            case 'status': return c.status;
            case 'site': return c.current_site?.name.toLowerCase() ?? null;
            case 'battery': return c.battery_percentage;
            case 'signal': return c.signal_quality;
            case 'sd_used': return c.sd_utilization_percentage;
            case 'temperature': return c.temperature;
            case 'last_report': return c.last_report_timestamp;
            case 'last_image': return c.last_image_timestamp;
            case 'location': return c.location ? 1 : 0;
            case 'sim_expiry': return c.sim_expiry_date;
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
    !!filters.status || !!filters.tag ||
    !!filters.battery || !!filters.signal || !!filters.sd_usage ||
    !!filters.location || !!filters.site;

  // Per-column cell renderer. Lives inside the component so it closes over
  // the format helpers (getBatteryColor, getSignalLabel, etc.) defined
  // above. Each ColumnId returns the cell body, not the wrapping <TableCell>.
  const renderCameraCell = (id: ColumnId, camera: Camera): React.ReactNode => {
    switch (id) {
      case 'device_id':
        return camera.device_id ? (
          camera.device_id
        ) : (
          <span className="text-muted-foreground">-</span>
        );
      case 'tags':
        return camera.tags && camera.tags.length > 0 ? (
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
        );
      case 'status':
        return <CameraStatusBadge status={camera.status} />;
      case 'battery':
        return (
          <div className="flex items-center gap-1.5">
            <span
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: getBatteryColor(camera.battery_percentage) }}
            />
            <span className="text-sm">
              {camera.battery_percentage !== null ? `${camera.battery_percentage}%` : 'N/A'}
            </span>
          </div>
        );
      case 'signal':
        return (
          <div className="flex items-center gap-1.5">
            <span
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: getSignalColor(camera.signal_quality) }}
            />
            <span className="text-sm">{getSignalLabel(camera.signal_quality)}</span>
          </div>
        );
      case 'sd_used':
        return (
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
        );
      case 'temperature':
        return (
          <span className="text-sm">
            {camera.temperature !== null ? `${camera.temperature} °C` : 'N/A'}
          </span>
        );
      case 'last_report':
        return (
          <div className="flex items-center gap-1.5">
            <span
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: getTimestampColor(camera.last_report_timestamp) }}
            />
            <span className="text-sm">{formatRelative(camera.last_report_timestamp)}</span>
          </div>
        );
      case 'last_image':
        return (
          <div className="flex items-center gap-1.5">
            <span
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: getTimestampColor(camera.last_image_timestamp) }}
            />
            <span className="text-sm">{formatRelative(camera.last_image_timestamp)}</span>
          </div>
        );
      case 'site':
        return camera.current_site ? (
          <span className="text-sm">
            {camera.current_site.name}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        );
      case 'location':
        return (
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
        );
      case 'notes':
        return camera.notes ? (
          <span
            className="text-sm text-muted-foreground block max-w-[16rem] truncate"
            title={camera.notes}
          >
            {camera.notes}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        );
      case 'sim_expiry':
        return (
          <span className={`text-sm ${simExpiryStatusClass(camera.sim_expiry_date)}`}>
            {formatSimExpiryStatus(camera.sim_expiry_date)}
          </span>
        );
    }
  };

  if (!currentProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Please select a project to view cameras.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with title and page-level actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold mb-0">Cameras</h1>
          <p className="text-sm text-gray-600 mt-1">
            Monitor camera health, battery levels, and connectivity status
          </p>
        </div>
        {isServerAdmin && (
          <div className="flex gap-2 self-start">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="whitespace-nowrap">
                  <Plus className="h-4 w-4 mr-2" />
                  Add camera
                  <ChevronDown className="h-3.5 w-3.5 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setShowAddDialog(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add a single camera
                </DropdownMenuItem>
                <DropdownMenuItem onClick={openImportDialog}>
                  <Upload className="h-4 w-4 mr-2" />
                  Import from CSV
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {/* Needs attention. Page-wide counts of cameras that want a visit,
          independent of the table filters. Clicking a count applies the
          matching filter. Thresholds match the battery/SD filter buckets
          (low battery <30%, SD nearly full >80%). */}
      {cameras && cameras.length > 0 && (() => {
        const inactiveCount = cameras.filter((c: Camera) => c.status === 'inactive').length;
        const lowBatteryCount = cameras.filter(
          (c: Camera) => c.battery_percentage != null && c.battery_percentage < 30,
        ).length;
        const sdHighCount = cameras.filter(
          (c: Camera) => c.sd_utilization_percentage != null && c.sd_utilization_percentage > 80,
        ).length;
        const allClear = inactiveCount === 0 && lowBatteryCount === 0 && sdHighCount === 0;

        const items: { count: number; label: string; patch: Record<string, FilterValue> }[] = [
          { count: inactiveCount, label: 'inactive', patch: { status: 'inactive' } },
          { count: lowBatteryCount, label: 'low battery', patch: { battery: 'low' } },
          { count: sdHighCount, label: 'SD nearly full', patch: { sd_usage: 'high' } },
        ];

        if (allClear) {
          return (
            <Card>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle className="h-4 w-4 text-primary" />
                  All cameras look healthy
                </div>
              </CardContent>
            </Card>
          );
        }

        return (
          <Card>
            <CardContent className="p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground mr-1">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Needs attention
                </span>
                {items
                  .filter((it) => it.count > 0)
                  .map((it) => (
                    <Button
                      key={it.label}
                      variant="outline"
                      size="sm"
                      onClick={() => onFilterChange(it.patch)}
                    >
                      {it.count} {it.label}
                    </Button>
                  ))}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Shared filter bar (drives both table and map views) */}
      {cameras && cameras.length > 0 && (
        <div className="space-y-3">
          <FilterBar
            fields={filterFields}
            values={filterValues}
            onChange={onFilterChange}
            onClearAll={onClearAll}
            displayControls={[
              {
                key: 'columns',
                label: 'Visible columns',
                render: () => (
                  <ColumnPicker
                    visible={visibleColumns}
                    onChange={setVisibleColumns}
                  />
                ),
              },
            ]}
            displayValues={{}}
            onDisplayChange={() => {}}
          />
          {isFiltered && (
            <p className="text-sm text-muted-foreground">
              {filteredCameras.length} of {cameras.length} cameras
            </p>
          )}
        </div>
      )}

      {/* Bulk-action bar. Only renders for admins with at least one camera
          selected. Sits between the toolbar and the table, same shape as
          ManageImagesPage's bulk bar. */}
      {canAdminCurrentProject && selectedCameraIds.size > 0 && cameras && cameras.length > 0 && (
        <div className="flex items-center gap-3 p-3 mb-3 bg-muted rounded-md flex-wrap">
          <span className="text-sm font-medium">
            {selectedCameraIds.size} of {cameras.length} cameras selected
          </span>
          <div className="flex gap-2 flex-wrap ml-auto">
            <Button variant="outline" size="sm" onClick={() => setShowBulkAddTags(true)}>
              Add tags
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowBulkRemoveTags(true)}>
              Remove tags
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowBulkSetSimExpiry(true)}>
              Set SIM expiry
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowBulkSetNotes(true)}>
              Set notes
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setShowBulkDelete(true)}>
              Delete
            </Button>
            <Button variant="ghost" size="sm" onClick={clearCameraSelection}>
              Cancel
            </Button>
          </div>
        </div>
      )}

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
                    {canAdminCurrentProject && (
                      <TableHead className="w-10">
                        <input
                          type="checkbox"
                          aria-label="Select all visible cameras"
                          checked={
                            filteredCameras.length > 0 &&
                            filteredCameras.every((c) => selectedCameraIds.has(c.id))
                          }
                          ref={(el) => {
                            if (!el) return;
                            const someSelected = filteredCameras.some((c) =>
                              selectedCameraIds.has(c.id)
                            );
                            const allSelected =
                              filteredCameras.length > 0 &&
                              filteredCameras.every((c) => selectedCameraIds.has(c.id));
                            el.indeterminate = someSelected && !allSelected;
                          }}
                          onChange={(e) => {
                            const visibleIds = filteredCameras.map((c) => c.id);
                            setSelectedCameraIds((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) {
                                for (const id of visibleIds) next.add(id);
                              } else {
                                for (const id of visibleIds) next.delete(id);
                              }
                              return next;
                            });
                          }}
                          className="w-4 h-4 cursor-pointer accent-primary"
                        />
                      </TableHead>
                    )}
                    {visibleColumnDefs.map((col) => (
                      <TableHead key={col.id}>
                        {col.sortable ? (
                          <SortableHeader
                            label={col.label}
                            column={col.id}
                            sort={sort}
                            onSort={handleSort}
                          />
                        ) : (
                          col.label
                        )}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCameras.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={visibleColumnDefs.length + (canAdminCurrentProject ? 1 : 0)}
                        className="text-center py-8 text-muted-foreground"
                      >
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
                      {canAdminCurrentProject && (
                        <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`Select camera ${camera.name}`}
                            checked={selectedCameraIds.has(camera.id)}
                            onChange={() => toggleCameraSelection(camera.id)}
                            className="w-4 h-4 cursor-pointer accent-primary"
                          />
                        </TableCell>
                      )}
                      {visibleColumnDefs.map((col) => (
                        <TableCell
                          key={col.id}
                          className={col.id === 'device_id' ? 'font-medium' : undefined}
                        >
                          {renderCameraCell(col.id, camera)}
                        </TableCell>
                      ))}
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

      {/* Bulk-edit dialogs. Suggestions for the remove dialog come from
          tags currently on the selected cameras only, so the user cannot
          accidentally type a tag that no selected camera carries. */}
      <BulkAddTagsDialog
        open={showBulkAddTags}
        onClose={() => setShowBulkAddTags(false)}
        cameraCount={selectedCameraIds.size}
        isPending={bulkAddTagsMutation.isPending}
        suggestions={tagOptions}
        onConfirm={(tags) =>
          bulkAddTagsMutation.mutate({ ids: Array.from(selectedCameraIds), tags })
        }
      />
      <BulkRemoveTagsDialog
        open={showBulkRemoveTags}
        onClose={() => setShowBulkRemoveTags(false)}
        cameraCount={selectedCameraIds.size}
        isPending={bulkRemoveTagsMutation.isPending}
        suggestions={Array.from(
          new Set(
            (cameras || [])
              .filter((c) => selectedCameraIds.has(c.id))
              .flatMap((c) => c.tags || []),
          ),
        ).sort()}
        onConfirm={(tags) =>
          bulkRemoveTagsMutation.mutate({ ids: Array.from(selectedCameraIds), tags })
        }
      />
      <BulkSetSimExpiryDialog
        open={showBulkSetSimExpiry}
        onClose={() => setShowBulkSetSimExpiry(false)}
        cameraCount={selectedCameraIds.size}
        isPending={bulkSetSimExpiryMutation.isPending}
        onConfirm={(date) =>
          bulkSetSimExpiryMutation.mutate({ ids: Array.from(selectedCameraIds), date })
        }
      />
      <BulkSetNotesDialog
        open={showBulkSetNotes}
        onClose={() => setShowBulkSetNotes(false)}
        cameraCount={selectedCameraIds.size}
        isPending={bulkSetNotesMutation.isPending}
        onConfirm={(notes) =>
          bulkSetNotesMutation.mutate({ ids: Array.from(selectedCameraIds), notes })
        }
      />

      <DeleteCamerasModal
        open={showBulkDelete}
        onClose={() => setShowBulkDelete(false)}
        cameraIds={Array.from(selectedCameraIds)}
        onDeleted={() => setSelectedCameraIds(new Set())}
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

              <div>
                <label htmlFor="sim-expiry" className="block text-sm font-medium mb-2">
                  SIM expiry date
                </label>
                <input
                  id="sim-expiry"
                  type="date"
                  value={newCameraSimExpiry}
                  onChange={(e) => setNewCameraSimExpiry(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Optional. Used by the monthly SIM expiry alert if enabled for this project.
                </p>
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
                        <p className="text-sm font-medium">Optionally add a name, notes, or SIM expiry</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Add <code className="bg-background px-1 rounded">Name</code>, <code className="bg-background px-1 rounded">Notes</code>, or <code className="bg-background px-1 rounded">SimExpiryDate</code> columns. Empty names default to the camera ID. SIM expiry dates use <code className="bg-background px-1 rounded">YYYY-MM-DD</code>.
                        </p>
                      </div>
                      <pre className="text-[11px] leading-relaxed bg-background p-2 rounded overflow-x-auto">
{`CameraID,Name,Notes,SimExpiryDate
860946063660255,,,
860946063660256,Camera north,Oak tree,2026-12-15`}
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

                  <div className="max-h-96 overflow-auto border rounded-md">
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
