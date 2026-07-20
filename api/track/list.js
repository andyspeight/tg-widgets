// =============================================================================
//  /api/track/list.js   →   GET /api/track/list
// =============================================================================
//
//  Read side of YesAware, for the dashboard. ADMIN ONLY. Returns tracked
//  messages with aggregated open/click counts, a recent activity feed and
//  totals. Reads both Airtable tables and joins them on Token in memory
//  (personal volume, so a bounded paginated fetch is plenty).
//
//  "humanOpens" counts only opens tagged `direct` — it excludes Apple Mail
//  Privacy Protection prefetches and image-proxy fetches, which are the honest
//  way to read opens in 2026 (see docs/yesaware-handover.md section 3).
//
// =============================================================================

import { requireAdmin, setAdminCors } from '../admin/_guard.js';
import { applyRateLimit, RATE_LIMITS } from '../_auth.js';

const AIRTABLE_API = 'https://api.airtable.com/v0';
const BASE = process.env.AIRTABLE_BASE_ID || 'appAYzWZxvK6qlwXK';
const MESSAGES = 'YesAware Messages';
const EVENTS = 'YesAware Events';

// Paginated fetch, bounded. Airtable returns each record's createdTime, so we
// sort in memory and need no created-time field.
async function fetchAll(table, cap) {
  const key = process.env.AIRTABLE_KEY;
  if (!key) return [];
  const out = [];
  let offset = '';
  for (let page = 0; page < 25 && out.length < cap; page++) {
    const url = new URL(`${AIRTABLE_API}/${BASE}/${encodeURIComponent(table)}`);
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);
    const r = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) break;
    const d = await r.json();
    for (const rec of d.records || []) out.push(rec);
    offset = d.offset || '';
    if (!offset) break;
  }
  return out;
}

export default async function handler(req, res) {
  setAdminCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const gate = requireAdmin(req);
  if (gate.error) return res.status(gate.status).json({ error: gate.error });

  const rlKey = `yesaware-list:${gate.user.recordId || gate.user.clientId || 'anon'}`;
  if (!applyRateLimit(res, rlKey, RATE_LIMITS.widgetRead)) return;

  try {
    const [msgRecs, evtRecs] = await Promise.all([
      fetchAll(MESSAGES, 500),
      fetchAll(EVENTS, 3000),
    ]);

    // Group events by token.
    const byToken = new Map();
    for (const e of evtRecs) {
      const f = e.fields || {};
      const token = f.Token || '';
      if (!token) continue;
      let g = byToken.get(token);
      if (!g) { g = { opens: 0, humanOpens: 0, clicks: 0, last: 0 }; byToken.set(token, g); }
      const t = Date.parse(e.createdTime) || 0;
      if (t > g.last) g.last = t;
      if (f.Type === 'open') { g.opens++; if (f.Source === 'direct') g.humanOpens++; }
      else if (f.Type === 'click') { g.clicks++; }
    }

    const messages = msgRecs.map((m) => {
      const f = m.fields || {};
      const token = f.Token || '';
      const g = byToken.get(token) || { opens: 0, humanOpens: 0, clicks: 0, last: 0 };
      let links = [];
      try { const p = JSON.parse(f.Links || '[]'); if (Array.isArray(p)) links = p.slice(0, 25); } catch { /* ignore */ }
      return {
        token,
        subject: f.Subject || '',
        recipient: f.Recipient || '',
        created: Date.parse(m.createdTime) || 0,
        links,
        opens: g.opens,
        humanOpens: g.humanOpens,
        clicks: g.clicks,
        lastEventAt: g.last || 0,
      };
    }).sort((a, b) => (b.lastEventAt || b.created) - (a.lastEventAt || a.created));

    const events = evtRecs.map((e) => {
      const f = e.fields || {};
      return { token: f.Token || '', type: f.Type || '', source: f.Source || '', url: f.URL || '', at: Date.parse(e.createdTime) || 0 };
    }).sort((a, b) => b.at - a.at).slice(0, 60);

    const totals = {
      messages: messages.length,
      opens: messages.reduce((s, m) => s + m.opens, 0),
      humanOpens: messages.reduce((s, m) => s + m.humanOpens, 0),
      clicks: messages.reduce((s, m) => s + m.clicks, 0),
    };

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, messages, events, totals });
  } catch (e) {
    console.error('[track/list] failed', e && e.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
