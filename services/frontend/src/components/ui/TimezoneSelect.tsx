/**
 * Searchable timezone selector using react-select
 * Styled to match the application theme (same as MultiSelect)
 */
import React, { useMemo } from 'react';
import Select, { SingleValue, StylesConfig, GroupBase } from 'react-select';

interface TimezoneOption {
  label: string;
  value: string;
}

interface TimezoneGroup {
  label: string;
  options: TimezoneOption[];
}

interface TimezoneSelectProps {
  value: string;
  onChange: (timezone: string) => void;
  disabled?: boolean;
  className?: string;
}

function buildTimezoneOptions(): TimezoneGroup[] {
  const timezones = Intl.supportedValuesOf('timeZone');
  const groups: Record<string, TimezoneOption[]> = {};

  for (const tz of timezones) {
    const parts = tz.split('/');
    const region = parts[0];
    // City name: take last part, replace underscores with spaces
    const city = parts[parts.length - 1].replace(/_/g, ' ');

    // Compute current UTC offset
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    });
    const offsetPart = formatter.formatToParts(new Date())
      .find(p => p.type === 'timeZoneName');
    const offset = offsetPart?.value ?? '';
    // Normalize "GMT" to "UTC", "GMT+X" to "UTC+X"
    const utcOffset = offset.replace('GMT', 'UTC');

    const label = `${city} (${utcOffset})`;

    if (!groups[region]) groups[region] = [];
    groups[region].push({ label, value: tz });
  }

  // Sort options within each group alphabetically by label
  for (const region of Object.keys(groups)) {
    groups[region].sort((a, b) => a.label.localeCompare(b.label));
  }

  // Sort groups alphabetically
  return Object.keys(groups)
    .sort()
    .map(region => ({ label: region, options: groups[region] }));
}

const customStyles: StylesConfig<TimezoneOption, false, GroupBase<TimezoneOption>> = {
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
  groupHeading: (provided) => ({
    ...provided,
    color: 'hsl(var(--muted-foreground))',
    fontSize: '0.75rem',
    fontWeight: 600,
    textTransform: 'uppercase',
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

export const TimezoneSelect: React.FC<TimezoneSelectProps> = ({
  value,
  onChange,
  disabled = false,
  className = '',
}) => {
  const groupedOptions = useMemo(() => buildTimezoneOptions(), []);

  // Find the current value in the grouped options
  const selectedOption = useMemo(() => {
    for (const group of groupedOptions) {
      const found = group.options.find(opt => opt.value === value);
      if (found) return found;
    }
    return null;
  }, [groupedOptions, value]);

  const handleChange = (option: SingleValue<TimezoneOption>) => {
    if (option) onChange(option.value);
  };

  return (
    <Select<TimezoneOption, false, GroupBase<TimezoneOption>>
      options={groupedOptions}
      value={selectedOption}
      onChange={handleChange}
      placeholder="Search timezone..."
      styles={customStyles}
      className={className}
      classNamePrefix="react-select"
      isSearchable
      isDisabled={disabled}
    />
  );
};
