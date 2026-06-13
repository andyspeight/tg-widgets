/**
 * GET /api/appointment/availability?widgetId=&eventId=&from=&to=
 * Public, cross-origin. Returns the bookable slots for a scheduler widget.
 *
 * If the owning client has a connected calendar, real busy time is subtracted
 * (no double-booking). If not, it returns the same slots the widget would
 * generate client-side, so behaviour is consistent either way.
 *
 * Response: { connected, timezone, eventId, slots: [{ startISO, endISO }] }
 */
import { resolveWidget, pickEvent } from '../_lib/calendar/state.js';
import { generateSlots, subtractBusy } from '../_lib/calendar/slots.js';
import { getAccessToken } from '../_lib/calendar/store.js';
import * as google from '../_lib/calendar/google.js';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const q = req.query || {};
  const widgetId = q.widgetId;
  if (!widgetId) return res.status(400).json({ error: 'widgetId required' });

  const w = await resolveWidget(widgetId);
  if (!w) return res.status(404).json({ error: 'Widget not found', connected: false, slots: [] });

  const config = w.config || {};
  const ev = pickEvent(config, q.eventId);
  let slots = generateSlots(config, ev, { from: q.from, to: q.to });

  let connected = false;
  try {
    const tok = await getAccessToken(w.clientRecordId);
    if (tok) {
      connected = true;
      if (slots.length) {
        const timeMin = slots[0].startISO;
        const timeMax = slots[slots.length - 1].endISO;
        const busy = await google.freeBusy(tok.accessToken, tok.calendarId, timeMin, timeMax);
        slots = subtractBusy(slots, busy);
      }
    }
  } catch (e) {
    console.error('[availability] freebusy failed:', e.message);
    // fall back to the unfiltered (client-side-equivalent) slots
  }

  return res.status(200).json({
    connected,
    timezone: config.timezone || 'Europe/London',
    eventId: ev.id,
    slots: slots.map(s => ({ startISO: s.startISO, endISO: s.endISO })),
  });
}
