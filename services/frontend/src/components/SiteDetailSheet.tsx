/**
 * Site detail side panel
 *
 * Mirrors CameraDetailSheet so the two entity views feel the same:
 * - Overview: editable key fields (name, habitat, notes) inline for admins,
 *   then a read-only card with coordinates and aggregate counts.
 * - Deployments: list of deployments at this site, click a row to open the
 *   shared DeploymentEditModal (editable for admins, read-only otherwise).
 *
 * Merge and Delete live in a kebab menu in the header (admins only). Both open
 * the parent's existing dialogs via `onMergeRequested` / `onDeleteRequested`.
 */
import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  Save,
  Trash2,
  ExternalLink,
  MapPin,
  Camera,
  Move,
  GitMerge,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
} from './ui/Sheet';
import { Button } from './ui/Button';
import { sitesApi, type DeploymentSummary } from '../api/sites';
import { DeploymentEditModal } from './DeploymentEditModal';
import { TagInput } from './TagInput';
import { SiteFormModal } from './sites/SiteFormModal';
import { cn } from '../lib/utils';
import { useToast } from './ui/Toaster';

type TabType = 'overview' | 'deployments';

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: number;
  siteId: number | null;
  canEdit: boolean;
  // The merge and delete dialogs still live on the parent (they need the full
  // sites list and the existing mutations), so the kebab just signals up.
  onMergeRequested: (site: { id: number; name: string }) => void;
  onDeleteRequested: (site: { id: number; name: string }) => void;
}

function fmtDate(s: string | null): string {
  if (!s) return '-';
  const d = new Date(s);
  return isNaN(d.getTime())
    ? s
    : d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
}

