/** Searchable country picker, ISO 3166-1 alpha-3 codes. */
import { COUNTRIES } from '../../geodata/countries';
import { CodeSelect } from './CodeSelect';

interface CountrySelectProps {
  value: string;
  onChange: (countryCode: string) => void;
  disabled?: boolean;
}

export const CountrySelect = (props: CountrySelectProps) => (
  <CodeSelect options={COUNTRIES} placeholder="Select country..." {...props} />
);
