/**
 * Enquiries for the results screen: how many came through the site's forms in
 * the window, how many in the window before, and a day-by-day series for the
 * tile's sparkline.
 *
 * PURE, like lib/visits/summary.ts: rows in (a day and a count), a summary out.
 * The database module only fetches. The window is the last N UTC days
 * including today, zero-filled, the same window the visit tally uses, so the
 * four tiles on the screen all mean the same span of time.
 */

import { dayKey, shiftDay } from '../visits/summary';
import { sparkline, type TileView } from '../visits/chart';

export interface EnquiryDay {
  /** YYYY-MM-DD, the UTC day. */
  day: string;
  count: number;
}

export interface EnquirySummary {
  days: number;
  from: string;
  to: string;
  total: number;
  previous: number;
  /** One number a day across the window, oldest first. */
  daily: number[];
  /** The earliest day with an enquiry in the rows given, or null. */
  firstDay: string | null;
}

export function summariseEnquiries(rows: readonly EnquiryDay[], today: Date, days = 30): EnquirySummary {
  const span = Math.max(1, Math.min(365, Math.floor(days)));
  const to = dayKey(today);
  const from = shiftDay(to, -(span - 1));
  const previousFrom = shiftDay(from, -span);
  const daily = new Map<string, number>();
  for (let i = 0; i < span; i += 1) daily.set(shiftDay(from, i), 0);

  let total = 0;
  let previous = 0;
  let firstDay: string | null = null;
  for (const row of rows) {
    const count = Number.isFinite(row.count) ? Math.max(0, Math.floor(row.count)) : 0;
    if (count === 0) continue;
    if (firstDay === null || row.day < firstDay) firstDay = row.day;
    if (row.day >= from && row.day <= to) {
      total += count;
      daily.set(row.day, (daily.get(row.day) ?? 0) + count);
    } else if (row.day >= previousFrom && row.day < from) {
      previous += count;
    }
  }
  return { days: span, from, to, total, previous, daily: [...daily.values()], firstDay };
}

/**
 * The enquiries tile, in the same shape as the reader tiles so the four sit in
 * one row. Series 0 is the neutral slate: enquiries are not one of the three
 * reader series and must not borrow a colour that means something else.
 * `compare` is false when the window has no whole previous window to compare
 * with (a 90-day view on a tally that keeps 90 days), so the tile explains
 * itself rather than showing a change against nothing.
 */
export function enquiryTile(summary: EnquirySummary, compare = true): TileView {
  const delta = summary.total - summary.previous;
  const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  return {
    key: 'enquiries',
    label: 'Enquiries',
    value: summary.total,
    series: 0,
    delta: compare
      ? {
          label: delta > 0 ? `+${delta}` : String(delta),
          direction,
          note:
            direction === 'flat'
              ? `same as the ${summary.days} days before`
              : `${direction} on the ${summary.days} days before`,
        }
      : null,
    note: 'Sent through the forms on your pages.',
    spark: sparkline(summary.daily),
  };
}
