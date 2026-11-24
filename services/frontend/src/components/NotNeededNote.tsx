/**
 * On the page a To do line opens: "Marked not needed by peter@..., 25 Nov
 * 2026. Undo". Shown only while someone marked that line not needed
 * (TodoMenu), to whoever may undo it. Shared by the three pages whose lines
 * can be marked: project settings (species), server settings (Telegram) and
 * file management (files from unknown cameras).
 */
import React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { todoApi, todoKeys } from '../api/todo';
import { formatDate } from '../utils/datetime';

export const NotNeededNote: React.FC<{ kind: string; projectId?: number | null }> = ({ kind, projectId = null }) => {
  const { data } = useQuery({ queryKey: todoKeys.notNeeded, queryFn: todoApi.notNeeded });
  const undo = useMutation({ mutationFn: () => todoApi.undoNotNeeded(kind, projectId) });
  const mark = data?.find((m) => m.kind === kind && m.project_id === projectId);
  if (!mark) return null;
  return (
    // A span, not a p: it also sits inside a setting's description.
    <span className="block text-xs text-muted-foreground">
      Marked not needed in To do by {mark.by ?? 'someone'}, {formatDate(mark.at)}.{' '}
      <button
        type="button"
        onClick={() => undo.mutate()}
        disabled={undo.isPending}
        className="underline hover:text-foreground"
      >
        Undo
      </button>
    </span>
  );
};
