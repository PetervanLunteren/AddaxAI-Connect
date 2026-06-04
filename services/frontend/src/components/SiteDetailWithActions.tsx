/**
 * Site detail sheet plus its merge and delete actions, bundled.
 *
 * Wraps SiteDetailSheet with the merge-target picker dialog, the delete
 * confirm, and their mutations, so any page (Sites, Map) can open a fully
 * functional site detail with one component instead of re-wiring the dialogs.
 * On a successful merge or delete the sheet closes via onClose.
 */
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/Dialog';
import { Button } from './ui/Button';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { sitesApi } from '../api/sites';
import { SiteDetailSheet } from './SiteDetailSheet';
import { SiteMergePicker } from './sites/SiteMergePicker';
import { useToast } from './ui/Toaster';

function errMsg(err: unknown): string {
  const e = err as { response?: { data?: { detail?: string } }; message?: string };
  return e?.response?.data?.detail || e?.message || 'Unknown error';
}

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: number;
  siteId: number | null;
  canEdit: boolean;
}

export const SiteDetailWithActions: React.FC<Props> = ({
  open,
  onClose,
  projectId,
  siteId,
  canEdit,
}) => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [mergeSite, setMergeSite] = useState<{ id: number; name: string } | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [deleteSite, setDeleteSite] = useState<{ id: number; name: string } | null>(null);

  const { data: sites } = useQuery({
    queryKey: ['sites', projectId],
    queryFn: () => sitesApi.list(projectId),
    enabled: open,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['sites', projectId] });
    queryClient.invalidateQueries({ queryKey: ['site', projectId] });
    queryClient.invalidateQueries({ queryKey: ['site-tags', projectId] });
  };

  const mergeMutation = useMutation({
    mutationFn: () => sitesApi.merge(projectId, mergeSite!.id, Number(mergeTargetId)),
    onSuccess: () => {
      invalidate();
      setMergeSite(null);
      setMergeTargetId('');
      onClose();
      toast.success('Sites merged');
    },
    onError: (err) => toast.error(`Could not merge sites, ${errMsg(err)}`),
  });

  const deleteMutation = useMutation({
    mutationFn: () => sitesApi.remove(projectId, deleteSite!.id),
    onSuccess: () => {
      invalidate();
      setDeleteSite(null);
      onClose();
      toast.success('Site deleted');
    },
    onError: (err) => toast.error(`Could not delete site, ${errMsg(err)}`),
  });

  return (
    <>
      <SiteDetailSheet
        open={open}
        onClose={onClose}
        projectId={projectId}
        siteId={siteId}
        canEdit={canEdit}
        onMergeRequested={(s) => {
          setMergeSite(s);
          setMergeTargetId('');
        }}
        onDeleteRequested={setDeleteSite}
      />

      {/* Merge dialog */}
      <Dialog open={mergeSite != null} onOpenChange={(o) => !o && setMergeSite(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Merge site</DialogTitle>
            <DialogDescription>
              Pick the site to keep. "{mergeSite?.name}" will be merged into it
              and then removed. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {mergeSite && (
            <SiteMergePicker
              sites={sites ?? []}
              sourceSiteId={mergeSite.id}
              selectedTargetId={mergeTargetId ? Number(mergeTargetId) : null}
              onSelectTarget={(id) => setMergeTargetId(String(id))}
            />
          )}
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
    </>
  );
};
