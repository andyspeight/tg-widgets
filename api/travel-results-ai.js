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
 *      TRAI_ALLOWED_ORIGINS (optional, comma-separated extra demo origins).
 *      TRAI_MODEL / TRAI_TEMPERATURE (optional overrides; defaults below).
 *      AIRTABLE_PAT (the widget gate reads the Widgets + Clients tables).
 *
 * Origin policy (8 Sep 2026): demo origins (travelify.io, traveldemo.site,
 * vercel.app, TRAI_ALLOWED_ORIGINS) pass as before. Any other origin must send
 * a valid Travel Results AI widget id whose client's plan includes the widget
 * (gateWidget). Refusals are answered 403 WITH the CORS header so the widget
 * can read them, alert, and show its fallback honestly.
 *
 * Security: see travelgenix-security skill. All payload + message text is
 * treated as untrusted and only ever placed in the user role, never the system
 * prompt. Output is parsed against the supplied rid allowlist and length-capped.
 */
'use strict';

import { findOneByField } from './_lib/auth/airtable.js';
import { resolveClientPlan } from './_lib/auth/plan.js';
import { PLAN_WIDGET_LIMITS, canonicalisePlan } from './widget-config.js';

// Model and temperature can change without a deploy. Temperature is LOW on
// purpose (stability pass, 8 Sep 2026): at the default of 1.0 the same
// shortlist gave different picks on two runs, which read as "hit and miss".
const MODEL = process.env.TRAI_MODEL || 'claude-sonnet-4-6';
const TEMPERATURE = (() => {
  const t = parseFloat(process.env.TRAI_TEMPERATURE);
  return Number.isFinite(t) && t >= 0 && t <= 1 ? t : 0.2;
})();
const MAX_TOKENS = 700;
// The widget gives up at 18s. One attempt may take 12s; a second is tried only
// when the first failed fast (busy model, 5xx, network) and enough budget
// remains, so the server never keeps working on a call nobody is waiting for.
const ATTEMPT_TIMEOUT_MS = 12000;
const TOTAL_BUDGET_MS = 17000;
const RETRY_MIN_REMAINING_MS = 5000;
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

// ---- Widget gate ------------------------------------------------------------
// A call from anywhere other than the static demo origins must carry a valid
// Travel Results AI widget id whose owning client's plan includes the widget,
// judged by the SAME table the save-time gate uses. Lookup failures and
// legacy widgets with no owning client FAIL OPEN (mirrors widget-config);
// an unknown id, the wrong widget type or a plan that excludes the widget
// FAIL CLOSED. Verdicts are cached for ten minutes per instance.
const WIDGETS_TABLE = 'tblVAThVqAjqtria2';
const WF = { widgetId: 'fldxRWtizMv3Y57Ep', type: 'fldTmwmW7ZNOfxMsS', clientRecordId: 'fldXaQVeJuIJ51KY4' };
const WIDGET_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const GATE_TTL_MS = 10 * 60 * 1000;
const gateCache = new Map();

function selectName(v) { return (v && typeof v === 'object') ? String(v.name || '') : String(v || ''); }

export async function gateWidget(widgetId) {
  if (!widgetId) return { ok: false, reason: 'no_id' };
  if (!WIDGET_ID_RE.test(widgetId)) return { ok: false, reason: 'bad_id' };
  const hit = gateCache.get(widgetId);
  if (hit && Date.now() - hit.at < GATE_TTL_MS) return hit.verdict;
  let verdict;
  try {
    const rec = await findOneByField(WIDGETS_TABLE, WF.widgetId, widgetId);
    if (!rec) verdict = { ok: false, reason: 'not_found' };
    else if (selectName(rec.fields[WF.type]) !== 'Travel Results AI') verdict = { ok: false, reason: 'wrong_type' };
    else {
      const clientId = String(rec.fields[WF.clientRecordId] || '').trim();
      if (!clientId) verdict = { ok: true, reason: 'ok_unverified', note: 'no owning client on record' };
      else {
        const plan = canonicalisePlan(await resolveClientPlan(clientId));
        if (!plan) verdict = { ok: true, reason: 'ok_unverified', note: 'no plan resolved', clientId };
        else {
          const limit = (PLAN_WIDGET_LIMITS['Travel Results AI'] || {})[plan];
          verdict = limit === 0 ? { ok: false, reason: 'not_on_plan', plan, clientId } : { ok: true, reason: 'ok', plan, clientId };
        }
      }
    }
  } catch (e) {
    verdict = { ok: true, reason: 'ok_unverified', note: 'lookup failed: ' + String((e && e.message) || e).slice(0, 120) };
  }
  gateCache.set(widgetId, { at: Date.now(), verdict });
  return verdict;
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
// One attempt, one retry, inside the budget. Returns { res, attempts, last }.
async function callModel(apiKey, payload) {
  const started = Date.now();
  let attempts = 0, last = null;
  while (attempts < 2) {
    attempts++;
    const remaining = TOTAL_BUDGET_MS - (Date.now() - started);
    if (remaining <= 0) break;
    try {
      const ar = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(Math.min(ATTEMPT_TIMEOUT_MS, remaining))
      });
      if (ar.ok) return { res: ar, attempts, last };
      const t = await ar.text().catch(() => '');
      last = { status: ar.status, text: t.slice(0, 300) };
      const retryable = ar.status === 429 || ar.status === 529 || ar.status >= 500;
      if (!retryable) break;
    } catch (e) {
      last = { status: 0, text: String((e && e.name) || e).slice(0, 120) };
    }
    const left = TOTAL_BUDGET_MS - (Date.now() - started);
    if (attempts >= 2 || left < RETRY_MIN_REMAINING_MS) break;
    await new Promise(r => setTimeout(r, Math.min(800, left / 4)));
  }
  return { res: null, attempts, last };
}

