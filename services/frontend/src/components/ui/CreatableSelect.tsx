/**
 * CreatableSelect component using react-select's Creatable
 * Allows users to select from options OR type a custom value
 * Styled to match the application theme
 */
import React from 'react';
import CreatableSelect from 'react-select/creatable';
import type { StylesConfig, SingleValue } from 'react-select';

export interface Option {
  label: string;
  value: string;
}

interface CreatableSelectProps {
  options: Option[];
  value: Option | null;
  onChange: (selected: Option | null) => void;
  placeholder?: string;
  isLoading?: boolean;
  className?: string;
  isClearable?: boolean;
}

export const CreatableSpeciesSelect: React.FC<CreatableSelectProps> = ({
  options,
  value,
  onChange,
  placeholder = 'Select or type...',
  isLoading = false,
  className = '',
  isClearable = true,
}) => {
  const handleChange = (newValue: SingleValue<Option>) => {
    onChange(newValue);
  };

  // Format the option label for newly created options
  const formatCreateLabel = (inputValue: string) => `Add "${inputValue}"`;

  // Custom styles to match your theme
  const customStyles: StylesConfig<Option, false> = {
    control: (provided, state) => ({
      ...provided,
      backgroundColor: 'hsl(var(--background))',
      borderColor: state.isFocused ? 'hsl(var(--ring))' : 'hsl(var(--input))',
      borderRadius: '0.375rem',
      minHeight: '2.25rem',
      boxShadow: state.isFocused ? '0 0 0 2px hsl(var(--ring))' : 'none',
      '&:hover': {
        borderColor: 'hsl(var(--input))',
      },
    }),
    menu: (provided) => ({
      ...provided,
      backgroundColor: 'hsl(var(--background))',
      border: '1px solid hsl(var(--border))',
      borderRadius: '0.375rem',
      zIndex: 50,
    }),
    option: (provided, state) => ({
      ...provided,
      backgroundColor: state.isSelected
        ? 'hsl(var(--primary))'
        : state.isFocused
        ? 'hsl(var(--accent))'
        : 'transparent',
      color: state.isSelected ? 'hsl(var(--primary-foreground))' : 'hsl(var(--foreground))',
      cursor: 'pointer',
      fontSize: '0.875rem',
      '&:active': {
        backgroundColor: 'hsl(var(--primary))',
      },
    }),
    input: (provided) => ({
      ...provided,
      color: 'hsl(var(--foreground))',
      fontSize: '0.875rem',
    }),
    placeholder: (provided) => ({
      ...provided,
      color: 'hsl(var(--muted-foreground))',
      fontSize: '0.875rem',
    }),
    singleValue: (provided) => ({
      ...provided,
      color: 'hsl(var(--foreground))',
      fontSize: '0.875rem',
    }),
    clearIndicator: (provided) => ({
      ...provided,
      color: 'hsl(var(--muted-foreground))',
      cursor: 'pointer',
      padding: '4px',
      '&:hover': {
        color: 'hsl(var(--foreground))',
      },
    }),
    dropdownIndicator: (provided) => ({
      ...provided,
      color: 'hsl(var(--muted-foreground))',
      padding: '4px',
      '&:hover': {
        color: 'hsl(var(--foreground))',
      },
    }),
  };

  return (
    <CreatableSelect
      options={options}
      value={value}
      onChange={handleChange}
      placeholder={placeholder}
      isLoading={isLoading}
      styles={customStyles}
      className={className}
      classNamePrefix="react-select"
      isClearable={isClearable}
      formatCreateLabel={formatCreateLabel}
    />
  );
};
