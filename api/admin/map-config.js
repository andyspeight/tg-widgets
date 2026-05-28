/**
 * /api/admin/map-config
 *
 * Read and write the World Map cache refresh interval. The cron runs on its
 * Vercel schedule, but before sweeping each country it checks this value and
 * skips any country whose stored offers were refreshed less than N minutes
 * ago. So this is the "don't re-poll a country more often than every N
 * minutes" control — it works WITH the rotating sweep rather than gating the
 * whole run.
 *
 * GET   -> { refreshIntervalMins: number, allowed: number[] }
 * PATCH { refreshIntervalMins: number }
 *
 * Storage: shared _redis.js helpers (same Upstash store + serialisation the
 * cron uses), key tg:wm:refresh-interval-mins, stored as a plain string.
 * Falls back to 45 if unset or unreadable.
 *
 * Security:
 *   - Admin-gated (requireAdmin from _guard.js — same gate as the other admin
 *     routes).
 *   - Value strictly whitelisted server-side; anything off-list is rejected
 *     400 (no zero, negative, or absurd values reach Redis).
 *   - No '*' CORS; no-store. Redis creds never leave the server.
 */
import { requireAdmin, setAdminCors } from './_guard.js';
import { getString, setString, configured } from '../_redis.js';

const KEY = 'tg:wm:refresh-interval-mins';
const ALLOWED = [15, 30, 45, 60, 120, 240, 1440];
const DEFAULT_MINS = 45;

export default async function handler(req, res) {
  setAdminCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const gate = requireAdmin(req);
  if (gate.error) return res.status(gate.status).json({ error: gate.error });

  res.setHeader('Cache-Control', 'no-store');

  try {
    if (req.method === 'GET') {
      const raw = await getString(KEY);
      const mins = ALLOWED.includes(Number(raw)) ? Number(raw) : DEFAULT_MINS;
      return res.status(200).json({ refreshIntervalMins: mins, allowed: ALLOWED });
    }

    if (req.method === 'PATCH') {
      if (!configured()) {
        return res.status(500).json({ error: 'Redis not configured on the server.' });
      }
      const body = req.body || {};
      const mins = Number(body.refreshIntervalMins);
      if (!Number.isFinite(mins) || !ALLOWED.includes(mins)) {
        return res.status(400).json({
          error: 'refreshIntervalMins must be one of: ' + ALLOWED.join(', '),
        });
      }
      const ok = await setString(KEY, String(mins));
      if (!ok) return res.status(502).json({ error: 'Failed to write interval to Redis.' });
      return res.status(200).json({ refreshIntervalMins: mins, ok: true });
    }

    res.setHeader('Allow', 'GET, PATCH, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[admin/map-config]', e.message);
    return res.status(500).json({ error: 'Server error' });
  }
}
