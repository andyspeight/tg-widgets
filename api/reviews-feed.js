/**
 * Travelgenix Widget Suite — Live Reviews Feed API
 * /api/reviews-feed?source=<feefo|reviewsio>&id=<merchant or store>&max=20
 *
 * Streams a business's PUBLIC reviews from a review platform with NO per-client
 * API key — the suite does the fetching server-side and caches at the edge, the
 * same "us doing the work" posture as Elfsight. The client only ever supplies
 * their own public merchant/store identifier; they never plug in a key.
 *
 * Self-serve sources implemented here (both expose open public JSON, no key):
 *   - feefo     → api.feefo.com    (merchant_identifier, e.g. "kuoni")
 *   - reviewsio → api.reviews.io    (store, e.g. "trustford")
 *
 * Scrape-only platforms (Google, TripAdvisor, Yelp, Facebook) are NOT here:
 * they block datacenter IPs / need a headless browser, so they slot in later
 * behind this SAME interface via a paid data provider — no widget/editor change.
 * Trustpilot is intentionally excluded (client's own paid Trustpilot account).
 *
 * Security posture mirrors rss-feed.js MINUS the SSRF machinery: the upstream
 * host is HARD-CODED per source (never user-supplied), so there is no arbitrary
 * URL to defend. The only user input is the identifier, which is strictly
 * validated and URL-encoded into a fixed host. We still: lock CORS, rate-limit
 * per IP, time- and size-cap the upstream read, allow-list the final host as
 * defence-in-depth, and return a uniform { ok:false, error } shape.
 *
 * Output — one normalized shape that maps 1:1 onto what widget-reviews.js reads
 * per card (author, rating, text, date, source, photoUrl/hasPhoto, helpful,
 * reply, tags), so connected reviews render through the exact same card code as
 * manual ones, each carrying its `source` so the right platform logo shows:
 *
 *   { ok:true,
 *     source:'feefo',
 *     business:{ id, name },
 *     rating:{ average:4.8, count:1234 },
 *     count: 20,
 *     reviews:[ { id, author, rating, text, date, source,
 *                 photoUrl, hasPhoto, helpful, reply, tags } ],
 *     updated:'…Z' }
 *
 * The widget calls this ONCE PER connected source (each cached independently at
 * the edge) and merges/sorts client-side — so a single display can mix Feefo +
 * Reviews.io (+ future sources), every card showing where it came from. This is
 * the identical multi-feed pattern rss-feed.js already uses.
 */

'use strict';

// ─── CORS (shared posture with the other data endpoints) ─────────────────────
const ALLOWED_ORIGINS = [
  'https://tg-widgets.vercel.app',
  'https://widgets.travelify.io',
  'https://www.travelgenix.io',
  'https://travelgenix.io',
  'https://www.traveldemo.site',
  'https://traveldemo.site',
];
const ALLOW_DUDA_PREVIEWS = true;
const EXTRA_ORIGINS = (process.env.TG_ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin) || EXTRA_ORIGINS.includes(origin)) return true;
  if (ALLOW_DUDA_PREVIEWS) {
    try {
      const h = new URL(origin).hostname;
      if (h === 'duda.co' || h.endsWith('.duda.co') || h.endsWith('.dudamobile.com') || h.endsWith('.multiscreensite.com')) return true;
    } catch (e) { /* ignore */ }
  }
  return false;
}
function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ─── Rate limit ──────────────────────────────────────────────────────────────
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 30;
const ipHits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  hits.push(now);
  ipHits.set(ip, hits);
  if (ipHits.size > 5000) { for (const [k, v] of ipHits) { if (!v.length || now - v[v.length - 1] > RATE_LIMIT_WINDOW_MS) ipHits.delete(k); } }
  return hits.length > RATE_LIMIT_MAX;
}

