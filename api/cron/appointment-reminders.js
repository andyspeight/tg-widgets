/**
 * Vercel Cron — appointment reminders.
 *
 * Runs hourly. Finds confirmed bookings starting within the next REMIND_HOURS
 * (default 24) that have not yet had a reminder, emails the visitor a reminder
 * with the .ics and a manage link, and marks the booking reminded so it only
 * fires once.
 *
 * AUTH: Authorization: Bearer ${CRON_SECRET} (same as the map cron).
 * Manual run: GET with the header, optional ?hours=24 to widen the window.
 */
import { listAllBookings, saveBooking } from '../_lib/calendar/store.js';
import { sendReminder } from '../_lib/calendar/mail.js';
import { storageReady } from '../_lib/calendar/store.js';

export default async function handler(req, res) {
  const auth = req.headers['authorization'] || '';
  const secret = process.env.CRON_SECRET || '';
  if (!secret || auth !== `Bearer ${secret}`) return res.status(401).json({ ok: false, error: 'unauthorised' });

  if (!storageReady()) return res.status(200).json({ ok: true, scanned: 0, sent: 0, note: 'storage not configured' });

  const hours = Math.max(1, Math.min(72, Number((req.query && req.query.hours) || 24)));
  const now = Date.now();
  const windowEnd = now + hours * 3600 * 1000;

  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const origin = (process.env.APP_BASE_URL || (proto + '://' + req.headers.host)).replace(/\/$/, '');

  let scanned = 0, sent = 0;
  try {
    const bookings = await listAllBookings(now, windowEnd);
    for (const b of bookings) {
      scanned++;
      if (b.status !== 'confirmed' || b.reminded) continue;
      const manageUrl = b.manageToken ? (origin + '/manage-booking?token=' + b.manageToken) : '';
      const ok = await sendReminder(b, { manageUrl });
      if (ok) { b.reminded = true; b.remindedAt = new Date().toISOString(); await saveBooking(b); sent++; }
    }
  } catch (e) {
    console.error('[reminders] failed:', e.message);
    return res.status(500).json({ ok: false, error: 'reminder run failed', scanned, sent });
  }
  return res.status(200).json({ ok: true, scanned, sent, windowHours: hours });
}
