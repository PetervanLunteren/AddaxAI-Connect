/**
 * Set site: say where a camera stood, from one day until another, or
 * until now.
 *
 * The one form for every way to place a camera: placing a camera without
 * GPS, changing the site of a deployment the GPS made, and correcting the
 * past. It writes a fixed period on the server. The GPS does not change that
 * period, and it can be undone under Corrections in the camera panel.
 *
 * Whole days on purpose: a day belongs to one deployment, the day of a move
 * to the new one, the same rule as everywhere in the app. The caller prefills
 * the days and the site.
 */
import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { deploymentsApi } from '../../api/deployments';
import { sitesApi } from '../../api/sites';
import { SiteFormModal } from '../sites/SiteFormModal';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/Dialog';
import { useToast } from '../ui/Toaster';

export interface SetDeploymentPrefill {
  siteId: number | null;
  fromDate: string; // YYYY-MM-DD
  untilDate: string | null; // YYYY-MM-DD, null = still there
  // Where the camera's own GPS put it, for a new site. Null without GPS.
  lat: number | null;
  lon: number | null;
}

interface Props {
  projectId: number;
  cameraId: number;
  cameraName: string;
  prefill: SetDeploymentPrefill;
  onClose: () => void;
  // Open on "create a new site" at the prefilled spot: a click on an empty
  // spot of the map in the moves check.
  newSite?: boolean;
  // Called after a successful save, before onClose, with the statement
  // written, so the caller can offer Undo.
  onSaved?: (statementId: number) => void;
}

function errMsg(err: unknown): string {
  const e = err as { response?: { data?: { detail?: string } }; message?: string };
  return e?.response?.data?.detail || e?.message || 'Unknown error';
}

export const SetDeploymentDialog: React.FC<Props> = ({ projectId, cameraId, cameraName, prefill, onClose, newSite = false, onSaved }) => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [siteId, setSiteId] = useState<number | null>(prefill.siteId);
  const [fromDate, setFromDate] = useState(prefill.fromDate);
  const [untilDate, setUntilDate] = useState(prefill.untilDate ?? '');
  const [creatingSite, setCreatingSite] = useState(newSite);

  useEffect(() => {
    setSiteId(prefill.siteId);
    setFromDate(prefill.fromDate);
    setUntilDate(prefill.untilDate ?? '');
  }, [prefill]);

  const { data: sites } = useQuery({
    queryKey: ['sites', projectId],
    queryFn: () => sitesApi.list(projectId),
  });

  const save = useMutation({
    mutationFn: (site: number) =>
      deploymentsApi.set(projectId, {
        camera_id: cameraId,
        site_id: site,
        from_date: fromDate,
        until_date: untilDate || null,
      }),
    onSuccess: (result) => {
      // Everything that shows where a camera stood.
      queryClient.invalidateQueries({ queryKey: ['camera-deployments'] });
      queryClient.invalidateQueries({ queryKey: ['fixed-periods'] });
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      queryClient.invalidateQueries({ queryKey: ['sites', projectId] });
      queryClient.invalidateQueries({ queryKey: ['site', projectId] });
      queryClient.invalidateQueries({ queryKey: ['deployments', projectId] });
      toast.success('Site set');
      onSaved?.(result.statement_id);
      onClose();
    },
    onError: (error) => toast.error(`Could not set the site. ${errMsg(error)}`),
  });

  const untilBeforeFrom = untilDate !== '' && fromDate !== '' && untilDate < fromDate;
  const canSave = siteId != null && fromDate !== '' && !untilBeforeFrom && !save.isPending;

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent onClose={onClose}>
          <DialogHeader>
            <DialogTitle>Set site</DialogTitle>
            <DialogDescription>
              Where camera {cameraName} stood. The photos of these days move to
              this site. You can undo this in the camera panel.
            </DialogDescription>
          </DialogHeader>
          <form
            className="py-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSave) save.mutate(siteId!);
            }}
          >
            <div>
              <label className="block text-sm font-medium mb-2">Site</label>
              <Select
                value={siteId ?? ''}
                onChange={(e) => setSiteId(e.target.value === '' ? null : Number(e.target.value))}
              >
                <option value="">Pick a site</option>
                {(sites ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              <button
                type="button"
                onClick={() => setCreatingSite(true)}
                className="mt-2 text-sm text-primary hover:underline"
              >
                Or create a new site
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-2" htmlFor="set-deployment-from">First day</label>
                <input
                  id="set-deployment-from"
                  type="date"
                  required
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2" htmlFor="set-deployment-until">Last day</label>
                <input
                  id="set-deployment-until"
                  type="date"
                  value={untilDate}
                  onChange={(e) => setUntilDate(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">Leave empty when the camera is still there.</p>
              </div>
            </div>
            {untilBeforeFrom && (
              <p className="text-sm text-destructive">The last day cannot be before the first day.</p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={!canSave}>
                {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {creatingSite && (
        <SiteFormModal
          open
          onClose={() => setCreatingSite(false)}
          projectId={projectId}
          sites={sites ?? []}
          defaultLat={prefill.lat}
          defaultLon={prefill.lon}
          onCreated={(site) => {
            setCreatingSite(false);
            setSiteId(site.id);
          }}
        />
      )}
    </>
  );
};
