/**
 * Sites page.
 *
 * Lists the project's sites (physical places that group camera deployments)
 * with their camera, deployment and image counts. Project admins can add,
 * rename, merge and delete sites. Clicking a site opens a detail panel with
 * its deployments.
 */
import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MapPin, Plus, MoreVertical, Loader2, Map as MapIcon, Table as TableIcon } from 'lucide-react';
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
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetBody,
} from '../components/ui/Sheet';
import { useProject } from '../contexts/ProjectContext';
import { useToast } from '../components/ui/Toaster';
import { sitesApi, type SiteListItem } from '../api/sites';
import { SitesMapView } from '../components/sites/SitesMapView';

const inputClass =
  'w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring';

function errMsg(err: unknown): string {
  const e = err as { response?: { data?: { detail?: string } }; message?: string };
  return e?.response?.data?.detail || e?.message || 'Unknown error';
}

function fmtDate(s: string | null): string {
  if (!s) return '-';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtCoords(lat: number | null, lon: number | null): string {
  if (lat == null || lon == null) return '-';
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export const SitesPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const pid = Number(projectId);
  const { selectedProject, isProjectAdmin, isServerAdmin } = useProject();
  const canEdit = isProjectAdmin || isServerAdmin;
  const toast = useToast();
  const queryClient = useQueryClient();

  const [viewMode, setViewMode] = useState<'table' | 'map'>('table');
  const [detailSiteId, setDetailSiteId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createLat, setCreateLat] = useState('');
  const [createLon, setCreateLon] = useState('');
  const [editSite, setEditSite] = useState<SiteListItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editHabitat, setEditHabitat] = useState('');
  const [mergeSite, setMergeSite] = useState<SiteListItem | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [deleteSite, setDeleteSite] = useState<SiteListItem | null>(null);

  const { data: sites, isLoading } = useQuery({
    queryKey: ['sites', pid],
    queryFn: () => sitesApi.list(pid),
    enabled: Number.isFinite(pid),
  });

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['site', pid, detailSiteId],
    queryFn: () => sitesApi.get(pid, detailSiteId as number),
    enabled: detailSiteId != null,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['sites', pid] });
    queryClient.invalidateQueries({ queryKey: ['site', pid] });
  };

  const createMutation = useMutation({
    mutationFn: () =>
      sitesApi.create(pid, {
        name: createName.trim(),
        latitude: Number(createLat),
        longitude: Number(createLon),
      }),
    onSuccess: () => {
      invalidate();
      setShowCreate(false);
      setCreateName('');
      setCreateLat('');
      setCreateLon('');
      toast.success('Site created');
    },
    onError: (err) => toast.error(`Could not create site, ${errMsg(err)}`),
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      sitesApi.update(pid, (editSite as SiteListItem).id, {
        name: editName.trim(),
        habitat_type: editHabitat.trim() || null,
      }),
    onSuccess: () => {
      invalidate();
      setEditSite(null);
      toast.success('Site updated');
    },
    onError: (err) => toast.error(`Could not update site, ${errMsg(err)}`),
  });

  const mergeMutation = useMutation({
    mutationFn: () =>
      sitesApi.merge(pid, (mergeSite as SiteListItem).id, Number(mergeTargetId)),
    onSuccess: () => {
      invalidate();
      setMergeSite(null);
      setMergeTargetId('');
      toast.success('Sites merged');
    },
    onError: (err) => toast.error(`Could not merge sites, ${errMsg(err)}`),
  });

  const deleteMutation = useMutation({
    mutationFn: () => sitesApi.remove(pid, (deleteSite as SiteListItem).id),
    onSuccess: () => {
      invalidate();
      setDeleteSite(null);
      toast.success('Site deleted');
    },
    onError: (err) => toast.error(`Could not delete site, ${errMsg(err)}`),
  });

  if (!selectedProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Please select a project to view sites.</p>
      </div>
    );
  }

  const otherSites = (sites ?? []).filter((s) => s.id !== mergeSite?.id);

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-0">Sites</h1>
          <p className="text-sm text-gray-600 mt-1">
            Physical places where cameras are deployed. Each site groups the
            deployments at that location.
          </p>
        </div>
        {canEdit && (
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add site
          </Button>
        )}
      </div>

      {!isLoading && sites && sites.length > 0 && (
        <div className="flex justify-end mb-4">
          <div className="flex rounded-md shadow-sm" role="group">
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`h-9 px-3 text-sm font-medium rounded-l-md border flex items-center gap-1.5 ${
                viewMode === 'table'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              <TableIcon className="h-4 w-4" /> Table
            </button>
            <button
              type="button"
              onClick={() => setViewMode('map')}
              className={`h-9 px-3 text-sm font-medium rounded-r-md border-t border-r border-b flex items-center gap-1.5 ${
                viewMode === 'map'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              <MapIcon className="h-4 w-4" /> Map
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading sites
        </div>
      ) : !sites || sites.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <MapPin className="h-8 w-8 mx-auto mb-3 opacity-50" />
            <p>No sites yet. Sites are created automatically as cameras report
              their location, or you can add one.</p>
          </CardContent>
        </Card>
      ) : viewMode === 'map' ? (
        <SitesMapView sites={sites} onSiteClick={(id) => setDetailSiteId(id)} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Cameras</TableHead>
                  <TableHead className="text-right">Deployments</TableHead>
                  <TableHead className="text-right">Images</TableHead>
                  <TableHead>Last activity</TableHead>
                  <TableHead>Coordinates</TableHead>
                  {canEdit && <TableHead className="w-10"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sites.map((site) => (
                  <TableRow key={site.id} className="cursor-pointer">
                    <TableCell
                      className="font-medium"
                      onClick={() => setDetailSiteId(site.id)}
                    >
                      {site.name}
                    </TableCell>
                    <TableCell className="text-right" onClick={() => setDetailSiteId(site.id)}>
                      {site.camera_count}
                    </TableCell>
                    <TableCell className="text-right" onClick={() => setDetailSiteId(site.id)}>
                      {site.deployment_count}
                    </TableCell>
                    <TableCell className="text-right" onClick={() => setDetailSiteId(site.id)}>
                      {site.image_count.toLocaleString()}
                    </TableCell>
                    <TableCell onClick={() => setDetailSiteId(site.id)}>
                      {fmtDate(site.last_activity)}
                    </TableCell>
                    <TableCell
                      className="text-muted-foreground text-sm"
                      onClick={() => setDetailSiteId(site.id)}
                    >
                      {fmtCoords(site.latitude, site.longitude)}
                    </TableCell>
                    {canEdit && (
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => {
                                setEditSite(site);
                                setEditName(site.name);
                                setEditHabitat(site.habitat_type ?? '');
                              }}
                            >
                              Rename / edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                setMergeSite(site);
                                setMergeTargetId('');
                              }}
                            >
                              Merge into...
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => setDeleteSite(site)}
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Detail sheet */}
      <Sheet open={detailSiteId != null} onOpenChange={(o) => !o && setDetailSiteId(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{detail?.name ?? 'Site'}</SheetTitle>
            <SheetDescription>
              {detail
                ? `${fmtCoords(detail.latitude, detail.longitude)} | ${detail.deployment_count} deployments | ${detail.image_count.toLocaleString()} images`
                : ''}
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            {detailLoading || !detail ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Loading
              </div>
            ) : (
              <div className="space-y-4">
                {detail.habitat_type && (
                  <p className="text-sm">
                    <span className="text-muted-foreground">Habitat </span>
                    {detail.habitat_type}
                  </p>
                )}
                <div>
                  <h3 className="text-sm font-semibold mb-2">Deployments</h3>
                  {detail.deployments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No deployments at this site.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Camera</TableHead>
                          <TableHead>Label</TableHead>
                          <TableHead>Period</TableHead>
                          <TableHead className="text-right">Images</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.deployments.map((d) => (
                          <TableRow key={d.id}>
                            <TableCell className="font-medium">{d.camera_name}</TableCell>
                            <TableCell>{d.label ?? '-'}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {fmtDate(d.start_date)} to {d.end_date ? fmtDate(d.end_date) : 'now'}
                            </TableCell>
                            <TableCell className="text-right">
                              {d.image_count.toLocaleString()}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </div>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add site</DialogTitle>
            <DialogDescription>
              Create a site at a fixed location. Cameras reporting GPS near this
              point will be grouped here.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Name</label>
              <input
                type="text"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                className={inputClass}
                placeholder="e.g. North ridge"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-2">Latitude</label>
                <input
                  type="number"
                  step="any"
                  value={createLat}
                  onChange={(e) => setCreateLat(e.target.value)}
                  className={inputClass}
                  placeholder="49.8225"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Longitude</label>
                <input
                  type="number"
                  step="any"
                  value={createLon}
                  onChange={(e) => setCreateLon(e.target.value)}
                  className={inputClass}
                  placeholder="5.7276"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={
                createMutation.isPending ||
                !createName.trim() ||
                createLat === '' ||
                createLon === ''
              }
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={editSite != null} onOpenChange={(o) => !o && setEditSite(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit site</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Name</label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Habitat type</label>
              <input
                type="text"
                value={editHabitat}
                onChange={(e) => setEditHabitat(e.target.value)}
                className={inputClass}
                placeholder="optional, e.g. forest"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditSite(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending || !editName.trim()}
            >
              {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Merge dialog */}
      <Dialog open={mergeSite != null} onOpenChange={(o) => !o && setMergeSite(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge site</DialogTitle>
            <DialogDescription>
              Move every deployment from "{mergeSite?.name}" into another site,
              then delete "{mergeSite?.name}". This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div>
            <label className="block text-sm font-medium mb-2">Merge into</label>
            <select
              value={mergeTargetId}
              onChange={(e) => setMergeTargetId(e.target.value)}
              className={inputClass}
            >
              <option value="">Select a site</option>
              {otherSites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeSite(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => mergeMutation.mutate()}
              disabled={mergeMutation.isPending || mergeTargetId === ''}
            >
              {mergeMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Merge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleteSite != null}
        onClose={() => setDeleteSite(null)}
        onConfirm={() => deleteMutation.mutate()}
        title="Delete site"
        body={
          <>
            Delete "{deleteSite?.name}"? Its deployments keep their data but lose
            the site link. This cannot be undone.
          </>
        }
        confirmLabel="Delete"
        variant="destructive"
        isPending={deleteMutation.isPending}
      />
    </div>
  );
};
