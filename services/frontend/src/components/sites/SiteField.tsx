/**
 * Choose a site, in a form: the list of the project's sites with "New site"
 * next to it, and under it a small map (SitePickMap) with the chosen site
 * magenta, where a click on a pin chooses it too. Site names often say
 * nothing about place, and a wrong site puts every photo of a deployment or
 * an upload in the wrong spot, so the map is always there.
 *
 * Shared by Edit deployment and the bulk upload, so the two cannot drift
 * apart. It loads the sites itself and holds the Add site window; a site
 * made there is chosen at once. The form owns the chosen id and passes the
 * caption, which says what the site means in that form.
 */
import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { sitesApi } from '../../api/sites';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { SiteFormModal } from './SiteFormModal';
import { SitePickMap } from './SitePickMap';

interface Props {
  projectId: number;
  value: number | null;
  onChange: (siteId: number | null) => void;
  caption: React.ReactNode;
  // The sites the map starts on, next to the chosen one (the site a
  // deployment has now). All sites when none is known.
  fitIds?: (number | null)[];
  // Where a new site starts on the map: the camera's own GPS spot.
  newSiteAt?: { lat: number | null; lon: number | null };
  // Open on the Add site window ("Give it its own site").
  startCreating?: boolean;
}

export const SiteField: React.FC<Props> = ({
  projectId, value, onChange, caption, fitIds = [], newSiteAt, startCreating = false,
}) => {
  const [creating, setCreating] = useState(false);
  // Open the Add site window after the form has opened, not with it: two
  // windows opened at once stack in mount order, which put Add site behind
  // the form, open but out of sight (and New site then did nothing).
  useEffect(() => {
    if (startCreating) setCreating(true);
  }, [startCreating]);
  const { data: sites } = useQuery({
    queryKey: ['sites', projectId],
    queryFn: () => sitesApi.list(projectId),
  });

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium" htmlFor="site-field">Site</label>
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <Select
            id="site-field"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          >
            <option value="">Select a site</option>
            {(sites ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <Button type="button" variant="outline" className="shrink-0" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4 mr-1" />
          New site
        </Button>
      </div>
      {sites && (
        <SitePickMap sites={sites} selectedId={value} onSelect={onChange} fitIds={[...fitIds, value]} height={200} />
      )}
      <p className="text-xs text-muted-foreground">{caption}</p>

      {creating && (
        <SiteFormModal
          open
          onClose={() => setCreating(false)}
          projectId={projectId}
          sites={sites ?? []}
          defaultLat={newSiteAt?.lat}
          defaultLon={newSiteAt?.lon}
          onCreated={(site) => {
            setCreating(false);
            onChange(site.id);
          }}
        />
      )}
    </div>
  );
};
