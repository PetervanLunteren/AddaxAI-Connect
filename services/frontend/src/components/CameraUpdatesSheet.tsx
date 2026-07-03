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
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera as CameraIcon, ChevronDown, ChevronRight, Loader2, MapPin, Route } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetBody } from './ui/Sheet';
import { Button } from './ui/Button';
import { Select } from './ui/Select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/Dialog';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { useToast } from './ui/Toaster';
import { AuthenticatedImage } from './AuthenticatedImage';
import { feedApi, type FeedEventItem, type ResolveRequest } from '../api/feed';
import { deploymentsApi } from '../api/deployments';
import { imagesApi } from '../api/images';

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

// Camera ids are hardware identifiers (often IMEIs), shown as a code chip so
// they read apart from prose and from site names.
const CameraChip: React.FC<{ event: FeedEventItem }> = ({ event: e }) => (
  <code className="px-1 py-0.5 rounded bg-muted text-[13px]">
    {e.camera_label ?? `camera ${e.camera_id}`}
  </code>
);

// Site names get a chip with a map pin so a place reads apart from prose,
// mirroring the camera code chip (proportional font, since names are words).
// The map itself opens from the entry's "Show location" button.
const SiteName: React.FC<{ name: string | null }> = ({ name }) => (
  <span className="inline-flex items-center gap-1 px-1 py-0.5 rounded bg-muted text-[13px] font-medium align-middle">
    <MapPin className="h-3 w-3 shrink-0" />
    {name ?? 'an unnamed site'}
  </span>
);

// First line: what happened.
const EventHeadline: React.FC<{ event: FeedEventItem }> = ({ event: e }) => {
  if (e.event_type === 'camera_moved') {
    const dist = e.distance_m != null ? ` about ${fmtDistance(e.distance_m)}` : '';
    return (
      <p className="text-sm break-words">
        Camera <CameraChip event={e} /> moved{dist}.
      </p>
    );
  }
  return (
    <p className="text-sm break-words">
      Camera <CameraChip event={e} /> started sending images.
    </p>
  );
};

// Context line under the photos: where the camera was put, worded by whether
// the site was made for it or already existed.
const EventContext: React.FC<{ event: FeedEventItem }> = ({ event: e }) => {
  const from = e.from_site_name ? (
    <>
      {' '}It was at <SiteName name={e.from_site_name} /> before.
    </>
  ) : null;
  if (e.site_created) {
    // "Automatically named X" is a naming act, so X stays frozen at the name
    // given then. When the site was renamed through some other path (a
    // sibling entry, the site slideout), this entry has no resolution line of
    // its own, so it says the current name too; a dead name with no follow-up
    // reads as stale.
    const renamedElsewhere =
      !e.resolved_action &&
      e.site_name != null &&
      e.original_site_name != null &&
      e.site_name !== e.original_site_name;
    return (
      <p className="text-sm text-muted-foreground break-words">
        There is no known site there, so a new one was made and automatically
        named <SiteName name={e.original_site_name ?? e.site_name} />.
        {renamedElsewhere && (
          <>
            {' '}It is now called <SiteName name={e.site_name} />.
          </>
        )}
        {from}
      </p>
    );
  }
  // "Placed at X" refers to the site as a place, so it follows the live name
  // (a rename from a sibling entry propagates here). Once this entry itself
  // was corrected, site_id points at the outcome, so the frozen name takes
  // over as history and the resolution line explains the change.
  const placedName = e.resolved_action
    ? e.original_site_name ?? e.site_name
    : e.site_name ?? e.original_site_name;
  // Distance from the deployment to the assigned site, when known via the
  // candidate list (candidates include the assigned site).
  const own = e.candidates.find((c) => c.site_id === e.site_id);
  const away = own && own.distance_m > 0 ? ` (${fmtDistance(own.distance_m)} away)` : '';
  return (
    <p className="text-sm text-muted-foreground break-words">
      There is already a site nearby, so it was placed at{' '}
      <SiteName name={placedName} />{away}.{from}
    </p>
  );
};

