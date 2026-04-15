/**
 * Searchable timezone selector using react-select.
 *
 * Each option reads as "🇰🇪 Kenya, Nairobi (UTC+03:00)". Country names are
 * localized via Intl.DisplayNames so a Dutch browser shows "Kenia", a
 * German browser shows "Kenia", etc. Flags are computed at render time
 * from the ISO alpha-2 code via regional indicator symbols.
 *
 * Search matches country, city, and IANA name. The fixed UTC offset
 * options (Etc/GMT*) live in their own group at the top; every other
 * zone lives in a single flat, alphabetically sorted group.
 */
import React, { useMemo } from 'react';
import Select, { SingleValue, StylesConfig, GroupBase, FilterOptionOption } from 'react-select';
import { TIMEZONE_COUNTRY } from '../../geodata/timezone-countries';

interface TimezoneOption {
  label: string;
  value: string;
  country: string;
  city: string;
  iana: string;
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

// Module-scoped instances so they are built once per page load, not per option.
const regionNames = new Intl.DisplayNames(undefined, { type: 'region' });
const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

/** Convert an ISO 3166-1 alpha-2 code like "KE" to its flag emoji 🇰🇪. */
function countryFlag(code: string): string {
  // Regional Indicator Symbol Letter A is U+1F1E6, 'A' is U+0041.
  return code
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 0x41));
}

/**
 * Resolve a timezone name to its IANA canonical form. Browsers return both
 * legacy aliases (Asia/Saigon, Europe/Kiev, America/Louisville) and their
 * canonical equivalents (Asia/Ho_Chi_Minh, Europe/Kyiv,
 * America/Kentucky/Louisville) from Intl.supportedValuesOf. The IANA
 * country mapping is keyed on canonical names only, so we canonicalize
 * before lookup and dedupe so the canonical entry wins.
 */
function canonicalizeTimezone(tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone;
  } catch {
    return tz;
  }
}

/** Current UTC offset for a zone, formatted as UTC+03:00 / UTC-08:00 / UTC+05:30. */
function formatOffset(tz: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'longOffset',
  }).formatToParts(new Date());
  const raw = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  // Intl emits "GMT+03:00" / "GMT-08:00" / "GMT" (for UTC itself).
  if (raw === 'GMT') return 'UTC+00:00';
  return raw.replace('GMT', 'UTC');
}

function buildFixedOffsetGroup(): TimezoneGroup {
  // Fixed UTC offsets without DST, using Etc/GMT± IANA names.
  // Note: IANA convention inverts the sign (Etc/GMT-4 = UTC+4).
  const offsets: TimezoneOption[] = [];
  for (let i = -12; i <= 14; i++) {
    const label =
      i === 0
        ? 'UTC (fixed, no daylight saving)'
        : `UTC${i > 0 ? '+' : ''}${i} (fixed, no daylight saving)`;
    const value = i === 0 ? 'UTC' : `Etc/GMT${i > 0 ? '-' : '+'}${Math.abs(i)}`;
    offsets.push({ label, value, country: '', city: label, iana: value });
  }
  return { label: 'Fixed offset', options: offsets };
}

function buildTimezoneOptions(): TimezoneGroup[] {
  const options: TimezoneOption[] = [];
  const seen = new Set<string>();

  for (const rawTz of Intl.supportedValuesOf('timeZone')) {
    // Etc/* zones are handled in the fixed-offset group above.
    if (rawTz.startsWith('Etc/')) continue;

    // Resolve legacy aliases (Asia/Saigon, Europe/Kiev, America/Louisville,
    // ...) to their canonical form, then dedupe so each canonical zone
    // appears exactly once in the list.
    const tz = canonicalizeTimezone(rawTz);
    if (tz.startsWith('Etc/') || seen.has(tz)) continue;
    seen.add(tz);

    const city = tz.split('/').pop()!.replace(/_/g, ' ');
    const isoCode = TIMEZONE_COUNTRY[tz];
    const countryName = isoCode ? regionNames.of(isoCode) ?? '' : '';
    const flag = isoCode ? countryFlag(isoCode) : '';
    const offset = formatOffset(tz);

    const label = countryName
      ? `${flag} ${countryName}, ${city} (${offset})`
      : `${city} (${offset})`;

    options.push({ label, value: tz, country: countryName, city, iana: tz });
  }

  // Flat sort: by localized country name, then city, then IANA as tiebreaker.
  options.sort((a, b) => {
    const byCountry = collator.compare(a.country, b.country);
    if (byCountry !== 0) return byCountry;
    const byCity = collator.compare(a.city, b.city);
    if (byCity !== 0) return byCity;
    return collator.compare(a.iana, b.iana);
  });

  return [buildFixedOffsetGroup(), { label: 'Locations', options }];
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

  // Find the current value in the grouped options. Canonicalize first so a
  // legacy alias saved in the DB (e.g. Asia/Saigon) still matches its
  // canonical entry (Asia/Ho_Chi_Minh).
  const selectedOption = useMemo(() => {
    if (!value) return null;
    const canonical = canonicalizeTimezone(value);
    for (const group of groupedOptions) {
      const found = group.options.find((opt) => opt.value === canonical);
      if (found) return found;
    }
    return null;
  }, [groupedOptions, value]);

  const handleChange = (option: SingleValue<TimezoneOption>) => {
    if (option) onChange(option.value);
  };

  // Match on country, city, and IANA name. Skipping offset matching keeps
  // "+3" or "UTC+03" from returning dozens of unrelated zones at a glance.
  // Fixed-offset entries have no country or IANA city, so fall back to the
  // full label for those.
  const filterOption = (option: FilterOptionOption<TimezoneOption>, inputValue: string) => {
    if (!inputValue) return true;
    const search = inputValue.toLowerCase();
    const data = option.data;
    return (
      data.country.toLowerCase().includes(search) ||
      data.city.toLowerCase().includes(search) ||
      data.iana.toLowerCase().includes(search) ||
      data.label.toLowerCase().includes(search)
    );
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
