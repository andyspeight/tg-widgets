/**
 * /api/admin/widget-traffic
 *
 * Read-only aggregates over the Supabase `widget_events` telemetry table for
 * the admin traffic dashboard. Admin-gated (same requireAdmin gate as the other
 * admin routes). The Supabase service-role key stays server-side — the browser
 * only ever talks to this route, never to Supabase directly.
 *
 * GET ?action=overview&range=24h[&event=&widget=&account=&domain=]
 *   → { summary, timeseries, topWidgets, topDomains, topAccounts, blocked, recent }
 * GET ?action=recent&range=1h[&filters…]  → { recent }   (for live-feed polling)
 *
 * range ∈ 1h | 24h | 7d | 30d  (or pass explicit from/to ISO timestamps).
 * The bucket for the time series is chosen to suit the range.
 *
 * Security:
 *   - requireAdmin (role or MAP_ADMIN_EMAILS allow-list).
 *   - Same-origin CORS, no-store.
 *   - Reads through SECURITY-restricted RPCs; service key never leaves here.
 */
import { requireAdmin, setAdminCors } from './_guard.js';
import { lrange, configured as redisConfigured } from '../_redis.js';
import { REDIS_BUFFER_KEY } from '../_lib/telemetry.js';
import { aggregateBuffer } from '../_lib/telemetry-aggregate.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const RANGES = {
  '1h':  { ms: 60 * 60 * 1000,            bucket: 'minute' },
  '24h': { ms: 24 * 60 * 60 * 1000,       bucket: 'hour'   },
  '7d':  { ms: 7 * 24 * 60 * 60 * 1000,   bucket: 'day'    },
  '30d': { ms: 30 * 24 * 60 * 60 * 1000,  bucket: 'day'    },
};

const EVENTS = new Set(['offers', 'cached-offers', 'config', 'popup-lead']);

function telemetryConfigured() {
  return !!(SUPABASE_URL && SERVICE_KEY);
}

async function callRpc(fn, params) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`rpc ${fn} → ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

// Optional string filter → trimmed value or null. Bounds length defensively.
function filt(v, max = 253) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

export default async function handler(req, res) {
  setAdminCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const gate = requireAdmin(req);
  if (gate.error) return res.status(gate.status).json({ error: gate.error });

  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'GET only' });
  }

  // Neither store available → nothing to show.
  if (!telemetryConfigured() && !redisConfigured()) {
    return res.status(503).json({
      error: 'Telemetry store not configured',
      detail: 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel to enable the dashboard.',
      configured: false,
    });
  }

  const q = req.query || {};
  const action = filt(q.action) || 'overview';

  // Resolve the window. Explicit from/to win; otherwise use the range shorthand.
  const rangeKey = RANGES[q.range] ? q.range : '24h';
  const range = RANGES[rangeKey];
  let toDate = q.to ? new Date(q.to) : new Date();
  let fromDate = q.from ? new Date(q.from) : new Date(toDate.getTime() - range.ms);
  if (isNaN(toDate.getTime())) toDate = new Date();
  if (isNaN(fromDate.getTime())) fromDate = new Date(toDate.getTime() - range.ms);
  const from = fromDate.toISOString();
  const to = toDate.toISOString();
  const bucket = filt(q.bucket) && ['minute', 'hour', 'day'].includes(q.bucket) ? q.bucket : range.bucket;

  // Shared filters. event is whitelisted; the rest are free text (widget id,
  // account name, referer domain) matched exactly by the RPCs.
  const eventFilter = EVENTS.has(q.event) ? q.event : null;
  const f = {
    p_event: eventFilter,
    p_widget: filt(q.widget, 120),
    p_account: filt(q.account, 200),
    p_domain: filt(q.domain, 253),
  };
  const limit = Math.max(1, Math.min(200, parseInt(q.limit, 10) || 20));

  // ── Fallback mode ──────────────────────────────────────────────────
  // Supabase not wired up yet, but Redis is: read the capped rolling buffer
  // and aggregate in-process. Same response shape, plus mode:'redis' so the
  // dashboard can show a "limited history" note.
  if (!telemetryConfigured() && redisConfigured()) {
    try {
      const raw = await lrange(REDIS_BUFFER_KEY, 0, -1);
      const entries = [];
      for (const s of raw) {
        try { entries.push(JSON.parse(s)); } catch { /* skip malformed */ }
      }
      const filters = { event: eventFilter, widget: f.p_widget, account: f.p_account, domain: f.p_domain };
      const agg = aggregateBuffer(entries, { from, to, bucket, limit, filters });
      if (action === 'recent') {
        return res.status(200).json({ configured: false, mode: 'redis', from, to, recent: agg.recent });
      }
      return res.status(200).json({
        configured: false,
        mode: 'redis',
        bufferSize: entries.length,
        range: rangeKey,
        bucket,
        from,
        to,
        ...agg,
      });
    } catch (err) {
      console.error('[widget-traffic] redis fallback failed:', err.message);
      return res.status(502).json({ error: 'Telemetry buffer read failed', detail: err.message.slice(0, 200) });
    }
  }

  try {
    if (action === 'recent') {
      const recent = await callRpc('we_recent', { p_from: from, p_to: to, p_limit: Math.min(500, limit * 5 || 100), ...f });
      return res.status(200).json({ configured: true, from, to, recent });
    }

    // action === 'overview' (default): one round of parallel aggregates.
    const [summary, timeseries, topWidgets, topDomains, topAccounts, blocked, recent] = await Promise.all([
      callRpc('we_summary',    { p_from: from, p_to: to, ...f }),
      callRpc('we_timeseries', { p_from: from, p_to: to, p_bucket: bucket, ...f }),
      callRpc('we_top',        { p_dim: 'widget',  p_from: from, p_to: to, p_limit: limit, ...f }),
      callRpc('we_top',        { p_dim: 'domain',  p_from: from, p_to: to, p_limit: limit, ...f }),
      callRpc('we_top',        { p_dim: 'account', p_from: from, p_to: to, p_limit: limit, ...f }),
      callRpc('we_top_blocked',{ p_dim: 'ip', p_from: from, p_to: to, p_limit: limit }),
      callRpc('we_recent',     { p_from: from, p_to: to, p_limit: 60, ...f }),
    ]);

    return res.status(200).json({
      configured: true,
      range: rangeKey,
      bucket,
      from,
      to,
      summary: Array.isArray(summary) ? summary[0] : summary,
      timeseries,
      topWidgets,
      topDomains,
      topAccounts,
      blocked,
      recent,
    });
  } catch (err) {
    console.error('[widget-traffic] query failed:', err.message);
    return res.status(502).json({ error: 'Telemetry query failed', detail: err.message.slice(0, 200) });
  }
}
