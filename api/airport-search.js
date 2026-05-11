/**
 * /api/airport-search.js  (ESM)
 * ----------------------------------------------------------------
 * Editor-only search endpoint for the Airport Spotlight picker.
 * Returns shallow summaries of airports matching a free-text query.
 *
 * Authenticated — uses the shared session-token utility from _auth.js.
 *
 * Query: GET /api/airport-search?q=dalaman
 * Response 200:
 *   { results: [
 *     { recordId, iata, name, cityServed, country, role, status }
 *   ] }
 *
 * Module system: ESM. Matches widget-config.js. Earlier CommonJS draft
 * crashed with FUNCTION_INVOCATION_FAILED on Vercel because the runtime
 * is ESM-by-default and require() of an ESM sibling threw on first call.
 */

import { requireAuth, sanitiseForFormula, setCors, applyRateLimit, RATE_LIMITS } from './_auth.js';

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const DESTINATION_BASE_ID = process.env.DESTINATION_CONTENT_BASE_ID || 'appuZdlMJ7HKUt6qS';
const AIRPORTS_TABLE_ID = 'tblI2iVAbIGCtsGa7';
const AIRTABLE_API = 'https://api.airtable.com/v0';

// Field IDs we care about — mirror the catalogue in airport-content.js
const F = {
  name:       'fldlT6eApAdQHGYED',
  status:     'fldjvujj14Q9QNLLq',
  iata:       'fldcS9uu4NWMVaIVP',
  cityServed: 'fldgrJ2uFjzPcAxUx',
  countryTxt: 'fldjARk52dZi7TGGc',
  role:       'fldUSTC6kdgXNgKfI',
};

// --- Airtable HTTP helper ------------------------------------------
// Build the query string manually so array values become repeated keys.
// Airtable expects fields[]=fldA&fields[]=fldB, not fields[]=fldA,fldB
// (which is what URLSearchParams produces for arrays).
async function airtableGet(path, params) {
  if (!AIRTABLE_KEY) throw new Error('AIRTABLE_KEY env missing');
  let qs = '';
  if (params) {
    const parts = [];
    for (const k of Object.keys(params)) {
      const v = params[k];
      if (Array.isArray(v)) {
        for (const item of v) parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(item)));
      } else {
        parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
      }
    }
    qs = parts.length ? '?' + parts.join('&') : '';
  }
  const res = await fetch(AIRTABLE_API + '/' + DESTINATION_BASE_ID + '/' + path + qs, {
    headers: { 'Authorization': 'Bearer ' + AIRTABLE_KEY },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error('Airtable ' + res.status + ': ' + body.slice(0, 200));
  }
  return res.json();
}

function txt(v) {
  if (v == null) return '';
  return String(v).replace(/<[^>]*>/g, '').trim();
}

function selName(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v.name) return String(v.name);
  return '';
}

export default async function handler(req, res) {
  // CORS (delegated to the shared helper used by every other API in the project)
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth — use the same helper widget-config.js uses
  const auth = requireAuth(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const user = auth.user;

  // Rate limit (per-user, same preset as widget writes)
  if (!applyRateLimit(res, `airport-search:${user.email}`, RATE_LIMITS.widgetWrite)) return;

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q || q.length < 2) return res.status(200).json({ results: [] });
  if (q.length > 60)      return res.status(400).json({ error: 'Query too long' });

  // Don't cache search results — agents need to see new airports immediately
  res.setHeader('Cache-Control', 'no-store');

  try {
    const safe = sanitiseForFormula(q);
    // Match on airport name OR IATA OR city served.
    // Field names must match Airtable exactly — 'Airport Name', 'IATA Code',
    // 'City Served'. Earlier draft used {Name} which doesn't exist on this
    // table and poisoned the whole OR, causing every search to fail with
    // INVALID_FILTER_BY_FORMULA.
    const formula = "OR(" +
      "SEARCH(LOWER('" + safe + "'),LOWER({Airport Name}))," +
      "SEARCH(UPPER('" + safe + "'),UPPER({IATA Code}))," +
      "SEARCH(LOWER('" + safe + "'),LOWER({City Served}))" +
    ")";

    const data = await airtableGet(AIRPORTS_TABLE_ID, {
      filterByFormula: formula,
      pageSize: '12',
      'fields[]': [F.name, F.iata, F.cityServed, F.countryTxt, F.role, F.status],
    });

    const results = (data.records || []).map(rec => {
      const f = rec.fields || {};
      return {
        recordId: rec.id,
        name: txt(f[F.name]),
        iata: txt(f[F.iata]).toUpperCase(),
        cityServed: txt(f[F.cityServed]),
        country: txt(f[F.countryTxt]),
        role: selName(f[F.role]),
        status: selName(f[F.status]),
      };
    }).filter(r => r.name);

    return res.status(200).json({ results });

  } catch (err) {
    console.error('[api/airport-search] Error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
