/**
 * The typed-word guard on destructive dialogs, one shape for all of them.
 *
 * Shows the word to type in a code chip with a copy button, then the input.
 * The caller keeps the typed value in state and disables its button until
 * `value === word`; no error message, the button simply does not work until
 * the word is right. Used by the camera, project and image deletes and the
 * dev purge.
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
      Type this to confirm
    </label>
    <div className="flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-1 font-mono text-sm">
      <span className="break-all select-all">{word}</span>
      <CopyButton text={word} className="-mr-1 shrink-0" />
    </div>
    <input
      id={id}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2 border rounded-md"
      autoComplete="off"
      autoCapitalize="off"
      spellCheck={false}
      disabled={disabled}
    />
  </div>
);
