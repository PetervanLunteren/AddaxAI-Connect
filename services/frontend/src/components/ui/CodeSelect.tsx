/**
 * Searchable picker for a list of "<icon> <name>" options keyed by a code,
 * like the countries and the US states. Search matches the name only, not
 * the icon or the code.
 */
import { useMemo } from 'react';
import Select, { type FilterOptionOption } from 'react-select';
import { searchSelectComponents, searchSelectStyles } from './searchSelectTheme';

export interface CodeOption {
  label: string;
  value: string;
}

interface CodeSelectProps {
  options: CodeOption[];
  value: string;
  onChange: (code: string) => void;
  placeholder: string;
  disabled?: boolean;
}

const styles = searchSelectStyles<CodeOption>();

const filterOption = (option: FilterOptionOption<CodeOption>, input: string) =>
  option.label.slice(option.label.indexOf(' ') + 1).toLowerCase().includes(input.toLowerCase());

export const CodeSelect = ({ options, value, onChange, placeholder, disabled = false }: CodeSelectProps) => {
  const selected = useMemo(() => options.find((o) => o.value === value) ?? null, [options, value]);
  return (
    <Select<CodeOption, false>
      options={options}
      value={selected}
      onChange={(option) => onChange(option ? option.value : '')}
      placeholder={placeholder}
      styles={styles}
      components={searchSelectComponents}
      classNamePrefix="react-select"
      isSearchable
      isClearable
      isDisabled={disabled}
      filterOption={filterOption}
      menuPortalTarget={document.body}
    />
  );
};
