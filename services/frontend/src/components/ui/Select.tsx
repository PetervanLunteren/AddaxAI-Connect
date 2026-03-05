/**
 * Select dropdown component
 */
import React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  children?: React.ReactNode;
  onValueChange?: (value: string) => void;
  onChange?: (event: React.ChangeEvent<HTMLSelectElement>) => void;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, onValueChange, onChange, ...props }, ref) => {
    const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
      // Call both handlers if provided
      onChange?.(event);
      onValueChange?.(event.target.value);
    };

    return (
      <div className="relative">
        <select
          className={cn(
            'flex h-10 w-full rounded-md border border-input bg-background px-3 pr-8 text-sm ring-offset-background appearance-none',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
            className
          )}
          ref={ref}
          onChange={handleChange}
          {...props}
        >
          {children}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      </div>
    );
  }
);
Select.displayName = 'Select';

export const SelectTrigger = Select; // Alias for compatibility
export const SelectValue = React.Fragment; // Placeholder component

export interface SelectContentProps {
  children?: React.ReactNode;
}

export const SelectContent: React.FC<SelectContentProps> = ({ children }) => {
  return <>{children}</>;
};

export interface SelectItemProps extends React.OptionHTMLAttributes<HTMLOptionElement> {
  children?: React.ReactNode;
}

export const SelectItem = React.forwardRef<HTMLOptionElement, SelectItemProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <option ref={ref} {...props}>
        {children}
      </option>
    );
  }
);
SelectItem.displayName = 'SelectItem';
