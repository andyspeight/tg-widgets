/**
 * Tripbuster public deals API
 * GET /api/tripbuster/deals
 *
 * One read path for every consumer surface:
 *   • the embeddable widget's per-agent feed   ?agent=sunseeker-travel
 *   • the consumer site's search results       ?country=Spain&maxPrice=400&compare=1
 *   • the deal page's multi-agent compare      ?resort=Benidorm&compare=1
 *
 * Public and CDN-cacheable: it returns nothing but deals agents have chosen to
 * advertise. No auth, no PII, so a wildcard CORS origin is correct here — the
 * widget runs on customer sites and must be able to fetch it.
 *
 * All filtering happens inside the tb_search_deals Postgres function with bound
 * parameters. This layer validates and clamps input, then maps the database's
 * snake_case rows onto the camelCase shape widget-tripbuster.js consumes.
 */
import { setCors } from '../_auth.js';
import { evaluatePublicRateLimit } from '../_lib/rate-limit-public.js';
import { tbConfigured, tbRpc } from '../_lib/tripbuster/db.js';
import { toDeal } from '../_lib/tripbuster/deal-view.js';

// Mirrors the CHECK constraints on public.deals — anything else is rejected
// rather than passed through to the database.
const BOARDS = ['All inclusive', 'Ultra all inclusive', 'Full board', 'Half board',
  'Bed & breakfast', 'Self catering', 'Room only'];
const SORTS = ['recommended', 'price', 'discount', 'score', 'recent'];
const HOLIDAY_TYPES = ['Package holiday', 'Hotel only', 'Flight + hotel', 'City break',
  'Cruise', 'Escorted tour', 'Flight only'];

/** Trim, drop empties, and cap length so nothing unbounded reaches the database. */
function str(v, max = 80) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  return s.slice(0, max);
}

function int(v, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

function money(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(n, 100000);
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rl = await evaluatePublicRateLimit(req, res, {
    event: 'tb-deals',
    widgetId: typeof req.query.agent === 'string' ? req.query.agent : '',
  });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });

  if (!tbConfigured()) {
    // Deployed before the env vars land: say so honestly rather than 500.
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'Deals service not configured yet', deals: [], total: 0 });
  }

  const q = req.query || {};
  const board = str(q.board, 40);
  const sort = str(q.sort, 20);
  const holidayType = str(q.holidayType, 40);

  const args = {
    p_agent_slug: str(q.agent, 80),
    p_q: str(q.q, 120),
    p_country: str(q.country, 80),
    p_resort: str(q.resort, 80),
    p_board: BOARDS.includes(board) ? board : null,
    p_airport: str(q.airport, 80),
    p_min_price: money(q.minPrice),
    p_max_price: money(q.maxPrice),
    p_nights: int(q.nights, 1, 60),
    p_sort: SORTS.includes(sort) ? sort : 'recommended',
    p_compare: q.compare === '1' || q.compare === 'true',
    // One deal and every agent advertising the same hotel. This is what the
    // deal page asks for; before it existed the page pulled sixty deals and
    // searched the response, which quietly broke past sixty live deals.
    p_deal_slug: str(q.slug, 140),
    p_holiday_type: HOLIDAY_TYPES.includes(holidayType) ? holidayType : null,
    p_limit: int(q.limit, 1, 60) ?? 24,
    p_offset: int(q.offset, 0, 5000) ?? 0,
  };

  try {
    const data = await tbRpc('tb_search_deals', args);
    const rows = Array.isArray(data && data.deals) ? data.deals : [];
    const payload = {
      deals: rows.map(toDeal),
      total: Number(data && data.total) || 0,
      limit: Number(data && data.limit) || args.p_limit,
      offset: Number(data && data.offset) || args.p_offset,
      compare: !!(data && data.compare),
    };

    // Deals change on the order of minutes, not seconds. Cache at the edge and
    // serve stale while revalidating so a traffic spike never reaches Postgres.
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(payload);
  } catch (e) {
    // Generic body, detail already logged in the db helper.
    console.error('[tripbuster/deals] failed', e && e.code, e && e.message);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'Could not load deals', deals: [], total: 0 });
  }
}
