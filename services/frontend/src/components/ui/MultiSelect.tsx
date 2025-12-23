/**
 * MultiSelect component using react-select
 * Styled to match the application theme
 */
import React from 'react';
import Select, { MultiValue, StylesConfig } from 'react-select';

export interface Option {
  label: string;
  value: string | number;
}

interface MultiSelectProps {
  options: Option[];
  value: Option[];
  onChange: (selected: Option[]) => void;
  placeholder?: string;
  isLoading?: boolean;
  className?: string;
}

export const MultiSelect: React.FC<MultiSelectProps> = ({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  isLoading = false,
  className = '',
}) => {
  const handleChange = (newValue: MultiValue<Option>) => {
    onChange(Array.from(newValue));
  };

  // Custom styles to match your dark theme
  const customStyles: StylesConfig<Option, true> = {
    control: (provided, state) => ({
      ...provided,
      backgroundColor: 'hsl(var(--background))',
      borderColor: state.isFocused ? 'hsl(var(--ring))' : 'hsl(var(--input))',
      borderRadius: '0.375rem',
      minHeight: '2.5rem',
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
      '&:active': {
        backgroundColor: 'hsl(var(--primary))',
      },
    }),
    multiValue: (provided) => ({
      ...provided,
      backgroundColor: 'hsl(var(--primary))',
      borderRadius: '0.25rem',
    }),
    multiValueLabel: (provided) => ({
      ...provided,
      color: 'hsl(var(--primary-foreground))',
      fontSize: '0.875rem',
    }),
    multiValueRemove: (provided) => ({
      ...provided,
      color: 'hsl(var(--primary-foreground))',
      cursor: 'pointer',
      '&:hover': {
        backgroundColor: 'hsl(var(--primary) / 0.8)',
        color: 'hsl(var(--primary-foreground))',
      },
    }),
    input: (provided) => ({
      ...provided,
      color: 'hsl(var(--foreground))',
    }),
    placeholder: (provided) => ({
      ...provided,
      color: 'hsl(var(--muted-foreground))',
    }),
    singleValue: (provided) => ({
      ...provided,
      color: 'hsl(var(--foreground))',
    }),
  };

  return (
    <Select
      isMulti
      options={options}
      value={value}
      onChange={handleChange}
      placeholder={placeholder}
      isLoading={isLoading}
      styles={customStyles}
      className={className}
      classNamePrefix="react-select"
      isClearable={false}
      closeMenuOnSelect={false}
    />
  );
};
