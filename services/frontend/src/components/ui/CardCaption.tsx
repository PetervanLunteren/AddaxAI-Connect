/**
 * The info line at the foot of a chart or map card: a thin rule, an Info
 * icon, then short facts about what the view shows, with "·" between them
 * ("6 sites shown · Each point represents one site"). One component so
 * every Insights card and the Sites map read the same.
 *
 * Parts that are null, false or '' are left out, and with no parts the
 * line is not drawn at all.
 */
import React from 'react';
import { Info } from 'lucide-react';

interface Props {
  parts: React.ReactNode[];
  className?: string;
}

export const CardCaption: React.FC<Props> = ({ parts, className = '' }) => {
  const shown = parts.filter((p) => p !== null && p !== undefined && p !== false && p !== '');
  if (shown.length === 0) return null;
  return (
    <div className={`border-t pt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground ${className}`}>
      <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {shown.map((part, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span aria-hidden="true">·</span>}
          <span>{part}</span>
        </React.Fragment>
      ))}
    </div>
  );
};
