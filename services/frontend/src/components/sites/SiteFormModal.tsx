/**
 * Create-site modal with a map coordinate picker.
 *
 * Shared by the Sites page "Add site" button and the deployment edit modal's
 * "Create new site" action. Click the map or type lat/lon; existing sites show
 * as context markers. On success the new site is returned via onCreated so the
 * caller can select it.
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

  // Seed the coordinate fields from the default (e.g. a deployment's GPS) each
  // time the modal opens.
  useEffect(() => {
    if (open) {
      setName('');
      setLat(defaultLat != null ? String(defaultLat) : '');
      setLon(defaultLon != null ? String(defaultLon) : '');
    }
  }, [open, defaultLat, defaultLon]);

  const value =
    lat !== '' && lon !== '' && !isNaN(Number(lat)) && !isNaN(Number(lon))
      ? { lat: Number(lat), lon: Number(lon) }
      : null;

  const createMutation = useMutation({
    mutationFn: () =>
      sitesApi.create(projectId, {
        name: name.trim(),
        latitude: Number(lat),
        longitude: Number(lon),
      }),
    onSuccess: (site) => {
      queryClient.invalidateQueries({ queryKey: ['sites', projectId] });
      toast.success('Site created');
      onCreated?.(site);
      onClose();
    },
    onError: (err) => toast.error(`Could not create site, ${errMsg(err)}`),
  });

  const handleClose = () => {
    if (!createMutation.isPending) onClose();
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
              className={inputClass}
              placeholder="e.g. North ridge"
            />
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
          <Button variant="outline" onClick={handleClose} disabled={createMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !name.trim() || value === null}
          >
            {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
