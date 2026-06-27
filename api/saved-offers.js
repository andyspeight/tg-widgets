/**
 * Saved Offers API  ·  storage for hand-built special offers
 *
 *   GET    /api/saved-offers?id=OFFER_ID  → PUBLIC, returns the offer JSON
 *                                            (cached). Powers /offer and cards.
 *   GET    /api/saved-offers              → AUTH, lists the signed-in client's
 *                                            offers (summaries, recent first).
 *   POST   /api/saved-offers              → AUTH, creates or updates an offer.
 *                                            Body: { id?, offer }. Returns
 *                                            { id, url }.
 *   DELETE /api/saved-offers?id=OFFER_ID  → AUTH, deletes an offer the client
 *                                            owns.
 *
 * (Distinct from /api/offers, which proxies the live Travelify offers cache.)
 *
 * Store: Upstash Redis (api/_redis.js). One JSON record per offer at
 * `offer:<id>`, plus a per-client recency index (sorted set) at
 * `offers:idx:<clientKey>` (score = updatedAt, member = id).
 *
 * Security (travelgenix-security):
 *   - GET by id is public (cards/pages must load without a session); the public
 *     payload never includes owner/client internals.
 *   - List, save and delete require a valid session (requireAuth) and are
 *     rate-limited. Save/delete enforce ownership (client scope), staff bypass.
 *   - Offer input is whitelisted to a bounded shape, proto-pollution and
 *     <script> scrubbed (sanitiseConfig), and size-capped. Ids are validated
 *     against a strict pattern before they ever touch a Redis key.
 *   - Fails closed: storage unconfigured → 503 on writes, 404 on reads.
 */
import crypto from 'crypto';
import { requireAuth, applyRateLimit, RATE_LIMITS, setCors, sanitiseConfig } from './_auth.js';
import { configured, getJson, setJson, del, zadd, zrangebyscore, zrem } from './_redis.js';

const ID_RE = /^[A-Za-z0-9_-]{6,40}$/;
const MAX_OFFER_BYTES = 48 * 1024;
const MAX_LIST = 300;

function genId() {
  return crypto.randomBytes(9).toString('base64url'); // 12 url-safe chars
}
function clientKeyOf(user) {
  if (user.clientId) return 'c:' + user.clientId;
  if (user.email) return 'e:' + String(user.email).toLowerCase();
  return '';
}
function isStaff(user) {
  const e = String(user.email || '').toLowerCase();
  if (/@travelgenix\.|@agendas\.group$/.test(e)) return true;
  const r = String(user.role || '').toLowerCase();
  return r === 'staff' || r === 'admin';
}

// Whitelist an offer to a small, bounded shape. Returns a clean object.
function cleanOffer(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const s = sanitiseConfig(raw); // deep clone + scrub __proto__/constructor + <script>
  const cap = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const strArr = (a, items, len) => Array.isArray(a)
    ? a.filter((x) => typeof x === 'string').slice(0, items).map((x) => x.slice(0, len))
    : [];

  const fields = {};
  const src = (s.fields && typeof s.fields === 'object' && !Array.isArray(s.fields)) ? s.fields : {};
  let n = 0;
  for (const k of Object.keys(src)) {
    if (n >= 100) break;
    if (!/^[A-Za-z0-9_]{1,40}$/.test(k)) continue;
    const v = src[k];
    if (typeof v === 'string') { fields[k] = v.slice(0, 5000); n++; }
    else if (typeof v === 'number' && isFinite(v)) { fields[k] = String(v); n++; }
  }

  return {
    currency: cap(s.currency, 8),
    fields: fields,
    includes: strArr(s.includes, 40, 200),
    tags: strArr(s.tags, 30, 60),
    images: strArr(s.images, 20, 1000)
  };
}

function summarise(rec) {
  const f = (rec.offer && rec.offer.fields) || {};
  return {
    id: rec.id,
    title: f.title || '',
    price: f.price || '',
    currency: (rec.offer && rec.offer.currency) || '',
    showFrom: f.showFrom || '',
    showUntil: f.showUntil || '',
    updatedAt: rec.updatedAt || 0
  };
}

function readBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { return null; } }
  return (b && typeof b === 'object') ? b : null;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    // ── Public read by id ──────────────────────────────────────
    if (req.method === 'GET' && req.query && req.query.id) {
      const id = String(req.query.id);
      if (!ID_RE.test(id)) return res.status(400).json({ error: 'Bad offer id.' });
      if (!configured()) return res.status(404).json({ error: 'Offer not found.' });
      const rec = await getJson('offer:' + id);
      if (!rec || !rec.offer) return res.status(404).json({ error: 'Offer not found.' });
      res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');
      return res.status(200).json({ id: id, offer: rec.offer });
    }

    // ── Everything else needs a session ───────────────────────
    const auth = requireAuth(req);
    if (auth.error) return res.status(auth.status || 401).json({ error: auth.error });
    const user = auth.user;
    const ck = clientKeyOf(user);
    if (!ck) return res.status(403).json({ error: 'No client on this session.' });

    // ── List this client's offers ─────────────────────────────
    if (req.method === 'GET') {
      if (!applyRateLimit(res, 'offers:list:' + ck, RATE_LIMITS.widgetRead)) return;
      if (!configured()) return res.status(200).json({ offers: [] });
      const ids = await zrangebyscore('offers:idx:' + ck, '-inf', '+inf');
      const recent = (ids || []).reverse().slice(0, MAX_LIST);
      const offers = [];
      for (const id of recent) {
        const rec = await getJson('offer:' + id);
        if (rec && rec.offer) offers.push(summarise(rec));
      }
      return res.status(200).json({ offers: offers });
    }

    // ── Create or update ──────────────────────────────────────
    if (req.method === 'POST') {
      if (!applyRateLimit(res, 'offers:write:' + ck, RATE_LIMITS.widgetWrite)) return;
      if (!configured()) return res.status(503).json({ error: 'Offer storage is not configured.' });

      const body = readBody(req);
      if (!body) return res.status(400).json({ error: 'Body is not valid JSON.' });
      const offer = cleanOffer(body.offer);
      if (!offer || !offer.fields || !Object.keys(offer.fields).length) {
        return res.status(400).json({ error: 'Offer is missing or empty.' });
      }
      if (JSON.stringify(offer).length > MAX_OFFER_BYTES) {
        return res.status(413).json({ error: 'Offer is too large. Trim the description or images.' });
      }

      const now = Date.now();
      let id = body.id ? String(body.id) : '';
      let createdAt = now;

      if (id) {
        if (!ID_RE.test(id)) return res.status(400).json({ error: 'Bad offer id.' });
        const existing = await getJson('offer:' + id);
        if (!existing) return res.status(404).json({ error: 'Offer not found.' });
        if (existing.ownerKey !== ck && !isStaff(user)) {
          return res.status(403).json({ error: 'You do not own this offer.' });
        }
        createdAt = existing.createdAt || now;
      } else {
        id = genId();
      }

      const record = {
        id: id,
        offer: offer,
        ownerKey: ck,
        ownerEmail: user.email || '',
        clientId: user.clientId || '',
        createdAt: createdAt,
        updatedAt: now
      };
      const ok = await setJson('offer:' + id, record);
      if (!ok) return res.status(502).json({ error: 'Could not save the offer. Please try again.' });
      await zadd('offers:idx:' + ck, now, id);

      return res.status(200).json({ id: id, url: '/offer?id=' + id });
    }

    // ── Delete ────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      if (!applyRateLimit(res, 'offers:write:' + ck, RATE_LIMITS.widgetWrite)) return;
      if (!configured()) return res.status(503).json({ error: 'Offer storage is not configured.' });
      const id = req.query && req.query.id ? String(req.query.id) : '';
      if (!ID_RE.test(id)) return res.status(400).json({ error: 'Bad offer id.' });
      const existing = await getJson('offer:' + id);
      if (!existing) return res.status(404).json({ error: 'Offer not found.' });
      if (existing.ownerKey !== ck && !isStaff(user)) {
        return res.status(403).json({ error: 'You do not own this offer.' });
      }
      await del('offer:' + id);
      await zrem('offers:idx:' + ck, id);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    console.error('[saved-offers] error', err && err.message);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
}

// Exported for unit tests.
export const _test = { cleanOffer, genId, ID_RE, clientKeyOf, isStaff, summarise };
