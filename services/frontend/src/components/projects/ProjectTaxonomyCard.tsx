/**
 * Project settings card for a SpeciesNet project's label list (its taxonomy
 * mapping CSV). Saving a new CSV replaces the list and relabels the images
 * nobody has verified yet; labels that rules or thresholds still use but the
 * new list lacks are named, so the admin can update those.
 */
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save } from 'lucide-react';
import { Card, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { TaxonomyDropzone } from './TaxonomyDropzone';
import { TaxonomyMappingDialog } from './TaxonomyMappingDialog';
import { projectsApi } from '../../api/projects';
import { normalizeLabel } from '../../utils/labels';
import type { TaxonomyUploadResponse } from '../../api/types';

interface ProjectTaxonomyCardProps {
  projectId: number;
}

export const ProjectTaxonomyCard: React.FC<ProjectTaxonomyCardProps> = ({ projectId }) => {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [showMapping, setShowMapping] = useState(false);
  const [result, setResult] = useState<TaxonomyUploadResponse | null>(null);

  const { data: mapping } = useQuery({
    queryKey: ['project-taxonomy', projectId],
    queryFn: () => projectsApi.getTaxonomy(projectId),
  });
  const entries = mapping?.entries ?? [];

  const uploadMutation = useMutation({
    mutationFn: (csv: File) => projectsApi.uploadTaxonomy(projectId, csv),
    onSuccess: (response) => {
      setResult(response);
      setFile(null);
      // New labels everywhere labels show: the list itself, the label
      // pickers, and every image and number that carried an old label.
      queryClient.invalidateQueries({ queryKey: ['project-taxonomy', projectId] });
      queryClient.invalidateQueries({ queryKey: ['available-species', projectId] });
      queryClient.invalidateQueries({ queryKey: ['species', projectId] });
      queryClient.invalidateQueries({ queryKey: ['images'] });
      queryClient.invalidateQueries({ queryKey: ['image'] });
      queryClient.invalidateQueries({ queryKey: ['statistics'] });
    },
    onError: () => setResult(null),
  });
  const errorDetail = (uploadMutation.error as any)?.response?.data?.detail
    || uploadMutation.error?.message;

  return (
    <Card className="mt-6">
      <CardContent className="pt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-8">
          <div className="w-full sm:w-1/2 sm:shrink-0">
            <label className="text-sm font-medium block">Species labels</label>
            <p className="text-sm text-muted-foreground mt-1">
              The labels SpeciesNet uses in this project, from a CSV with latin and common columns. Make one with Dan Morris's{' '}
              <a
                href="https://dmorris.net/speciesnet-taxonomy-mapper/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                taxonomy mapper
              </a>
              . A new file replaces the labels and relabels the images nobody has verified yet.
              {entries.length > 0 && (
                <>
                  {' '}
                  <button type="button" onClick={() => setShowMapping(true)} className="text-primary hover:underline">
                    View current labels ({entries.length} rows)
                  </button>
                </>
              )}
            </p>
          </div>
          <div className="flex-1">
            <TaxonomyDropzone
              file={file}
              onFileChange={(next) => { setFile(next); uploadMutation.reset(); setResult(null); }}
              disabled={uploadMutation.isPending}
            />
          </div>
        </div>

        {uploadMutation.isError && (
          <Callout variant="error" className="mt-6">{errorDetail || 'Upload failed'}</Callout>
        )}
        {result && (
          <Callout variant="success" className="mt-6">
            Saved {result.count} rows. {result.reprocessed_count} detections got a new label.
          </Callout>
        )}
        {result && result.stale_labels.length > 0 && (
          <Callout variant="warning" className="mt-3">
            These labels are no longer in the list, but alert rules, species reports or thresholds still use them. Update those so they keep working.
            <ul className="list-disc ml-5 mt-1">
              {result.stale_labels.map((label) => (
                <li key={label}>{normalizeLabel(label)}</li>
              ))}
            </ul>
          </Callout>
        )}

        {file && (
          <>
            <div className="border-t my-6" />
            <div className="flex justify-end">
              <Button onClick={() => uploadMutation.mutate(file)} disabled={uploadMutation.isPending}>
                {uploadMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Save and relabel
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </CardContent>

      <TaxonomyMappingDialog open={showMapping} onClose={() => setShowMapping(false)} entries={entries} />
    </Card>
  );
};
