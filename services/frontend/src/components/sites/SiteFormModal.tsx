/**
 * Add-site modal with a map coordinate picker.
 *
 * Used by the Sites page "Add site" button and the deployment modal's "Create
 * new site". Returns the new site via onCreated so the caller can select it.
 * Click the map or type lat/lon; existing sites show as context markers.
 *
 * Sites are not movable after creation: a site's location is derived from the
 * centroid of its deployments, so there is no manual move mode here.
 */
import React, { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/Dialog';
import { Button } from '../ui/Button';
import { SiteLocationPicker } from './SiteLocationPicker';
import { sitesApi, type SiteDetail, type SiteListItem } from '../../api/sites';
import { useToast } from '../ui/Toaster';

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: number;
  sites: SiteListItem[];
  defaultLat?: number | null;
  defaultLon?: number | null;
  onCreated?: (site: SiteDetail) => void;
}

const inputClass =
  'w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring';

function errMsg(err: unknown): string {
  const e = err as { response?: { data?: { detail?: string } }; message?: string };
  return e?.response?.data?.detail || e?.message || 'Unknown error';
}

export const SiteFormModal: React.FC<Props> = ({
  open,
  onClose,
  projectId,
  sites,
  defaultLat,
  defaultLon,
  onCreated,
}) => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');

  // Seed when the modal opens. Coords are optionally prefilled from a
  // deployment's GPS (the "Create new site" path in the deployment modal).
  useEffect(() => {
    if (!open) return;
    setName('');
    setLat(defaultLat != null ? String(defaultLat) : '');
    setLon(defaultLon != null ? String(defaultLon) : '');
  }, [open, defaultLat, defaultLon]);

  const value =
    lat !== '' && lon !== '' && !isNaN(Number(lat)) && !isNaN(Number(lon))
      ? { lat: Number(lat), lon: Number(lon) }
      : null;

  // Site names are unique per project (DB constraint). Catch a collision while
  // typing instead of failing on submit. Mirror the backend match exactly
  // (trimmed, case-sensitive) so the form never blocks a name the server allows.
  const trimmedName = name.trim();
  const isDuplicateName =
    trimmedName !== '' && sites.some((s) => s.name === trimmedName);

  const mutation = useMutation({
    mutationFn: () =>
      sitesApi.create(projectId, {
        name: name.trim(),
        latitude: Number(lat),
        longitude: Number(lon),
      }),
    onSuccess: (site) => {
      queryClient.invalidateQueries({ queryKey: ['sites', projectId] });
      queryClient.invalidateQueries({ queryKey: ['site', projectId] });
      toast.success('Site created');
      onCreated?.(site);
      onClose();
    },
    onError: (err) => toast.error(`Could not create site, ${errMsg(err)}`),
  });

  const handleClose = () => {
    if (!mutation.isPending) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent onClose={handleClose} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add site</DialogTitle>
          <DialogDescription>
            Click the map to place the site, or type its coordinates. Cameras
            reporting GPS near this point are grouped here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={isDuplicateName}
              className={inputClass + (isDuplicateName ? ' border-destructive' : '')}
              placeholder="e.g. North ridge"
            />
            {isDuplicateName && (
              <p className="text-sm text-destructive mt-1">
                A site with this name already exists
              </p>
            )}
          </div>

          <SiteLocationPicker
            value={value}
            onChange={(la, lo) => {
              setLat(la.toFixed(6));
              setLon(lo.toFixed(6));
            }}
            sites={sites}
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-2">Latitude</label>
              <input
                type="number"
                step="any"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                className={inputClass}
                placeholder="49.8225"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Longitude</label>
              <input
                type="number"
                step="any"
                value={lon}
                onChange={(e) => setLon(e.target.value)}
                className={inputClass}
                placeholder="5.7276"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={
              mutation.isPending || value === null || !name.trim() || isDuplicateName
            }
          >
            {mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
