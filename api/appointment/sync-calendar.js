/**
 * POST /api/appointment/sync-calendar
 * Auth required. Puts bookings that never reached a calendar into the caller's
 * now-connected one, and reports what happened to each.
 *
 * Why this exists (17 Sep 2026). Calendars became per-person on 11 Sep, and a
 * connection made before that carries no recorded owner. Andy's stopped
 * resolving, so his scheduler kept taking bookings and sending both
 * confirmation emails while silently skipping the calendar write. Reconnecting
 * fixes it from then on; the meetings already taken are still missing, and this
 * is how they are put right.
 *
 * Scoped to the caller. Only schedulers whose ClientEmail is the signed-in
 * person, which is the same rule ?scope=self uses on /api/appointment/list, and
 * the calendar written to is only ever that person's own. A colleague cannot
 * push their bookings into someone else's diary with this.
 *
 * Idempotent. A booking already carrying a providerEventId is left alone, so
 * running it twice cannot create the meeting twice. Cancelled bookings and
 * anything in the past are skipped.
 *
 * Body (all optional): { days = 60, dryRun = false, widgetId }
 * Response: { ok, connected, counts, results: [{ ref, outcome, ... }] }
 */
import { requireAuth } from '../_lib/auth/middleware.js';
import { listBookings, saveBooking, getAccessToken, storageReady } from '../_lib/calendar/store.js';
import { syncBookingToCalendar, applyCalendarResult } from '../_lib/calendar/actions.js';

// A ceiling on one run, so a client with a long history cannot time the
// function out. The response says when there are more to do.
const MAX_PER_RUN = 50;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const ctx = await requireAuth(req, res);
  if (!ctx) return;
  res.setHeader('Cache-Control', 'private, no-store');

  if (!storageReady()) {
    return res.status(200).json({ ok: false, storage: false, error: 'Booking storage is not configured' });
  }

  const me = String(ctx.email || '').toLowerCase().trim();
  // Fail CLOSED. Without a caller we cannot tell whose bookings these are, and
  // the wrong answer here is writing them into somebody else's diary.
  if (!me) return res.status(403).json({ error: 'Could not identify the signed-in user' });

  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const days = Math.max(1, Math.min(365, Number(body.days) || 60));
  const dryRun = body.dryRun === true;
  const onlyWidget = typeof body.widgetId === 'string' ? body.widgetId.trim() : '';

  // Is there a calendar to write into at all? Saying "connect one first" beats
  // reporting fifty identical not-connected rows.
  let connected = false;
  try { connected = !!(await getAccessToken(ctx.clientRecordId, me)); } catch (e) { connected = false; }
  if (!connected) {
    return res.status(200).json({
      ok: false, connected: false,
      error: 'No calendar is connected for this account. Connect one in the scheduler editor, then run this again.',
      counts: { considered: 0, created: 0, skipped: 0, failed: 0 }, results: [],
    });
  }

  const now = Date.now();
  const toMs = now + days * 86400000;

  let bookings;
  try {
    bookings = await listBookings(ctx.clientRecordId, now, toMs);
  } catch (e) {
    return res.status(500).json({ error: 'Could not load bookings' });
  }

  const mine = (bookings || []).filter((b) => {
    if (!b || b.status === 'cancelled') return false;
    if (String(b.clientEmail || '').toLowerCase().trim() !== me) return false;
    if (onlyWidget && b.widgetId !== onlyWidget) return false;
    return true;
  });

  const missing = mine.filter((b) => !b.providerEventId);
  const batch = missing.slice(0, MAX_PER_RUN);

  const results = [];
  const counts = {
    considered: mine.length,
    alreadyThere: mine.length - missing.length,
    created: 0, skipped: 0, failed: 0,
    remaining: Math.max(0, missing.length - batch.length),
  };

  for (const b of batch) {
    const row = { ref: b.ref, startISO: b.startISO, who: (b.invitee && b.invitee.name) || '', outcome: '' };
    if (dryRun) {
      row.outcome = 'would-create';
      counts.skipped++;
      results.push(row);
      continue;
    }
    // No clash check: the booking is already made and the visitor already has a
    // confirmation, so a busy diary is something to tell them about rather than
    // a reason to leave the meeting out of it.
    const result = await syncBookingToCalendar(b, { checkClash: false });
    applyCalendarResult(b, result);
    try {
      await saveBooking(b);
    } catch (e) {
      result.status = 'failed';
      result.error = 'could not save the booking';
    }
    row.outcome = result.status;
    if (result.error) row.error = result.error;
    if (result.calendarLink) row.calendarLink = result.calendarLink;
    if (result.status === 'created') counts.created++;
    else counts.failed++;
    results.push(row);
  }

  return res.status(200).json({ ok: true, connected: true, dryRun, counts, results });
}
