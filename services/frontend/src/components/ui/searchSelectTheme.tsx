/**
 * The look of every searchable select (react-select), so it matches the
 * plain Select in ui/Select.tsx: same height, border, focus ring, text size
 * and the same lucide chevron. Country, state and timezone pickers use it.
 */
import { ChevronDown } from 'lucide-react';
import { components, type DropdownIndicatorProps, type GroupBase, type StylesConfig } from 'react-select';

export function searchSelectStyles<T>(): StylesConfig<T, false, GroupBase<T>> {
  return {
    control: (provided, state) => ({
      ...provided,
      backgroundColor: 'hsl(var(--background))',
      borderColor: 'hsl(var(--input))',
      borderRadius: '0.375rem',
      minHeight: '2.5rem',
      fontSize: '0.875rem',
      boxShadow: state.isFocused ? '0 0 0 2px hsl(var(--ring))' : 'none',
      '&:hover': { borderColor: 'hsl(var(--input))' },
    }),
    menu: (provided) => ({
      ...provided,
      backgroundColor: 'hsl(var(--background))',
      border: '1px solid hsl(var(--border))',
      borderRadius: '0.375rem',
      fontSize: '0.875rem',
      zIndex: 50,
    }),
    // The menu renders in document.body, so a Dialog that scrolls cannot clip
    // it. Same layer as the other select menus (z-index ladder).
    menuPortal: (provided) => ({ ...provided, zIndex: 50 }),
    option: (provided, state) => ({
      ...provided,
      backgroundColor: state.isSelected
        ? 'hsl(var(--primary))'
        : state.isFocused
        ? 'hsl(var(--accent))'
        : 'transparent',
      color: state.isSelected ? 'hsl(var(--primary-foreground))' : 'hsl(var(--foreground))',
      cursor: 'pointer',
      '&:active': { backgroundColor: 'hsl(var(--primary))' },
    }),
    groupHeading: (provided) => ({
      ...provided,
      color: 'hsl(var(--muted-foreground))',
      fontSize: '0.75rem',
      fontWeight: 600,
      textTransform: 'uppercase',
    }),
    input: (provided) => ({ ...provided, color: 'hsl(var(--foreground))' }),
    placeholder: (provided) => ({ ...provided, color: 'hsl(var(--muted-foreground))' }),
    singleValue: (provided) => ({ ...provided, color: 'hsl(var(--foreground))' }),
  };
}

// The chevron of ui/Select, at its default and its compact size.
const indicator = (iconClass: string) =>
  function DropdownIndicator<T>(props: DropdownIndicatorProps<T, false, GroupBase<T>>) {
    return (
      <components.DropdownIndicator {...props}>
        <ChevronDown className={`${iconClass} text-muted-foreground`} />
      </components.DropdownIndicator>
    );
  };

/** The chevron of ui/Select and no separator line before it. */
export const searchSelectComponents = { DropdownIndicator: indicator('h-4 w-4'), IndicatorSeparator: null };

/** The same for the compact 28 px selects, like Select size="sm". */
export const compactSearchSelectComponents = { DropdownIndicator: indicator('h-3 w-3'), IndicatorSeparator: null };
