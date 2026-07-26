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

// Mirrors the CHECK constraints on public.deals — anything else is rejected
// rather than passed through to the database.
const BOARDS = ['All inclusive', 'Ultra all inclusive', 'Full board', 'Half board',
  'Bed & breakfast', 'Self catering', 'Room only'];
const SORTS = ['recommended', 'price', 'discount', 'score', 'recent'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

/**
 * Turn a travel window into the short label the deal card shows.
 * Same year → "Sep – Nov 2026". Spanning years → "Sep 2026 – Mar 2027".
 */
function dateLabel(from, until) {
  const f = from ? new Date(from) : null;
  const u = until ? new Date(until) : null;
  const ok = (d) => d && !isNaN(d.getTime());
  if (!ok(f) && !ok(u)) return '';
  if (ok(f) && !ok(u)) return `From ${MONTHS[f.getUTCMonth()]} ${f.getUTCFullYear()}`;
  if (!ok(f) && ok(u)) return `Until ${MONTHS[u.getUTCMonth()]} ${u.getUTCFullYear()}`;
  const sameYear = f.getUTCFullYear() === u.getUTCFullYear();
  return sameYear
    ? `${MONTHS[f.getUTCMonth()]} – ${MONTHS[u.getUTCMonth()]} ${u.getUTCFullYear()}`
    : `${MONTHS[f.getUTCMonth()]} ${f.getUTCFullYear()} – ${MONTHS[u.getUTCMonth()]} ${u.getUTCFullYear()}`;
}

/** Database row → the shape the widget and consumer site read. */
function toDeal(r) {
  const airports = Array.isArray(r.departure_airports) ? r.departure_airports : [];
  const destination = [r.resort, r.country].filter(Boolean).join(', ');
  return {
    id: r.id,
    // card essentials — these key names are what widget-tripbuster.js expects
    title: r.title,
    destination,
    board: r.board_basis || '',
    nights: r.nights || null,
    airport: airports[0] || '',
    dates: dateLabel(r.travel_from, r.travel_until),
    priceFrom: r.price_from != null ? Number(r.price_from) : null,
    wasPrice: r.was_price != null ? Number(r.was_price) : null,
    currency: r.currency || 'GBP',
    image: r.hero_image_url || '',
    clickoutUrl: r.effective_clickout || '',
    atol: r.effective_atol || '',
    discount: r.discount_pct || 0,
    badge: Array.isArray(r.offer_badges) && r.offer_badges.length ? r.offer_badges[0] : '',

    // richer fields the consumer site uses
    strapline: r.strapline || '',
    country: r.country || '',
    region: r.region || '',
    resort: r.resort || '',
    accommodation: r.accommodation_name || '',
    starRating: r.star_rating || null,
    guestScore: r.guest_score != null ? Number(r.guest_score) : null,
    distanceToBeach: r.distance_to_beach || '',
    holidayType: r.holiday_type || '',
    allAirports: airports,
    facilities: Array.isArray(r.facilities) ? r.facilities : [],
    sellingPoints: Array.isArray(r.selling_points) ? r.selling_points : [],
    badges: Array.isArray(r.offer_badges) ? r.offer_badges : [],
    availability: r.availability_status || '',
    protection: r.effective_protection || '',
    agent: { name: r.agent_name || '', slug: r.agent_slug || '', town: r.agent_town || '' },

    // present only in compare mode: every agent advertising this same hotel
    agentCount: r.agentCount || 1,
    compare: Array.isArray(r.compare)
      ? r.compare.map((c) => ({
          dealId: c.dealId,
          agent: c.agent,
          agentSlug: c.agentSlug,
          atol: c.atol || '',
          price: c.price != null ? Number(c.price) : null,
          clickoutUrl: c.clickoutUrl || '',
        }))
      : undefined,
  };
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
