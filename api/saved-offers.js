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

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function genId() {
  // Hyphen/underscore-free (base62) so the id can sit at the end of a readable
  // slug URL (/offer/<slug>-<id>) and be recovered as the final '-' token.
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += ID_ALPHABET[bytes[i] % 62];
  return out; // 12 chars, [A-Za-z0-9]
}

// Reserve a brand-new id that is not already in use. genId() is random base62
// (collision odds are astronomically small), but import must NEVER overwrite an
// existing offer, so we make the guarantee explicit: try a few ids and only
// return one that maps to no stored record. Returns '' if none is free (never
// happens in practice) so the caller skips rather than risking an overwrite.
async function reserveNewId(maxTries = 6) {
  for (let i = 0; i < maxTries; i++) {
    const id = genId();
    const existing = await getJson('offer:' + id);
    if (!existing) return id;
  }
  return '';
}

// Cosmetic slug from the offer title. Lowercase ascii words joined by hyphens.
function slugify(s) {
  return String(s == null ? '' : s)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60).replace(/-+$/, '');
}

// The shareable path for a saved offer: /offer/<slug>-<id>, or /offer/<id> when
// the title yields no slug. Lookups use the id only, so the link survives an
// edit to the title.
function offerUrl(id, title) {
  const slug = slugify(title);
  return '/offer/' + (slug ? slug + '-' : '') + id;
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

  // i18n — saved per-language content translations (Layer 2). Whitelisted to
  // known language codes and known field keys only, capped to the same lengths
  // as the source fields, so saved translations survive a round-trip without
  // letting unbounded data into the record. Omitted entirely when empty so
  // existing offers are unchanged.
  const I18N_FIELD_CAP = { title: 120, teaser: 220, description: 5000, urgency: 140, avail: 140 };
  const i18n = {};
  const rawI18n = (s.i18n && typeof s.i18n === 'object' && !Array.isArray(s.i18n)) ? s.i18n : {};
  let langN = 0;
  for (const lang of Object.keys(rawI18n)) {
    if (langN >= 12) break;
    if (!/^[a-z]{2}$/.test(lang)) continue;
    const li = (rawI18n[lang] && typeof rawI18n[lang] === 'object' && !Array.isArray(rawI18n[lang])) ? rawI18n[lang] : {};
    const lf = {};
    const srcLf = (li.fields && typeof li.fields === 'object' && !Array.isArray(li.fields)) ? li.fields : {};
    for (const k of Object.keys(I18N_FIELD_CAP)) {
      if (typeof srcLf[k] === 'string' && srcLf[k]) lf[k] = srcLf[k].slice(0, I18N_FIELD_CAP[k]);
    }
    const entry = {};
    if (Object.keys(lf).length) entry.fields = lf;
    const inc = strArr(li.includes, 40, 200);
    if (inc.length) entry.includes = inc;
    const tg = strArr(li.tags, 30, 60);
    if (tg.length) entry.tags = tg;
    if (Object.keys(entry).length) { i18n[lang] = entry; langN++; }
  }

  const out = {
    currency: cap(s.currency, 8),
    fields: fields,
    includes: strArr(s.includes, 40, 200),
    tags: strArr(s.tags, 30, 60),
    images: strArr(s.images, 20, 1000)
  };
  if (Object.keys(i18n).length) out.i18n = i18n;
  return out;
}

