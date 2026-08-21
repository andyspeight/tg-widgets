/**
 * Vercel Cron — appointment reminders.
 *
 * Runs hourly. Scans confirmed bookings starting within the next SCAN_HOURS
 * (default 72, wide enough for the largest configurable offset) and emails the
 * visitor and the agency for every reminder in the booking's stamped plan
 * whose window has opened (start - hoursBefore <= now < start). Each plan
 * entry fires once; if several entries fall due in the same run (e.g. after
 * downtime) one email goes out and all of them are marked sent, so nobody gets
 * duplicate reminders back to back.
 *
 * Bookings stamped before plans existed run the default 24h plan, and their
 * old boolean `reminded` flag still counts as sent — nothing double-fires.
 *
 * AUTH: Authorization: Bearer ${CRON_SECRET} (same as the map cron).
 * Manual run: GET with the header, optional ?hours=72 to change the window.
 */
import { listAllBookings, saveBooking, storageReady } from '../_lib/calendar/store.js';
import { sendReminder } from '../_lib/calendar/mail.js';
import { dueReminders } from '../_lib/calendar/reminders.js';
import { smsConfigured, sendSms, reminderSmsBody } from '../_lib/calendar/sms.js';

export default async function handler(req, res) {
  const auth = req.headers['authorization'] || '';
  const secret = process.env.CRON_SECRET || '';
  if (!secret || auth !== `Bearer ${secret}`) return res.status(401).json({ ok: false, error: 'unauthorised' });

  if (!storageReady()) return res.status(200).json({ ok: true, scanned: 0, sent: 0, note: 'storage not configured' });

  const hours = Math.max(1, Math.min(168, Number((req.query && req.query.hours) || 72)));
  const now = Date.now();
  const windowEnd = now + hours * 3600 * 1000;

  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const origin = (process.env.APP_BASE_URL || (proto + '://' + req.headers.host)).replace(/\/$/, '');

  let scanned = 0, sent = 0, texted = 0;
  try {
    const bookings = await listAllBookings(now, windowEnd);
    for (const b of bookings) {
      scanned++;
      if (b.status !== 'confirmed') continue;
      const due = dueReminders(b, now);
      if (!due.length) continue;
      const manageUrl = b.manageToken ? (origin + '/manage-booking?token=' + b.manageToken) : '';
      const ok = await sendReminder(b, { manageUrl });
      // Text reminder rides the same cadence, best-effort, only when the
      // widget opted in AND the platform has Twilio configured. An SMS
      // failure never blocks the email being marked sent.
      if (ok && b.smsReminder && smsConfigured() && b.invitee && b.invitee.phone) {
        if (await sendSms(b.invitee.phone, reminderSmsBody(b, { manageUrl }))) texted++;
      }
      if (ok) {
        b.remindersSent = [...new Set([...(Array.isArray(b.remindersSent) ? b.remindersSent : []), ...due])].sort((a, c) => a - c);
        b.reminded = true;
        b.remindedAt = new Date().toISOString();
        await saveBooking(b);
        sent++;
      }
    }
  } catch (e) {
    console.error('[reminders] failed:', e.message);
    return res.status(500).json({ ok: false, error: 'reminder run failed', scanned, sent });
  }
  return res.status(200).json({ ok: true, scanned, sent, texted, windowHours: hours });
}