// One structured line per call, so usage and quality can be read from the
// logs: how many were sent, how many came back, how many survived the rid
// check, how long it took, and where the fallback would have kicked in.
function logCall(fields) {
  try { console.log('[trai] ' + JSON.stringify(fields)); } catch (e) { /* never throw */ }
}

export default async function handler(req, res) {
  const rawOrigin = String(req.headers.origin || '');
  const staticOrigin = resolveOrigin(rawOrigin);

  // The preflight only asks whether the POST may be sent; the POST decides.
  // Echoing the origin here is what lets a client's own domain reach the
  // widget check below instead of being refused invisibly by the browser.
  if (req.method === 'OPTIONS') { setCors(res, rawOrigin || null); return res.status(204).end(); }
  if (req.method !== 'POST') { setCors(res, staticOrigin); return res.status(405).json({ error: 'Method not allowed' }); }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { setCors(res, staticOrigin); return res.status(400).json({ error: 'Invalid JSON' }); } }
  body = body || {};

  const widgetId = (typeof body.widgetId === 'string' && WIDGET_ID_RE.test(body.widgetId)) ? body.widgetId : '';
  const lang = typeof body.lang === 'string' ? body.lang.slice(0, 8) : '';
  const t0 = Date.now();

  // Origin policy: a demo origin passes as before; anything else (a client's
  // own domain, or no Origin at all) needs a widget id that passes the gate.
  // A refusal still carries the CORS header so the widget can READ the 403,
  // alert on it, and show its fallback honestly, instead of a silent block.
  let gate = null;
  if (!staticOrigin) {
    gate = await gateWidget(widgetId);
    if (!gate.ok) {
      setCors(res, rawOrigin || null);
      logCall({ ok: false, reason: 'refused', code: gate.reason, origin: rawOrigin || '(none)', widgetId: widgetId || '(none)', plan: gate.plan || '' });
      return res.status(403).json({ error: 'Origin not allowed for this widget', code: gate.reason });
    }
  }
  setCors(res, rawOrigin || null);

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

  const base = { widgetId: widgetId || '(none)', origin: rawOrigin || '(none)', gate: gate ? gate.reason : 'static', kind: criteria.searchType || 'accommodation', refine: !!message, shortlist: shortlist.length, lang, model: MODEL, temperature: TEMPERATURE };

  try {
    const { res: ar, attempts, last } = await callModel(apiKey, {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: [{ type: 'text', text: buildSystem(), cache_control: { type: 'ephemeral' } }],
      messages: messages
    });

    if (!ar) {
      console.error('[trai] anthropic error', last && last.status, last && last.text);
      logCall(Object.assign(base, { ok: false, reason: 'model', status: last && last.status, attempts, ms: Date.now() - t0 }));
      return res.status(502).json({ error: 'AI service unavailable' });
    }

    const data = await ar.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    const parsed = safeJson(text);
    if (!parsed) {
      console.error('[trai] could not parse model output');
      logCall(Object.assign(base, { ok: false, reason: 'parse', attempts, ms: Date.now() - t0, stop: data.stop_reason }));
      return res.status(502).json({ error: 'AI response error' });
    }

    const returned = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
    const recommendations = returned
      .filter(r => r && validRids.has(String(r.rid)))
      .slice(0, 6)
      .map(r => ({
        rid: String(r.rid),
        category: String(r.category || 'Suggested').slice(0, 40),
        reason: String(r.reason || '').slice(0, 300)
      }));

    const reply = typeof parsed.reply === 'string' ? parsed.reply.slice(0, 600) : '';
    const usage = data.usage || {};
    logCall(Object.assign(base, { ok: true, returned: returned.length, valid: recommendations.length, attempts, ms: Date.now() - t0, stop: data.stop_reason, inTok: usage.input_tokens, outTok: usage.output_tokens }));

    return res.status(200).json({ version: 1, searchSession: session, reply, recommendations });
  } catch (e) {
    console.error('[trai] handler error', e);
    logCall(Object.assign(base, { ok: false, reason: 'error', ms: Date.now() - t0, detail: String((e && e.message) || e).slice(0, 120) }));
    return res.status(500).json({ error: 'Internal error' });
  }
};
