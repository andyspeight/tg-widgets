/**
 * SMS reminders for the Appointment Scheduler — Twilio REST, no SDK.
 *
 * Dark-launched: everything here no-ops until the three env vars exist
 * (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM — a Twilio number or
 * alphanumeric sender ID). The editor shows the toggle either way, with an
 * honest hint about whether SMS is switched on for the platform.
 *
 * UK-first phone handling: Twilio needs E.164, so a UK 07… number becomes
 * +447…; anything already in +CC form passes through; anything else is
 * skipped rather than guessed (a wrong-country text is worse than no text).
 * Reminder texts are transactional service messages about an appointment the
 * customer booked, sent to the number they gave for that booking.
 */

export function smsConfigured() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
}

/** E.164 or '' — never a guess. */
export function normalisePhone(raw) {
  let s = String(raw == null ? '' : raw).replace(/[\s().-]/g, '');
  if (!s) return '';
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (s.startsWith('+')) {
    return /^\+[1-9]\d{7,14}$/.test(s) ? s : '';
  }
  // UK national format: 07123 456789 → +447123456789 (also 01/02/03 landlines).
  if (/^0[1-9]\d{8,9}$/.test(s)) return '+44' + s.slice(1);
  return '';
}

/**
 * The reminder text: short, branded with the agency name, capped so it stays
 * within two SMS segments even with a manage link.
 */
export function reminderSmsBody(booking, opts) {
  opts = opts || {};
  const company = String(booking.company || 'your travel team').slice(0, 40);
  const label = String(booking.eventLabel || 'Your appointment').slice(0, 60);
  let when = '';
  try {
    const tz = booking.visitorTimezone || booking.hostTimezone || 'Europe/London';
    // hourCycle (not hour12): en-GB + hour12 resolves to the h11 cycle on some
    // ICU builds and renders noon as "0:00pm" — same fix as mail.js.
    const d = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(booking.startISO));
    const t = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: '2-digit', hourCycle: 'h12' }).format(new Date(booking.startISO)).replace(/[\s  ]/g, '').toLowerCase();
    when = d + ' at ' + t;
  } catch (e) { when = ''; }
  let body = 'Reminder from ' + company + ': ' + label + (when ? ' on ' + when : '') + '.';
  if (opts.manageUrl) body += ' Manage: ' + opts.manageUrl;
  return body.slice(0, 300);
}

/**
 * Send one SMS via the Twilio REST API. Best-effort: returns true/false and
 * never throws — a reminder run must survive a Twilio outage.
 */
export async function sendSms(to, body) {
  if (!smsConfigured()) return false;
  const dest = normalisePhone(to);
  if (!dest || !body) return false;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  try {
    const r = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + encodeURIComponent(sid) + '/Messages.json', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(sid + ':' + process.env.TWILIO_AUTH_TOKEN).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: dest, From: process.env.TWILIO_FROM, Body: String(body).slice(0, 320) }).toString(),
    });
    if (!r.ok) {
      let detail = '';
      try { detail = (await r.json()).message || ''; } catch (e) { /* noop */ }
      console.error('[sms] send failed:', r.status, detail);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[sms] send failed:', e.message);
    return false;
  }
}
