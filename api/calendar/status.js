/**
 * GET /api/calendar/status
 * Tells the editor whether the signed-in USER has a connected calendar and
 * which providers can be connected. Returns { connected, email, provider,
 * providers: [ids], storage }.
 *
 * "Connected" means the caller's own, not a colleague's. Before 11 Sep 2026 a
 * client held one connection between everybody, so a second admin was told
 * they were connected to a calendar that was not theirs.
 */
import { requireAuth } from '../_lib/auth/middleware.js';
import { configuredProviders } from '../_lib/calendar/providers.js';
import * as zoomProvider from '../_lib/calendar/zoom.js';
import { getConnection, getZoomConnection, storageReady } from '../_lib/calendar/store.js';
import { smsConfigured } from '../_lib/calendar/sms.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const ctx = await requireAuth(req, res);
  if (!ctx) return;

  let connected = false, email = '', provider = '';
  try {
    const conn = await getConnection(ctx.clientRecordId, ctx.email);
    if (conn) { connected = true; email = conn.email || ''; provider = conn.provider || 'google'; }
  } catch (e) { /* treat as not connected */ }

  // The Zoom connection is separate: calendar drives availability + invites,
  // Zoom drives per-booking video meetings.
  let zoomConnected = false, zoomEmail = '';
  try {
    const z = await getZoomConnection(ctx.clientRecordId);
    if (z) { zoomConnected = true; zoomEmail = z.email || ''; }
  } catch (e) { /* treat as not connected */ }

  const providers = configuredProviders();
  return res.status(200).json({
    connected, email, provider,
    // Each person connects their own calendar. The editor can say so rather
    // than implying a colleague's connection covers this user.
    scope: 'user',
    zoomConnected, zoomEmail, zoomConfigured: zoomProvider.configured(),
    providers,                       // which can be connected
    configured: providers.length > 0,
    storage: storageReady(),
    sms: smsConfigured(),            // platform-level SMS reminders (Twilio)
  });
}
