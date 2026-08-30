/**
 * The monthly client report: the pure half.
 *
 * A client's dashboard shows one month of their site's activity: enquiries,
 * what was published, images added. This module does the calendar arithmetic and
 * the view shaping so the page and the database reads stay simple, and so it can
 * be unit-tested in Node with no clock and no connection.
 *
 * MONTHS ARE UTC. created_at and published_at are timestamptz; a month boundary
 * is taken in UTC so the count is deterministic and does not shift with the
 * server's zone. For UK clients the hour of drift at a month edge moves at most a
 * stray late-night event, which a monthly total does not turn on.
 *
 * NO VISITOR NUMBERS YET. Web analytics is off, so the report is built from what
 * the site already stores: enquiries, publishes, media. A visitors section lights
 * up here the day analytics is switched on; until then the page says so plainly
 * rather than showing a zero that reads as "nobody came".
 */

export interface MonthRange {
  year: number;
  /** 1-12. */
  month: number;
  /** Inclusive start, UTC midnight on the first. */
  from: Date;
  /** Exclusive end, UTC midnight on the first of the next month. */
  to: Date;
  /** "2026-08", the URL key. */
  key: string;
  /** "August 2026", for a heading. */
  label: string;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Two digits, so a month key sorts and matches YYYY-MM. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** The UTC year and month of a date, month 1-12. */
export function monthOf(date: Date): { year: number; month: number } {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

/**
 * A month key (YYYY-MM) parsed to a year and month, or the month of `now` when it
 * is missing or malformed. Total and defensive: a hand-typed URL never throws,
 * it just falls back to the current month.
 */
export function parseMonthKey(value: string | undefined | null, now: Date): { year: number; month: number } {
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})$/.exec(value.trim());
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12) return { year, month };
    }
  }
  return monthOf(now);
}

/** The full range for a year and month, clamped to sane bounds. */
export function monthRange(year: number, month: number): MonthRange {
  const y = Math.min(2100, Math.max(2000, Math.trunc(year)));
  const m = Math.min(12, Math.max(1, Math.trunc(month)));
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 1)); // Date.UTC rolls December over to next January.
  return { year: y, month: m, from, to, key: `${y}-${pad2(m)}`, label: `${MONTH_NAMES[m - 1]} ${y}` };
}

/** The month before this one, rolling January back to the previous December. */
export function previousMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

/** The month after this one, rolling December on to the next January. */
export function nextMonth(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

/** Whether a month is the current month or later, so the page can cap Next. */
export function isFutureOrCurrent(year: number, month: number, now: Date): boolean {
  const here = monthOf(now);
  return year > here.year || (year === here.year && month >= here.month);
}

/** The counts a month yields, all from tables the site already keeps. */
export interface MonthMetrics {
  enquiries: number;
  pagesPublished: number;
  pagesCreated: number;
  itemsPublished: number;
  mediaAdded: number;
}

/** The site's current totals, for the "at a glance" strip (not month-bounded). */
export interface SiteTotals {
  livePages: number;
  publishedEntries: number;
  totalEnquiries: number;
  unreadEnquiries: number;
}

/** One line for the month's enquiry list. */
export interface EnquiryLine {
  id: string;
  formName: string;
  path: string;
  createdAt: string;
}

/** How a month compares to the one before: the change and its direction. */
export interface Delta {
  diff: number;
  direction: 'up' | 'down' | 'flat';
}

/** The change from the previous month's value to this month's. */
export function delta(current: number, previous: number): Delta {
  const diff = current - previous;
  return { diff, direction: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat' };
}

/** "+3", "-1" or "0", the signed change for a delta chip. */
export function deltaLabel(d: Delta): string {
  return d.diff > 0 ? `+${d.diff}` : String(d.diff);
}
