/**
 * Site detail side panel
 *
 * Mirrors CameraDetailSheet so the two entity views feel the same:
 * - Overview: editable key fields (name, habitat, notes) inline for admins,
 *   then a read-only card with coordinates and aggregate counts.
 * - Deployments: a read-only journey of which cameras stood here over time.
 *   Each step links to the Deployments page (pre-filtered to this site), which
 *   is where reassignment happens.
 *
 * Merge and Delete live in a kebab menu in the header (admins only). Both open
 * the parent's existing dialogs via `onMergeRequested` / `onDeleteRequested`.
 */
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  Save,
  Trash2,
  ExternalLink,
  ChevronRight,
  MapPin,
  GitMerge,
  Camera as CameraIcon,
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
import { sitesApi } from '../api/sites';
import type { Camera } from '../api/types';
import {
  getStatusColor,
  getBatteryColor,
  getSignalColor,
  STATUS_LABELS,
} from '../utils/camera-colors';
import { TagInput } from './TagInput';
import { DeploymentJourney } from './DeploymentJourney';
import { SiteLocationMiniMap } from './sites/SiteLocationMiniMap';
import { cn } from '../lib/utils';
import { useToast } from './ui/Toaster';

type TabType = 'overview' | 'cameras' | 'deployments';

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: number;
  siteId: number | null;
  // Cameras currently at this site, for the cameras tab health summary.
  cameras?: Camera[];
  // Which tab to open on. Defaults to overview; the map opens straight to
  // cameras when a health colour is active.
  initialTab?: TabType;
  canEdit: boolean;
  // The merge and delete dialogs still live on the parent (they need the full
  // sites list and the existing mutations), so the kebab just signals up.
  onMergeRequested: (site: { id: number; name: string }) => void;
  onDeleteRequested: (site: { id: number; name: string }) => void;
}


function fmtCoords(lat: number | null, lon: number | null): string {
  if (lat == null || lon == null) return '-';
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

function errMsg(err: any): string {
  return err?.response?.data?.detail || err?.message || 'unknown error';
}

// A camera health line on the cameras tab: a coloured dot then the words.
// Same text size and spacing as the deployment journey rows.
const MetricRow: React.FC<{ color: string; text: string }> = ({ color, text }) => (
  <p className="flex items-center gap-2 text-muted-foreground">
    <span
      className="w-2 h-2 rounded-full shrink-0"
      style={{ backgroundColor: color }}
      aria-hidden="true"
    />
    {text}
  </p>
);

export const SiteDetailSheet: React.FC<Props> = ({
  open,
  onClose,
  projectId,
  siteId,
  cameras,
  initialTab = 'overview',
  canEdit,
  onMergeRequested,
  onDeleteRequested,
}) => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [editName, setEditName] = useState('');
  const [editHabitat, setEditHabitat] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);

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

  // Open on the requested tab when a different site is selected. Read fresh so
  // a clicked dot lands on cameras while a health colour is active.
  useEffect(() => {
    setActiveTab(initialTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            <div className="flex border-b -mt-2">
              <TabButton tab="overview" label="Overview" />
              <TabButton tab="cameras" label="Cameras" />
              <TabButton tab="deployments" label="Deployments" />
            </div>

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
                    <span className="text-muted-foreground">Deployments</span>
                    <span>{detail.deployment_count}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Images</span>
                    <span>{detail.image_count.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            ) : activeTab === 'cameras' ? (
              // Cameras tab: the cameras at this site with their health, so a
              // colour-coded site dot explains itself. Mirrors the deployment
              // journey layout. Each camera and the footer link open the
              // Cameras page, same as the deployments tab.
              cameras && cameras.length > 0 ? (
                <div className="space-y-3">
                  <ol className="relative ml-2 border-l border-border">
                    {cameras.map((c) => (
                      <li key={c.id} className="relative ml-5 pb-4 last:pb-0">
                        <span
                          className="absolute -left-[27px] top-3 h-2.5 w-2.5 rounded-full ring-2 ring-card"
                          style={{ backgroundColor: getStatusColor(c.status) }}
                        />
                        <Link
                          to={`/projects/${projectId}/cameras?search=${encodeURIComponent(c.device_id ?? c.name)}`}
                          className="block rounded-md border p-3 text-sm hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex items-center gap-2 font-medium min-w-0">
                            <CameraIcon className="h-4 w-4 text-primary shrink-0" />
                            <span className="truncate">{c.device_id ?? c.name}</span>
                          </div>
                          <div className="mt-1">
                            <MetricRow
                              color={getStatusColor(c.status)}
                              text={`Status ${STATUS_LABELS[c.status] ?? c.status}`}
                            />
                            <MetricRow
                              color={getBatteryColor(c.battery_percentage)}
                              text={`Battery ${c.battery_percentage != null ? `${c.battery_percentage}%` : 'unknown'}`}
                            />
                            <MetricRow
                              color={getSignalColor(c.signal_quality)}
                              text={`Signal ${c.signal_quality != null ? c.signal_quality : 'unknown'}`}
                            />
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ol>
                  <Link
                    to={`/projects/${projectId}/cameras?site=${siteId}`}
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    Open in Cameras
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No cameras at this site.
                </p>
              )
            ) : (
              // Deployments tab: a read-only journey of which cameras stood here
              // over time. Reassignment lives on the Deployments page.
              <DeploymentJourney
                mode="site"
                items={(detail.deployments ?? []).map((d) => ({
                  id: d.id,
                  title: d.camera_name,
                  startDate: d.start_date,
                  endDate: d.end_date,
                  imageCount: d.image_count,
                }))}
                linkTo={`/projects/${projectId}/deployments?site=${siteId}`}
                itemLinkTo={(id) => `/projects/${projectId}/deployments?deployment=${id}`}
                emptyText="No deployments at this site."
              />
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  );
};
