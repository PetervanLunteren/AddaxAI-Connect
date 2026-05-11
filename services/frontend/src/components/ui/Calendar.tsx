/**
 * Calendar primitive built on react-day-picker v9.
 *
 * Uses the library's default stylesheet (imported once globally in
 * main.tsx) with two CSS variables overridden in index.css to tint the
 * selection in Connect's teal brand. Only the chevron icons are swapped
 * to lucide for visual consistency.
 *
 * Ported verbatim from AddaxAI WebUI's `components/ui/calendar.tsx`.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/utils';

export type CalendarProps = ComponentProps<typeof DayPicker>;

export function Calendar({ className, ...props }: CalendarProps) {
  return (
    <DayPicker
      className={cn('p-2', className)}
      components={{
        Chevron: ({ orientation }) =>
          orientation === 'left' ? (
            <ChevronLeft className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          ),
      }}
      {...props}
    />
  );
}
