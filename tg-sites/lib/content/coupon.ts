/**
 * When a coupon has run out.
 *
 * PURE, AND TODAY COMES IN AS AN ARGUMENT, for the same reason the copyright
 * line's year does: a function that reads the clock itself can only be tested on
 * the day the tests happen to run, and the whole point of this one is what
 * happens on the boundary. The renderer passes the real date; a test passes
 * whichever date it wants to ask about.
 *
 * THE DATE A CLIENT TYPES IS A PLAIN CALENDAR DAY, "2026-09-30", with no time
 * and no timezone, because that is how an offer is written on a poster. So it is
 * compared as a STRING against today's date in the same shape. That sounds
 * crude and is exactly right: turning "2026-09-30" into a Date gives midnight
 * UTC, and comparing that to a moment means an offer ending on the 30th stops
 * working at 1am on the 30th for anybody east of London. Comparing the day to
 * the day has no such trap.
 *
 * THE LAST DAY IS INCLUDED. "Ends 30 September" means you can still use it on
 * the 30th, which is what a customer reading it believes and what a court would
 * say if anybody ever asked.
 */

/** A date a client typed, if it is one we can compare. Otherwise null. */
export function couponDate(value: unknown): string | null {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;

  /*
   * Checked for being a REAL day, not just the right shape. "2026-02-31" passes
   * the pattern and is not a date; left alone it would compare as later than the
   * end of February and quietly extend an offer by three days.
   */
  const [y, m, d] = text.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const asDate = new Date(Date.UTC(y, m - 1, d));
  if (asDate.getUTCFullYear() !== y || asDate.getUTCMonth() !== m - 1 || asDate.getUTCDate() !== d) {
    return null;
  }
  return text;
}

/**
 * Has this offer finished?
 *
 * False when there is no end date, which is an offer that runs until somebody
 * takes it down, and false when the date is not one we can read — refusing to
 * hide something because a client mistyped a date would be the worse mistake.
 */
export function couponExpired(expires: unknown, today: string): boolean {
  const end = couponDate(expires);
  if (!end) return false;
  // String comparison, because YYYY-MM-DD sorts the same way it reads. See the
  // note above on why this is not a Date comparison.
  return today > end;
}

/**
 * "Ends 30 September 2026", for the line under the code.
 *
 * Written out rather than shown as 2026-09-30, which is a date format nobody
 * outside a database reads comfortably. UK order, month in full, no ordinal
 * suffix: "30 September" rather than "30th September", which is house style and
 * also what reads cleanly when the day is 1 or 22.
 */
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function couponEndsLabel(expires: unknown): string {
  const end = couponDate(expires);
  if (!end) return '';
  const [y, m, d] = end.split('-').map(Number);
  return `Ends ${d} ${MONTHS[m - 1]} ${y}`;
}

/**
 * Today, as the same plain calendar day the client typed.
 *
 * UTC, which is what the server's clock reports. For a few hours once a day an
 * offer ending tonight is still showing for somebody in Auckland whose tomorrow
 * has started; erring towards showing an offer slightly too long is the right
 * direction to err, since the other one takes an offer away from somebody who
 * can still legitimately use it.
 */
export function todayUtc(now: Date): string {
  return now.toISOString().slice(0, 10);
}
