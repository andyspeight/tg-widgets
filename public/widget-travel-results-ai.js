/**
 * Travelgenix — Travel Results AI concierge endpoint
 * POST /api/travel-results-ai
 *
 * Public (embedded on client sites) but Origin-allowlisted + rate limited.
 * Takes a pre-filtered, compressed accommodation shortlist + search criteria,
 * asks Claude to pick the best 4-6 for THIS trip, and supports conversational
 * refinement ("more central", "with a pool", "cheaper"). Returns structured
 * JSON only. Never trusts model output beyond an allowlist of supplied rids.
 *
 * Env: ANTHROPIC_API_KEY (required, already set in tg-widgets).
 *      UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (optional, rate limiting).
 *      TRAI_ALLOWED_ORIGINS (optional, comma-separated extra origins).
 *
 * Security: see travelgenix-security skill. All payload + message text is
 * treated as untrusted and only ever placed in the user role, never the system
 * prompt. Output is parsed against the supplied rid allowlist and length-capped.
 */
'use strict';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 700;
const MAX_SHORTLIST = 40;
const MAX_MESSAGE = 500;
const MAX_HISTORY = 8;

// ---- Origin allowlist -------------------------------------------------------
function resolveOrigin(origin) {
  if (!origin) return null;
  let host;
  try { host = new URL(origin).hostname; } catch (e) { return null; }
  const extra = (process.env.TRAI_ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const ok =
    extra.includes(origin) ||
    host === 'travelify.io' || host.endsWith('.travelify.io') ||
    host === 'traveldemo.site' || host.endsWith('.traveldemo.site') ||
    host.endsWith('.vercel.app');            // staging / demos
  return ok ? origin : null;
}

function setCors(res, origin) {
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// ---- Rate limiting (Upstash REST; degrades open if unconfigured) ------------
async function rateOk(key, limit, windowSec) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const tok = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) return true; // not configured — allow, but it should be set in prod
  try {
    const r = await fetch(url + '/incr/' + encodeURIComponent(key), {
      headers: { Authorization: 'Bearer ' + tok }
    });
    const j = await r.json();
    const n = j.result;
    if (n === 1) {
      await fetch(url + '/expire/' + encodeURIComponent(key) + '/' + windowSec, {
        headers: { Authorization: 'Bearer ' + tok }
      });
    }
    return n <= limit;
  } catch (e) {
    console.error('[trai] rate check failed', e);
    return true; // never block on limiter failure
  }
}

// ---- Prompt -----------------------------------------------------------------
function buildSystem() {
  return [
    'You are an expert travel concierge embedded on a holiday search results page.',
    'You receive a JSON object with the search "criteria" and a "shortlist" of accommodation options that have ALREADY been pre-filtered and scored. Each shortlist item uses short keys:',
    'rid=id, n=name, star=star rating (0 means unrated, not bad), p=total price for the stay, board=board basis, ref=refundable rate available, city=area, km=distance from the search centre, gf=goodFor tags, am=amenities, ta=[tripadvisor rating, review count], w=warnings, d=short description.',
    'Package keys (present only for package searches): pkg=1 means the price ALREADY INCLUDES flights (a holiday package, not hotel-only); op=tour operator; fl=included flight summary (e.g. "Jet2 \u00b7 Direct"); inc=package inclusions such as ATOL protection, coach transfers, baggage. The search criteria may also carry searchType, packagePrices and a shared flight summary.',
    '',
    'Your job: choose the 4 to 6 best options for THIS specific trip and party.',
    'If the customer sends a refinement message (e.g. "more central", "with a pool", "cheaper", "good for kids"), honour it: re-pick from the shortlist to match, and acknowledge it in one short sentence.',
    '',
    'Rules:',
    '- Only use rid values that appear in the shortlist. Never invent properties or rids.',
    '- Every reason must cite ONLY evidence present in the data (price, board, ref, star, ta, km, gf, am, w). Do not invent facts, availability, savings, or quality claims.',
    '- Never claim a feature or amenity unless it appears in that property\'s own am (amenities) or gf (goodFor) list. If a property does not list "pool", "spa", "beach", "parking", "wifi", etc., do NOT mention it for that property — describe only what is actually present, or speak generally about price/rating/location.',
    '- Do not state distances, ratings, prices or board types that are not in that item\'s data. When unsure, stay general rather than guessing.',
    '- When pkg=1 these are package prices that already include flights: present them as packages (not hotel-only), and you may cite op (operator), fl (flight) and inc (inclusions like ATOL) where present. Still never invent operator, flight, inclusions, distances, ratings or prices.',
    '- A higher price is not automatically worse; balance price against star, reviews, distance, refundability and fit for the party.',
    '- Flag genuine watch-outs from w (e.g. shared bathroom, dormitory, non-refundable only) where relevant.',
    '- Keep each reason to one sentence (about 12-18 words). Keep "reply" to one or two short sentences in a warm, plain, helpful voice.',
    '- Each reason must give a SPECIFIC, comparative reason this option suits THIS search (e.g. "Closest to the centre of your shortlist", "Best-reviewed option under your budget", "Only refundable 5-star here"). Do NOT restate the property name, and do NOT just repeat the star rating, price or review score on their own — those are already shown to the customer; add the insight behind them.',
    '',
    'Respond with ONLY a JSON object, no markdown, no preamble:',
    '{"reply":"...","recommendations":[{"rid":"...","category":"Best value|Best for families|Most central|Top reviewed|Premium pick|Best refundable|...","reason":"..."}]}'
  ].join('\n');
}

