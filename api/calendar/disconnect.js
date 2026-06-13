/**
 * POST /api/calendar/disconnect
 * Drops the signed-in client's stored calendar connection. New bookings fall
 * back to the widget's client-side availability. Existing booking records are
 * kept (their manage links keep working for cancel).
 */
import { requireAuth } from '../_lib/auth/middleware.js';
import { deleteConnection } from '../_lib/calendar/store.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const ctx = await requireAuth(req, res);
  if (!ctx) return;
  try {
    await deleteConnection(ctx.clientRecordId);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'Could not disconnect' });
  }
}
