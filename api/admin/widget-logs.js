/**
 * GET /api/admin/widget-logs
 * Admin-gated reader for the widget failure/heartbeat buffer that
 * /api/widget-log fills. Every Travelgenix widget posts a one-time "load"
 * heartbeat and any runtime failure to that sink; this endpoint reads the
 * capped Redis buffer back and aggregates it for the health dashboard.
 *
 *   ?event=error|load|all   filter the returned entries (default all)
 *   ?widget=offers          filter to one widget type
 *   ?limit=200              cap the returned entries (default 200, max 500)
 *
 * Returns: { configured, count, summary, byWidget[], entries[] }. Read-only,
 * same-origin, never writes. 503 if Redis is not configured (nothing to read).
 */
import { requireAdmin, setAdminCors } from './_guard.js';
import { lrange, configured as redisConfigured } from '../_redis.js';
import { LOG_KEY } from '../widget-log.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
  setAdminCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const gate = requireAdmin(req);
  if (gate.error) return res.status(gate.status).json({ error: gate.error });

  if (!redisConfigured()) {
    return res.status(503).json({ error: 'Telemetry store not configured', detail: 'Add UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in Vercel.' });
  }

  const q = req.query || {};
  const eventFilter = ['error', 'load'].includes(String(q.event || '').toLowerCase()) ? String(q.event).toLowerCase() : 'all';
  const widgetFilter = String(q.widget || '').trim().slice(0, 40);
  let limit = parseInt(q.limit, 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 200;
  limit = Math.min(limit, 500);

  // Newest first — widget-log LPUSHes, so index 0 is the most recent event.
  let raw = [];
  try {
    raw = await lrange(LOG_KEY, 0, 499);
  } catch (e) {
    return res.status(500).json({ error: 'Could not read the log buffer', detail: e.message });
  }

  const all = [];
  for (const s of raw) {
    let e = null;
    try { e = JSON.parse(s); } catch { continue; }
    if (e && typeof e === 'object') all.push(e);
  }

  // Aggregate across the FULL buffer (not the filtered/limited slice) so the
  // tiles and per-widget table reflect everything we hold.
  const now = Date.now();
  const summary = { total: all.length, errors: 0, loads: 0, errors24h: 0, widgets: 0, sites: 0 };
  const sites = new Set();
  const byWidget = new Map();
  for (const e of all) {
    const isErr = e.event === 'error';
    if (isErr) summary.errors++; else summary.loads++;
    const t = Date.parse(e.at || '');
    if (isErr && Number.isFinite(t) && now - t <= DAY_MS) summary.errors24h++;
    const site = e.origin || e.pageUrl || '';
    if (site) sites.add(site);

    const w = e.widget || 'unknown';
    let agg = byWidget.get(w);
    if (!agg) { agg = { widget: w, errors: 0, loads: 0, sites: new Set(), lastError: '', lastErrorAt: '', lastAt: '' }; byWidget.set(w, agg); }
    if (isErr) { agg.errors++; if (!agg.lastErrorAt) { agg.lastError = e.message || 'error'; agg.lastErrorAt = e.at || ''; } }
    else agg.loads++;
    if (site) agg.sites.add(site);
    if (!agg.lastAt) agg.lastAt = e.at || '';
  }
  summary.widgets = byWidget.size;
  summary.sites = sites.size;

  const byWidgetOut = [...byWidget.values()]
    .map((a) => ({ widget: a.widget, errors: a.errors, loads: a.loads, sites: a.sites.size, lastError: a.lastError, lastErrorAt: a.lastErrorAt, lastAt: a.lastAt }))
    .sort((a, b) => b.errors - a.errors || b.loads - a.loads);

  const entries = all
    .filter((e) => (eventFilter === 'all' || e.event === eventFilter) && (!widgetFilter || e.widget === widgetFilter))
    .slice(0, limit);

  return res.status(200).json({ configured: true, count: all.length, summary, byWidget: byWidgetOut, entries });
}
