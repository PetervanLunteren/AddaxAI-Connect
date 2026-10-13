/**
 * The typed-word guard on destructive dialogs, one shape for all of them.
 *
 * One line, GitHub style: "Type DELETE to confirm" with the word as an inline
 * code chip and a copy button right after it, then the input with the word as
 * its placeholder. The caller keeps the typed value in state and disables its
 * button until `value === word`; no error message, the button simply does not
 * work until the word is right. Used by the camera, project and image deletes
 * and the dev purge.
 */
import React from 'react';
import { CopyButton } from './CopyButton';

interface ConfirmWordFieldProps {
  word: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
}

export const ConfirmWordField: React.FC<ConfirmWordFieldProps> = ({
  word,
  value,
  onChange,
  disabled = false,
  id = 'confirm-word',
}) => (
  <div className="space-y-2">
    <label htmlFor={id} className="text-sm font-medium block">
      Type{' '}
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono font-semibold break-all select-all">
        {word}
      </code>
      <CopyButton text={word} className="p-1 align-middle" />
      to confirm
    </label>
    <input
      id={id}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={word}
      className="w-full px-3 py-2 border rounded-md"
      autoComplete="off"
      autoCapitalize="off"
      spellCheck={false}
      disabled={disabled}
    />
  </div>
);
