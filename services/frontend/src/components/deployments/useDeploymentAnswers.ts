/**
 * The answers to a suspicious deployment, for its window: Right, Wrong, and
 * taking either back. Each answer carries its own row, because the window
 * may have stepped on by the time the server answers.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deploymentsApi, invalidateDeployments } from '../../api/deployments';
import { errorDetail } from '../../lib/utils';
import { useToast } from '../ui/Toaster';

/** A Wrong answered in this window: the correction it made, for Undo. */
export interface Wrong {
  correctionId: number;
  oldSite: string;
}

export function useDeploymentAnswers(projectId: number) {
  const queryClient = useQueryClient();
  const toast = useToast();
  // By row key. A Wrong removes its deployment, so the window keeps what
  // was answered to say so and to offer Undo.
  const [wrongs, setWrongs] = useState<Record<string, Wrong>>({});
  const refresh = () => invalidateDeployments(queryClient, projectId);

  const right = useMutation({
    mutationFn: ({ id, checked }: { id: number; checked: boolean }) =>
      deploymentsApi.setChecked(projectId, id, checked),
    onSuccess: refresh,
    onError: (error) => toast.error(`Could not save. ${errorDetail(error)}`),
  });
  const wrong = useMutation({
    mutationFn: ({ id }: { id: number; key: string; oldSite: string }) => deploymentsApi.notMoved(projectId, id),
    onSuccess: (result, { key, oldSite }) => {
      setWrongs((w) => ({ ...w, [key]: { correctionId: result.statement_id, oldSite } }));
      refresh();
    },
    onError: (error) => toast.error(`Could not save. ${errorDetail(error)}`),
  });
  const undoWrong = useMutation({
    mutationFn: ({ correctionId }: { correctionId: number; key: string }) =>
      deploymentsApi.undoCorrection(projectId, correctionId),
    onSuccess: (_, { key }) => {
      setWrongs(({ [key]: _done, ...rest }) => rest);
      refresh();
    },
    onError: (error) => toast.error(`Could not undo. ${errorDetail(error)}`),
  });

  return {
    wrongs,
    right,
    wrong,
    undoWrong,
    busy: right.isPending || wrong.isPending || undoWrong.isPending,
  };
}
