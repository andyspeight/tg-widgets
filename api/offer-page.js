/**
 * Offer Page (server-rendered)  ·  GET /offer?id=…  (public)
 *
 * Serves the public special-offer page. This is a serverless function rather than
 * a static file for ONE reason: social and search crawlers (WhatsApp, Facebook,
 * LinkedIn, Slack, iMessage, Google) do not run JavaScript, so Open Graph and
 * Twitter Card meta must be present in the HTML the server returns. We resolve the
 * offer here and inject the title, description and cover image into <head>, then
 * hand off to the same client widget (widget-offer-page.js) for the rich render.
 *
 * Query: ?id=<savedId>  → load the stored offer (the production share link)
 *        ?data=<b64url> → an inline offer (throwaway preview link)
 *        plus optional template / theme / accent / agency passthrough.
 *
 * To save the client a second round trip, the resolved offer is embedded as inert
 * JSON (<script type="application/json">) and the bootstrap reads it; if it is
 * absent (storage hiccup) the bootstrap falls back to fetching by id as before.
 *
 * Security: the offer is UNTRUSTED stored content. Every value injected into the
 * HTML is escaped for its context (HTML text, attribute, or JSON), the cover
 * image URL is validated to http(s) with no breakout characters, and the embedded
 * JSON has its closing-tag sequence neutralised. Out-of-window offers render
 * generic meta so an ended deal does not leak its details to a crawler.
 *
 * Env: UPSTASH_* (offer storage); OFFER_PAGE_BASE_URL (optional absolute base for
 *      og:url / canonical, e.g. https://offers.travelify.io).
 */
import { configured, getJson } from './_redis.js';

const ID_RE = /^[A-Za-z0-9_-]{6,40}$/;
const TEMPLATES = ['classic', 'editorial', 'immersive'];
const CURRENCY = { GBP: '£', EUR: '€', USD: '$', AUD: '$', CAD: '$' };

const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const escAttr = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Inert JSON embed: stop a stored "</script>" from closing our tag, and escape
// the line separators that are legal in JSON but illegal in a script body.
const escJson = (obj) => JSON.stringify(obj)
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

