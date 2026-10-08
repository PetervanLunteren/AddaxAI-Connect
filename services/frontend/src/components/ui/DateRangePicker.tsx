/**
 * DateRangePicker — single trigger button + popover with a two-month
 * react-day-picker calendar in range mode.
 *
 * Shared by every filter bar that previously used two `<input type="date">`
 * fields side-by-side. Dates are exchanged with the caller as ISO date
 * strings (YYYY-MM-DD), same shape as `<input type="date">.value`.
 *
 * Ported from AddaxAI WebUI's DateRangePicker so the date-range UX is
 * uniform between the two products.
 */
import { useState } from 'react';
import {
  addMonths,
  endOfMonth,
  endOfYear,
  format,
  parseISO,
  startOfMonth,
  startOfYear,
  subMonths,
  subYears,
} from 'date-fns';

import { Button } from './Button';
import { Calendar } from './Calendar';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';

interface Preset {
  label: string;
  from: Date;
  /** Unset for periods that are still running, see buildPresets. */
  to?: Date;
}

/** First day of the meteorological season the date falls in (Mar, Jun, Sep
 * or Dec 1). January and February belong to the winter that started the
 * previous December. Northern hemisphere, like every current deployment. */
function seasonStart(d: Date): Date {
  const month = d.getMonth();
  if (month < 2) return new Date(d.getFullYear() - 1, 11, 1);
  const start = month - ((month + 1) % 3);
  return new Date(d.getFullYear(), start, 1);
}

function seasonLabel(start: Date): string {
  const names: Record<number, string> = {
    2: 'Spring', 5: 'Summer', 8: 'Autumn', 11: 'Winter',
  };
  const year = start.getFullYear();
  return start.getMonth() === 11
    ? `Winter ${year}/${String((year + 1) % 100).padStart(2, '0')}`
    : `${names[start.getMonth()]} ${year}`;
}

/** The quick ranges: calendar periods plus the four most recent seasons.
 * Periods that are still running get no end date, so a remembered "this
 * month" keeps taking in new images instead of freezing on the day it was
 * picked. A future end date is no option either, it would stretch the
 * daily charts past today. Finished periods keep their real boundaries.
 * Built per render so a long-lived tab stays correct. */
function buildPresets(): Preset[] {
  const now = new Date();
  const lastMonth = subMonths(now, 1);
  const lastYear = subYears(now, 1);
  const presets: Preset[] = [
    { label: 'This month', from: startOfMonth(now) },
    { label: 'Last month', from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) },
    { label: 'Last 3 months', from: startOfMonth(subMonths(now, 2)) },
    { label: 'This year', from: startOfYear(now) },
    { label: 'Last year', from: startOfYear(lastYear), to: endOfYear(lastYear) },
  ];
  let start = seasonStart(now);
  for (let i = 0; i < 4; i++) {
    const end = endOfMonth(addMonths(start, 2));
    presets.push({ label: seasonLabel(start), from: start, to: end < now ? end : undefined });
    start = subMonths(start, 3);
  }
  return presets;
}

const isoDate = (d: Date | undefined): string | undefined =>
  d ? format(d, 'yyyy-MM-dd') : undefined;

interface DateRangePickerProps {
  /** ISO date string (YYYY-MM-DD), or null/undefined when unset. */
  from: string | null | undefined;
  to: string | null | undefined;
  onChange: (range: { from: string | undefined; to: string | undefined }) => void;
  /** Optional bounds shown by the calendar (also ISO date strings). */
  minDate?: string | null;
  maxDate?: string | null;
  /** Label shown when no dates are picked. Defaults to "All dates". */
  placeholder?: string;
  /** Trigger button className override. Defaults to a full-width h-9 style. */
  className?: string;
}

export function DateRangePicker({
  from,
  to,
  onChange,
  minDate,
  maxDate,
  placeholder = 'All dates',
  className,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);

  const range = {
    from: from ? parseISO(from) : undefined,
    to: to ? parseISO(to) : undefined,
  };
  const startMonth = minDate ? parseISO(minDate.slice(0, 10)) : undefined;
  const endMonth = maxDate ? parseISO(maxDate.slice(0, 10)) : undefined;

  const label = range.from
    ? range.to
      ? `${format(range.from, 'd MMM yyyy')} – ${format(range.to, 'd MMM yyyy')}`
      : `From ${format(range.from, 'd MMM yyyy')}`
    : placeholder;

  // Some presets cover the same range (in September "This month" and
  // "Autumn" both start on 1 September), so only the first match lights up.
  const presets = buildPresets();
  const activePreset = presets.find(
    (p) => from === isoDate(p.from) && (to || undefined) === isoDate(p.to),
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={className ?? 'w-full h-9 justify-start text-sm font-normal'}
        >
          <span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex max-w-[280px] flex-wrap gap-1.5 border-b p-2">
          {presets.map((preset) => {
            const active = preset === activePreset;
            return (
              <button
                key={preset.label}
                type="button"
                className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'bg-secondary/50 hover:bg-secondary'
                }`}
                onClick={() => {
                  onChange({ from: isoDate(preset.from), to: isoDate(preset.to) });
                  setOpen(false);
                }}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
        <Calendar
          mode="range"
          selected={range}
          onSelect={(picked) => {
            onChange({
              from: picked?.from ? format(picked.from, 'yyyy-MM-dd') : undefined,
              to: picked?.to ? format(picked.to, 'yyyy-MM-dd') : undefined,
            });
          }}
          numberOfMonths={1}
          defaultMonth={range.from ?? endMonth}
          startMonth={startMonth}
          endMonth={endMonth}
        />
        {(from || to) && (
          <div className="flex justify-end p-2 border-t">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange({ from: undefined, to: undefined })}
            >
              Clear
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
