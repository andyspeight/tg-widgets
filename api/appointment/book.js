/**
 * POST /api/appointment/book
 * Public, cross-origin. Books a slot from a scheduler widget.
 *
 * Body: { widgetId, eventId, startISO, name, email, phone, answers,
 *         visitorTimezone, sourceUrl, website (honeypot), ts }
 *
 * Steps: validate → re-check the slot is generatable and (if connected) still
 * free → place a double-booking hold → create the calendar event inviting the
 * visitor → persist the booking with a manage token → notify the agency.
 *
 * Response: { ok, ref, manageUrl, calendarLink }
 */
import { resolveWidget, pickEvent, bookingRef, manageToken } from '../_lib/calendar/state.js';
import { isValidSlot, hostDateKey } from '../_lib/calendar/slots.js';
import { getAccessToken, saveBooking, placeHold, releaseHold, getDayCount, incDayCount } from '../_lib/calendar/store.js';
import { getProvider } from '../_lib/calendar/providers.js';
import { sendNewBooking } from '../_lib/calendar/mail.js';
import { checkRateLimit } from '../_lib/auth/ratelimit.js';
import { getRequestIp } from '../_lib/auth/http.js';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
export const clean = (v) => String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, '').trim();
const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 150;

// Bound visitor-supplied custom answers: cap the number of fields and the
// length of each key and value so a booking payload can't bloat storage or
// emails. Keys and values are cleaned of control characters.
export function cleanAnswers(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  let n = 0;
  for (const k of Object.keys(raw)) {
    if (n >= 20) break;
    const key = clean(k).slice(0, 80);
    if (!key) continue;
    const val = clean(raw[k]).slice(0, 500);
    if (!val) continue;
    out[key] = val;
    n++;
  }
  return out;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (!body || typeof body !== 'object') body = {};

  // Spam defences (mirror api/contact.js)
  if (clean(body.website)) return res.status(200).json({ ok: true, ref: 'skipped' });
  const ts = Number(body.ts);
  if (ts && Date.now() - ts < 2500) return res.status(200).json({ ok: true, ref: 'skipped' });

  // Per-IP rate limit. Fail-open: this endpoint creates calendar events and
  // sends mail, so we cap abuse, but a Redis blip must never block a real
  // booking (especially live on the demo stand).
  const ip = getRequestIp(req) || 'unknown';
  const rl = await checkRateLimit({ bucket: 'aptBook', key: ip, max: 8, windowSeconds: 600, failClosed: false });
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSeconds || 600));
    return res.status(429).json({ error: 'Too many booking attempts. Please try again in a few minutes.' });
  }

  const name = clean(body.name).slice(0, 100);
  const email = clean(body.email).slice(0, 150);
  const phone = clean(body.phone).slice(0, 40);
  const answers = cleanAnswers((body.appointment && body.appointment.answers) || body.answers);
  const startISO = clean(body.startISO);
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!emailOk(email)) return res.status(400).json({ error: 'A valid email is required' });
  if (!body.widgetId) return res.status(400).json({ error: 'widgetId required' });
  if (!startISO || !Number.isFinite(Date.parse(startISO))) return res.status(400).json({ error: 'A valid time is required' });

  const w = await resolveWidget(body.widgetId);
  if (!w) return res.status(404).json({ error: 'Widget not found' });
  const config = w.config || {};
  const ev = pickEvent(config, body.eventId);

  if (!isValidSlot(config, ev, startISO)) {
    return res.status(409).json({ error: 'That time is no longer available. Please pick another.' });
  }

  const startMs = Date.parse(startISO);
  const endMs = startMs + ev.mins * 60000;
  const endISO = new Date(endMs).toISOString();
  const ref = bookingRef(startMs);
  const token = manageToken();
  const dayKey = hostDateKey(startISO, config.timezone || 'Europe/London');

  // Daily booking cap.
  const cap = Math.max(0, Number(config.dailyCap) || 0);
  if (cap > 0 && (await getDayCount(w.clientRecordId, dayKey)) >= cap) {
    return res.status(409).json({ error: 'That day is fully booked. Please pick another.' });
  }

  // Double-booking hold (works even without a connected calendar).
  const held = await placeHold(w.clientRecordId, startISO, ref);
  if (!held) return res.status(409).json({ error: 'Someone just took that time. Please pick another.' });

  // The video-meeting link for this booking: the event type's own link
  // (their Zoom room etc.) wins; otherwise a Meet/Teams link is minted by
  // the connected calendar below for video meetings.
  const explicitUrl = /^https?:\/\/\S+$/i.test(String(ev.meetingUrl || '').trim())
    ? String(ev.meetingUrl).trim().slice(0, 300) : '';
  let meetingUrl = explicitUrl;

  // If connected, re-check free/busy then create the event.
  let providerEventId = '', calendarLink = '', connected = false, providerName = '';
  try {
    const tok = await getAccessToken(w.clientRecordId);
    if (tok) {
      connected = true;
      providerName = tok.provider || 'google';
      const provider = getProvider(tok.provider);
      // Respect before/after buffers: the slot plus its buffers must be clear.
      const before = Math.max(0, Number(config.bufferBefore) || 0) * 60000;
      const after = Math.max(0, Number(config.bufferAfter) || 0) * 60000;
      const guardMin = new Date(startMs - before).toISOString();
      const guardMax = new Date(endMs + after).toISOString();
      const busy = await provider.freeBusy(tok.accessToken, tok.calendarId, guardMin, guardMax);
      const clash = busy.some(b => Date.parse(b.start) < (endMs + after) && Date.parse(b.end) > (startMs - before));
      if (clash) { await releaseHold(w.clientRecordId, startISO); return res.status(409).json({ error: 'That time was just booked. Please pick another.' }); }

      const descLines = ['Booked via the website scheduler.', 'Visitor: ' + name + ' <' + email + '>' + (phone ? ', ' + phone : '')];
      Object.keys(answers).forEach(k => { descLines.push(k + ': ' + answers[k]); });
      if (explicitUrl) descLines.unshift('Join the meeting: ' + explicitUrl);
      const created = await provider.insertEvent(tok.accessToken, tok.calendarId, {
        summary: (ev.label || 'Appointment') + ' with ' + name,
        description: descLines.join('\n'),
        start: { dateTime: startISO, timeZone: config.timezone || 'UTC' },
        end: { dateTime: endISO, timeZone: config.timezone || 'UTC' },
        location: explicitUrl || config.location || '',
        attendees: [{ email, displayName: name }],
        reminders: { useDefault: true },
        // Video meetings without their own link get one minted by the
        // calendar (Google Meet / Teams).
        _conference: !explicitUrl && ev.mode === 'video',
      });
      providerEventId = created.id || '';
      calendarLink = created.htmlLink || '';
      if (!meetingUrl && created.meetingUrl) meetingUrl = created.meetingUrl;
    }
  } catch (e) {
    console.error('[book] calendar create failed:', e.message);
    // Keep the booking as a request even if the calendar write failed.
  }

  const booking = {
    ref, manageToken: token, status: 'confirmed',
    widgetId: body.widgetId, clientRecordId: w.clientRecordId, clientEmail: w.clientEmail,
    eventId: ev.id, eventLabel: ev.label, durationMins: ev.mins, mode: ev.mode,
    startISO, endISO, visitorTimezone: clean(body.visitorTimezone) || (config.timezone || 'Europe/London'),
    hostTimezone: config.timezone || 'Europe/London',
    invitee: { name, email, phone, answers },
    provider: providerName, providerEventId, calendarLink,
    meetingUrl,
    // Branding travels WITH the booking so every lifecycle email (confirm,
    // reminder, reschedule, cancel) renders consistently without re-reading
    // the widget config.
    company: String(config.company || '').slice(0, 80),
    accent: /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(config.accent || '')) ? config.accent : '',
    dayCounted: cap > 0,
    sourceUrl: clean(body.sourceUrl).slice(0, 300), createdAt: new Date().toISOString(),
  };
  const saved = await saveBooking(booking);
  if (saved && cap > 0) await incDayCount(w.clientRecordId, dayKey);

  // Manage URL on our own origin — only offered if the booking persisted,
  // so we never hand out a dead link when storage is unconfigured.
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const origin = proto + '://' + req.headers.host;
  const manageUrl = saved ? (origin + '/manage-booking?token=' + token) : '';

  // Confirmation to the visitor (with .ics + manage link) and the agency note.
  booking.location = config.location || '';
  await sendNewBooking(booking, { manageUrl });

  return res.status(200).json({ ok: true, ref, manageUrl: manageUrl || undefined, calendarLink, connected, meetingUrl: meetingUrl || undefined });
}
