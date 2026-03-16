/**
 * Searchable US state selector using react-select
 * Styled to match the application theme (same as TimezoneSelect)
 */
import React, { useMemo } from 'react';
import Select, { SingleValue, StylesConfig, FilterOptionOption } from 'react-select';
import { US_STATES } from '../../geodata/countries';

interface StateOption {
  label: string;
  value: string;
}

interface StateSelectProps {
  value: string;
  onChange: (stateCode: string) => void;
  disabled?: boolean;
}

const customStyles: StylesConfig<StateOption, false> = {
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

export const StateSelect: React.FC<StateSelectProps> = ({
  value,
  onChange,
  disabled = false,
}) => {
  const selectedOption = useMemo(
    () => US_STATES.find(opt => opt.value === value) ?? null,
    [value],
  );

  const handleChange = (option: SingleValue<StateOption>) => {
    onChange(option ? option.value : '');
  };

  const filterOption = (option: FilterOptionOption<StateOption>, inputValue: string) => {
    const search = inputValue.toLowerCase();
    const name = option.label.slice(option.label.indexOf(' ') + 1).toLowerCase();
    return name.includes(search);
  };

  return (
    <Select<StateOption, false>
      options={US_STATES}
      value={selectedOption}
      onChange={handleChange}
      placeholder="Select state..."
      styles={customStyles}
      classNamePrefix="react-select"
      isSearchable
      isClearable
      isDisabled={disabled}
      filterOption={filterOption}
    />
  );
};
