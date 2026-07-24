/**
 * /api/attraction-search.js  (ESM)
 * ----------------------------------------------------------------
 * Editor-only search endpoint for the Attraction Spotlight picker.
 * Returns shallow summaries of attractions matching a free-text query.
 *
 * Public — no auth, same posture as airport-search.js. The same data is
 * reachable via /api/attraction-content; gating only this would achieve
 * nothing. IP-based rate limit is the abuse control.
 *
 * Query: GET /api/attraction-search?q=disney
 * Response 200: { results: [ { recordId, name, type, operator, location, country, status } ] }
 */

import { sanitiseForFormula, setCors, applyRateLimit, RATE_LIMITS } from './_auth.js';

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const CONTENT_BASE_ID = process.env.DESTINATION_CONTENT_BASE_ID || 'appuZdlMJ7HKUt6qS';
const ATTRACTIONS_TABLE_ID = 'tblhVDUdpwaLabDmQ';
const AIRTABLE_API = 'https://api.airtable.com/v0';

const F = {
  name:     'fldboK0kstNohXgqJ',
  status:   'fldSMqzRfIwIcodgS',
  type:     'fld1UMHOpugpUm865',
  operator: 'flduUYklGYPVCvvfV',
  location: 'fldyoIhTvHu2NI3gn',
  country:  'fldlx9YGIZQ797rem',
};

async function airtableGet(path, params) {
  if (!AIRTABLE_KEY) throw new Error('AIRTABLE_KEY env missing');
  const allParams = Object.assign({ returnFieldsByFieldId: 'true' }, params || {});
  const parts = [];
  for (const k of Object.keys(allParams)) {
    const v = allParams[k];
    if (Array.isArray(v)) for (const item of v) parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(item)));
    else parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
  }
  const qs = parts.length ? '?' + parts.join('&') : '';
  const res = await fetch(AIRTABLE_API + '/' + CONTENT_BASE_ID + '/' + path + qs, {
    headers: { 'Authorization': 'Bearer ' + AIRTABLE_KEY },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error('Airtable ' + res.status + ': ' + body.slice(0, 200));
  }
  return res.json();
}

function txt(v) { if (v == null) return ''; return String(v).replace(/<[^>]*>/g, '').trim(); }
function selName(v) { if (!v) return ''; if (typeof v === 'string') return v; if (typeof v === 'object' && v.name) return String(v.name); return ''; }

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET, OPTIONS'); return res.status(405).json({ error: 'Method not allowed' }); }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.headers['x-real-ip'] || 'unknown';
  if (!applyRateLimit(res, `attraction-search:${ip}`, RATE_LIMITS.widgetWrite)) return;

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q || q.length < 2) return res.status(200).json({ results: [] });
  if (q.length > 60) return res.status(400).json({ error: 'Query too long' });

  res.setHeader('Cache-Control', 'no-store');

  try {
    const safe = sanitiseForFormula(q);
    // Match on Name OR Location OR Operator. Field names must match Airtable exactly.
    const formula = "OR(" +
      "SEARCH(LOWER('" + safe + "'),LOWER({Name}))," +
      "SEARCH(LOWER('" + safe + "'),LOWER({Location}))," +
      "SEARCH(LOWER('" + safe + "'),LOWER({Operator}))" +
    ")";

    const data = await airtableGet(ATTRACTIONS_TABLE_ID, {
      filterByFormula: formula,
      pageSize: '12',
      'fields[]': [F.name, F.type, F.operator, F.location, F.country, F.status],
    });

    const results = (data.records || []).map(rec => {
      const f = rec.fields || {};
      return {
        recordId: rec.id,
        name: txt(f[F.name]),
        type: selName(f[F.type]),
        operator: selName(f[F.operator]),
        location: txt(f[F.location]),
        country: txt(f[F.country]),
        status: selName(f[F.status]),
      };
    }).filter(r => r.name);

    return res.status(200).json({ results });
  } catch (err) {
    console.error('[api/attraction-search] Error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