// ─── Small helpers ───────────────────────────────────────────────────────────
function clip(s, n) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; }
function clampRating(v) { const n = Number(v); if (!Number.isFinite(n)) return 0; return Math.max(0, Math.min(5, Math.round(n * 10) / 10)); }
function toIsoDate(d) {
  if (!d) return '';
  // Reviews.io gives "2025-10-14 04:25:55" (treat as UTC); Feefo gives ISO.
  let s = String(d).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) s = s.replace(' ', 'T') + 'Z';
  const t = new Date(s);
  if (isNaN(t.getTime())) return '';
  return t.toISOString().slice(0, 10); // YYYY-MM-DD
}
function safeImg(u) { return /^https:\/\//i.test(String(u || '').trim()) ? String(u).trim() : ''; }

// ─── Upstream fetch (FIXED hosts only — see header note on SSRF) ─────────────
const UPSTREAM_TIMEOUT_MS = 6000;
const MAX_BYTES = 3 * 1024 * 1024; // 3MB
const ALLOWED_UPSTREAM_HOSTS = new Set(['api.feefo.com', 'api.reviews.io']);

async function fetchJson(url) {
  // Defence-in-depth: the host is constructed by us, but assert it anyway.
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch (e) { return { error: 'Bad upstream URL.', status: 500 }; }
  if (!ALLOWED_UPSTREAM_HOSTS.has(host)) return { error: 'Upstream host not allowed.', status: 500 };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let r;
  try {
    r = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TravelgenixWidgets/1.0; +https://tg-widgets.vercel.app)',
        'Accept': 'application/json, */*;q=0.5',
        'Accept-Language': 'en',
      },
    });
  } catch (e) {
    clearTimeout(timer);
    return { error: e.name === 'AbortError' ? 'The review provider took too long to respond.' : 'Could not reach the review provider.', status: e.name === 'AbortError' ? 504 : 502 };
  }
  clearTimeout(timer);

  if (r.status === 401 || r.status === 403) return { error: 'That account is not open for public reviews.', status: 422 };
  if (r.status === 404) return { error: 'No reviews found for that identifier.', status: 404 };
  if (!r.ok) {
    // Both providers return a JSON error body we can surface for the common cases.
    let msg = '';
    try { const j = await r.json(); msg = (j && (j.message || j.error)) ? String(j.message || j.error) : ''; } catch (e) {}
    if (/closed/i.test(msg)) return { error: 'That account is closed on the review provider.', status: 422 };
    return { error: 'The review provider returned an error.', status: 502 };
  }

  // Size-capped read
  const reader = r.body && r.body.getReader ? r.body.getReader() : null;
  let text = '';
  if (reader) {
    const chunks = []; let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_BYTES) { try { reader.cancel(); } catch (e) {} return { error: 'Review payload too large.', status: 413 }; }
      chunks.push(value);
    }
    text = Buffer.concat(chunks).toString('utf8');
  } else {
    text = await r.text();
    if (text.length > MAX_BYTES) text = text.slice(0, MAX_BYTES);
  }
  try { return { json: JSON.parse(text) }; }
  catch (e) { return { error: 'Could not parse the review provider response.', status: 502 }; }
}

// ─── Source fetchers ─────────────────────────────────────────────────────────
// Each: validate(id) → ok|err ; build(id,max) → url ; parse(json,id) → {business,rating,reviews}
// `parse` returns reviews already normalized to the widget's per-card shape.

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/; // safe for both providers' ids

