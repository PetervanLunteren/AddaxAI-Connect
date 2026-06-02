/**
 * Site location modal with a map coordinate picker.
 *
 * Two modes:
 * - Create (default): name + coordinates, used by the Sites page "Add site"
 *   button and the deployment modal's "Create new site". Returns the new site
 *   via onCreated so the caller can select it.
 * - Move (`moveSite` set): the name is fixed and only the coordinates change.
 *   Used by the site slideout's "Move" action.
 *
 * Click the map or type lat/lon; existing sites show as context markers.
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

interface MoveSite {
  id: number;
  name: string;
  latitude: number | null;
  longitude: number | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: number;
  sites: SiteListItem[];
  defaultLat?: number | null;
  defaultLon?: number | null;
  onCreated?: (site: SiteDetail) => void;
  // When set, the modal moves this site (name fixed, only coordinates change).
  moveSite?: MoveSite;
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
  moveSite,
}) => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const isMove = !!moveSite;
  const [name, setName] = useState('');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');

  // Seed the fields when the modal opens. Move mode seeds from the site being
  // moved; create mode starts blank (coords optionally prefilled from a
  // deployment's GPS).
  useEffect(() => {
    if (!open) return;
    if (moveSite) {
      setName(moveSite.name);
      setLat(moveSite.latitude != null ? String(moveSite.latitude) : '');
      setLon(moveSite.longitude != null ? String(moveSite.longitude) : '');
    } else {
      setName('');
      setLat(defaultLat != null ? String(defaultLat) : '');
      setLon(defaultLon != null ? String(defaultLon) : '');
    }
  }, [open, moveSite, defaultLat, defaultLon]);

  const value =
    lat !== '' && lon !== '' && !isNaN(Number(lat)) && !isNaN(Number(lon))
      ? { lat: Number(lat), lon: Number(lon) }
      : null;

  const mutation = useMutation({
    mutationFn: () => {
      if (moveSite) {
        return sitesApi.update(projectId, moveSite.id, {
          latitude: Number(lat),
          longitude: Number(lon),
        });
      }
      return sitesApi.create(projectId, {
        name: name.trim(),
        latitude: Number(lat),
        longitude: Number(lon),
      });
    },
    onSuccess: (site) => {
      queryClient.invalidateQueries({ queryKey: ['sites', projectId] });
      queryClient.invalidateQueries({ queryKey: ['site', projectId] });
      if (moveSite) {
        toast.success('Site moved');
      } else {
        toast.success('Site created');
        onCreated?.(site as SiteDetail);
      }
      onClose();
    },
    onError: (err) =>
      toast.error(`Could not ${isMove ? 'move' : 'create'} site, ${errMsg(err)}`),
  });

  const handleClose = () => {
    if (!mutation.isPending) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent onClose={handleClose} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isMove ? 'Move site' : 'Add site'}</DialogTitle>
          <DialogDescription>
            {isMove
              ? 'Move this site to the right place on the map. The cameras and photos here stay linked to it.'
              : 'Click the map to place the site, or type its coordinates. Cameras reporting GPS near this point are grouped here.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Name</label>
            {isMove ? (
              <p className="text-sm px-3 py-2">{name}</p>
            ) : (
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
                placeholder="e.g. North ridge"
              />
            )}
          </div>

          <SiteLocationPicker
            value={value}
            onChange={(la, lo) => {
              setLat(la.toFixed(6));
              setLon(lo.toFixed(6));
            }}
            sites={sites}
            excludeSiteId={moveSite?.id}
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
            disabled={mutation.isPending || value === null || (!isMove && !name.trim())}
          >
            {mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isMove ? 'Save location' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