// Is an offer within its show window? (UTC day granularity; the card/page also
// re-check in the viewer's local time and self-hide, so this is the gate that
// keeps scheduled/ended offers out of the public feed.)
function isLiveOffer(offer) {
  const f = (offer && offer.fields) || {};
  const day = (s) => {
    if (!s) return null;
    const m = String(s).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
    const t = Date.parse(s);
    return isFinite(t) ? t : null;
  };
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const from = day(f.showFrom), until = day(f.showUntil);
  if (from !== null && today < from) return false;
  if (until !== null && today > until) return false;
  return true;
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

// ── Soft delete (Recently deleted bin) ──────────────────────────
// Deleting an offer does not destroy it: we stamp `deletedAt`, drop it from the
// owner's live index and add it to a trash index. It then disappears from the
// list, the public feed and its own page, but can be restored for 30 days. After
// that it is purged (lazily, when the trash is next listed, or on an explicit
// "delete forever"). Index keys: live = offers:idx:<ownerKey>, trash =
// offers:trash:<ownerKey>.
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const TRASH_RETENTION_DAYS = 30;

function summariseTrash(rec) {
  const s = summarise(rec);
  s.deletedAt = rec.deletedAt || 0;
  return s;
}

async function softDeleteOffer(id, ck, user) {
  const rec = await getJson('offer:' + id);
  if (!rec) return 'missing';
  if (rec.ownerKey !== ck && !isStaff(user)) return 'forbidden';
  const ok = rec.ownerKey || ck;
  if (!rec.deletedAt) {
    rec.deletedAt = Date.now();
    await setJson('offer:' + id, rec);
    await zadd('offers:trash:' + ok, rec.deletedAt, id);
  }
  await zrem('offers:idx:' + ok, id); // out of the live list either way
  return 'ok';
}

async function restoreOffer(id, ck, user) {
  const rec = await getJson('offer:' + id);
  if (!rec) return 'missing';
  if (rec.ownerKey !== ck && !isStaff(user)) return 'forbidden';
  const ok = rec.ownerKey || ck;
  if (rec.deletedAt) {
    delete rec.deletedAt;
    if (!rec.updatedAt) rec.updatedAt = Date.now();
    await setJson('offer:' + id, rec);
  }
  await zrem('offers:trash:' + ok, id);
  await zadd('offers:idx:' + ok, rec.updatedAt || Date.now(), id);
  return 'ok';
}

async function purgeOffer(id, ck, user) {
  const rec = await getJson('offer:' + id);
  if (!rec) return 'ok'; // already gone — idempotent
  if (rec.ownerKey !== ck && !isStaff(user)) return 'forbidden';
  const ok = rec.ownerKey || ck;
  await del('offer:' + id);
  await zrem('offers:trash:' + ok, id);
  await zrem('offers:idx:' + ok, id);
  return 'ok';
}

// Parse + dedupe + cap a comma list of ids from the query string.
function idsFromQuery(raw, cap = 200) {
  return [...new Set(String(raw || '').split(',').map((s) => s.trim()).filter(Boolean))].slice(0, cap);
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
      if (!rec || !rec.offer || rec.deletedAt) return res.status(404).json({ error: 'Offer not found.' });
      res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');
      return res.status(200).json({ id: id, offer: rec.offer });
    }

    // ── Public feed: a client's live offers (powers the offers grid embed) ──
    if (req.method === 'GET' && req.query && req.query.client) {
      const client = String(req.query.client);
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(client)) return res.status(400).json({ error: 'Bad client.' });
      res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
      if (!configured()) return res.status(200).json({ offers: [] });
      const ids = await zrangebyscore('offers:idx:c:' + client, '-inf', '+inf');
      const recent = (ids || []).reverse().slice(0, 100);
      const out = [];
      for (const id of recent) {
        const rec = await getJson('offer:' + id);
        if (rec && rec.offer && !rec.deletedAt && isLiveOffer(rec.offer)) out.push({ id: id, offer: rec.offer });
      }
      return res.status(200).json({ offers: out });
    }

    // ── Everything else needs a session ───────────────────────
    const auth = requireAuth(req);
    if (auth.error) return res.status(auth.status || 401).json({ error: auth.error });
    const user = auth.user;
    const ck = clientKeyOf(user);
    if (!ck) return res.status(403).json({ error: 'No client on this session.' });

    // ── Recently deleted bin (lazy-purges entries older than 30 days) ──
    if (req.method === 'GET' && req.query && req.query.trash) {
      if (!applyRateLimit(res, 'offers:trash:' + ck, RATE_LIMITS.widgetRead)) return;
      if (!configured()) return res.status(200).json({ offers: [], retentionDays: TRASH_RETENTION_DAYS });
      const ids = await zrangebyscore('offers:trash:' + ck, '-inf', '+inf');
      const recent = (ids || []).reverse().slice(0, MAX_LIST);
      const now = Date.now();
      const offers = [];
      for (const id of recent) {
        const rec = await getJson('offer:' + id);
        if (!rec || !rec.offer || !rec.deletedAt) { await zrem('offers:trash:' + ck, id); continue; }
        if (now - rec.deletedAt > TRASH_RETENTION_MS) { await del('offer:' + id); await zrem('offers:trash:' + ck, id); continue; }
        offers.push(summariseTrash(rec));
      }
      return res.status(200).json({ offers: offers, retentionDays: TRASH_RETENTION_DAYS });
    }

    // ── List this client's offers ─────────────────────────────
    if (req.method === 'GET') {
      if (!applyRateLimit(res, 'offers:list:' + ck, RATE_LIMITS.widgetRead)) return;
      if (!configured()) return res.status(200).json({ offers: [] });
      const ids = await zrangebyscore('offers:idx:' + ck, '-inf', '+inf');
      const recent = (ids || []).reverse().slice(0, MAX_LIST);
      const offers = [];
      for (const id of recent) {
        const rec = await getJson('offer:' + id);
        if (rec && rec.offer && !rec.deletedAt) offers.push(summarise(rec));
      }
      // feedKey is the public client id the offers-grid embed uses (when present).
      return res.status(200).json({ offers: offers, feedKey: user.clientId || '' });
    }

    // ── Create or update ──────────────────────────────────────
    if (req.method === 'POST') {
      if (!applyRateLimit(res, 'offers:write:' + ck, RATE_LIMITS.widgetWrite)) return;
      if (!configured()) return res.status(503).json({ error: 'Offer storage is not configured.' });

      const body = readBody(req);
      if (!body) return res.status(400).json({ error: 'Body is not valid JSON.' });

      // ── Restore from the Recently deleted bin: { restore: [ids] } ──
      if (Array.isArray(body.restore)) {
        const ids = [...new Set(body.restore.filter((x) => typeof x === 'string').map((s) => s.trim()).filter(Boolean))].slice(0, 200);
        let restored = 0, skipped = 0;
        for (const rid of ids) {
          if (!ID_RE.test(rid)) { skipped++; continue; }
          const r = await restoreOffer(rid, ck, user);
          if (r === 'ok') restored++; else skipped++;
        }
        return res.status(200).json({ ok: true, restored, skipped });
      }

      // ── Bulk import: { offers: [ ... ] } (spreadsheet upload) ──
      if (Array.isArray(body.offers)) {
        const MAX_BULK = 200;
        const batch = body.offers.slice(0, MAX_BULK);
        const now = Date.now();
        const ids = [];
        let skipped = 0;
        for (let i = 0; i < batch.length; i++) {
          const cleaned = cleanOffer(batch[i]);
          if (!cleaned || !cleaned.fields || !Object.keys(cleaned.fields).length || JSON.stringify(cleaned).length > MAX_OFFER_BYTES) { skipped++; continue; }
          // Import only ever CREATES offers — a fresh, guaranteed-unused id per
          // row — so it can never overwrite an existing offer. Any id on the
          // incoming row is ignored by design.
          const id = await reserveNewId();
          if (!id) { skipped++; continue; }
          const ts = now + i; // distinct scores keep import order in the index
          const ok = await setJson('offer:' + id, {
            id: id, offer: cleaned, ownerKey: ck, ownerEmail: user.email || '',
            clientId: user.clientId || '', createdAt: ts, updatedAt: ts
          });
          if (!ok) { skipped++; continue; }
          await zadd('offers:idx:' + ck, ts, id);
          ids.push(id);
        }
        return res.status(200).json({ saved: ids.length, skipped: skipped, ids: ids });
      }

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
        id = await reserveNewId();
        if (!id) return res.status(503).json({ error: 'Could not allocate an offer id. Please try again.' });
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

      return res.status(200).json({ id: id, url: offerUrl(id, offer.fields && offer.fields.title) });
    }

    // ── Delete ────────────────────────────────────────────────
    // Default is a SOFT delete: the offer moves to the Recently deleted bin and
    // can be restored for 30 days. ?permanent=1 hard-deletes (used by the bin's
    // "delete forever" / "empty bin"). Accepts ?id= (one) or ?ids=a,b (bulk).
    // Each id is independently ownership-checked; ids not owned or already gone
    // are skipped rather than failing the whole request.
    if (req.method === 'DELETE') {
      if (!applyRateLimit(res, 'offers:write:' + ck, RATE_LIMITS.widgetWrite)) return;
      if (!configured()) return res.status(503).json({ error: 'Offer storage is not configured.' });

      const permanent = !!(req.query && (req.query.permanent === '1' || req.query.permanent === 'true'));
      let ids;
      if (req.query && req.query.ids) ids = idsFromQuery(req.query.ids);
      else if (req.query && req.query.id) ids = idsFromQuery(req.query.id, 1);
      else return res.status(400).json({ error: 'No offer id given.' });
      if (!ids.length) return res.status(400).json({ error: 'No valid offer id given.' });

      let done = 0, skipped = 0;
      for (const did of ids) {
        if (!ID_RE.test(did)) { skipped++; continue; }
        const r = permanent ? await purgeOffer(did, ck, user) : await softDeleteOffer(did, ck, user);
        if (r === 'ok') done++; else skipped++;
      }
      return res.status(200).json(permanent
        ? { ok: true, purged: done, skipped }
        : { ok: true, trashed: done, skipped });
    }

    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    console.error('[saved-offers] error', err && err.message);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
}

// Exported for unit tests.
export const _test = { cleanOffer, genId, ID_RE, clientKeyOf, isStaff, summarise, summariseTrash, isLiveOffer, slugify, offerUrl, idsFromQuery, TRASH_RETENTION_MS, TRASH_RETENTION_DAYS };
