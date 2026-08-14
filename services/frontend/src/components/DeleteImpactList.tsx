/**
 * What a delete is about to destroy, per camera.
 *
 * Shared by the camera delete and the project delete so the two dialogs can
 * never disagree. Both read the same backend helper.
 *
 * Why this exists: the old confirmation counted cameras and nothing else, so
 * removing an empty registration and removing a camera with 374 images and
 * months of verification work looked exactly the same. It also never named
 * the cameras, and the table selection survives filtering, so people could
 * delete rows that were not on screen.
 */
import React from 'react';
import { Loader2 } from 'lucide-react';
import type { CameraDeletePreviewItem } from '../api/cameras';

interface DeleteImpactListProps {
  items: CameraDeletePreviewItem[] | undefined;
  isLoading: boolean;
  error: string | null;
}

/** Totals across the whole selection. Derived here so the API stays lean. */
export function impactTotals(items: CameraDeletePreviewItem[] | undefined) {
  return (items ?? []).reduce(
    (acc, item) => ({
      cameras: acc.cameras + 1,
      images: acc.images + item.images,
      verified: acc.verified + item.verified_images,
    }),
    { cameras: 0, images: 0, verified: 0 },
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const DeleteImpactList: React.FC<DeleteImpactListProps> = ({
  items,
  isLoading,
  error,
}) => {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking what these cameras hold
      </div>
    );
  }

  if (error) {
    return (
      <p className="py-3 text-sm text-destructive">
        Could not check what these cameras hold, so deleting is blocked. {error}
      </p>
    );
  }

  const totals = impactTotals(items);

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-destructive">
        {plural(totals.cameras, 'camera')}, {plural(totals.images, 'image')}
        {totals.verified > 0 && `, ${totals.verified} verified by hand`}
      </p>

      {/* Named rows, so nobody deletes a camera that is off screen. Scrolls
          on its own for a long selection, the page never scrolls sideways. */}
      <div className="max-h-48 overflow-y-auto rounded-md border bg-white">
        <table className="w-full text-sm">
          <tbody>
            {(items ?? []).map((item) => (
              <tr key={item.camera_id} className="border-b last:border-b-0">
                <td className="px-3 py-1.5 font-mono text-xs">{item.name}</td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap">
                  {plural(item.images, 'image')}
                </td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap text-muted-foreground">
                  {item.verified_images > 0
                    ? `${item.verified_images} verified`
                    : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-sm text-muted-foreground">
        Also removed, all detections, classifications, human observations,
        deployment and health records, and the stored image files.
      </p>
    </div>
  );
};
