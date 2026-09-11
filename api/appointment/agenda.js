/**
 * GET /api/appointment/agenda?days=N&scope=
 * Auth required. The signed-in user's TRAVELGENIX APPOINTMENTS for the window
 * ahead (default 14 days, max 31), soonest first. Powers the browser
 * extension's "Coming up" view.
 *
 * TWO THINGS THIS GETS RIGHT, BOTH REPORTED AS ONE BUG ON 11 SEP 2026.
 *
 * 1. WHOSE. The calendar read is the caller's own (ctx.email), never the
 *    client's. A connection used to be held once per client, so a second admin
 *    on an agency account opened the panel and was shown the first one's
 *    diary. It also fails CLOSED: with no email on the session we show
 *    nothing rather than falling back to the agency calendar.
 *
 * 2. WHAT. It used to return EVERY event in the connected Google or Microsoft
 *    calendar, so a person's private commitments were listed in a booking
 *    tool. Andy: "it should only show the ones that relate to the users who
 *    are using the app." So the calendar is now filtered down to the events
 *    that ARE this person's Travelgenix bookings, matched on the provider
 *    event id we recorded when each booking was made. A booking taken before
 *    a calendar was connected has no such id, so it is included from the
 *    booking record itself and nothing is lost.
 *
 *    Reading the calendar still matters and has not changed: it is what keeps
 *    the times offered to a visitor clear of the host's real commitments. That
 *    happens in /api/appointment/availability. It is just not a reason to LIST
 *    those commitments here.
 *
 *    ?scope=all returns the whole diary for a caller that genuinely wants it.
 *
 * A calendar event that has been moved or renamed in Google still shows with
 * its real time and title, because the filter picks events out of the calendar
 * rather than rebuilding them from our records.
 */
import { requireAuth } from '../_lib/auth/middleware.js';
import { getAccessToken, listBookings, storageReady } from '../_lib/calendar/store.js';
import { getProvider } from '../_lib/calendar/providers.js';

const normEmail = (v) => String(v == null ? '' : v).toLowerCase().trim();

/** A booking with no calendar event behind it, shaped like a calendar event. */
function bookingAsEvent(b) {
  return {
    id: 'tg:' + b.ref,
    title: (b.eventLabel || 'Appointment') + (b.invitee && b.invitee.name ? ' with ' + b.invitee.name : ''),
    startISO: b.startISO,
    endISO: b.endISO || '',
    allDay: false,
    link: b.calendarLink || '',
    tg: true,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const ctx = await requireAuth(req, res);
  if (!ctx) return;
  // Never cache one person's diary. (A 304 on the sibling bookings list is
  // what kept a stale, pre-fix body on screen after the fix had shipped.)
  res.setHeader('Cache-Control', 'private, no-store');

  const q = req.query || {};
  const days = Math.max(1, Math.min(31, Number(q.days) || 14));
  const wholeDiary = String(q.scope || '').toLowerCase() === 'all';
  const me = normEmail(ctx.email);
  const fromMs = Date.now();
  const toMs = fromMs + days * 86400000;

  // Fail closed. Without an identity we cannot tell whose diary this is, and
  // the wrong answer here is showing somebody else's.
  if (!me) return res.status(200).json({ ok: true, connected: false, events: [] });

  // This person's own appointments in the window.
  let mine = [];
  if (storageReady()) {
    try {
      const all = await listBookings(ctx.clientRecordId, fromMs, toMs);
      mine = (all || []).filter((b) => b && b.status !== 'cancelled' && normEmail(b.clientEmail) === me);
    } catch (e) { mine = []; }
  }

  let tok = null;
  try { tok = await getAccessToken(ctx.clientRecordId, ctx.email); } catch (e) { tok = null; }

  // No calendar of their own: their appointments still show, from our records.
  if (!tok) {
    return res.status(200).json({
      ok: true, connected: false,
      events: mine.map(bookingAsEvent).sort((a, b) => Date.parse(a.startISO) - Date.parse(b.startISO)),
    });
  }

  try {
    const events = await getProvider(tok.provider).listEvents(
      tok.accessToken, tok.calendarId, new Date(fromMs).toISOString(), new Date(toMs).toISOString());

    if (wholeDiary) {
      return res.status(200).json({ ok: true, connected: true, provider: tok.provider, scope: 'all', events });
    }

    // Keep the calendar's own copy of each of our appointments, so a time or
    // title changed in Google is what shows.
    const ourIds = new Set(mine.map((b) => b.providerEventId).filter(Boolean));
    const kept = (events || []).filter((e) => e && ourIds.has(e.id)).map((e) => Object.assign({}, e, { tg: true }));

    // Anything of ours the calendar did not account for (booked before the
    // calendar was connected, or the event was deleted there).
    const seen = new Set(kept.map((e) => e.id));
    const missing = mine.filter((b) => !b.providerEventId || !seen.has(b.providerEventId)).map(bookingAsEvent);

    const out = kept.concat(missing).sort((a, b) => Date.parse(a.startISO) - Date.parse(b.startISO));
    return res.status(200).json({
      ok: true, connected: true, provider: tok.provider, scope: 'appointments',
      // What we did NOT list, so a caller can offer the whole diary if it wants.
      otherCount: Math.max(0, (events || []).length - kept.length),
      events: out,
    });
  } catch (e) {
    console.error('[agenda] list failed:', e.message);
    // Connected but unreadable right now. Their own appointments still show.
    return res.status(200).json({
      ok: true, connected: true, degraded: true,
      events: mine.map(bookingAsEvent).sort((a, b) => Date.parse(a.startISO) - Date.parse(b.startISO)),
    });
  }
}
