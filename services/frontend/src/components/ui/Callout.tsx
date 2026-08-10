/**
 * One shared message box for info, warning, error, and success notes.
 *
 * Every short status or hint message in the app uses this component so
 * the styling stays identical everywhere. Content goes in as children
 * and may hold links or small buttons; the optional action slot renders
 * a control on the right, e.g. a button or a dismiss icon. Structured
 * status widgets (server health page, pipeline status) intentionally
 * keep their own layout and do not use this component.
 */
import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle, Info } from 'lucide-react';

export type CalloutVariant = 'info' | 'warning' | 'error' | 'success';

const VARIANTS: Record<CalloutVariant, { box: string; Icon: typeof Info }> = {
  info: { box: 'bg-blue-50 border-blue-200 text-blue-900', Icon: Info },
  warning: { box: 'bg-amber-50 border-amber-200 text-amber-900', Icon: AlertTriangle },
  error: { box: 'bg-red-50 border-red-200 text-red-900', Icon: AlertCircle },
  success: { box: 'bg-green-50 border-green-200 text-green-900', Icon: CheckCircle },
};

interface CalloutProps {
  variant: CalloutVariant;
  children: React.ReactNode;
  /** Optional control on the right, e.g. a small button */
  action?: React.ReactNode;
  className?: string;
}

export const Callout: React.FC<CalloutProps> = ({
  variant, children, action, className = '',
}) => {
  const { box, Icon } = VARIANTS[variant];
  return (
    <div className={`flex items-start gap-2 p-3 border rounded-md text-sm ${box} ${className}`}>
      <Icon className="h-4 w-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0">{children}</div>
      {action && <div className="flex-shrink-0 flex items-center gap-2">{action}</div>}
    </div>
  );
};
