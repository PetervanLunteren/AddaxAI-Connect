/**
 * Drop-in replacement for useSearchParams on pages with a FILTER_SCHEMA,
 * adding filter memory: the schema keys are saved to localStorage per user,
 * project and page, and come back when the page is opened on a bare address
 * (a sidebar click, also on the page you are on, a new tab, a fresh login).
 *
 * Rules:
 * - Only a bare address restores. Any parameter means the address is a
 *   link, a shared filter or a shared image, and it shows exactly what the
 *   sender saw.
 * - Only schema keys are saved and restored. Page-private params like the
 *   open image never touch storage.
 * - Clearing filters saves the empty set, so cleared stays cleared.
 * - The restored params are returned synchronously on the first render
 *   (the URL catches up in an effect), so queries never fire unfiltered
 *   first and refetch filtered a render later.
 * - localStorage reads and writes are wrapped: with storage blocked the
 *   page behaves exactly as before, filters just stop persisting.
 */
import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useProject } from '../contexts/ProjectContext';
import type { FilterSchema } from './filter-url';

type ParamsInit = URLSearchParams | ((prev: URLSearchParams) => URLSearchParams);
type SetParams = (init: ParamsInit, opts?: { replace?: boolean }) => void;

/** The non-empty schema keys of a set of params. */
function schemaSubset(params: URLSearchParams, schema: FilterSchema): URLSearchParams {
  const subset = new URLSearchParams();
  for (const k of Object.keys(schema)) {
    const v = params.get(k);
    if (v !== null && v !== '') subset.set(k, v);
  }
  return subset;
}

function readSaved(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function saveFilters(key: string, filters: string) {
  try {
    localStorage.setItem(key, filters);
  } catch {
    // Storage blocked: the page still works, filters just stop persisting.
  }
}

export function usePersistedFilterParams(
  page: string,
  schema: FilterSchema,
): [URLSearchParams, SetParams] {
  const { user } = useAuth();
  const { selectedProject } = useProject();
  const [searchParams, setSearchParams] = useSearchParams();

  const storageKey =
    `addaxai:filters:${user?.id ?? 'anon'}:${selectedProject?.id ?? 'none'}:${page}`;

  // Saved filters to restore, or null. An empty string (filters cleared)
  // counts as nothing to restore. Once the URL carries them it is no longer
  // bare, so the restore cannot repeat.
  const isBare = searchParams.toString() === '';
  const saved = isBare ? readSaved(storageKey) : null;
  const restoredQuery = saved ? schemaSubset(new URLSearchParams(saved), schema).toString() : '';
  const restored = useMemo(
    () => (restoredQuery ? new URLSearchParams(restoredQuery) : null),
    [restoredQuery],
  );

  useEffect(() => {
    if (restoredQuery) {
      setSearchParams(new URLSearchParams(restoredQuery), { replace: true });
    }
  }, [restoredQuery, setSearchParams]);

  // Saves only when the filters change, so opening or closing an image
  // from a shared link does not overwrite the filters remembered here.
  const setParams = useCallback<SetParams>(
    (init, opts) => {
      setSearchParams((prev) => {
        const next = typeof init === 'function' ? init(prev) : init;
        const filters = schemaSubset(next, schema).toString();
        if (filters !== schemaSubset(prev, schema).toString()) {
          saveFilters(storageKey, filters);
        }
        return next;
      }, opts);
    },
    [storageKey, schema, setSearchParams],
  );

  return [restored ?? searchParams, setParams];
}
