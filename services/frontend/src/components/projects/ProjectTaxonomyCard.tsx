/**
 * Project settings card for a SpeciesNet project's label list (its taxonomy
 * mapping CSV). Saving a new CSV replaces the list and relabels the images
 * nobody has verified yet. When the new list lacks a label that rules or
 * thresholds use, the server saves nothing and LabelChangeDialog asks first.
 */
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save } from 'lucide-react';
import { Card, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { TaxonomyDropzone } from './TaxonomyDropzone';
import { TaxonomyMappingDialog } from './TaxonomyMappingDialog';
import { LabelChangeDialog } from './LabelChangeDialog';
import { labelChangeImpact, projectsApi } from '../../api/projects';
import { apiErrorMessage } from '../../api/client';
import { downloadCsv } from '../../utils/download';
import type { LabelChangeImpact, TaxonomyUploadResponse } from '../../api/types';

interface ProjectTaxonomyCardProps {
  projectId: number;
}

export const ProjectTaxonomyCard: React.FC<ProjectTaxonomyCardProps> = ({ projectId }) => {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [showMapping, setShowMapping] = useState(false);
  const [result, setResult] = useState<TaxonomyUploadResponse | null>(null);
  // Set while the server waits for a confirm, see LabelChangeDialog
  const [pendingImpact, setPendingImpact] = useState<LabelChangeImpact | null>(null);

  const { data: mapping } = useQuery({
    queryKey: ['project-taxonomy', projectId],
    queryFn: () => projectsApi.getTaxonomy(projectId),
  });
  const entries = mapping?.entries ?? [];

  const uploadMutation = useMutation({
    mutationFn: ({ csv, confirm }: { csv: File; confirm: boolean }) =>
      projectsApi.uploadTaxonomy(projectId, csv, confirm),
    onSuccess: (response) => {
      setResult(response);
      setFile(null);
      setPendingImpact(null);
      // New labels everywhere labels show: the list itself, the label
      // pickers, and every image and number that carried an old label.
      queryClient.invalidateQueries({ queryKey: ['project-taxonomy', projectId] });
      queryClient.invalidateQueries({ queryKey: ['available-species', projectId] });
      queryClient.invalidateQueries({ queryKey: ['species', projectId] });
      queryClient.invalidateQueries({ queryKey: ['images'] });
      queryClient.invalidateQueries({ queryKey: ['image'] });
      queryClient.invalidateQueries({ queryKey: ['statistics'] });
      // Rules and thresholds may have lost a label that is gone
      queryClient.invalidateQueries({ queryKey: ['detection-alert-rules', projectId] });
      queryClient.invalidateQueries({ queryKey: ['species-report-rules', projectId] });
      queryClient.invalidateQueries({ queryKey: ['user-projects'] });
    },
    onError: (error) => {
      setResult(null);
      setPendingImpact(labelChangeImpact(error));
    },
  });
  // A refusal that waits for a confirm is a question, not an error
  const uploadError = uploadMutation.isError && !labelChangeImpact(uploadMutation.error)
    ? apiErrorMessage(uploadMutation.error)
    : null;

  // The same two columns an upload reads, so the file can go back in as it is.
  const downloadLabels = () => downloadCsv(
    ['latin', 'common'],
    entries.map((entry) => [entry.latin, entry.common]),
    'species-labels.csv',
  );

  return (
    <Card className="mt-6">
      <CardContent className="pt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-8">
          <div className="w-full sm:w-1/2 sm:shrink-0">
            <label className="text-sm font-medium block">Species labels</label>
            <p className="text-sm text-muted-foreground mt-1">
              The labels SpeciesNet uses in this project, from a CSV with latin and common columns. The AI taxonomist in the{' '}
              <a
                href="https://connect.addaxai.com/speciesnet-setup/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                SpeciesNet setup guide
              </a>{' '}
              makes a new file with you, or changes the current one. A new file replaces the labels and relabels the images nobody has verified yet.
            </p>
            {entries.length > 0 && (
              <p className="text-sm mt-2 flex flex-wrap gap-x-4 gap-y-1">
                <button type="button" onClick={() => setShowMapping(true)} className="text-primary hover:underline">
                  View current labels ({entries.length} rows)
                </button>
                <button type="button" onClick={downloadLabels} className="text-primary hover:underline">
                  Download CSV
                </button>
              </p>
            )}
          </div>
          <div className="flex-1">
            <TaxonomyDropzone
              file={file}
              onFileChange={(next) => { setFile(next); uploadMutation.reset(); setResult(null); }}
              disabled={uploadMutation.isPending}
            />
          </div>
        </div>

        {uploadError && (
          <Callout variant="error" className="mt-6 whitespace-pre-line">{uploadError}</Callout>
        )}
        {result && (
          <Callout variant="success" className="mt-6">
            Saved {result.count} rows. {result.reprocessed_count} detections got a new label.
          </Callout>
        )}
        {file && (
          <>
            <div className="border-t my-6" />
            <div className="flex justify-end">
              <Button onClick={() => uploadMutation.mutate({ csv: file, confirm: false })} disabled={uploadMutation.isPending}>
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
      <LabelChangeDialog
        impact={pendingImpact}
        onClose={() => { setPendingImpact(null); uploadMutation.reset(); }}
        onConfirm={() => file && uploadMutation.mutate({ csv: file, confirm: true })}
        isPending={uploadMutation.isPending}
      />
    </Card>
  );
};
