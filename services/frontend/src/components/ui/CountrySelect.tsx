/**
 * Searchable country selector using react-select
 * Styled to match the application theme (same as TimezoneSelect)
 */
import React, { useMemo } from 'react';
import Select, { SingleValue, StylesConfig, FilterOptionOption } from 'react-select';
import { COUNTRIES } from '../../geodata/countries';

interface CountryOption {
  label: string;
  value: string;
}

interface CountrySelectProps {
  value: string;
  onChange: (countryCode: string) => void;
  disabled?: boolean;
}

const customStyles: StylesConfig<CountryOption, false> = {
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

export const CountrySelect: React.FC<CountrySelectProps> = ({
  value,
  onChange,
  disabled = false,
}) => {
  const selectedOption = useMemo(
    () => COUNTRIES.find(opt => opt.value === value) ?? null,
    [value],
  );

  const handleChange = (option: SingleValue<CountryOption>) => {
    onChange(option ? option.value : '');
  };

  const filterOption = (option: FilterOptionOption<CountryOption>, inputValue: string) => {
    const search = inputValue.toLowerCase();
    // Search on country name (after the flag emoji), not the ISO code
    const name = option.label.slice(option.label.indexOf(' ') + 1).toLowerCase();
    return name.includes(search);
  };

  return (
    <Select<CountryOption, false>
      options={COUNTRIES}
      value={selectedOption}
      onChange={handleChange}
      placeholder="Select country..."
      styles={customStyles}
      classNamePrefix="react-select"
      isSearchable
      isClearable
      isDisabled={disabled}
      filterOption={filterOption}
    />
  );
};
