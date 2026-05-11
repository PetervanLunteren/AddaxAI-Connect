/**
 * Shared DateRange type for dashboard / insights filter state.
 *
 * The standalone `<DateRangeFilter>` component this module once exported
 * was unused once filter bars switched to `<DateRangePicker>`. Only the
 * type alias remains; all imports go through `components/dashboard`.
 */

export interface DateRange {
  startDate: string | null;
  endDate: string | null;
}
