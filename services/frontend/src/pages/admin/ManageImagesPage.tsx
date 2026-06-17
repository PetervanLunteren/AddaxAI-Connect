/**
 * Image management admin page
 *
 * Allows project admins to view all images (including hidden),
 * bulk hide/unhide images from analysis, and permanently delete images.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  EyeOff, Eye, Trash2, Loader2, ArrowUp, ArrowDown, ArrowUpDown,
  ChevronLeft, ChevronRight, AlertTriangle, CheckCircle, Check, Download, Info,
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import {
  FilterBar,
  type FilterFieldDef,
  type FilterValue,
} from '../../components/ui/FilterBar';
import {
  filtersFromSearchParams,
  filtersToSearchParams,
  type FilterSchema,
} from '../../lib/filter-url';
import type { AdminImageFilterParams, BulkActionTarget } from '../../api/imageAdmin';
import { statisticsApi } from '../../api/statistics';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../components/ui/Dialog';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '../../components/ui/Table';
import { ImageDetailModal } from '../../components/ImageDetailModal';
import { AuthenticatedImage } from '../../components/AuthenticatedImage';
import { useProject } from '../../contexts/ProjectContext';
import { imageAdminApi } from '../../api/imageAdmin';
import { camerasApi } from '../../api/cameras';
import { sitesApi } from '../../api/sites';
import { imagesApi } from '../../api/images';
import type { ImageListItem } from '../../api/types';
import { formatDateTime } from '../../utils/datetime';

type SortColumn = 'filename' | 'camera_name' | 'captured_at';

const FILTER_SCHEMA: FilterSchema = {
  search: 'string',
  camera_id: 'string',
  hidden: 'string',
  verified: 'string',
  species: 'string',
  tags: 'string[]',
  date_from: 'date',
  date_to: 'date',
  liked: 'string',
  needs_review: 'string',
  bulk_upload_job: 'string',
  min_detection_confidence: 'number',
  max_detection_confidence: 'number',
  min_classification_confidence: 'number',
  max_classification_confidence: 'number',
};

const formatPct = (lo: number, hi: number): string =>
  `${Math.round(lo * 100)}% - ${Math.round(hi * 100)}%`;

const asString = (v: string | string[] | undefined): string =>
  typeof v === 'string' ? v : '';
const asStringArray = (v: string | string[] | undefined): string[] =>
  Array.isArray(v) ? v : [];

const SortableHeader: React.FC<{
  label: string;
  column: SortColumn;
  sort: { column: SortColumn; direction: 'asc' | 'desc' };
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

export const ManageImagesPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { selectedProject, canAdminCurrentProject } = useProject();
  const projectId = selectedProject?.id;

  const [page, setPage] = useState(1);
  const [searchParams, setSearchParams] = useSearchParams();
  const parsedFilters = filtersFromSearchParams(searchParams, FILTER_SCHEMA);
  const search = asString(parsedFilters.search);
  const cameraFilter = asString(parsedFilters.camera_id);
  const hiddenFilter = asString(parsedFilters.hidden);
  const verifiedFilter = asString(parsedFilters.verified);
  const speciesFilter = asString(parsedFilters.species);
  const tagValues = asStringArray(parsedFilters.tags);
  const dateFrom = asString(parsedFilters.date_from);
  const dateTo = asString(parsedFilters.date_to);
  const likedFilter = asString(parsedFilters.liked);
  const needsReviewFilter = asString(parsedFilters.needs_review);
  const bulkUploadJob = asString(parsedFilters.bulk_upload_job);
  const minDetConf = asString(parsedFilters.min_detection_confidence);
  const maxDetConf = asString(parsedFilters.max_detection_confidence);
  const minClsConf = asString(parsedFilters.min_classification_confidence);
  const maxClsConf = asString(parsedFilters.max_classification_confidence);
  const [debouncedSearch, setDebouncedSearch] = useState(search);

  const filterValues: Record<string, FilterValue> = {
    search: search || undefined,
    camera_id: cameraFilter || undefined,
    hidden: hiddenFilter || undefined,
    verified: verifiedFilter || undefined,
    species: speciesFilter || undefined,
    tags: tagValues.length > 0 ? tagValues : undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    liked: likedFilter || undefined,
    needs_review: needsReviewFilter || undefined,
    bulk_upload_job: bulkUploadJob || undefined,
    min_detection_confidence: minDetConf || undefined,
    max_detection_confidence: maxDetConf || undefined,
    min_classification_confidence: minClsConf || undefined,
    max_classification_confidence: maxClsConf || undefined,
  };

  // Filter params in the AdminImageFilterParams shape, ready to send
  // to either the list endpoint or the filter-based bulk actions.
  const filterParams: AdminImageFilterParams = useMemo(() => ({
    camera_id: cameraFilter ? parseInt(cameraFilter) : undefined,
    start_date: dateFrom || undefined,
    end_date: dateTo || undefined,
    species: speciesFilter || undefined,
    verified: verifiedFilter || undefined,
    hidden: hiddenFilter || undefined,
    search: debouncedSearch || undefined,
    tags: tagValues.length > 0 ? tagValues.join(',') : undefined,
    liked: likedFilter || undefined,
    needs_review: needsReviewFilter || undefined,
    bulk_upload_job: bulkUploadJob || undefined,
    min_detection_confidence: minDetConf ? Number(minDetConf) : undefined,
    max_detection_confidence: maxDetConf ? Number(maxDetConf) : undefined,
    min_classification_confidence: minClsConf ? Number(minClsConf) : undefined,
    max_classification_confidence: maxClsConf ? Number(maxClsConf) : undefined,
  }), [cameraFilter, dateFrom, dateTo, speciesFilter, verifiedFilter, hiddenFilter, debouncedSearch, tagValues, likedFilter, needsReviewFilter, bulkUploadJob, minDetConf, maxDetConf, minClsConf, maxClsConf]);

  const onFilterChange = (patch: Record<string, FilterValue>) => {
    const next = { ...filterValues, ...patch };
    setSearchParams(filtersToSearchParams(next, FILTER_SCHEMA), { replace: true });
    setPage(1);
  };
  const onClearAll = () => {
    setSearchParams(new URLSearchParams(), { replace: true });
    setPage(1);
  };

  const [sort, setSort] = useState<{ column: SortColumn; direction: 'asc' | 'desc' }>({
    column: 'captured_at',
    direction: 'desc',
  });
  const [selectedUuids, setSelectedUuids] = useState<Set<string>>(new Set());
  // Promoted from per-page selection to "every image matching the
  // current filters". When true `selectedUuids` is ignored and bulk
  // actions send the filter set instead.
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [modalImageUuid, setModalImageUuid] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const limit = 50;

  // Redirect non-admins
  if (!canAdminCurrentProject) {
    return <Navigate to={`/projects/${projectId}/dashboard`} replace />;
  }

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Reset page on filter changes
  useEffect(() => {
    setPage(1);
  }, [
    debouncedSearch, cameraFilter, hiddenFilter, verifiedFilter, speciesFilter,
    tagValues.join(','), dateFrom, dateTo, likedFilter, needsReviewFilter,
    minDetConf, maxDetConf, minClsConf, maxClsConf, sort,
  ]);

  // Drop the all-matching mode whenever the filter set or project
  // changes, so the user doesn't unintentionally delete across a
  // different selection than the one they confirmed.
  useEffect(() => {
    setSelectAllMatching(false);
  }, [
    projectId, debouncedSearch, cameraFilter, hiddenFilter, verifiedFilter,
    speciesFilter, tagValues.join(','), dateFrom, dateTo, likedFilter,
    needsReviewFilter, minDetConf, maxDetConf, minClsConf, maxClsConf,
  ]);

  // Reset selection on project change
  useEffect(() => {
    setSelectedUuids(new Set());
    setPage(1);
  }, [projectId]);

  // Sort column mapping for backend
  const sortByMap: Record<SortColumn, string> = {
    filename: 'filename',
    camera_name: 'camera_name',
    captured_at: 'captured_at',
  };

  // Fetch images
  const { data: imagesData, isLoading } = useQuery({
    queryKey: ['admin-images', projectId, page, filterParams, sort],
    queryFn: () =>
      imageAdminApi.getAll({
        project_id: projectId!,
        page,
        limit,
        sort_by: sortByMap[sort.column],
        sort_dir: sort.direction,
        ...filterParams,
      }),
    enabled: projectId !== undefined,
  });

  // Fetch cameras for filter
  const { data: cameras } = useQuery({
    queryKey: ['cameras', projectId],
    queryFn: () => camerasApi.getAll(projectId),
    enabled: projectId !== undefined,
  });

  // Fetch species for filter
  const { data: speciesOptions } = useQuery({
    queryKey: ['species', projectId],
    queryFn: () => imagesApi.getSpecies(projectId),
    enabled: projectId !== undefined,
  });

  // Fetch site tag options. Tags describe the place, so they live on the site;
  // the filter resolves images via their deployment.
  const { data: tagOptions } = useQuery({
    queryKey: ['site-tags', projectId],
    queryFn: () => sitesApi.getTags(projectId!),
    enabled: projectId !== undefined,
  });

  // Overview drives date-range bounds
  const { data: overview } = useQuery({
    queryKey: ['statistics', 'overview', projectId],
    queryFn: () => statisticsApi.getOverview(projectId),
    enabled: projectId !== undefined,
  });

  // Mutations
  const hideMutation = useMutation({
    mutationFn: (target: BulkActionTarget) => imageAdminApi.bulkHide(projectId!, target),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['admin-images'] });
      queryClient.invalidateQueries({ queryKey: ['images'] });
      queryClient.invalidateQueries({ queryKey: ['statistics'] });
      setSelectedUuids(new Set());
      setSelectAllMatching(false);
      setSuccessMessage(`${result.success_count} image(s) hidden from analysis`);
      setTimeout(() => setSuccessMessage(null), 3000);
    },
  });

  const unhideMutation = useMutation({
    mutationFn: (target: BulkActionTarget) => imageAdminApi.bulkUnhide(projectId!, target),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['admin-images'] });
      queryClient.invalidateQueries({ queryKey: ['images'] });
      queryClient.invalidateQueries({ queryKey: ['statistics'] });
      setSelectedUuids(new Set());
      setSelectAllMatching(false);
      setSuccessMessage(`${result.success_count} image(s) restored to analysis`);
      setTimeout(() => setSuccessMessage(null), 3000);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (target: BulkActionTarget) => imageAdminApi.bulkDelete(projectId!, target),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['admin-images'] });
      queryClient.invalidateQueries({ queryKey: ['images'] });
      queryClient.invalidateQueries({ queryKey: ['statistics'] });
      setSelectedUuids(new Set());
      setSelectAllMatching(false);
      setShowDeleteConfirm(false);
      setDeleteConfirmText('');
      setSuccessMessage(`${result.success_count} image(s) permanently deleted`);
      setTimeout(() => setSuccessMessage(null), 3000);
    },
  });

  const downloadMutation = useMutation({
    mutationFn: (target: BulkActionTarget) => imageAdminApi.bulkDownload(projectId!, target),
    onSuccess: ({ blob, filename }) => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setSuccessMessage('Download started');
      setTimeout(() => setSuccessMessage(null), 3000);
    },
  });

  const isMutating =
    hideMutation.isPending
    || unhideMutation.isPending
    || deleteMutation.isPending
    || downloadMutation.isPending;

  // Build the target a bulk action should send, branching on whether
  // the user promoted to "all matching" or stuck with the per-page set.
  const buildBulkTarget = useCallback((): BulkActionTarget => {
    if (selectAllMatching) {
      return { filters: filterParams };
    }
    return { image_uuids: Array.from(selectedUuids) };
  }, [selectAllMatching, filterParams, selectedUuids]);

  // Selection helpers
  const currentPageUuids = useMemo(
    () => imagesData?.items.map((img) => img.uuid) ?? [],
    [imagesData],
  );

  const allOnPageSelected = currentPageUuids.length > 0 && currentPageUuids.every((uuid) => selectedUuids.has(uuid));
  const someOnPageSelected = currentPageUuids.some((uuid) => selectedUuids.has(uuid));

  const toggleSelectAll = () => {
    // Toggling the page-header checkbox while in all-matching mode
    // drops the all-matching state entirely. Easiest mental model.
    if (selectAllMatching) {
      setSelectAllMatching(false);
      setSelectedUuids(new Set());
      return;
    }
    setSelectedUuids((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        currentPageUuids.forEach((uuid) => next.delete(uuid));
      } else {
        currentPageUuids.forEach((uuid) => next.add(uuid));
      }
      return next;
    });
  };

  const toggleSelect = (uuid: string) => {
    // Once the user touches an individual checkbox, they're back in
    // per-page mode and the all-matching banner state goes away.
    if (selectAllMatching) {
      setSelectAllMatching(false);
      setSelectedUuids(new Set([uuid]));
      return;
    }
    setSelectedUuids((prev) => {
      const next = new Set(prev);
      if (next.has(uuid)) {
        next.delete(uuid);
      } else {
        next.add(uuid);
      }
      return next;
    });
  };

  const handleSort = (column: SortColumn) => {
    setSort((prev) => ({
      column,
      direction: prev.column === column && prev.direction === 'desc' ? 'asc' : 'desc',
    }));
  };

  const totalPages = imagesData?.pages ?? 1;
  const effectiveSelectionCount = selectAllMatching
    ? (imagesData?.total ?? 0)
    : selectedUuids.size;

  // Image navigation within modal
  const allImageUuids = currentPageUuids;
  const currentModalIndex = modalImageUuid ? allImageUuids.indexOf(modalImageUuid) : -1;

  const filterFields: FilterFieldDef[] = [
    {
      kind: 'search',
      key: 'search',
      label: 'Search',
      placeholder: 'Search filename',
    },
    {
      kind: 'select',
      key: 'camera_id',
      label: 'Camera',
      options: (cameras ?? []).map((cam) => ({
        value: String(cam.id),
        label: cam.name,
      })),
    },
    {
      kind: 'multi-select',
      key: 'tags',
      label: 'Site tags',
      options: (tagOptions ?? []).map((t) => ({ label: t, value: t })),
      placeholder: 'Any tags',
      summary: (n) => `${n} tags`,
    },
    {
      kind: 'select',
      key: 'species',
      label: 'Species',
      options: (speciesOptions ?? []).map((s) => ({
        value: String(s.value),
        label: String(s.label),
      })),
    },
    {
      kind: 'date-range',
      fromKey: 'date_from',
      toKey: 'date_to',
      label: 'Date range',
      minDate: overview?.first_image_date,
      maxDate: overview?.last_image_date,
    },
    {
      kind: 'select',
      key: 'hidden',
      label: 'Visibility',
      primary: false,
      options: [
        { value: 'false', label: 'Visible' },
        { value: 'true', label: 'Hidden' },
      ],
    },
    {
      kind: 'select',
      key: 'verified',
      label: 'Verification',
      primary: false,
      options: [
        { value: 'true', label: 'Verified' },
        { value: 'false', label: 'Unverified' },
      ],
    },
    {
      kind: 'select',
      key: 'liked',
      label: 'Liked',
      primary: false,
      options: [
        { value: 'true', label: 'Liked' },
        { value: 'false', label: 'Not liked' },
      ],
    },
    {
      kind: 'select',
      key: 'needs_review',
      label: 'Review',
      primary: false,
      options: [
        { value: 'true', label: 'Needs review' },
        { value: 'false', label: 'No review needed' },
      ],
    },
    {
      kind: 'range',
      minKey: 'min_detection_confidence',
      maxKey: 'max_detection_confidence',
      label: 'Detection confidence',
      min: selectedProject?.detection_threshold ?? 0,
      max: 1,
      step: 0.05,
      format: formatPct,
      chipPrefix: 'Detection',
      primary: false,
    },
    {
      kind: 'range',
      minKey: 'min_classification_confidence',
      maxKey: 'max_classification_confidence',
      label: 'Classification confidence',
      min: selectedProject?.classification_thresholds?.default ?? 0,
      max: 1,
      step: 0.05,
      format: formatPct,
      chipPrefix: 'Classification',
      primary: false,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Curation</h1>
        <p className="text-muted-foreground mt-1">
          Hide, download, or delete images in this project
        </p>
      </div>

      {/* Success message */}
      {successMessage && (
        <div className="flex items-center gap-2 p-3 bg-green-50 text-green-700 rounded-md border border-green-200">
          <CheckCircle className="h-4 w-4" />
          <span className="text-sm">{successMessage}</span>
        </div>
      )}

      <FilterBar
        fields={filterFields}
        values={filterValues}
        onChange={onFilterChange}
        onClearAll={onClearAll}
      />

      {/* Scoped to a single bulk upload (opened from the bulk-upload page).
          Makes the narrow scope obvious before a select-all delete. */}
      {bulkUploadJob && (
        <div className="flex items-center justify-between gap-3 p-3 bg-blue-50 border border-blue-200 text-blue-800 rounded-md text-sm">
          <span className="flex items-center gap-2">
            <Info className="h-4 w-4 flex-shrink-0" />
            Showing images from one bulk upload only.
          </span>
          <Button
            variant="link"
            size="sm"
            onClick={() => onFilterChange({ bulk_upload_job: undefined })}
          >
            Clear
          </Button>
        </div>
      )}

      {/* Promotion banner. Shows up when the user has ticked every
          image on the page and there's more on other pages. Clicking
          promotes from "this page" to "all images matching filters". */}
      {!selectAllMatching
        && allOnPageSelected
        && (imagesData?.total ?? 0) > currentPageUuids.length && (
        <div className="flex items-center justify-between gap-3 p-3 bg-secondary/50 border rounded-md">
          <span className="text-sm">
            All {currentPageUuids.length} on this page are selected.
          </span>
          <Button
            variant="link"
            size="sm"
            onClick={() => {
              setSelectAllMatching(true);
              setSelectedUuids(new Set());
            }}
          >
            Select all {imagesData?.total} matching the filters
          </Button>
        </div>
      )}

      {/* Bulk action bar */}
      {(selectAllMatching || selectedUuids.size > 0) && (
        <div className="flex items-center gap-3 p-3 bg-muted rounded-md flex-wrap">
          <span className="text-sm font-medium">
            {selectAllMatching
              ? `All ${imagesData?.total ?? 0} matching image(s) selected`
              : `${selectedUuids.size} image(s) selected`}
          </span>
          {selectAllMatching && (
            <button
              type="button"
              onClick={() => setSelectAllMatching(false)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => hideMutation.mutate(buildBulkTarget())}
            disabled={isMutating}
          >
            {hideMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <EyeOff className="h-4 w-4 mr-1" />
            )}
            Hide from analysis
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => unhideMutation.mutate(buildBulkTarget())}
            disabled={isMutating}
          >
            {unhideMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Eye className="h-4 w-4 mr-1" />
            )}
            Show in analysis
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadMutation.mutate(buildBulkTarget())}
            disabled={isMutating}
            title="Download a zip of the raw originals (capped at 500 images per request)"
          >
            {downloadMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Preparing zip...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-1" />
                Download zip
              </>
            )}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowDeleteConfirm(true)}
            disabled={isMutating}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Delete permanently
          </Button>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : !imagesData?.items.length ? (
        <div className="text-center py-12 text-muted-foreground">
          No images found
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  checked={selectAllMatching || allOnPageSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = !selectAllMatching && someOnPageSelected && !allOnPageSelected;
                  }}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded accent-primary cursor-pointer"
                />
              </TableHead>
              <TableHead className="w-16">Thumb</TableHead>
              <TableHead>
                <SortableHeader label="Filename" column="filename" sort={sort} onSort={handleSort} />
              </TableHead>
              <TableHead>
                <SortableHeader label="Camera" column="camera_name" sort={sort} onSort={handleSort} />
              </TableHead>
              <TableHead>
                <SortableHeader label="Date" column="captured_at" sort={sort} onSort={handleSort} />
              </TableHead>
              <TableHead className="w-12 text-center">Verified</TableHead>
              <TableHead className="w-12 text-center">Hidden</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {imagesData.items.map((image) => (
              <TableRow
                key={image.uuid}
                className={`cursor-pointer ${image.is_hidden ? 'opacity-50 bg-muted/50' : ''}`}
                onClick={(e) => {
                  // Don't open modal if clicking checkbox
                  if ((e.target as HTMLElement).closest('input[type="checkbox"]')) return;
                  setModalImageUuid(image.uuid);
                }}
              >
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selectAllMatching || selectedUuids.has(image.uuid)}
                    onChange={() => toggleSelect(image.uuid)}
                    className="w-4 h-4 rounded accent-primary cursor-pointer"
                  />
                </TableCell>
                <TableCell>
                  {image.thumbnail_url ? (
                    <AuthenticatedImage
                      src={image.thumbnail_url}
                      alt=""
                      className="h-10 w-14 object-cover rounded"
                      fallback={<div className="h-10 w-14 bg-muted rounded" />}
                    />
                  ) : (
                    <div className="h-10 w-14 bg-muted rounded" />
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs max-w-[200px] truncate">
                  {image.filename}
                </TableCell>
                <TableCell className="text-sm">{image.camera_name}</TableCell>
                <TableCell className="text-sm whitespace-nowrap">
                  {formatDateTime(image.captured_at)}
                </TableCell>
                <TableCell className="text-center">
                  {image.is_verified && (
                    <Check className="h-4 w-4 inline-block" style={{ color: '#0f6064' }} />
                  )}
                </TableCell>
                <TableCell className="text-center">
                  {image.is_hidden && (
                    <EyeOff className="h-4 w-4 inline-block" style={{ color: '#0f6064' }} />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Pagination */}
      {imagesData && imagesData.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(page - 1) * limit + 1}-{Math.min(page * limit, imagesData.total)} of {imagesData.total} images
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Image detail modal */}
      {modalImageUuid && (
        <ImageDetailModal
          imageUuid={modalImageUuid}
          allImageUuids={allImageUuids}
          isOpen={!!modalImageUuid}
          onClose={() => setModalImageUuid(null)}
          onPrevious={
            currentModalIndex > 0
              ? () => setModalImageUuid(allImageUuids[currentModalIndex - 1])
              : undefined
          }
          onNext={
            currentModalIndex < allImageUuids.length - 1
              ? () => setModalImageUuid(allImageUuids[currentModalIndex + 1])
              : undefined
          }
          hasPrevious={currentModalIndex > 0}
          hasNext={currentModalIndex < allImageUuids.length - 1}
        />
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={(open) => {
        if (!deleteMutation.isPending) {
          setShowDeleteConfirm(open);
          if (!open) setDeleteConfirmText('');
        }
      }}>
        <DialogContent onClose={() => {
          if (!deleteMutation.isPending) {
            setShowDeleteConfirm(false);
            setDeleteConfirmText('');
          }
        }}>
          <DialogHeader>
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <DialogTitle>Delete images permanently</DialogTitle>
            </div>
            <DialogDescription>
              This action cannot be undone. This will permanently delete {effectiveSelectionCount} image(s) and all associated data.
            </DialogDescription>
          </DialogHeader>

          <div className="border-2 border-destructive rounded-md p-4 my-4 bg-destructive/5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
              <div className="space-y-2 text-sm">
                <p className="font-semibold text-destructive">Warning: This will delete:</p>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li>{effectiveSelectionCount} image(s) and their files</li>
                  <li>All associated detections and classifications</li>
                  <li>All human observations</li>
                  <li>All crop and thumbnail files</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="delete-confirm" className="text-sm font-medium block">
              Type <span className="font-mono font-bold">DELETE</span> to confirm:
            </label>
            <input
              id="delete-confirm"
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="Type DELETE"
              className="w-full px-3 py-2 border rounded-md"
              autoComplete="off"
              disabled={deleteMutation.isPending}
            />
          </div>

          <DialogFooter className="mt-4">
            <Button
              variant="outline"
              onClick={() => {
                setShowDeleteConfirm(false);
                setDeleteConfirmText('');
              }}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteConfirmText !== 'DELETE' || deleteMutation.isPending}
              onClick={() => deleteMutation.mutate(buildBulkTarget())}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete {effectiveSelectionCount} image(s)
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
