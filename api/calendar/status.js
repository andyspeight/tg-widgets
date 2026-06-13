/**
 * GET /api/calendar/status
 * Tells the editor whether the signed-in client has a connected calendar.
 * Returns { connected, email, provider, configured, storage }.
 */
import { requireAuth } from '../_lib/auth/middleware.js';
import * as google from '../_lib/calendar/google.js';
import { getConnection, storageReady } from '../_lib/calendar/store.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const ctx = await requireAuth(req, res);
  if (!ctx) return;

  let connected = false, email = '', provider = '';
  try {
    const conn = await getConnection(ctx.clientRecordId);
    if (conn) { connected = true; email = conn.email || ''; provider = conn.provider || 'google'; }
  } catch (e) { /* treat as not connected */ }

  return res.status(200).json({
    connected, email, provider,
    configured: google.configured(),
    storage: storageReady(),
  });
}