// What a human did with the entry, when someone did. Uses the live site name
// (the outcome), unlike the context line above (the history).
const ResolutionLine: React.FC<{ event: FeedEventItem }> = ({ event: e }) => {
  if (!e.resolved_action) return null;
  const who = e.resolved_by_email ?? 'A project admin';
  const when = e.resolved_at
    ? new Date(e.resolved_at).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '';
  const suffix = when ? ` at ${when}` : '';
  const site = <SiteName name={e.site_name} />;
  let did: React.ReactNode;
  switch (e.resolved_action) {
    case 'rename_site':
      did = <>renamed this site to {site}</>;
      break;
    case 'set_site':
      did = <>moved the camera to {site}</>;
      break;
    case 'new_site':
      did = <>gave the camera its own site {site}</>;
      break;
    default: // not_moved
      did = <>marked this as GPS noise, the camera stayed at {site}</>;
  }
  return (
    <p className="text-sm text-muted-foreground break-words mt-1">
      {who} {did}{suffix}.
    </p>
  );
};

export const CameraUpdatesSheet: React.FC<CameraUpdatesSheetProps> = ({
  open, onClose, projectId, canEdit,
}) => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [dialog, setDialog] = useState<DialogMode>({ kind: 'closed' });
  const [earlierOpen, setEarlierOpen] = useState(false);

  const { data: events, isLoading } = useQuery({
    queryKey: ['feed', projectId],
    queryFn: () => feedApi.list(projectId),
    enabled: open && projectId > 0,
  });

  // Closing the sheet is "having seen" the feed. Stamping on close (not on
  // open) keeps the fresh/earlier split stable while the panel is open, and
  // clears the badge once the user is done looking.
  const handleClose = () => {
    onClose();
    setEarlierOpen(false);
    if (projectId > 0) {
      feedApi.markSeen(projectId).then(() => {
        queryClient.invalidateQueries({ queryKey: ['feed-unseen', projectId] });
        queryClient.invalidateQueries({ queryKey: ['feed', projectId] });
      });
    }
  };

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

  // Fresh entries (not seen on an earlier visit) stay prominent, grouped by
  // day; already-seen ones collapse under "Earlier" so the list stays short
  // without any per-entry dismissing.
  const fresh = (events ?? []).filter((e) => !e.seen);
  const earlier = (events ?? []).filter((e) => e.seen);

  const groups: { heading: string; items: FeedEventItem[] }[] = [];
  for (const e of fresh) {
    const heading = dayHeading(e.created_at);
    const last = groups[groups.length - 1];
    if (last && last.heading === heading) {
      last.items.push(e);
    } else {
      groups.push({ heading, items: [e] });
    }
  }

  const renderEntry = (e: FeedEventItem) => (
    <FeedEntry
      key={e.id}
      event={e}
      projectId={projectId}
      canEdit={canEdit}
      onAction={(kind) => setDialog({ kind, event: e } as DialogMode)}
    />
  );

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => !o && handleClose()}>
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

            {!isLoading && fresh.length === 0 && earlier.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Nothing new since the last visit.
              </p>
            )}

            {groups.map((group) => (
              <div key={group.heading} className="mb-4">
                <p className="text-xs font-medium text-muted-foreground mb-2">{group.heading}</p>
                <ul className="space-y-3">{group.items.map(renderEntry)}</ul>
              </div>
            ))}

            {earlier.length > 0 && (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => setEarlierOpen((o) => !o)}
                  className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                >
                  {earlierOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  Earlier ({earlier.length})
                </button>
                {earlierOpen && (
                  <ul className="mt-2 space-y-3">{earlier.map(renderEntry)}</ul>
                )}
              </div>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>

      {dialog.kind === 'rename' && (
        <NameDialog
          title="Name this site"
          description={<>Give <SiteName name={dialog.event.site_name} /> a real name.</>}
          initialName={dialog.event.site_name ?? ''}
          confirmLabel="Save name"
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
        title="Are you sure the camera did not move?"
        body={
          dialog.kind === 'not_moved' ? (
            <>
              That means the reading was GPS noise. The camera and its images
              go back to <SiteName name={dialog.event.from_site_name} />.
            </>
          ) : ''
        }
        confirmLabel="Yes, it is GPS noise"
        cancelLabel="No, cancel"
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
  // When the entry's deployment was merged away (an undone move), fall back
  // to the camera's recent photos; after an undo that is the same spot.
  const { data: thumbUuids } = useQuery({
    queryKey: ['deployment-thumbnails', projectId, e.deployment_id],
    queryFn: () => deploymentsApi.thumbnails(projectId, e.deployment_id!, 3),
    enabled: e.deployment_id != null,
  });
  const { data: cameraThumbs } = useQuery({
    queryKey: ['camera-recent-thumbnails', e.camera_id],
    queryFn: async () => {
      const page = await imagesApi.getAll({ camera_id: String(e.camera_id), limit: 3 });
      return page.items.map((img) => img.uuid);
    },
    enabled: e.deployment_id == null,
  });
  const thumbs = e.deployment_id != null ? thumbUuids : cameraThumbs;

  const Icon = e.event_type === 'camera_moved' ? Route : CameraIcon;
  // "Different site" only helps when there is a nearby alternative besides
  // the currently assigned one.
  const hasAlternatives = e.candidates.some((c) => c.site_id !== e.site_id);
  // "Rename site" is for the naming pass on fresh auto-named sites. Once a
  // site has a real name, renaming belongs to the site slideout, not here.
  // Matches the auto-name format from ingestion ("Site at 53.2460, 5.2620").
  const autoNamed = /^Site at -?\d+\.\d+, -?\d+\.\d+$/.test(e.site_name ?? '');
  const actionable = canEdit && e.deployment_id != null;

  return (
    <li className="border rounded-md p-3">
      <div className="flex items-start gap-2">
        <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <EventHeadline event={e} />
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
            <span>{fmtTime(e.created_at)}</span>
          </div>
        </div>
      </div>

      {thumbs && thumbs.length > 0 && (
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {thumbs.map((u) => (
            <AuthenticatedImage
              key={u}
              src={`/api/images/${u}/thumbnail`}
              alt="Photo from this camera"
              className="w-full h-16 object-cover rounded border"
            />
          ))}
        </div>
      )}

      <div className="mt-2">
        <EventContext event={e} />
        <ResolutionLine event={e} />
      </div>

      <div className="mt-2 space-y-1.5">
        {/* Not a correction, so it shows for viewers too. */}
        {e.site_lat != null && e.site_lon != null && (
          <EntryAction
            label="Show location"
            caption="Open this spot in Google Maps."
            onClick={() => window.open(`https://www.google.com/maps?q=${e.site_lat},${e.site_lon}`, '_blank')}
          />
        )}
        {actionable && (
          <>
            {e.site_id != null && autoNamed && (
              <EntryAction
                label="Name this site"
                caption="The name is a placeholder. Give it a real one."
                onClick={() => onAction('rename')}
              />
            )}
            {hasAlternatives && (
              <EntryAction
                label="Different site"
                caption="The camera actually stands at another site nearby."
                onClick={() => onAction('different_site')}
              />
            )}
            {/* On a site made for this camera, "new site" would equal renaming
                it, so it only shows when the camera landed on an existing site. */}
            {!e.site_created && (
              <EntryAction
                label="New site"
                caption="This spot should be its own site, apart from the one picked."
                onClick={() => onAction('new_site')}
              />
            )}
            {e.event_type === 'camera_moved' && e.from_site_id != null && (
              <EntryAction
                label="It did not move"
                caption="The move was GPS noise. Put the camera and its images back."
                onClick={() => onAction('not_moved')}
              />
            )}
          </>
        )}
      </div>
    </li>
  );
};

// One full-width action row: what to do, and one line on when to do it.
const EntryAction: React.FC<{
  label: string;
  caption: string;
  onClick: () => void;
}> = ({ label, caption, onClick }) => (
  <Button
    variant="outline"
    onClick={onClick}
    className="w-full h-auto py-2 justify-start"
  >
    <span className="flex flex-col items-start text-left">
      <span className="text-sm font-medium">{label}</span>
      <span className="text-xs text-muted-foreground font-normal">{caption}</span>
    </span>
  </Button>
);

const NameDialog: React.FC<{
  title: string;
  description: React.ReactNode;
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
