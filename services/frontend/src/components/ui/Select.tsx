/**
 * Select dropdown component
 */
import React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'size'> {
  children?: React.ReactNode;
  /** 'sm' is the 28 px inline variant for dense panels. */
  size?: 'default' | 'sm';
  /** Layout of the wrapper, e.g. flex-1 or a max width; className styles the select itself. */
  wrapperClassName?: string;
  onValueChange?: (value: string) => void;
  onChange?: (event: React.ChangeEvent<HTMLSelectElement>) => void;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, wrapperClassName, size = 'default', children, onValueChange, onChange, ...props }, ref) => {
    const sm = size === 'sm';
    const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
      // Call both handlers if provided
      onChange?.(event);
      onValueChange?.(event.target.value);
    };

    return (
      <div className={cn('relative', wrapperClassName)}>
        <select
          className={cn(
            'flex w-full border border-input bg-background text-foreground ring-offset-background appearance-none',
            sm ? 'h-7 rounded pl-1.5 pr-6 text-xs' : 'h-10 rounded-md px-3 pr-8 text-sm',
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
        <ChevronDown
          className={cn(
            'absolute top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none',
            sm ? 'right-1.5 h-3 w-3' : 'right-3 h-4 w-4',
          )}
        />
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