function safeImg(u) {
  u = String(u == null ? '' : u).trim();
  if (!/^https?:\/\//i.test(u)) return '';
  if (/[\s"'()<>\\]/.test(u) || u.length > 600) return '';
  return u;
}

// Cosmetic slug from a title (matches saved-offers.slugify) — used for og:url.
function slugify(s) {
  return String(s == null ? '' : s)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
}

// Recover the offer id from a /offer/<slug>-<id> path segment. New ids are
// hyphen-free, so the final '-' token is the id; we also try the whole segment
// (covers an id pasted directly with no slug prefix).
function idsFromSlugid(slugid) {
  const s = String(slugid || '');
  const out = [];
  const tail = s.split('-').pop();
  if (ID_RE.test(tail)) out.push(tail);
  if (s !== tail && ID_RE.test(s)) out.push(s);
  return out;
}

function decodeData(data) {
  try {
    const json = Buffer.from(String(data).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const obj = JSON.parse(json);
    return (obj && typeof obj === 'object') ? obj : null;
  } catch { return null; }
}

// Day-granularity show-window check (mirrors saved-offers.isLiveOffer).
function inWindow(offer) {
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

// Build the social/search meta from a live offer.
function metaFrom(offer) {
  const f = (offer && offer.fields) || {};
  const title = (f.title ? String(f.title).slice(0, 120) : 'Special offer');
  const sym = CURRENCY[String(offer && offer.currency || 'GBP').toUpperCase()] || '£';
  const priceLine = f.price ? ('From ' + sym + String(f.price).replace(/[^0-9.,]/g, '') + (f.basis ? ' ' + f.basis : '')) : '';
  let desc = f.teaser || '';
  if (!desc && f.description) desc = String(f.description).split('\n')[0];
  desc = String(desc || '').slice(0, 200);
  if (priceLine) desc = desc ? (desc + ' · ' + priceLine) : priceLine;
  if (!desc) desc = 'A handpicked travel offer.';
  const images = Array.isArray(offer && offer.images) ? offer.images : [];
  const image = safeImg(images[0]);
  return { title, desc, image };
}

function pageHtml({ meta, ogUrl, bootstrap, cfg }) {
  const og = meta;
  const imgTags = og.image
    ? '<meta property="og:image" content="' + escAttr(og.image) + '" />\n<meta name="twitter:image" content="' + escAttr(og.image) + '" />\n<meta name="twitter:card" content="summary_large_image" />'
    : '<meta name="twitter:card" content="summary" />';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escHtml(og.title)} · Travelgenix</title>
<meta name="description" content="${escAttr(og.desc)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Travelgenix" />
<meta property="og:title" content="${escAttr(og.title)}" />
<meta property="og:description" content="${escAttr(og.desc)}" />
${ogUrl ? '<meta property="og:url" content="' + escAttr(ogUrl) + '" />\n<link rel="canonical" href="' + escAttr(ogUrl) + '" />' : ''}
<meta name="twitter:title" content="${escAttr(og.title)}" />
<meta name="twitter:description" content="${escAttr(og.desc)}" />
${imgTags}
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fff; color: #0F172A; }
  .of-fallback { min-height: 80vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 40px 24px; gap: 8px; }
  .of-fallback .ic { width: 64px; height: 64px; border-radius: 50%; background: #F1F5F9; color: #94A3B8; display: flex; align-items: center; justify-content: center; margin-bottom: 8px; }
  .of-fallback h1 { font-size: 24px; font-weight: 800; margin: 0; }
  .of-fallback p { color: #64748B; font-size: 15px; margin: 0; max-width: 40ch; }
  .of-fallback a { margin-top: 14px; color: #0096B7; font-weight: 600; text-decoration: none; }
</style>
</head>
<body>
  <div id="mount"></div>
  <script type="application/json" id="tg-offer-bootstrap">${bootstrap}</script>
  <script src="/widget-maps.js"></script>
  <script src="/widget-offer-page.js"></script>
  <script>
    (function () {
      var mount = document.getElementById('mount');
      function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
      function fallback(title, msg) {
        mount.innerHTML = '<div class="of-fallback"><div class="ic">'
          + '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>'
          + '</div><h1>' + esc(title) + '</h1><p>' + esc(msg) + '</p></div>';
      }
      function b64urlDecode(b) { b = String(b).replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '='; return decodeURIComponent(escape(atob(b))); }

      var boot = null;
      try { boot = JSON.parse(document.getElementById('tg-offer-bootstrap').textContent || 'null'); } catch (e) { boot = null; }
      var params = new URLSearchParams(location.search);
      var cfg = ${escJson(cfg)};

      function mountOffer(offer, offerId) {
        cfg.offer = offer;
        if (offerId) cfg.offerId = offerId;
        var t = (offer.fields && offer.fields.title) || offer.title;
        if (t) document.title = t + ' · Travelgenix';
        var div = document.createElement('div');
        mount.appendChild(div);
        new window.TGOfferPageWidget(div, cfg);
        if (div.getAttribute('data-tg-hidden')) fallback('Offer not available', 'This offer is not currently available. Please check back later.');
      }

      // Preferred path: the server already resolved the offer.
      if (boot && boot.notAvailable) { fallback('Offer not available', 'This offer is not currently available. Please check back later.'); return; }
      if (boot && boot.offer) { mountOffer(boot.offer, boot.offerId || ''); return; }

      // Fallbacks (storage hiccup, or a ?data= link the server did not resolve).
      var dataParam = params.get('data');
      var idParam = params.get('id') || (boot && boot.offerId) || '';
      if (dataParam) {
        var offer = null;
        try { offer = JSON.parse(b64urlDecode(dataParam)); } catch (e) { offer = null; }
        if (!offer || typeof offer !== 'object') { fallback('Offer not found', 'This offer link looks broken or incomplete.'); return; }
        mountOffer(offer, '');
        return;
      }
      if (idParam) {
        fetch('/api/saved-offers?id=' + encodeURIComponent(idParam))
          .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
          .then(function (d) {
            if (!d || !d.offer || typeof d.offer !== 'object') { fallback('Offer not found', 'We could not find this offer.'); return; }
            mountOffer(d.offer, idParam);
          })
          .catch(function () { fallback('Offer not available', 'We could not find this offer. It may have ended or been removed.'); });
        return;
      }
      fallback('Offer not found', 'No offer was specified in the link.');
    })();
  </script>
</body>
</html>`;
}

export default async function handler(req, res) {
  const q = req.query || {};
  const template = TEMPLATES.indexOf(String(q.template || '')) !== -1 ? String(q.template) : 'classic';
  const cfg = {
    template,
    theme: q.theme === 'dark' ? 'dark' : 'light',
    accentColor: typeof q.accent === 'string' ? q.accent.slice(0, 32) : '',
    agencyName: typeof q.agency === 'string' ? q.agency.slice(0, 80) : ''
  };

  let offer = null;
  let offerId = '';
  let notAvailable = false;

  try {
    // Candidate ids: an explicit ?id=, or recovered from the readable
    // /offer/<slug>-<id> path (passed through as ?slugid= by the rewrite).
    let candidates = [];
    if (q.id && ID_RE.test(String(q.id))) candidates = [String(q.id)];
    else if (q.slugid) candidates = idsFromSlugid(q.slugid);

    if (candidates.length && configured()) {
      for (const cand of candidates) {
        const rec = await getJson('offer:' + cand);
        if (rec && rec.offer) {
          offerId = cand;
          if (inWindow(rec.offer)) offer = rec.offer;
          else notAvailable = true; // exists but outside its show window
          break;
        }
      }
    } else if (q.data) {
      const decoded = decodeData(q.data);
      if (decoded) {
        if (inWindow(decoded)) offer = decoded;
        else notAvailable = true;
      }
    }
  } catch (e) {
    console.error('[offer-page] resolve failed:', e && e.message);
  }

  const meta = offer ? metaFrom(offer) : { title: 'Special offer', desc: 'A handpicked travel offer from Travelgenix.', image: '' };

  // Build a canonical og:url from the configured base or the request host, using
  // the readable slug path. When the offer is unavailable we have no title, so it
  // degrades to /offer/<id> (and never leaks an ended offer's title).
  let ogUrl = '';
  const base = process.env.OFFER_PAGE_BASE_URL || (req.headers.host ? 'https://' + req.headers.host : '');
  if (base && offerId) {
    const slug = offer ? slugify(offer.fields && offer.fields.title) : '';
    ogUrl = base.replace(/\/$/, '') + '/offer/' + (slug ? slug + '-' : '') + encodeURIComponent(offerId);
  }

  const bootstrap = escJson({ offer: offer || null, offerId, notAvailable });
  const html = pageHtml({ meta, ogUrl, bootstrap, cfg });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Saved offers can change, so keep the CDN cache short with revalidation.
  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');
  return res.status(200).send(html);
}

// Test surface — pure helpers, no network.
export const _test = { metaFrom, inWindow, safeImg, decodeData, escJson, escAttr, slugify, idsFromSlugid };
