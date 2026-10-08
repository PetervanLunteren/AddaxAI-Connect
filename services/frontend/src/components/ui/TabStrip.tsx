/**
 * Underlined tab strip, shared by every page and slide-out that switches
 * between views (Sites table and map, Service open and done, the camera
 * and site slide-outs, the camera updates panel).
 *
 * `extra` sits at the right end of the same row, for controls that belong
 * to the active tab. The row wraps, so on phones it drops to its own line.
 */
import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

/** The tab look on its own, for tabs that are links (the dashboard). */
export const tabClass = (active: boolean) =>
  cn(
    'px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 transition-colors',
    active
      ? 'border-primary text-foreground'
      : 'border-transparent text-muted-foreground hover:text-foreground',
  );

export interface TabDef<K extends string> {
  key: K;
  label: string;
  icon?: LucideIcon;
  /** Shown as a badge when above zero. */
  count?: number;
}

interface TabStripProps<K extends string> {
  tabs: TabDef<K>[];
  value: K;
  onChange: (key: K) => void;
  extra?: React.ReactNode;
  className?: string;
}

export function TabStrip<K extends string>({ tabs, value, onChange, extra, className }: TabStripProps<K>) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-y-2 border-b', className)}>
      <div className="flex flex-wrap">
        {tabs.map(({ key, label, icon: Icon, count }) => (
          <button key={key} type="button" onClick={() => onChange(key)} className={tabClass(value === key)}>
            {Icon && <Icon className="h-4 w-4" />}
            {label}
            {(count ?? 0) > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#71b7ba] text-white">
                {count}
              </span>
            )}
          </button>
        ))}
      </div>
      {extra}
    </div>
  );
}
