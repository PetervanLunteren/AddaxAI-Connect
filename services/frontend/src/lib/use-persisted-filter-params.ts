/**
 * Drop-in replacement for useSearchParams on pages with a FILTER_SCHEMA,
 * adding filter memory: the schema keys are saved to localStorage per user,
 * project and page, and come back when the page is opened without any of
 * them in the URL (a sidebar click, a new tab, a fresh login).
 *
 * Rules:
 * - A URL that already carries a schema key wins, so a shared link always
 *   shows what the sender saw.
 * - Only schema keys are saved and restored. Page-private params like the
 *   open image never touch storage and survive a restore untouched.
 * - Clearing filters saves the empty set, so cleared stays cleared.
 * - The restored params are returned synchronously on the first render
 *   (the URL catches up in an effect), so queries never fire unfiltered
 *   first and refetch filtered a render later.
 * - localStorage reads and writes are wrapped: with storage blocked the
 *   page behaves exactly as before, filters just stop persisting.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useProject } from '../contexts/ProjectContext';
import type { FilterSchema } from './filter-url';

type ParamsInit = URLSearchParams | ((prev: URLSearchParams) => URLSearchParams);
type SetParams = (init: ParamsInit, opts?: { replace?: boolean }) => void;

function readSaved(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function saveFilters(key: string, params: URLSearchParams, schema: FilterSchema) {
  const subset = new URLSearchParams();
  for (const k of Object.keys(schema)) {
    const v = params.get(k);
    if (v !== null && v !== '') subset.set(k, v);
  }
  try {
    localStorage.setItem(key, subset.toString());
  } catch {
    // Storage blocked: the page still works, filters just stop persisting.
  }
}

function mergeSaved(
  params: URLSearchParams,
  saved: string,
  schema: FilterSchema,
): URLSearchParams {
  const merged = new URLSearchParams(params);
  const savedParams = new URLSearchParams(saved);
  for (const k of Object.keys(schema)) {
    const v = savedParams.get(k);
    if (v !== null && v !== '') merged.set(k, v);
  }
  return merged;
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
  const urlHasFilters = Object.keys(schema).some((k) => searchParams.has(k));

  // The restore decision is made once per storage key. The ref is only
  // written in the effect below, so a re-render before the effect lands
  // computes the same restored params again instead of flip-flopping.
  const appliedKeyRef = useRef<string | null>(null);
  let effectiveParams = searchParams;
  if (appliedKeyRef.current !== storageKey && !urlHasFilters) {
    const saved = readSaved(storageKey);
    if (saved) effectiveParams = mergeSaved(searchParams, saved, schema);
  }

  useEffect(() => {
    if (appliedKeyRef.current === storageKey) return;
    appliedKeyRef.current = storageKey;
    if (urlHasFilters) return;
    const saved = readSaved(storageKey);
    if (saved) {
      setSearchParams(mergeSaved(searchParams, saved, schema), { replace: true });
    }
    // Only the key decides whether a restore is due; params and schema are
    // read fresh when it fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const setParams = useCallback<SetParams>(
    (init, opts) => {
      if (typeof init === 'function') {
        setSearchParams((prev) => {
          const next = init(prev);
          saveFilters(storageKey, next, schema);
          return next;
        }, opts);
      } else {
        saveFilters(storageKey, init, schema);
        setSearchParams(init, opts);
      }
    },
    [storageKey, schema, setSearchParams],
  );

  return [effectiveParams, setParams];
}
