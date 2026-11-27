/**
 * One fact as a label and a value on one line, the label muted on the
 * left. Used where a window lists what it knows: "Show details" in image
 * verification. Renders
 * nothing without a value, so callers can pass optional fields as they are.
 */
import React from 'react';

export const DetailRow: React.FC<{ label: string; children?: React.ReactNode }> = ({ label, children }) => {
  if (children === null || children === undefined || children === false || children === '') return null;
  return (
    <div className="flex justify-between gap-4">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right">{children}</span>
    </div>
  );
};