function trimCriteria(c) {
  return {
    locationName: c.locationName, checkinDate: c.checkinDate, checkoutDate: c.checkoutDate,
    nights: c.nights, passengers: c.passengers, rooms: c.rooms, boardBasis: c.boardBasis,
    refundableOnly: c.refundableOnly, minStarRating: c.minStarRating, currency: c.currency
  };
}

function safeJson(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  try { return JSON.parse(cleaned); } catch (e) { /* fall through */ }
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (e2) { /* ignore */ } }
  return null;
}

// ---- Handler ----------------------------------------------------------------
export default async function handler(req, res) {
  const origin = resolveOrigin(req.headers.origin);

  if (req.method === 'OPTIONS') { setCors(res, origin); return res.status(204).end(); }
  setCors(res, origin);

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (req.headers.origin && !origin) return res.status(403).json({ error: 'Origin not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: 'Invalid JSON' }); } }
  body = body || {};

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const session = typeof body.searchSession === 'string' ? body.searchSession.slice(0, 120) : '';

  if (!(await rateOk('trai:ip:' + ip, 60, 60))) return res.status(429).json({ error: 'Too many requests' });
  if (session && !(await rateOk('trai:s:' + session, 25, 60))) return res.status(429).json({ error: 'Too many requests' });

  const criteria = body.criteria && typeof body.criteria === 'object' ? body.criteria : null;
  let shortlist = Array.isArray(body.shortlist) ? body.shortlist.slice(0, MAX_SHORTLIST) : null;
  if (!criteria || !shortlist || !shortlist.length) {
    return res.status(400).json({ error: 'Missing criteria or shortlist' });
  }

  const message = typeof body.message === 'string' ? body.message.slice(0, MAX_MESSAGE) : '';
  const history = Array.isArray(body.history)
    ? body.history.slice(-MAX_HISTORY).map(h => ({
        role: h && h.role === 'assistant' ? 'assistant' : 'user',
        content: String((h && h.content) || '').slice(0, MAX_MESSAGE)
      })).filter(h => h.content)
    : [];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error('[trai] ANTHROPIC_API_KEY not set'); return res.status(500).json({ error: 'Server not configured' }); }

  const validRids = new Set(shortlist.map(s => String(s && s.rid)));
  const dataBlock = JSON.stringify({ criteria: trimCriteria(criteria), shortlist });
  const userContent = (message ? ('Customer refinement: ' + message + '\n\n') : 'Recommend the best options for this trip.\n\n')
    + 'Search data (JSON):\n' + dataBlock;
  const messages = history.concat([{ role: 'user', content: userContent }]);

  try {
    const ar = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: [{ type: 'text', text: buildSystem(), cache_control: { type: 'ephemeral' } }],
        messages: messages
      })
    });

    if (!ar.ok) {
      const t = await ar.text().catch(() => '');
      console.error('[trai] anthropic error', ar.status, t.slice(0, 300));
      return res.status(502).json({ error: 'AI service unavailable' });
    }

    const data = await ar.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    const parsed = safeJson(text);
    if (!parsed) { console.error('[trai] could not parse model output'); return res.status(502).json({ error: 'AI response error' }); }

    const recommendations = (Array.isArray(parsed.recommendations) ? parsed.recommendations : [])
      .filter(r => r && validRids.has(String(r.rid)))
      .slice(0, 6)
      .map(r => ({
        rid: String(r.rid),
        category: String(r.category || 'Suggested').slice(0, 40),
        reason: String(r.reason || '').slice(0, 300)
      }));

    const reply = typeof parsed.reply === 'string' ? parsed.reply.slice(0, 600) : '';

    return res.status(200).json({ version: 1, searchSession: session, reply, recommendations });
  } catch (e) {
    console.error('[trai] handler error', e);
    return res.status(500).json({ error: 'Internal error' });
  }
};
