/** Searchable US state picker, ISO 3166-2 codes. */
import { US_STATES } from '../../geodata/countries';
import { CodeSelect } from './CodeSelect';

interface StateSelectProps {
  value: string;
  onChange: (stateCode: string) => void;
  disabled?: boolean;
}

export const StateSelect = (props: StateSelectProps) => (
  <CodeSelect options={US_STATES} placeholder="Select state..." {...props} />
);
