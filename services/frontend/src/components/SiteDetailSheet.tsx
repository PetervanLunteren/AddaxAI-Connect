/**
 * Site detail side panel
 *
 * Mirrors CameraDetailSheet so the two entity views feel the same:
 * - Overview: editable key fields (name, habitat, notes) inline for admins,
 *   then a read-only card with coordinates and aggregate counts.
 * - Deployments: the cameras standing here now, as the same deployment
 *   cards as the camera panel (DeploymentCards), with Edit, Undo and the
 *   Suspicious marker, and the ones that stood here before folded under
 *   "Earlier here"; the camera name opens that camera, where its health is.
 *
 * Merge and Delete live in a kebab menu in the header (admins only). Both open
 * the parent's existing dialogs via `onMergeRequested` / `onDeleteRequested`.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  Save,
  Trash2,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  MapPin,
  GitMerge,
  Images,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
} from './ui/Sheet';
import { Button } from './ui/Button';
import { sitesApi, type SiteDetail } from '../api/sites';
import { TagInput, type TagManagement } from './TagInput';
import { DeploymentCards } from './deployments/DeploymentCards';
import { SiteLocationMiniMap } from './sites/SiteLocationMiniMap';
import { useToast } from './ui/Toaster';
import { ServiceSummaryRows } from './service/ServiceSummaryRows';
import { TabStrip } from './ui/TabStrip';
import { isAutoSiteName } from '../utils/site-names';
import { errorDetail } from '../lib/utils';

type TabType = 'overview' | 'deployments';

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: number;
  siteId: number | null;
  // Which tab to open on. Defaults to overview; the map opens on
  // deployments when a health colour is active.
  initialTab?: TabType;
  canEdit: boolean;
  // The merge and delete dialogs still live on the parent (they need the full
  // sites list and the existing mutations), so the kebab just signals up.
  onMergeRequested: (site: { id: number; name: string }) => void;
  onDeleteRequested: (site: { id: number; name: string }) => void;
  // Project-wide rename and delete inside the tag widget, admin contexts only.
  tagManagement?: TagManagement;
}


function fmtCoords(lat: number | null, lon: number | null): string {
  if (lat == null || lon == null) return '-';
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

/**
 * The Deployments tab: the cameras standing here now first, as the same
 * cards as the camera panel (DeploymentCards); the cameras that stood here
 * before under "Earlier here", folded. Now means the deployment has no last
 * day, the rule of "to now" on a card and of the site's camera count; a
 * camera that went silent still stands here.
 */
const SiteDeployments: React.FC<{ projectId: number; detail: SiteDetail; canEdit: boolean }> = ({
  projectId, detail, canEdit,
}) => {
  const [showEarlier, setShowEarlier] = useState(false);
  const cards = (detail.deployments ?? []).map((d) => ({
    id: d.id,
    cameraId: d.camera_id,
    cameraName: d.camera_name,
    siteId: detail.id,
    siteName: detail.name,
    startDate: d.start_date,
    endDate: d.end_date,
    imageCount: d.image_count,
    lat: d.latitude,
    lon: d.longitude,
  }));
  const now = cards.filter((c) => c.endDate === null);
  const earlier = cards.filter((c) => c.endDate !== null);
  return (
    <div className="space-y-3">
      <DeploymentCards
        projectId={projectId}
        deployments={now}
        canEdit={canEdit}
        emptyText="No camera stands here now."
      />
      {earlier.length > 0 && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setShowEarlier((v) => !v)}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            aria-expanded={showEarlier}
          >
            {showEarlier ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Earlier here ({earlier.length})
          </button>
          {showEarlier && (
            <DeploymentCards projectId={projectId} deployments={earlier} canEdit={canEdit} emptyText="" />
          )}
        </div>
      )}
    </div>
  );
};

