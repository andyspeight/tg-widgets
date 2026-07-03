/**
 * GET /api/appointment/agenda?days=N
 * Auth required. The signed-in client's CALENDAR diary for the window ahead
 * (default 14 days, max 31): real events from their connected Google or
 * Microsoft calendar, normalised and soonest-first. Scheduler bookings appear
 * here naturally because every booking is inserted into that calendar.
 *
 * Powers the browser extension's "Coming up" view. When no calendar is
 * connected it says so honestly ({ connected: false }) and the caller falls
 * back to scheduler bookings from /api/appointment/list.
 */
import { requireAuth } from '../_lib/auth/middleware.js';
import { getAccessToken } from '../_lib/calendar/store.js';
import { getProvider } from '../_lib/calendar/providers.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const ctx = await requireAuth(req, res);
  if (!ctx) return;
  res.setHeader('Cache-Control', 'no-store');

  const days = Math.max(1, Math.min(31, Number((req.query || {}).days) || 14));

  let tok = null;
  try { tok = await getAccessToken(ctx.clientRecordId); } catch (e) { tok = null; }
  if (!tok) return res.status(200).json({ ok: true, connected: false, events: [] });

  try {
    const timeMin = new Date().toISOString();
    const timeMax = new Date(Date.now() + days * 86400000).toISOString();
    const events = await getProvider(tok.provider).listEvents(tok.accessToken, tok.calendarId, timeMin, timeMax);
    return res.status(200).json({ ok: true, connected: true, provider: tok.provider, events });
  } catch (e) {
    console.error('[agenda] list failed:', e.message);
    // Connected but unreadable right now — the caller shows its fallback
    // rather than an error wall.
    return res.status(200).json({ ok: true, connected: true, degraded: true, events: [] });
  }
}
