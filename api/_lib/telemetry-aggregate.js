/**
 * In-process aggregation over the Redis fallback buffer, mirroring the shapes
 * the Supabase RPCs return. Used only when Supabase isn't configured yet, so
 * the traffic dashboard still works off the capped Redis buffer.
 *
 * The buffer holds at most a few hundred recent events, so a linear pass per
 * request is cheap. Field names match the Supabase row (snake_case) and the
 * RPC output columns, so the dashboard renders identically in either mode.
 */

function inWindow(ts, fromMs, toMs) {
  const t = Date.parse(ts);
  return Number.isFinite(t) && t >= fromMs && t < toMs;
}

function matchFilters(e, f) {
  if (f.event && e.event !== f.event) return false;
  if (f.widget && e.widget_id !== f.widget) return false;
  if (f.account && e.account_name !== f.account) return false;
  if (f.domain && e.referer_domain !== f.domain) return false;
  return true;
}

function bucketKey(ts, bucket) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  d.setUTCSeconds(0, 0);
  if (bucket === 'hour') d.setUTCMinutes(0);
  else if (bucket === 'day') { d.setUTCMinutes(0); d.setUTCHours(0); }
  return d.toISOString();
}

/**
 * @param {object[]} entries parsed buffer rows
 * @param {object} opts { from, to (ISO), bucket, limit, filters }
 * @returns aggregates in the same shape as /api/admin/widget-traffic overview
 */
export function aggregateBuffer(entries, opts) {
  const fromMs = Date.parse(opts.from);
  const toMs = Date.parse(opts.to);
  const bucket = ['minute', 'hour', 'day'].includes(opts.bucket) ? opts.bucket : 'hour';
  const limit = Math.max(1, Math.min(200, opts.limit || 20));
  const f = opts.filters || {};

  const rows = entries.filter((e) => e && inWindow(e.ts, fromMs, toMs) && matchFilters(e, f));

  // Summary
  const ips = new Set();
  const widgets = new Set();
  let misses = 0;
  let blocked = 0;
  for (const e of rows) {
    if (e.ip_hash) ips.add(e.ip_hash);
    if (e.widget_id) widgets.add(e.widget_id);
    if (e.cache_hit === false) misses++;
    if (Number(e.status) === 429) blocked++;
  }
  const summary = {
    total: rows.length,
    misses,
    blocked,
    uniq_ip: ips.size,
    uniq_widget: widgets.size,
  };

  // Time series
  const tsMap = new Map();
  for (const e of rows) {
    const k = bucketKey(e.ts, bucket);
    if (!k) continue;
    let b = tsMap.get(k);
    if (!b) { b = { bucket: k, total: 0, misses: 0, blocked: 0 }; tsMap.set(k, b); }
    b.total++;
    if (e.cache_hit === false) b.misses++;
    if (Number(e.status) === 429) b.blocked++;
  }
  const timeseries = Array.from(tsMap.values()).sort((a, b) => a.bucket.localeCompare(b.bucket));

  // Top-N by a dimension
  function top(dimField) {
    const m = new Map();
    for (const e of rows) {
      const key = e[dimField] || '(unknown)';
      let g = m.get(key);
      if (!g) { g = { key, wtype: null, total: 0, misses: 0, blocked: 0, _ips: new Set() }; m.set(key, g); }
      g.total++;
      if (!g.wtype && e.widget_type) g.wtype = e.widget_type;
      if (e.cache_hit === false) g.misses++;
      if (Number(e.status) === 429) g.blocked++;
      if (e.ip_hash) g._ips.add(e.ip_hash);
    }
    return Array.from(m.values())
      .map((g) => ({ key: g.key, wtype: g.wtype, total: g.total, misses: g.misses, blocked: g.blocked, uniq_ip: g._ips.size }))
      .sort((a, b) => b.total - a.total)
      .slice(0, limit);
  }

  // Blocked sources (429s grouped by hashed IP)
  const blockMap = new Map();
  for (const e of rows) {
    if (Number(e.status) !== 429) continue;
    const key = e.ip_hash || '(unknown)';
    let g = blockMap.get(key);
    if (!g) { g = { key, blocked: 0, _ips: new Set() }; blockMap.set(key, g); }
    g.blocked++;
    if (e.ip_hash) g._ips.add(e.ip_hash);
  }
  const blockedTop = Array.from(blockMap.values())
    .map((g) => ({ key: g.key, blocked: g.blocked, uniq_ip: g._ips.size }))
    .sort((a, b) => b.blocked - a.blocked)
    .slice(0, limit);

  // Recent feed (newest first), mapped to the we_recent column shape.
  const recent = rows
    .slice()
    .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
    .slice(0, 60)
    .map((e) => ({
      ts: e.ts,
      event: e.event,
      widget_id: e.widget_id,
      widget_type: e.widget_type,
      account_name: e.account_name,
      referer_domain: e.referer_domain,
      ip_text: e.ip || null,
      ip_hash: e.ip_hash,
      country: e.country,
      status: e.status,
      cache_hit: e.cache_hit,
      latency_ms: e.latency_ms,
    }));

  return {
    summary,
    timeseries,
    topWidgets: top('widget_id'),
    topDomains: top('referer_domain'),
    topAccounts: top('account_name'),
    blocked: blockedTop,
    recent,
  };
}
