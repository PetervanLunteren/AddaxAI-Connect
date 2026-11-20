/**
 * The read-only log of the Camera updates page: what the app noticed, by
 * week, one line each. No buttons: a line opens the check at that update.
 * An update somebody answered says who said it was right. Updates that need
 * a person carry an orange edge. Older weeks wait behind a button, except
 * the updates that need a person.
 */
import React, { useState } from 'react';
import { Button } from '../ui/Button';
import { context, dayLabel, headline, weekOf, type UpdateItem } from './update-items';

interface Props {
  items: UpdateItem[];
  onOpen: (item: UpdateItem) => void;
}

export const CameraUpdatesLog: React.FC<Props> = ({ items, onOpen }) => {
  const [showEarlier, setShowEarlier] = useState(false);
  const earlier = items.filter((it) => weekOf(it.day) === 'Earlier' && !it.needsYou);
  const shown = showEarlier ? items : items.filter((it) => !earlier.includes(it));

  const groups: { week: string; items: UpdateItem[] }[] = [];
  for (const it of shown) {
    const week = weekOf(it.day);
    const last = groups[groups.length - 1];
    if (last && last.week === week) last.items.push(it);
    else groups.push({ week, items: [it] });
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No camera updates. New cameras, moves and photos without a site show up here.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.week} className="space-y-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.week}</h3>
          <ul className="divide-y rounded-md border">
            {g.items.map((it) => (
              <li key={it.key}>
                <button
                  type="button"
                  onClick={() => onOpen(it)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-accent/50 ${
                    it.needsYou ? 'border-l-4 border-l-[#ff8945]' : ''
                  } ${it.answered ? 'text-muted-foreground' : ''}`}
                >
                  <span className="font-medium tabular-nums">{it.cameraLabel}</span> {headline(it)}
                  {it.shortTrip && <span className="ml-2 text-xs">back within a week</span>}
                  <span className="block text-xs text-muted-foreground">
                    {context(it)}
                    {it.answered && it.deployment?.checked_at && (
                      <> · right, said {it.deployment.checked_by ?? 'someone'} on {dayLabel(it.deployment.checked_at.slice(0, 10))}</>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {earlier.length > 0 && (
        <Button variant="ghost" size="sm" onClick={() => setShowEarlier(!showEarlier)}>
          {showEarlier ? 'Hide earlier updates' : `Show ${earlier.length} earlier ${earlier.length === 1 ? 'update' : 'updates'}`}
        </Button>
      )}
    </div>
  );
};
