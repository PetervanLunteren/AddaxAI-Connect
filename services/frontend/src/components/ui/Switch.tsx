/**
 * Toggle switch for on/off settings.
 * Uses the same primary color token as Button and Checkbox so it stays on brand.
 */
import React from 'react';

interface SwitchProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}

export const Switch: React.FC<SwitchProps> = ({
  id,
  checked,
  onChange,
  disabled = false,
  className = '',
  'aria-label': ariaLabel,
}) => {
  const trackBg = checked ? 'bg-primary' : 'bg-muted';
  const thumbTransform = checked ? 'translate-x-5' : 'translate-x-0.5';
  const cursor = disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer';

  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${trackBg} ${cursor} ${className}`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${thumbTransform}`}
      />
    </button>
  );
};
