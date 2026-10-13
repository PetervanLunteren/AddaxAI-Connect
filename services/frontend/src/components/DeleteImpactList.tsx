/**
 * What deleting or retiring cameras does, from the backend preview.
 *
 * Shared by the camera delete and the project delete so the two dialogs can
 * never disagree. Both read the same backend helper, and both render through
 * the shared ImpactBox so they look like every other destructive dialog.
 *
 * Why the names: the old confirmation counted cameras and nothing else, so
 * removing an empty registration and removing a camera with 374 images and
 * months of verification work looked exactly the same. It also never named
 * the cameras, and the table selection survives filtering, so people could
 * delete rows that were not on screen.
 *
 * In retire mode the same numbers are what stays, so the person sees that
 * nothing recorded is lost and only the open service tasks go.
 */
import React from 'react';
import { Loader2 } from 'lucide-react';
import type { CameraDeletePreviewItem } from '../api/cameras';
import { ImpactBox, type ImpactSection } from './ui/ImpactBox';

export type ImpactMode = 'delete' | 'retire';

interface DeleteImpactListProps {
  items: CameraDeletePreviewItem[] | undefined;
  isLoading: boolean;
  error: string | null;
  mode?: ImpactMode;
}

/** Totals across the whole selection. Derived here so the API stays lean. */
export function impactTotals(items: CameraDeletePreviewItem[] | undefined) {
  return (items ?? []).reduce(
    (acc, item) => ({
      cameras: acc.cameras + 1,
      images: acc.images + item.images,
      verified: acc.verified + item.verified_images,
      tasks: acc.tasks + item.open_tasks,
    }),
    { cameras: 0, images: 0, verified: 0, tasks: 0 },
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const DeleteImpactList: React.FC<DeleteImpactListProps> = ({
  items,
  isLoading,
  error,
  mode = 'delete',
}) => {
  const tone = mode === 'retire' ? 'neutral' : 'destructive';
  const verb = mode === 'retire' ? 'retiring' : 'deleting';

  if (isLoading) {
    return (
      <ImpactBox tone={tone} sections={[]}>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking what these cameras hold
        </div>
      </ImpactBox>
    );
  }

  if (error) {
    return (
      <ImpactBox tone={tone} sections={[]}>
        <p className="text-destructive">
          Could not check what these cameras hold, so {verb} is blocked. {error}
        </p>
      </ImpactBox>
    );
  }

  const totals = impactTotals(items);
  const recorded = [
    plural(totals.cameras, 'camera'),
    totals.verified > 0
      ? `${plural(totals.images, 'image')}, ${totals.verified} verified by hand`
      : plural(totals.images, 'image'),
    'all detections, classifications and human observations',
    'placements, health records and service history',
  ];
  const tasks = totals.tasks > 0 ? plural(totals.tasks, 'open service task') : null;

  const sections: ImpactSection[] =
    mode === 'retire'
      ? [
          { heading: 'This will keep', bullets: recorded },
          {
            heading: 'This will remove',
            bullets: [
              ...(tasks ? [tasks] : []),
              'the cameras from service, each current placement is closed at its last photo',
            ],
          },
        ]
      : [
          {
            heading: 'This will delete',
            bullets: [...recorded, ...(tasks ? [tasks] : []), 'the stored image files'],
          },
        ];

  const rows = (items ?? []).map((item) => ({
    key: item.camera_id,
    name: item.name,
    detail: (
      <>
        {plural(item.images, 'image')}
        {item.verified_images > 0 && (
          <span className="text-muted-foreground">, {item.verified_images} verified</span>
        )}
      </>
    ),
  }));

  return <ImpactBox tone={tone} sections={sections} rows={rows} />;
};
