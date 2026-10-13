/**
 * The bordered radio options at the top of a destructive dialog, where the
 * person first picks what happens (delete photos or records, retire or
 * delete a camera) before reading what that choice costs.
 *
 * One component so every dialog with a choice looks and behaves the same:
 * the chosen card is outlined in teal, the first option is the safer one and
 * the caller preselects it. Used by the Curation delete and the camera
 * delete.
 */
import React from 'react';

export interface ChoiceOption<V extends string> {
  value: V;
  title: string;
  detail: string;
}

interface ChoiceCardsProps<V extends string> {
  options: ChoiceOption<V>[];
  value: V;
  onChange: (value: V) => void;
  /** Radio group name, unique per dialog. */
  name: string;
  ariaLabel: string;
  disabled?: boolean;
}

export function ChoiceCards<V extends string>({
  options,
  value,
  onChange,
  name,
  ariaLabel,
  disabled = false,
}: ChoiceCardsProps<V>): React.ReactElement {
  return (
    <div className="space-y-2 text-sm" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <label
            key={option.value}
            className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors ${
              selected ? 'border-[#0f6064] bg-[#0f6064]/5' : 'hover:bg-muted'
            }`}
          >
            <input
              type="radio"
              name={name}
              className="mt-0.5 accent-primary"
              checked={selected}
              onChange={() => onChange(option.value)}
              disabled={disabled}
            />
            <span>
              <span className="font-medium">{option.title}</span>
              <span className="block text-muted-foreground">{option.detail}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
