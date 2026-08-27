/**
 * "Unnamed" marker for a site that still carries its placeholder name.
 *
 * One chip, used on the camera updates feed and on the Sites page, so the
 * naming to-do looks the same wherever the site shows up and survives after
 * its feed entry has aged out. Renders nothing for a real name.
 */
import React from 'react';
import { isAutoSiteName } from '../../utils/site-names';

export const UnnamedSiteChip: React.FC<{ name: string | null | undefined }> = ({ name }) =>
  isAutoSiteName(name) ? (
    <span
      className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-[#0f6064]/10 text-[#0f6064]"
      title="This site still has its automatic name. Give it a real one."
    >
      Unnamed
    </span>
  ) : null;