const SOURCES = {
  feefo: {
    name: 'Feefo',
    valid: (id) => SLUG_RE.test(id),
    // Feefo mixes free-text reviews with rating-only ones (~1 in 3 has text),
    // so over-fetch and keep the text-bearing ones up to `max`.
    build: (id, max) => `https://api.feefo.com/api/20/reviews/all?merchant_identifier=${encodeURIComponent(id)}&page_size=${Math.min(100, Math.max(max, max * 4))}&sort=-created_date`,
    parse: (j, id) => {
      const out = [];
      const list = Array.isArray(j.reviews) ? j.reviews : [];
      for (const rv of list) {
        const svc = rv.service || {};
        const text = clip(svc.review || '', 1500);
        if (!text) continue; // drop rating-only service entries — no testimonial to show
        const rating = clampRating(svc.rating && svc.rating.rating);
        if (!rating) continue;
        out.push({
          id: String(svc.id || rv.url || (id + ':' + out.length)),
          author: clip((rv.customer && rv.customer.display_name) || 'Verified customer', 120),
          rating,
          text,
          date: toIsoDate(svc.created_at || rv.last_updated_date),
          source: 'feefo',
          photoUrl: '',
          hasPhoto: false,
          helpful: Number(svc.helpful_votes) || 0,
          reply: '',
          tags: Array.isArray(rv.products_purchased) ? rv.products_purchased.slice(0, 3).map(t => clip(t, 40)).filter(Boolean) : [],
        });
      }
      // Feefo's reviews/all summary carries the real TOTAL count but no average,
      // so report the true count and derive the average from the text-bearing
      // sample we fetched (can refine later via the dedicated summary endpoint).
      const meta = (j.summary && j.summary.meta) || {};
      const count = Number(meta.count) || out.length;
      const average = out.length ? clampRating(out.reduce((a, r) => a + r.rating, 0) / out.length) : 0;
      return { business: { id, name: id }, rating: { average, count }, reviews: out };
    },
  },

  reviewsio: {
    name: 'Reviews.io',
    valid: (id) => SLUG_RE.test(id) || /^[A-Za-z0-9.-]{1,120}$/.test(id), // stores can be a domain
    build: (id, max) => `https://api.reviews.io/merchant/reviews?store=${encodeURIComponent(id)}&per_page=${max}&sort=date_desc`,
    parse: (j, id) => {
      const out = [];
      const list = Array.isArray(j.reviews) ? j.reviews : [];
      for (const rv of list) {
        const rer = rv.reviewer || {};
        const author = clip([rer.first_name, rer.last_name].filter(Boolean).join(' ') || 'Verified customer', 120);
        const rating = clampRating(rv.rating);
        const text = clip(rv.comments || rv.title || '', 1500);
        if (!rating || !text) continue;
        const img = (Array.isArray(rv.images) && rv.images[0] && safeImg(rv.images[0].image)) || '';
        const reply = (Array.isArray(rv.replies) && rv.replies[0] && clip(rv.replies[0].comments || rv.replies[0].reply || '', 800)) || '';
        out.push({
          id: String(rv.store_review_id || (id + ':' + out.length)),
          author,
          rating,
          text,
          date: toIsoDate(rv.date_created),
          source: 'reviewsio',
          photoUrl: img,
          hasPhoto: !!img,
          helpful: 0,
          reply,
          tags: Array.isArray(rv.tags) ? rv.tags.slice(0, 3).map(t => clip(typeof t === 'string' ? t : (t && t.tag) || '', 40)).filter(Boolean) : [],
        });
      }
      const stats = j.stats || {};
      const average = clampRating(stats.average_rating);
      const count = Number(stats.total_reviews) || out.length;
      const name = clip(j.store || id, 120);
      return { business: { id, name }, rating: { average: average || (out.length ? clampRating(out.reduce((a, r) => a + r.rating, 0) / out.length) : 0), count }, reviews: out };
    },
  },
};

/** Shared entrypoint — used by the handler and unit-testable directly. */
export async function fetchSource(source, id, max) {
  const src = SOURCES[source];
  if (!src) return { error: 'Unknown review source.', status: 400 };
  if (!src.valid(id)) return { error: 'That identifier looks invalid.', status: 400 };
  const r = await fetchJson(src.build(id, max));
  if (r.error) return r;
  let parsed;
  try { parsed = src.parse(r.json, id); }
  catch (e) { return { error: 'Could not read the reviews from that provider.', status: 502 }; }
  if (!parsed.reviews.length) return { error: 'No published reviews found for that identifier.', status: 422 };
  parsed.reviews = parsed.reviews.slice(0, max);
  return { ok: true, source, ...parsed };
}

function fail(res, status, error) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json({ ok: false, error });
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') return fail(res, 405, 'Method not allowed');

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  if (rateLimited(ip)) return fail(res, 429, 'Too many requests — please slow down.');

  const source = String(req.query.source || '').trim().toLowerCase();
  const id = String(req.query.id || '').trim();
  if (!source) return fail(res, 400, 'A review source is required.');
  if (!SOURCES[source]) return fail(res, 400, 'That review source is not supported.');
  if (!id) return fail(res, 400, 'A business identifier is required.');
  if (id.length > 120) return fail(res, 400, 'Identifier is too long.');

  let max = parseInt(req.query.max, 10);
  if (!Number.isFinite(max)) max = 20;
  max = Math.max(1, Math.min(50, max));

  const result = await fetchSource(source, id, max);
  if (result.error) return fail(res, result.status || 502, result.error);

  // Reviews move slowly — 6h fresh, 1 day stale-while-revalidate keeps upstream
  // calls minimal while still feeling "live" (Elfsight refreshes ~72h).
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=21600, stale-while-revalidate=86400');
  return res.status(200).json({
    ok: true,
    source: result.source,
    business: result.business,
    rating: result.rating,
    count: result.reviews.length,
    reviews: result.reviews,
    updated: new Date().toISOString(),
  });
}
