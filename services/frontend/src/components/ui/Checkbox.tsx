/**
 * Custom Checkbox component with primary color styling
 */
import React from 'react';

interface CheckboxProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  className?: string;
}

export const Checkbox: React.FC<CheckboxProps> = ({
  id,
  checked,
  onChange,
  label,
  className = '',
}) => {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-5 h-5 rounded border-border text-primary focus:ring-2 focus:ring-primary focus:ring-offset-0 accent-primary cursor-pointer"
      />
      <label
        htmlFor={id}
        className="text-sm font-medium cursor-pointer select-none"
      >
        {label}
      </label>
    </div>
  );
};
