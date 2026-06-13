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
import { isValidSlot } from '../_lib/calendar/slots.js';
import { getAccessToken, saveBooking, placeHold, releaseHold } from '../_lib/calendar/store.js';
import * as google from '../_lib/calendar/google.js';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
const clean = (v) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 150;
const esc = (v) => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function sgSend(payload) {
  if (!process.env.SENDGRID_API_KEY) return;
  try {
    await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.SENDGRID_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) { console.error('[book] sendgrid', e.message); }
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

  const name = clean(body.name).slice(0, 100);
  const email = clean(body.email).slice(0, 150);
  const phone = clean(body.phone).slice(0, 40);
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

  // Double-booking hold (works even without a connected calendar).
  const held = await placeHold(w.clientRecordId, startISO, ref);
  if (!held) return res.status(409).json({ error: 'Someone just took that time. Please pick another.' });

  // If connected, re-check free/busy then create the event.
  let providerEventId = '', calendarLink = '', connected = false;
  try {
    const tok = await getAccessToken(w.clientRecordId);
    if (tok) {
      connected = true;
      const busy = await google.freeBusy(tok.accessToken, tok.calendarId, startISO, endISO);
      const clash = busy.some(b => Date.parse(b.start) < endMs && Date.parse(b.end) > startMs);
      if (clash) { await releaseHold(w.clientRecordId, startISO); return res.status(409).json({ error: 'That time was just booked. Please pick another.' }); }

      const answers = (body.appointment && body.appointment.answers) || body.answers || {};
      const descLines = ['Booked via the website scheduler.', 'Visitor: ' + name + ' <' + email + '>' + (phone ? ', ' + phone : '')];
      Object.keys(answers || {}).forEach(k => { if (answers[k]) descLines.push(k + ': ' + answers[k]); });
      const created = await google.insertEvent(tok.accessToken, tok.calendarId, {
        summary: (ev.label || 'Appointment') + ' with ' + name,
        description: descLines.join('\n'),
        start: { dateTime: startISO, timeZone: config.timezone || 'UTC' },
        end: { dateTime: endISO, timeZone: config.timezone || 'UTC' },
        location: config.location || '',
        attendees: [{ email, displayName: name }],
        reminders: { useDefault: true },
      });
      providerEventId = created.id || '';
      calendarLink = created.htmlLink || '';
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
    invitee: { name, email, phone, answers: (body.appointment && body.appointment.answers) || body.answers || {} },
    provider: connected ? 'google' : '', providerEventId, calendarLink,
    sourceUrl: clean(body.sourceUrl).slice(0, 300), createdAt: new Date().toISOString(),
  };
  const saved = await saveBooking(booking);

  // Manage URL on our own origin — only offered if the booking persisted,
  // so we never hand out a dead link when storage is unconfigured.
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const origin = proto + '://' + req.headers.host;
  const manageUrl = saved ? (origin + '/manage-booking?token=' + token) : '';

  // Notify the agency (best effort).
  const to = w.clientEmail || process.env.CONTACT_TO || 'info@travelgenix.io';
  const whenStr = new Date(startMs).toUTCString();
  const rows = [['Meeting', ev.label + ' (' + ev.mins + ' min)'], ['When', whenStr + ' · ' + (config.timezone || '')], ['Name', name], ['Email', email], ['Phone', phone || '—']];
  const answers = booking.invitee.answers || {};
  Object.keys(answers).forEach(k => { if (answers[k]) rows.push([k, String(answers[k])]); });
  const html = '<div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.5">' +
    '<h2 style="margin:0 0 12px">New appointment booked</h2><table style="border-collapse:collapse">' +
    rows.map(([k, v]) => '<tr><td style="padding:4px 14px 4px 0;color:#64748b;font-weight:bold">' + esc(k) + '</td><td style="padding:4px 0">' + esc(v) + '</td></tr>').join('') +
    '</table><p style="margin:14px 0 0;font-size:13px;color:#64748b">Reference ' + esc(ref) + (connected ? ' · added to your calendar' : '') + '</p></div>';
  await sgSend({
    personalizations: [{ to: [{ email: to }] }],
    from: { email: process.env.CONTACT_FROM || 'info@travelgenix.io', name: 'Travelgenix Scheduler' },
    reply_to: { email, name },
    subject: 'New booking: ' + ev.label + ' with ' + name,
    content: [{ type: 'text/html', value: html }],
  });

  return res.status(200).json({ ok: true, ref, manageUrl: manageUrl || undefined, calendarLink, connected });
}
