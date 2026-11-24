/**
 * "Not needed" for a Needs attention line that is a choice, not a fault
 * (NOT_NEEDED_KINDS in services/api/utils/todo.py), on the page the line
 * opens: project settings (species), server settings (Telegram) and file
 * management (files from unknown cameras). Decided where the context is,
 * not in the panel, which only links.
 *
 * While the line is open: a short offer with a "Not needed" button. Once
 * marked: "Marked not needed by peter@..., 25 Nov 2026. Undo". Nothing
 * otherwise. Only whoever may mark the line sees either: the line and the
 * marks come from the server for exactly those people.
 */
import React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { todoApi, todoKeys } from '../api/todo';
import { formatDate } from '../utils/datetime';

export const NotNeededNote: React.FC<{ kind: string; projectId?: number | null }> = ({ kind, projectId = null }) => {
  const { data: todo } = useQuery({ queryKey: todoKeys.all, queryFn: todoApi.get });
  const { data: marks } = useQuery({ queryKey: todoKeys.notNeeded, queryFn: todoApi.notNeeded });
  const mark = useMutation({ mutationFn: () => todoApi.markNotNeeded(kind, projectId) });
  const undo = useMutation({ mutationFn: () => todoApi.undoNotNeeded(kind, projectId) });

  const marked = marks?.find((m) => m.kind === kind && m.project_id === projectId);
  const items = projectId === null ? todo?.server : todo?.projects.find((p) => p.project_id === projectId)?.items;
  const open = items?.some((i) => i.kind === kind);
  const link = 'underline hover:text-foreground disabled:opacity-50';

  // A span, not a p: it also sits inside a setting's description.
  if (marked) {
    return (
      <span className="block text-xs text-muted-foreground">
        Marked not needed by {marked.by ?? 'someone'}, {formatDate(marked.at)}.{' '}
        <button type="button" onClick={() => undo.mutate()} disabled={undo.isPending} className={link}>
          Undo
        </button>
      </span>
    );
  }
  if (!open) return null;
  return (
    <span className="block text-xs text-muted-foreground">
      This shows in Needs attention. If it is not needed, hide it there for everyone.{' '}
      <button type="button" onClick={() => mark.mutate()} disabled={mark.isPending} className={link}>
        Not needed
      </button>
    </span>
  );
};
