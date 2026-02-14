/**
 * Searchable timezone selector using react-select
 * Styled to match the application theme (same as MultiSelect)
 */
import React, { useMemo } from 'react';
import Select, { SingleValue, StylesConfig, GroupBase, FilterOptionOption } from 'react-select';

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

function buildFixedOffsetGroup(): TimezoneGroup {
  // Fixed UTC offsets without DST, using Etc/GMT± IANA names
  // Note: IANA convention inverts the sign (Etc/GMT-4 = UTC+4)
  const offsets: TimezoneOption[] = [];

  for (let i = -12; i <= 14; i++) {
    if (i === 0) {
      offsets.push({ label: 'UTC (no DST)', value: 'UTC' });
    } else {
      const sign = i > 0 ? '+' : '';
      const ianaSign = i > 0 ? '-' : '+';
      const ianaValue = `Etc/GMT${ianaSign}${Math.abs(i)}`;
      offsets.push({ label: `UTC${sign}${i} (no DST)`, value: ianaValue });
    }
  }

  return { label: 'Fixed offset', options: offsets };
}

function buildTimezoneOptions(): TimezoneGroup[] {
  const timezones = Intl.supportedValuesOf('timeZone');
  const groups: Record<string, TimezoneOption[]> = {};

  for (const tz of timezones) {
    const parts = tz.split('/');
    const region = parts[0];
    // City name: take last part, replace underscores with spaces
    const city = parts[parts.length - 1].replace(/_/g, ' ');

    // Skip Etc/* zones - we handle these in the fixed offset group
    if (region === 'Etc') continue;

    // Compute current UTC offset
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    });
    const offsetPart = formatter.formatToParts(new Date())
      .find(p => p.type === 'timeZoneName');
    const offset = offsetPart?.value ?? '';
    const utcOffset = offset.replace('GMT', 'UTC');

    const label = `${city} (${utcOffset})`;

    if (!groups[region]) groups[region] = [];
    groups[region].push({ label, value: tz });
  }

  // Sort options within each group alphabetically by label
  for (const region of Object.keys(groups)) {
    groups[region].sort((a, b) => a.label.localeCompare(b.label));
  }

  // Build geographic groups sorted alphabetically
  const geographicGroups = Object.keys(groups)
    .sort()
    .map(region => ({ label: region, options: groups[region] }));

  // Fixed offset group first, then geographic groups
  return [buildFixedOffsetGroup(), ...geographicGroups];
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

  // Custom filter: search on city name and IANA value, not the offset in parentheses
  // This prevents "UTC" from matching every option via "(UTC+X)" in the label
  // Fixed-offset entries (containing "no DST") match on their full label
  const filterOption = (option: FilterOptionOption<TimezoneOption>, inputValue: string) => {
    const search = inputValue.toLowerCase();
    const value = option.value.toLowerCase();
    const label = option.label.toLowerCase();

    // Fixed-offset entries: match on full label (e.g., "UTC+4 (no DST)")
    if (label.includes('no dst')) {
      return label.includes(search);
    }

    // Geographic entries: match on IANA value or city name (before the parentheses)
    const cityPart = label.split('(')[0].trim();
    return value.includes(search) || cityPart.includes(search);
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
      filterOption={filterOption}
    />
  );
};
