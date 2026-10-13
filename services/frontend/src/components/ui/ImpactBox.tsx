/**
 * The box in a destructive dialog that says what the action does, as a
 * heading with bullets: "This will delete", then one line per thing that
 * goes. Red for a delete, grey for an action that keeps the data (retire).
 *
 * One component for every such dialog (Curation delete, camera delete,
 * project delete, dev server reset) so the shape never drifts again: it used
 * to be pasted three times with two different content layouts. Headings
 * carry no colon, the UI copy rule.
 *
 * `rows` is an optional named list under the bullets, used by the camera and
 * project deletes to name every camera: the table selection survives
 * filtering, so without the names people could delete rows that are not on
 * screen. `children` is free content below everything, for a loading or
 * error line or a footnote.
 */
import React from 'react';
import { AlertTriangle, Info } from 'lucide-react';

export type ImpactTone = 'destructive' | 'neutral';

export interface ImpactSection {
  heading: string;
  bullets: React.ReactNode[];
}

export interface ImpactRow {
  key: string | number;
  name: string;
  detail?: React.ReactNode;
}

interface ImpactBoxProps {
  tone?: ImpactTone;
  sections: ImpactSection[];
  rows?: ImpactRow[];
  children?: React.ReactNode;
  className?: string;
}

const TONES: Record<ImpactTone, { box: string; heading: string; Icon: typeof Info }> = {
  destructive: {
    box: 'border-2 border-destructive bg-destructive/5',
    heading: 'text-destructive',
    Icon: AlertTriangle,
  },
  neutral: {
    box: 'border bg-muted/40',
    heading: '',
    Icon: Info,
  },
};

export const ImpactBox: React.FC<ImpactBoxProps> = ({
  tone = 'destructive',
  sections,
  rows,
  children,
  className = 'my-4',
}) => {
  const { box, heading, Icon } = TONES[tone];
  return (
    <div className={`rounded-md p-4 ${box} ${className}`}>
      <div className="flex items-start gap-3">
        <Icon
          className={`h-5 w-5 mt-0.5 flex-shrink-0 ${tone === 'destructive' ? 'text-destructive' : 'text-muted-foreground'}`}
          aria-hidden="true"
        />
        {/* min-w-0 so this can shrink inside the flex row. Without it the
            named rows set a minimum width and the dialog runs off a phone
            screen. */}
        <div className="min-w-0 flex-1 space-y-3 text-sm">
          {sections.map((section) => (
            <div key={section.heading} className="space-y-1">
              <p className={`font-semibold ${heading}`}>{section.heading}</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                {section.bullets.map((bullet, i) => (
                  <li key={i}>{bullet}</li>
                ))}
              </ul>
            </div>
          ))}

          {rows && rows.length > 0 && (
            // Deliberately not a table: fixed columns cannot shrink, so the
            // detail wraps under the name on a narrow screen instead of
            // pushing the dialog sideways. Scrolls on its own when long.
            <div className="max-h-48 overflow-y-auto rounded-md border bg-white divide-y">
              {rows.map((row) => (
                <div
                  key={row.key}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-1.5"
                >
                  <span className="font-mono text-xs break-all">{row.name}</span>
                  {row.detail != null && (
                    <span className="text-sm whitespace-nowrap">{row.detail}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {children}
        </div>
      </div>
    </div>
  );
};
