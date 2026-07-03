/**
 * Camera updates slideout.
 *
 * Opens from the sidebar. Lists what the system did on its own, one entry per
 * created deployment. A camera sent its first images, or a confirmed move
 * opened a new placement. Entries are notifications, not questions. Ignoring
 * them is always fine. Project admins can correct an entry with one of four
 * actions (rename the site, pick a different nearby site, split off a new
 * site, or undo a move that was GPS noise); viewers see the list read-only.
 *
 * Opening the sheet marks the feed as seen, which clears the sidebar badge.
 */
import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera as CameraIcon, Loader2, Route } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetBody } from './ui/Sheet';
import { Button } from './ui/Button';
import { Select } from './ui/Select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/Dialog';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { useToast } from './ui/Toaster';
import { AuthenticatedImage } from './AuthenticatedImage';
import { feedApi, type FeedEventItem, type ResolveRequest } from '../api/feed';
import { deploymentsApi } from '../api/deployments';

interface CameraUpdatesSheetProps {
  open: boolean;
  onClose: () => void;
  projectId: number;
  canEdit: boolean;
}

type DialogMode =
  | { kind: 'closed' }
  | { kind: 'rename'; event: FeedEventItem }
  | { kind: 'different_site'; event: FeedEventItem }
  | { kind: 'new_site'; event: FeedEventItem }
  | { kind: 'not_moved'; event: FeedEventItem };

function fmtDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// Day heading for the group an entry belongs to ("Today", "Yesterday", or a date).
function dayHeading(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// One sentence describing what happened. Neutral about whether the site was
// created or reused, since the entry does not record that.
function eventText(e: FeedEventItem): string {
  const camera = e.camera_label ?? `camera ${e.camera_id}`;
  const site = e.site_name ?? 'an unnamed site';
  if (e.event_type === 'camera_moved') {
    const dist = e.distance_m != null ? ` about ${fmtDistance(e.distance_m)}` : '';
    const from = e.from_site_name ? ` It was at ${e.from_site_name} before.` : '';
    return `Camera ${camera} moved${dist}. It is now at ${site}.${from}`;
  }
  return `Camera ${camera} started sending images. It was placed at ${site}.`;
}

export const CameraUpdatesSheet: React.FC<CameraUpdatesSheetProps> = ({
  open, onClose, projectId, canEdit,
}) => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [dialog, setDialog] = useState<DialogMode>({ kind: 'closed' });

  const { data: events, isLoading } = useQuery({
    queryKey: ['feed', projectId],
    queryFn: () => feedApi.list(projectId),
    enabled: open && projectId > 0,
  });

  // Opening the sheet is "seeing" the feed; stamp it and clear the badge.
  useEffect(() => {
    if (open && projectId > 0) {
      feedApi.markSeen(projectId).then(() => {
        queryClient.invalidateQueries({ queryKey: ['feed-unseen', projectId] });
      });
    }
  }, [open, projectId, queryClient]);

  const resolveMutation = useMutation({
    mutationFn: ({ eventId, body }: { eventId: number; body: ResolveRequest }) =>
      feedApi.resolve(projectId, eventId, body),
    onSuccess: () => {
      // The action changed sites and deployments, so refresh everything that
      // shows them, not only the feed.
      queryClient.invalidateQueries({ queryKey: ['feed', projectId] });
      queryClient.invalidateQueries({ queryKey: ['sites', projectId] });
      queryClient.invalidateQueries({ queryKey: ['deployments', projectId] });
      queryClient.invalidateQueries({ queryKey: ['camera-deployments'] });
      setDialog({ kind: 'closed' });
      toast.success('Saved');
    },
    onError: (error: any) => {
      toast.error(`Could not save. ${error.response?.data?.detail || error.message || ''}`);
    },
  });

  // Group entries by calendar day, newest first (the API already sorts).
  const groups: { heading: string; items: FeedEventItem[] }[] = [];
  for (const e of events ?? []) {
    const heading = dayHeading(e.created_at);
    const last = groups[groups.length - 1];
    if (last && last.heading === heading) {
      last.items.push(e);
    } else {
      groups.push({ heading, items: [e] });
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Camera updates</SheetTitle>
            <SheetDescription>
              New cameras and camera moves show up here, together with the site
              the system picked. Nothing here needs an answer. If a guess is
              wrong, it can be corrected with the buttons on the entry.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            {isLoading && (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {!isLoading && (events ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">
                No camera updates yet. When a camera starts sending images or
                moves to another spot, it shows up here.
              </p>
            )}

            {groups.map((group) => (
              <div key={group.heading} className="mb-4">
                <p className="text-xs font-medium text-muted-foreground mb-2">{group.heading}</p>
                <ul className="space-y-3">
                  {group.items.map((e) => (
                    <FeedEntry
                      key={e.id}
                      event={e}
                      projectId={projectId}
                      canEdit={canEdit}
                      onAction={(kind) => setDialog({ kind, event: e } as DialogMode)}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </SheetBody>
        </SheetContent>
      </Sheet>

      {dialog.kind === 'rename' && (
        <NameDialog
          title="Rename site"
          description={`Give ${dialog.event.site_name ?? 'this site'} a better name.`}
          initialName={dialog.event.site_name ?? ''}
          confirmLabel="Rename"
          isPending={resolveMutation.isPending}
          onClose={() => setDialog({ kind: 'closed' })}
          onConfirm={(name) =>
            resolveMutation.mutate({ eventId: dialog.event.id, body: { action: 'rename_site', name } })
          }
        />
      )}

      {dialog.kind === 'new_site' && (
        <NameDialog
          title="New site"
          description="The camera gets its own site at its current location. Pick a name for it."
          initialName=""
          confirmLabel="Create site"
          isPending={resolveMutation.isPending}
          onClose={() => setDialog({ kind: 'closed' })}
          onConfirm={(name) =>
            resolveMutation.mutate({ eventId: dialog.event.id, body: { action: 'new_site', name } })
          }
        />
      )}

      {dialog.kind === 'different_site' && (
        <DifferentSiteDialog
          event={dialog.event}
          isPending={resolveMutation.isPending}
          onClose={() => setDialog({ kind: 'closed' })}
          onConfirm={(siteId) =>
            resolveMutation.mutate({ eventId: dialog.event.id, body: { action: 'set_site', site_id: siteId } })
          }
        />
      )}

      <ConfirmDialog
        open={dialog.kind === 'not_moved'}
        onClose={() => setDialog({ kind: 'closed' })}
        onConfirm={() => {
          if (dialog.kind === 'not_moved') {
            resolveMutation.mutate({ eventId: dialog.event.id, body: { action: 'not_moved' } });
          }
        }}
        title="The camera did not move?"
        body={
          dialog.kind === 'not_moved'
            ? `The reading was GPS noise. The camera goes back to ${dialog.event.from_site_name ?? 'its previous site'}, together with its images.`
            : ''
        }
        confirmLabel="It did not move"
        cancelLabel="Keep the move"
        isPending={resolveMutation.isPending}
      />
    </>
  );
};

const FeedEntry: React.FC<{
  event: FeedEventItem;
  projectId: number;
  canEdit: boolean;
  onAction: (kind: 'rename' | 'different_site' | 'new_site' | 'not_moved') => void;
}> = ({ event: e, projectId, canEdit, onAction }) => {
  // A small photo strip as visual confirmation of where the camera looks.
  const { data: thumbUuids } = useQuery({
    queryKey: ['deployment-thumbnails', projectId, e.deployment_id],
    queryFn: () => deploymentsApi.thumbnails(projectId, e.deployment_id!, 3),
    enabled: e.deployment_id != null,
  });

  const Icon = e.event_type === 'camera_moved' ? Route : CameraIcon;
  // "Different site" only helps when there is a nearby alternative besides
  // the currently assigned one.
  const hasAlternatives = e.candidates.some((c) => c.site_id !== e.site_id);
  const actionable = canEdit && e.deployment_id != null;

  return (
    <li className="border rounded-md p-3">
      <div className="flex items-start gap-2">
        <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <p className="text-sm break-words">{eventText(e)}</p>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
            <span>{fmtTime(e.created_at)}</span>
            {e.resolved_action && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-primary/10 text-primary">
                Handled
              </span>
            )}
          </div>
        </div>
      </div>

      {thumbUuids && thumbUuids.length > 0 && (
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {thumbUuids.map((u) => (
            <AuthenticatedImage
              key={u}
              src={`/api/images/${u}/thumbnail`}
              alt="Photo from this camera"
              className="w-full h-16 object-cover rounded border"
            />
          ))}
        </div>
      )}

      {actionable && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {e.site_id != null && (
            <Button size="sm" variant="outline" onClick={() => onAction('rename')}>
              Rename site
            </Button>
          )}
          {hasAlternatives && (
            <Button size="sm" variant="outline" onClick={() => onAction('different_site')}>
              Different site
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => onAction('new_site')}>
            New site
          </Button>
          {e.event_type === 'camera_moved' && e.from_site_id != null && (
            <Button size="sm" variant="outline" onClick={() => onAction('not_moved')}>
              It did not move
            </Button>
          )}
        </div>
      )}
    </li>
  );
};

const NameDialog: React.FC<{
  title: string;
  description: string;
  initialName: string;
  confirmLabel: string;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (name: string) => void;
}> = ({ title, description, initialName, confirmLabel, isPending, onClose, onConfirm }) => {
  const [name, setName] = useState(initialName);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <label className="text-xs text-muted-foreground">Site name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={255}
            autoFocus
            className="w-full px-3 py-2 border rounded-md text-sm"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(name.trim())} disabled={isPending || !name.trim()}>
            {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const DifferentSiteDialog: React.FC<{
  event: FeedEventItem;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (siteId: number) => void;
}> = ({ event, isPending, onClose, onConfirm }) => {
  const alternatives = event.candidates.filter((c) => c.site_id !== event.site_id);
  const [siteId, setSiteId] = useState<number | null>(alternatives[0]?.site_id ?? null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>Different site</DialogTitle>
          <DialogDescription>
            Pick the site this camera actually stands at. Only sites within the
            distance threshold are listed.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <label className="text-xs text-muted-foreground">Site</label>
          <Select
            value={siteId ?? ''}
            onChange={(e) => setSiteId(e.target.value === '' ? null : Number(e.target.value))}
          >
            {alternatives.map((c) => (
              <option key={c.site_id} value={c.site_id}>
                {c.name} ({fmtDistance(c.distance_m)} away)
              </option>
            ))}
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => siteId != null && onConfirm(siteId)}
            disabled={isPending || siteId == null}
          >
            {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Move to this site
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
