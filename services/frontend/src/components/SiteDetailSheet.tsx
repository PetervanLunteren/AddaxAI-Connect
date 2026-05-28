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
  MoreVertical,
  Save,
  Trash2,
  ExternalLink,
  MapPin,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
} from './ui/Sheet';
import { Button } from './ui/Button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from './ui/DropdownMenu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/Table';
import { sitesApi, type DeploymentSummary } from '../api/sites';
import { DeploymentEditModal } from './DeploymentEditModal';
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
  const [openDep, setOpenDep] = useState<DeploymentSummary | null>(null);

  const { data: detail, isLoading } = useQuery({
    queryKey: ['site', projectId, siteId],
    queryFn: () => sitesApi.get(projectId, siteId as number),
    enabled: siteId != null,
  });

  // Reseed the form when the loaded detail changes (open a different site, or
  // after a save invalidates the cache). On close, reset the tab so reopen
  // starts on Overview.
  useEffect(() => {
    if (detail) {
      setEditName(detail.name);
      setEditHabitat(detail.habitat_type ?? '');
      setEditNotes(detail.notes ?? '');
    }
  }, [detail]);

  useEffect(() => {
    setActiveTab('overview');
  }, [siteId]);

  const coreChanged =
    !!detail &&
    (editName.trim() !== detail.name ||
      (editHabitat.trim() || null) !== (detail.habitat_type ?? null) ||
      (editNotes.trim() || null) !== (detail.notes ?? null));

  const saveMutation = useMutation({
    mutationFn: () =>
      sitesApi.update(projectId, siteId as number, {
        name: editName.trim(),
        habitat_type: editHabitat.trim() || null,
        notes: editNotes.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sites', projectId] });
      queryClient.invalidateQueries({ queryKey: ['site', projectId] });
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
            <div className="flex items-center justify-between gap-2 pr-8">
              <SheetTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                {detail?.name ?? 'Site'}
              </SheetTitle>
              {canEdit && detail && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() =>
                        onMergeRequested({ id: detail.id, name: detail.name })
                      }
                    >
                      Merge into another site
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        onDeleteRequested({ id: detail.id, name: detail.name })
                      }
                      className="text-destructive"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete site
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </SheetHeader>

          <SheetBody className="space-y-6">
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
                        placeholder="optional, e.g. forest"
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
                        className="w-full px-3 py-2 border rounded-md text-sm"
                      />
                    ) : (
                      <p className="text-sm mt-1 whitespace-pre-wrap">
                        {detail.notes ?? '-'}
                      </p>
                    )}
                  </div>
                  {coreChanged && canEdit && (
                    <Button
                      onClick={() => saveMutation.mutate()}
                      disabled={saveMutation.isPending || !editName.trim()}
                      className="w-full"
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
              // Deployments tab
              detail.deployments.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No deployments at this site.
                </p>
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
                      <TableRow
                        key={d.id}
                        onClick={() => setOpenDep(d)}
                        className="cursor-pointer hover:bg-muted/50"
                      >
                        <TableCell className="font-medium">{d.camera_name}</TableCell>
                        <TableCell>{d.label ?? '-'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {fmtDate(d.start_date)} to{' '}
                          {d.end_date ? fmtDate(d.end_date) : 'now'}
                        </TableCell>
                        <TableCell className="text-right">
                          {d.image_count.toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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
        initialName={openDep?.label ?? null}
        initialNotes={openDep?.notes ?? null}
        editable={canEdit}
        invalidateKeys={[
          ['site', projectId, siteId],
          ['sites', projectId],
        ]}
      />
    </>
  );
};
