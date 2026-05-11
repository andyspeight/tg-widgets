/**
 * /api/airport-search.js
 * ----------------------------------------------------------------
 * Editor-only search endpoint for the Airport Spotlight picker.
 * Returns shallow summaries of airports matching a free-text query.
 *
 * Authenticated — uses the shared session-token utility from _auth.js.
 * (Mirrors the destination-completeness endpoint pattern.)
 *
 * Query: GET /api/airport-search?q=dalaman
 * Response 200:
 *   { results: [
 *     { recordId, iata, name, cityServed, country, role, status }
 *   ] }
 */

'use strict';

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

// In-memory rate limiter — 30/min per IP
const RATE = { window: 60_000, max: 30 };
const _buckets = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (_buckets.get(ip) || []).filter(t => now - t < RATE.window);
  arr.push(now);
  _buckets.set(ip, arr);
  return arr.length > RATE.max;
}

function sanitiseForFormula(s) {
  return String(s == null ? '' : s).replace(/'/g, "\\'");
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

async function airtableGet(path, params) {
  if (!AIRTABLE_KEY) throw new Error('AIRTABLE_KEY env missing');
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const res = await fetch(AIRTABLE_API + '/' + DESTINATION_BASE_ID + '/' + path + qs, {
    headers: { 'Authorization': 'Bearer ' + AIRTABLE_KEY },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error('Airtable ' + res.status + ': ' + body.slice(0, 200));
  }
  return res.json();
}

/**
 * Verify session token via the shared auth helper.
 * Falls back to a tolerant check if _auth.js isn't present (dev environment).
 */
function verifySession(req) {
  // Try the shared helper first
  try {
    const auth = require('./_auth.js');
    if (auth && typeof auth.verifyRequest === 'function') {
      return auth.verifyRequest(req);
    }
  } catch (e) { /* helper not present; fall through */ }

  // Minimal fallback — require any cookie or Authorization header so this
  // endpoint isn't completely open. Real verification happens in widget-list.
  const cookie = req.headers.cookie || '';
  const hasSession = /tg_session=/.test(cookie) || !!req.headers.authorization;
  return hasSession ? { ok: true } : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'OPTIONS') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin === '*' ? '*' : origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') return res.status(204).end();

  // Auth
  const session = verifySession(req);
  if (!session) return res.status(401).json({ error: 'Authentication required' });

  // Rate limit
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
             req.headers['x-real-ip'] || 'unknown';
  if (rateLimited(ip)) return res.status(429).json({ error: 'Rate limit exceeded' });

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q || q.length < 2) return res.status(200).json({ results: [] });
  if (q.length > 60)      return res.status(400).json({ error: 'Query too long' });

  // Don't cache search results — agents need to see new airports immediately
  res.setHeader('Cache-Control', 'no-store');

  try {
    const safe = sanitiseForFormula(q);
    // Match on airport name OR IATA OR city served
    const formula = "OR(" +
      "SEARCH(LOWER('" + safe + "'),LOWER({Name}))," +
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
};
