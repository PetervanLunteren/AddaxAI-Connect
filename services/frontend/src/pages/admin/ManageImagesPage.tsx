/**
 * Image management admin page
 *
 * Allows project admins to view all images (including hidden),
 * bulk hide/unhide images from analysis, and permanently delete images.
 */
import React, { useState, useEffect, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  EyeOff, Eye, Trash2, Loader2, Search, ArrowUp, ArrowDown, ArrowUpDown,
  ChevronLeft, ChevronRight, AlertTriangle, CheckCircle, Check,
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
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
import { imagesApi } from '../../api/images';
import type { ImageListItem } from '../../api/types';
import { formatDateTime } from '../../utils/datetime';

type SortColumn = 'filename' | 'camera_name' | 'captured_at';

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
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [cameraFilter, setCameraFilter] = useState('');
  const [hiddenFilter, setHiddenFilter] = useState('');
  const [verifiedFilter, setVerifiedFilter] = useState('');
  const [speciesFilter, setSpeciesFilter] = useState('');
  const [sort, setSort] = useState<{ column: SortColumn; direction: 'asc' | 'desc' }>({
    column: 'captured_at',
    direction: 'desc',
  });
  const [selectedUuids, setSelectedUuids] = useState<Set<string>>(new Set());
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
  }, [debouncedSearch, cameraFilter, hiddenFilter, verifiedFilter, speciesFilter, sort]);

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
    queryKey: ['admin-images', projectId, page, debouncedSearch, cameraFilter, hiddenFilter, verifiedFilter, speciesFilter, sort],
    queryFn: () =>
      imageAdminApi.getAll({
        project_id: projectId!,
        page,
        limit,
        camera_id: cameraFilter ? parseInt(cameraFilter) : undefined,
        hidden: hiddenFilter || undefined,
        verified: verifiedFilter || undefined,
        species: speciesFilter || undefined,
        search: debouncedSearch || undefined,
        sort_by: sortByMap[sort.column],
        sort_dir: sort.direction,
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

  // Mutations
  const hideMutation = useMutation({
    mutationFn: (uuids: string[]) => imageAdminApi.bulkHide(projectId!, uuids),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['admin-images'] });
      queryClient.invalidateQueries({ queryKey: ['images'] });
      queryClient.invalidateQueries({ queryKey: ['statistics'] });
      setSelectedUuids(new Set());
      setSuccessMessage(`${result.success_count} image(s) hidden from analysis`);
      setTimeout(() => setSuccessMessage(null), 3000);
    },
  });

  const unhideMutation = useMutation({
    mutationFn: (uuids: string[]) => imageAdminApi.bulkUnhide(projectId!, uuids),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['admin-images'] });
      queryClient.invalidateQueries({ queryKey: ['images'] });
      queryClient.invalidateQueries({ queryKey: ['statistics'] });
      setSelectedUuids(new Set());
      setSuccessMessage(`${result.success_count} image(s) restored to analysis`);
      setTimeout(() => setSuccessMessage(null), 3000);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (uuids: string[]) => imageAdminApi.bulkDelete(projectId!, uuids),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['admin-images'] });
      queryClient.invalidateQueries({ queryKey: ['images'] });
      queryClient.invalidateQueries({ queryKey: ['statistics'] });
      setSelectedUuids(new Set());
      setShowDeleteConfirm(false);
      setDeleteConfirmText('');
      setSuccessMessage(`${result.success_count} image(s) permanently deleted`);
      setTimeout(() => setSuccessMessage(null), 3000);
    },
  });

  const isMutating = hideMutation.isPending || unhideMutation.isPending || deleteMutation.isPending;

  // Selection helpers
  const currentPageUuids = useMemo(
    () => imagesData?.items.map((img) => img.uuid) ?? [],
    [imagesData],
  );

  const allOnPageSelected = currentPageUuids.length > 0 && currentPageUuids.every((uuid) => selectedUuids.has(uuid));
  const someOnPageSelected = currentPageUuids.some((uuid) => selectedUuids.has(uuid));

  const toggleSelectAll = () => {
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
  const selectedArray = Array.from(selectedUuids);

  // Image navigation within modal
  const allImageUuids = currentPageUuids;
  const currentModalIndex = modalImageUuid ? allImageUuids.indexOf(modalImageUuid) : -1;

  const hasActiveFilters = cameraFilter || hiddenFilter || verifiedFilter || speciesFilter || debouncedSearch;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Curation</h1>
        <p className="text-muted-foreground mt-1">
          Hide or delete images from this project
        </p>
      </div>

      {/* Success message */}
      {successMessage && (
        <div className="flex items-center gap-2 p-3 bg-green-50 text-green-700 rounded-md border border-green-200">
          <CheckCircle className="h-4 w-4" />
          <span className="text-sm">{successMessage}</span>
        </div>
      )}

      {/* Filters bar */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={cameraFilter}
          onValueChange={setCameraFilter}
          className="w-48"
        >
          <option value="">All cameras</option>
          {cameras?.map((cam) => (
            <option key={cam.id} value={cam.id}>
              {cam.name}
            </option>
          ))}
        </Select>

        <Select
          value={hiddenFilter}
          onValueChange={setHiddenFilter}
          className="w-40"
        >
          <option value="">All visibility</option>
          <option value="false">Visible</option>
          <option value="true">Hidden</option>
        </Select>

        <Select
          value={verifiedFilter}
          onValueChange={setVerifiedFilter}
          className="w-40"
        >
          <option value="">All verification</option>
          <option value="true">Verified</option>
          <option value="false">Unverified</option>
        </Select>

        <Select
          value={speciesFilter}
          onValueChange={setSpeciesFilter}
          className="w-48"
        >
          <option value="">All species</option>
          {speciesOptions?.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>

        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search filename..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 h-10 rounded-md border border-input bg-background text-sm"
          />
        </div>

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setCameraFilter('');
              setHiddenFilter('');
              setVerifiedFilter('');
              setSpeciesFilter('');
              setSearch('');
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {/* Bulk action bar */}
      {selectedUuids.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-muted rounded-md">
          <span className="text-sm font-medium">
            {selectedUuids.size} image(s) selected
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => hideMutation.mutate(selectedArray)}
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
            onClick={() => unhideMutation.mutate(selectedArray)}
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
                  checked={allOnPageSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someOnPageSelected && !allOnPageSelected;
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
                    checked={selectedUuids.has(image.uuid)}
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
              This action cannot be undone. This will permanently delete {selectedUuids.size} image(s) and all associated data.
            </DialogDescription>
          </DialogHeader>

          <div className="border-2 border-destructive rounded-md p-4 my-4 bg-destructive/5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
              <div className="space-y-2 text-sm">
                <p className="font-semibold text-destructive">Warning: This will delete:</p>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li>{selectedUuids.size} image(s) and their files</li>
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
              onClick={() => deleteMutation.mutate(selectedArray)}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete {selectedUuids.size} image(s)
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
