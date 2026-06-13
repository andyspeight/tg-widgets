/**
 * Travelgenix Widget Suite — FX Rates API
 * /api/fx-rates
 *
 * Proxies the free Frankfurter API (European Central Bank reference rates) with
 * the same Travelgenix hardening as weather-current.js:
 *   - Strict allowlist validation of base + symbols (ISO 4217 codes we support)
 *   - In-memory per-IP rate limiting (anonymous, public endpoint)
 *   - 1-hour edge cache via CDN headers (ECB publishes once per working day, so
 *     this is plenty fresh and cuts upstream load to almost nothing)
 *   - Locked CORS to approved origins (+ Duda previews + env extras)
 *   - Fixed upstream parameter set — the caller never shapes the upstream URL
 *     beyond the validated base/symbols (SSRF guard)
 *   - Opinionated, stable response shape
 *
 * Upstream: https://www.frankfurter.app  (no API key required, CC-licensed ECB data)
 *   GET https://api.frankfurter.app/latest?base=GBP&symbols=EUR,USD
 *   → { amount:1, base:"GBP", date:"2026-06-12", rates:{ EUR:1.17, USD:1.27 } }
 *
 * Usage from the widget:
 *   GET /api/fx-rates?base=GBP&symbols=EUR,USD,AUD
 *   → { ok:true, base:"GBP", date:"2026-06-12",
 *       rates:{ GBP:1, EUR:1.17, USD:1.27, AUD:1.93 },
 *       updated:"2026-06-13T10:15:00Z", source:"frankfurter/ecb" }
 *
 * Note: the base currency is always present in `rates` as 1, so the widget can
 * convert between any two enabled currencies with a single fetch.
 */

'use strict';

// ─── CORS allowlist (mirrors weather-current.js) ───
const ALLOWED_ORIGINS = [
  'https://tg-widgets.vercel.app',
  'https://www.travelgenix.io',
  'https://travelgenix.io',
  'https://www.traveldemo.site',
  'https://traveldemo.site',
];
const ALLOW_DUDA_PREVIEWS = true;
const EXTRA_ORIGINS = (process.env.TG_ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

// ─── Rate limit (per-IP, in-memory, resets on cold start) ───
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 30;
const ipHits = new Map();

// ─── Edge cache. ECB updates once per working day, so an hour is generous. ───
const CACHE_SECONDS = 3600;            // 1 hour
const STALE_WHILE_REVALIDATE = 21600;  // 6 hours

// ─── Upstream ───
const FRANKFURTER_URL = 'https://api.frankfurter.app/latest';
const UPSTREAM_TIMEOUT_MS = 4000;

// ─── Supported currencies (the ECB/Frankfurter set). Code → display name. ───
// Validation allowlist and the single source of truth the widget mirrors.
export const CURRENCIES = {
  AUD: 'Australian Dollar', BGN: 'Bulgarian Lev', BRL: 'Brazilian Real',
  CAD: 'Canadian Dollar', CHF: 'Swiss Franc', CNY: 'Chinese Yuan',
  CZK: 'Czech Koruna', DKK: 'Danish Krone', EUR: 'Euro',
  GBP: 'British Pound', HKD: 'Hong Kong Dollar', HUF: 'Hungarian Forint',
  IDR: 'Indonesian Rupiah', ILS: 'Israeli Shekel', INR: 'Indian Rupee',
  ISK: 'Icelandic Krona', JPY: 'Japanese Yen', KRW: 'South Korean Won',
  MXN: 'Mexican Peso', MYR: 'Malaysian Ringgit', NOK: 'Norwegian Krone',
  NZD: 'New Zealand Dollar', PHP: 'Philippine Peso', PLN: 'Polish Zloty',
  RON: 'Romanian Leu', SEK: 'Swedish Krona', SGD: 'Singapore Dollar',
  THB: 'Thai Baht', TRY: 'Turkish Lira', USD: 'US Dollar', ZAR: 'South African Rand',
};

function isOriginAllowed(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (EXTRA_ORIGINS.includes(origin)) return true;
  if (ALLOW_DUDA_PREVIEWS) {
    try {
      const u = new URL(origin);
      if (u.hostname.endsWith('.duda.co') || u.hostname.endsWith('.multiscreensite.com')) return true;
    } catch { /* fall through */ }
  }
  return false;
}

function applyCors(req, res) {
  const origin = req.headers.origin || '';
  if (isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'] || '';
  const first = String(xff).split(',')[0].trim();
  return first || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function rateLimitHit(ip) {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const hits = (ipHits.get(ip) || []).filter(t => t > cutoff);
  hits.push(now);
  ipHits.set(ip, hits);
  if (ipHits.size > 500 && Math.random() < 0.01) {
    for (const [k, v] of ipHits.entries()) {
      const fresh = v.filter(t => t > cutoff);
      if (fresh.length === 0) ipHits.delete(k); else ipHits.set(k, fresh);
    }
  }
  return hits.length > RATE_LIMIT_MAX;
}

/** Normalise a currency code, returning '' if it isn't one we support. */
export function validCode(raw) {
  const c = String(raw || '').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(CURRENCIES, c) ? c : '';
}

/** Parse the requested symbols into a clean, deduped, supported set. */
export function parseSymbols(raw, base) {
  const out = new Set();
  String(raw || '').split(',').forEach(s => { const c = validCode(s); if (c && c !== base) out.add(c); });
  return [...out].slice(0, 40);   // hard cap, well above the full set
}

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}

function fail(res, status, reason) {
  res.status(status).json({ ok: false, error: reason });
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET, OPTIONS'); return fail(res, 405, 'Method not allowed'); }

  const ip = clientIp(req);
  if (rateLimitHit(ip)) { res.setHeader('Retry-After', '60'); return fail(res, 429, 'Too many requests'); }

  const base = validCode((req.query || {}).base) || 'GBP';
  let symbols = parseSymbols((req.query || {}).symbols, base);
  // Default to a sensible travel set if none (or none valid) were supplied.
  if (!symbols.length) symbols = ['EUR', 'USD', 'AUD', 'CAD', 'CHF', 'JPY'].filter(c => c !== base);

  // Fixed upstream URL — only the validated base/symbols influence it.
  const params = new URLSearchParams({ base, symbols: symbols.join(',') });
  const upstreamUrl = `${FRANKFURTER_URL}?${params.toString()}`;

  let upstream;
  try { upstream = await fetchWithTimeout(upstreamUrl, UPSTREAM_TIMEOUT_MS); }
  catch (e) { return fail(res, 502, 'Upstream FX service unavailable'); }
  if (!upstream.ok) return fail(res, 502, 'Upstream FX service returned an error');

  let raw;
  try { raw = await upstream.json(); }
  catch { return fail(res, 502, 'Upstream response was not valid JSON'); }

  if (!raw || !raw.rates || typeof raw.rates !== 'object') {
    return fail(res, 502, 'Upstream response missing rates');
  }

  // Shape: keep only supported codes, and always include the base as 1.
  const rates = { [base]: 1 };
  for (const code of symbols) {
    const v = Number(raw.rates[code]);
    if (Number.isFinite(v) && v > 0) rates[code] = v;
  }

  res.setHeader('Cache-Control', `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_WHILE_REVALIDATE}`);
  res.setHeader('Vary', 'Origin, Accept-Encoding');
  res.status(200).json({
    ok: true,
    base,
    date: typeof raw.date === 'string' ? raw.date : '',
    rates,
    updated: new Date().toISOString(),
    source: 'frankfurter/ecb',
  });
}
