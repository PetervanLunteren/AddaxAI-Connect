/**
 * Two links to a set of photos, for the places where a person decides about
 * photos they cannot see: the Edit and Add deployment form, and a camera's
 * "photos have no site yet" line. Images is for looking through them (when
 * did the view change, is it a test photo), Curation for hiding or deleting
 * them. Both open in a new tab, so a form keeps what was typed. Project
 * admins only, as Curation is; the places that show this already are.
 */
import React from 'react';
import { curationHref, imagesHref, type PhotoSet } from '../../lib/panel-links';

const linkClass = 'tap-target underline hover:text-foreground';

export const PhotoLinks: React.FC<{ projectId: number; photos: PhotoSet }> = ({ projectId, photos }) => (
  <span className="whitespace-nowrap">
    <a href={imagesHref(projectId, photos)} target="_blank" rel="noopener noreferrer" className={linkClass}>
      Show in Images
    </a>
    {' · '}
    <a href={curationHref(projectId, photos)} target="_blank" rel="noopener noreferrer" className={linkClass}>
      Open in Curation
    </a>
  </span>
);
