/**
 * The project settings row for a SpeciesNet project's label list (its
 * taxonomy mapping CSV). It sits where a fixed-class project has its Species
 * filtering row, and saves with the rest of the page: the parent owns the
 * picked file and uploads it on Save changes. A new list replaces the old
 * one and relabels the images nobody has verified yet.
 */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Callout } from '../ui/Callout';
import { TaxonomyDropzone } from './TaxonomyDropzone';
import { TaxonomyMappingDialog } from './TaxonomyMappingDialog';
import { projectsApi } from '../../api/projects';
import { downloadCsv } from '../../utils/download';

/** The look of a link or link-like button inside a settings caption */
export const captionLinkClass = 'text-primary underline underline-offset-2 hover:text-primary/80 disabled:opacity-50';

interface SpeciesLabelsRowProps {
  projectId: number;
  /** The CSV picked and not saved yet */
  file: File | null;
  onFileChange: (file: File | null) => void;
  /** Why the last save refused the file, one problem per line */
  error: string | null;
  disabled?: boolean;
}

export const SpeciesLabelsRow: React.FC<SpeciesLabelsRowProps> = ({
  projectId, file, onFileChange, error, disabled = false,
}) => {
  const [showMapping, setShowMapping] = useState(false);

  const { data: mapping } = useQuery({
    queryKey: ['project-taxonomy', projectId],
    queryFn: () => projectsApi.getTaxonomy(projectId),
  });
  const entries = mapping?.entries ?? [];

  // The same two columns an upload reads, so the file can go back in as it is.
  const downloadLabels = () => downloadCsv(
    ['latin', 'common'],
    entries.map((entry) => [entry.latin, entry.common]),
    'species-labels.csv',
  );

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-8">
        <div className="w-full sm:w-1/2 sm:shrink-0">
          <label className="text-sm font-medium block">Species labels</label>
          <p className="text-sm text-muted-foreground mt-1">
            The labels SpeciesNet uses in this project. The AI taxonomist in the{' '}
            <a
              href="https://connect.addaxai.com/speciesnet-setup/"
              target="_blank"
              rel="noopener noreferrer"
              className={captionLinkClass}
            >
              SpeciesNet setup guide
            </a>{' '}
            makes or changes the CSV with you.
            {entries.length > 0 && (
              <>
                {' '}
                {/* Buttons, not links: they open a dialog and save a file, no navigation. */}
                <button type="button" onClick={() => setShowMapping(true)} className={captionLinkClass}>
                  View the current labels ({entries.length} rows)
                </button>{' '}
                or{' '}
                <button type="button" onClick={downloadLabels} className={captionLinkClass}>
                  download the CSV
                </button>
                .
              </>
            )}
          </p>
        </div>
        <div className="flex-1">
          <TaxonomyDropzone file={file} onFileChange={onFileChange} disabled={disabled} />
        </div>
      </div>
      {error && <Callout variant="error" className="mt-4 whitespace-pre-line">{error}</Callout>}

      <TaxonomyMappingDialog open={showMapping} onClose={() => setShowMapping(false)} entries={entries} />
    </>
  );
};