function fmtCoords(lat: number | null, lon: number | null): string {
  if (lat == null || lon == null) return '-';
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

function errMsg(err: any): string {
  return err?.response?.data?.detail || err?.message || 'unknown error';
}

export const SiteDetailSheet: React.FC<Props> = ({
  open,
  onClose,
  projectId,
  siteId,
  canEdit,
  onMergeRequested,
  onDeleteRequested,
}) => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [editName, setEditName] = useState('');
  const [editHabitat, setEditHabitat] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [openDep, setOpenDep] = useState<DeploymentSummary | null>(null);
  const [showMove, setShowMove] = useState(false);

  const { data: detail, isLoading } = useQuery({
    queryKey: ['site', projectId, siteId],
    queryFn: () => sitesApi.get(projectId, siteId as number),
    enabled: siteId != null,
  });

  // Tag autocomplete suggestions, project-wide.
  const { data: tagSuggestions } = useQuery({
    queryKey: ['site-tags', projectId],
    queryFn: () => sitesApi.getTags(projectId),
    enabled: open,
  });

  // Seed the editable fields from the loaded site. Used both by the effect
  // below (on load / site switch / after save) and by the Discard button.
  const resetForm = () => {
    if (!detail) return;
    setEditName(detail.name);
    setEditHabitat(detail.habitat_type ?? '');
    setEditNotes(detail.notes ?? '');
    setEditTags(detail.tags ?? []);
  };

  // Reseed when the loaded detail changes (open a different site, or after a
  // save invalidates the cache).
  useEffect(() => {
    resetForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail]);

  useEffect(() => {
    setActiveTab('overview');
  }, [siteId]);

  const coreChanged =
    !!detail &&
    (editName.trim() !== detail.name ||
      (editHabitat.trim() || null) !== (detail.habitat_type ?? null) ||
      (editNotes.trim() || null) !== (detail.notes ?? null) ||
      JSON.stringify(editTags) !== JSON.stringify(detail.tags ?? []));

  const saveMutation = useMutation({
    mutationFn: () =>
      sitesApi.update(projectId, siteId as number, {
        name: editName.trim(),
        habitat_type: editHabitat.trim() || null,
        notes: editNotes.trim() || null,
        tags: editTags,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sites', projectId] });
      queryClient.invalidateQueries({ queryKey: ['site', projectId] });
      queryClient.invalidateQueries({ queryKey: ['site-tags', projectId] });
      toast.success('Site updated');
    },
    onError: (err) => toast.error(`Could not update site, ${errMsg(err)}`),
  });

  const TabButton = ({ tab, label }: { tab: TabType; label: string }) => (
    <button
      onClick={() => setActiveTab(tab)}
      className={cn(
        'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
        activeTab === tab
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );

  if (!siteId) return null;

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
        <SheetContent onClose={onClose}>
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 pr-8">
              <MapPin className="h-5 w-5" />
              {detail?.name ?? 'Site'}
            </SheetTitle>
          </SheetHeader>

          <SheetBody className="space-y-6">
            {canEdit && detail && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowMove(true)}>
                  <Move className="h-4 w-4 mr-2" />
                  Move
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onMergeRequested({ id: detail.id, name: detail.name })}
                >
                  <GitMerge className="h-4 w-4 mr-2" />
                  Merge
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onDeleteRequested({ id: detail.id, name: detail.name })}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>
              </div>
            )}

            <div className="flex border-b -mt-2">
              <TabButton tab="overview" label="Overview" />
              <TabButton tab="deployments" label="Deployments" />
            </div>

            {isLoading || !detail ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Loading
              </div>
            ) : activeTab === 'overview' ? (
              <div className="space-y-6">
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-muted-foreground">Name</label>
                    {canEdit ? (
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="e.g. North ridge"
                        className="w-full px-3 py-2 border rounded-md text-sm"
                      />
                    ) : (
                      <p className="text-sm mt-1">{detail.name}</p>
                    )}
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Habitat</label>
                    {canEdit ? (
                      <input
                        type="text"
                        value={editHabitat}
                        onChange={(e) => setEditHabitat(e.target.value)}
                        placeholder="e.g. mixed forest"
                        className="w-full px-3 py-2 border rounded-md text-sm"
                      />
                    ) : (
                      <p className="text-sm mt-1">{detail.habitat_type ?? '-'}</p>
                    )}
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Notes</label>
                    {canEdit ? (
                      <textarea
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        rows={4}
                        placeholder="e.g. boggy after rain, bring the tall boots"
                        className="w-full px-3 py-2 border rounded-md text-sm"
                      />
                    ) : (
                      <p className="text-sm mt-1 whitespace-pre-wrap">
                        {detail.notes ?? '-'}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Tags</label>
                    {canEdit ? (
                      <TagInput
                        value={editTags}
                        onChange={setEditTags}
                        suggestions={tagSuggestions ?? []}
                        placeholder="wetland, otter-territory"
                      />
                    ) : (
                      <div className="flex flex-wrap gap-1.5 min-h-[2.5rem] px-3 py-1.5">
                        {editTags.length > 0 ? (
                          editTags.map((tag) => (
                            <span
                              key={tag}
                              className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-accent text-accent-foreground"
                            >
                              {tag}
                            </span>
                          ))
                        ) : (
                          <span className="text-sm text-muted-foreground">No tags</span>
                        )}
                      </div>
                    )}
                  </div>
                  {coreChanged && canEdit && (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={resetForm}
                        disabled={saveMutation.isPending}
                        className="flex-1"
                      >
                        Discard
                      </Button>
                      <Button
                        onClick={() => saveMutation.mutate()}
                        disabled={saveMutation.isPending || !editName.trim()}
                        className="flex-1"
                      >
                        {saveMutation.isPending ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          <>
                            <Save className="h-4 w-4 mr-2" />
                            Save changes
                          </>
                        )}
                      </Button>
                    </div>
                  )}
                </div>

                <div className="rounded-lg border p-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Coordinates</span>
                    {detail.latitude != null && detail.longitude != null ? (
                      <span className="flex items-center gap-1">
                        {fmtCoords(detail.latitude, detail.longitude)}
                        <a
                          href={`https://www.google.com/maps?q=${detail.latitude},${detail.longitude}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </span>
                    ) : (
                      <span>-</span>
                    )}
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cameras</span>
                    <span>{detail.camera_count}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Deployments</span>
                    <span>{detail.deployment_count}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Images</span>
                    <span>{detail.image_count.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            ) : (
              // Deployments tab: same card shape as CameraDeploymentHistory.
              detail.deployments.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No deployments at this site.
                </p>
              ) : (
                <div className="space-y-3">
                  {detail.deployments.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={canEdit ? () => setOpenDep(d) : undefined}
                      disabled={!canEdit}
                      className={cn(
                        'w-full text-left rounded-md border p-3',
                        canEdit ? 'cursor-pointer hover:bg-muted/50' : '',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Camera className="h-4 w-4 shrink-0 text-primary" />
                          <span className="font-medium truncate">{d.camera_name}</span>
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {d.image_count.toLocaleString()} images
                        </span>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {fmtDate(d.start_date)} to{' '}
                        {d.end_date ? fmtDate(d.end_date) : 'now'}
                      </div>
                    </button>
                  ))}
                </div>
              )
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>

      <DeploymentEditModal
        open={openDep != null}
        onClose={() => setOpenDep(null)}
        projectId={projectId}
        deploymentId={openDep?.id ?? 0}
        cameraName={openDep?.camera_name ?? ''}
        siteName={detail?.name ?? null}
        initialSiteId={siteId}
        deploymentLat={openDep?.latitude ?? null}
        deploymentLon={openDep?.longitude ?? null}
        invalidateKeys={[
          ['site', projectId, siteId],
          ['sites', projectId],
        ]}
      />

      {detail && (
        <SiteFormModal
          open={showMove}
          onClose={() => setShowMove(false)}
          projectId={projectId}
          sites={[]}
          moveSite={{
            id: detail.id,
            name: detail.name,
            latitude: detail.latitude,
            longitude: detail.longitude,
          }}
        />
      )}
    </>
  );
};
