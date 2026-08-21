/**
 * Reminder cadence for the Appointment Scheduler.
 *
 * A widget config may carry `reminders`: an array of hours-before-start values
 * (e.g. [24, 2] = one reminder a day out and another two hours out). The plan
 * is stamped onto each booking at create time so the cron never re-reads
 * widget config — the same pattern branding uses. A config without the key
 * keeps the original behaviour (one reminder 24 hours before); an explicit
 * empty array means the agent switched reminders off.
 */

const MAX_REMINDERS = 3;
const MIN_HOURS = 1;   // the cron runs hourly, so sub-hour offsets can't be honoured
const MAX_HOURS = 72;  // must stay <= the cron's scan window

export const DEFAULT_REMINDERS = [24];

/**
 * Normalise a reminder plan from config (or from a stamped booking): integers,
 * clamped 1–72 hours, deduped, furthest-first, at most three. `undefined`,
 * `null` or junk falls back to the default plan; an explicit empty array stays
 * empty (reminders off).
 */
export function normaliseReminders(value) {
  if (!Array.isArray(value)) return DEFAULT_REMINDERS.slice();
  const out = [];
  for (const v of value) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n <= 0) continue;   // 0/negative = not a reminder
    const h = Math.max(MIN_HOURS, Math.min(MAX_HOURS, n));
    if (!out.includes(h)) out.push(h);
    if (out.length >= MAX_REMINDERS) break;
  }
  out.sort((a, b) => b - a);
  return out;
}

/**
 * The reminder indices due for a booking at `nowMs`: inside their window
 * (start - hours <= now < start) and not yet sent. Never returns anything for
 * a booking that has already started.
 *
 * Legacy bookings (stamped before plans existed, no `reminders` array) run the
 * default plan, and their old boolean `reminded` flag counts as everything
 * sent — so nothing double-fires across the upgrade.
 */
export function dueReminders(booking, nowMs) {
  const startMs = Date.parse(booking && booking.startISO);
  if (!Number.isFinite(startMs) || nowMs >= startMs) return [];
  const legacy = !Array.isArray(booking.reminders);
  if (legacy && booking.reminded) return [];
  const plan = normaliseReminders(legacy ? undefined : booking.reminders);
  const sent = new Set(Array.isArray(booking.remindersSent) ? booking.remindersSent : []);
  const due = [];
  plan.forEach((hours, i) => {
    if (sent.has(i)) return;
    if (nowMs >= startMs - hours * 3600000) due.push(i);
  });
  return due;
}
