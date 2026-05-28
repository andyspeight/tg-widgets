/**
 * /api/admin/map-config
 *
 * Read and write the World Map cache refresh interval. The cron job runs on
 * its Vercel schedule (currently every 15 minutes minimum on Pro), but checks
 * this key first and skips the run if not enough time has elapsed since the
 * last successful refresh. That lets the operator throttle the cache without
 * touching vercel.json.
 *
 * GET  → { refreshIntervalMins: number }
 * PATCH { refreshIntervalMins: number }
 *
 * Storage: Upstash Redis (REST). Key: tg:wm:refresh-interval-mins (string).
 * Falls back to 45 if not set or unreadable.
 *
 * Security:
 *   - Admin-gated (requireAdmin from _guard.js — same gate as map-rebuild and
 *     map-destinations).
 *   - Value strictly whitelisted server-side: any input outside the allowed
 *     list is rejected with 400 (prevents zero, negative, or absurd values).
 *   - No CORS '*'; mirrors the admin pattern in _guard.js.
 *   - Redis creds never returned to the client.
 */
import { requireAdmin, setAdminCors } from './_guard.js';

const KEY = 'tg:wm:refresh-interval-mins';
const ALLOWED = [15, 30, 45, 60, 120, 240, 1440];
const DEFAULT_MINS = 45;

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisGet(key) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  const r = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    cache: 'no-store',
  });
  if (!r.ok) return null;
  const d = await r.json().catch(() => ({}));
  return d && d.result != null ? d.result : null;
}

async function redisSet(key, value) {
  if (!REDIS_URL || !REDIS_TOKEN) throw new Error('Redis not configured');
  const r = await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    cache: 'no-store',
  });
  if (!r.ok) throw new Error('Redis SET failed: ' + r.status);
  return true;
}

export default async function handler(req, res) {
  setAdminCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const gate = requireAdmin(req);
  if (gate.error) return res.status(gate.status).json({ error: gate.error });

  res.setHeader('Cache-Control', 'no-store');

  try {
    if (req.method === 'GET') {
      const raw = await redisGet(KEY);
      const mins = ALLOWED.includes(Number(raw)) ? Number(raw) : DEFAULT_MINS;
      return res.status(200).json({ refreshIntervalMins: mins, allowed: ALLOWED });
    }

    if (req.method === 'PATCH') {
      const body = req.body || {};
      const mins = Number(body.refreshIntervalMins);
      if (!Number.isFinite(mins) || !ALLOWED.includes(mins)) {
        return res.status(400).json({
          error: 'refreshIntervalMins must be one of: ' + ALLOWED.join(', '),
        });
      }
      await redisSet(KEY, mins);
      return res.status(200).json({ refreshIntervalMins: mins, ok: true });
    }

    res.setHeader('Allow', 'GET, PATCH, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Server error' });
  }
}