export const SiteDetailSheet: React.FC<Props> = ({
  open,
  onClose,
  projectId,
  siteId,
  initialTab = 'overview',
  canEdit,
  onMergeRequested,
  onDeleteRequested,
  tagManagement,
}) => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [editName, setEditName] = useState('');
  const [editHabitat, setEditHabitat] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const nameInput = useRef<HTMLInputElement>(null);

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

  // True when the form differs from the given copy of the site.
  const differsFrom = (d: SiteDetail) =>
    editName.trim() !== d.name ||
    (editHabitat.trim() || null) !== (d.habitat_type ?? null) ||
    (editNotes.trim() || null) !== (d.notes ?? null) ||
    JSON.stringify(editTags) !== JSON.stringify(d.tags ?? []);

  // Reseed when the loaded detail changes: another site opened, a save, or a
  // project-wide tag rename or delete started from this form's tag field.
  // In that last case the form can hold unsaved edits. They stay, and only
  // the server's tag change (tags gone, tags new) is applied to the field,
  // so a later Save does not undo the rename on this site.
  const seededFrom = useRef<SiteDetail | null>(null);
  useEffect(() => {
    if (!detail) return;
    const prev = seededFrom.current;
    seededFrom.current = detail;
    if (!prev || prev.id !== detail.id || !differsFrom(prev)) {
      resetForm();
      return;
    }
    const before = prev.tags ?? [];
    const after = detail.tags ?? [];
    const gone = new Set(before.filter((t) => !after.includes(t)));
    const added = after.filter((t) => !before.includes(t));
    setEditTags((tags) => [...new Set([...tags.filter((t) => !gone.has(t)), ...added])]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail]);

  // Open on the requested tab when a different site is selected. Read fresh so
  // a clicked dot lands on deployments while a health colour is active.
  useEffect(() => {
    setActiveTab(initialTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  const coreChanged = !!detail && differsFrom(detail);

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
    onError: (err) => toast.error(`Could not update site, ${errorDetail(err)}`),
  });

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
            <TabStrip<TabType>
              className="-mt-2"
              tabs={[
                { key: 'overview', label: 'Overview' },
                { key: 'deployments', label: 'Deployments' },
              ]}
              value={activeTab}
              onChange={setActiveTab}
            />

            {isLoading || !detail ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Loading
              </div>
            ) : activeTab === 'overview' ? (
              <div className="space-y-6">
                {/* Actions: Images for everyone, Merge/Delete for admins.
                    grid-cols-3 caps each button at a third of the width. */}
                <div>
                  <label className="text-xs text-muted-foreground">Actions</label>
                  <div className="mt-1 grid grid-cols-3 gap-2">
                    {siteId != null && (
                      <Button
                        variant="outline"
                        onClick={() => navigate(`/projects/${projectId}/images?site_id=${siteId}`)}
                      >
                        <Images className="h-4 w-4 mr-2" />
                        Images
                      </Button>
                    )}
                    {canEdit && detail && (
                      <>
                        <Button
                          variant="outline"
                          onClick={() => onMergeRequested({ id: detail.id, name: detail.name })}
                        >
                          <GitMerge className="h-4 w-4 mr-2" />
                          Merge
                        </Button>
                        <Button
                          variant="outline"
                          className="text-destructive hover:text-destructive"
                          onClick={() => onDeleteRequested({ id: detail.id, name: detail.name })}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-xs text-muted-foreground">Name</label>
                      {/* Only a nudge: many projects keep the names the app gives. */}
                      {canEdit && isAutoSiteName(detail.name) && editName === detail.name && (
                        <button
                          type="button"
                          className="text-xs text-primary hover:underline"
                          onClick={() => {
                            nameInput.current?.focus();
                            nameInput.current?.select();
                          }}
                        >
                          Name this site
                        </button>
                      )}
                    </div>
                    {canEdit ? (
                      <input
                        ref={nameInput}
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
                        placeholder='For example "wetland" or "otter territory"'
                        management={tagManagement}
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

                <div className="rounded-lg border p-4 space-y-3 text-sm">
                  {detail.latitude != null && detail.longitude != null && (
                    <SiteLocationMiniMap
                      latitude={detail.latitude}
                      longitude={detail.longitude}
                    />
                  )}
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
                    <span className="text-muted-foreground">Images</span>
                    <span>{detail.image_count.toLocaleString()}</span>
                  </div>
                  <ServiceSummaryRows projectId={projectId} by="site" id={detail.id} />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <Link
                  to={`/projects/${projectId}/cameras?site=${siteId}`}
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  Open in Cameras
                  <ChevronRight className="h-4 w-4" />
                </Link>
                <SiteDeployments key={detail.id} projectId={projectId} detail={detail} canEdit={canEdit} />
              </div>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>

    </>
  );
};
