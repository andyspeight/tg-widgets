/**
 * Travelgenix Widget Suite — RSS / Atom Feed API
 * /api/rss-feed?url=<feed url>&max=12
 *
 * Proxies an ARBITRARY user-supplied RSS or Atom feed (no key) with Travelgenix
 * hardening — same posture as youtube-feed.js, PLUS a real SSRF guard because
 * the URL is attacker-controllable:
 *   - http/https only, port allow-list (80/443/none)
 *   - blocks localhost, *.local/*.internal, cloud metadata hosts
 *   - blocks private / loopback / link-local / reserved IPs, checked against the
 *     literal host AND every DNS-resolved address (defeats hostnames that point
 *     inward and most DNS-rebind setups)
 *   - redirects followed MANUALLY, each hop re-validated through the same guard
 *   - response size + time capped
 *   - locked CORS (shared TG_ALLOWED_ORIGINS env + Duda previews), per-IP rate
 *     limit, 15-min edge cache, uniform error shape
 *
 * Returns the newest items, parsed from RSS 2.0 or Atom into one clean shape:
 *   { ok:true, feed:{ title, link, url }, count, items:[
 *       { title, link, published, summary, image, source }
 *     ], source:'rss', updated:'…Z' }
 *
 * The widget calls this once PER configured feed (each feed cached independently
 * at the edge) and merges/sorts/dedupes client-side.
 */

'use strict';

import { promises as dns } from 'node:dns';

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

// ─── SSRF guard ──────────────────────────────────────────────────────────────
const BLOCKED_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'metadata.google.internal', 'metadata']);

function ipv4IsPrivate(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true; // malformed → block
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;                 // link-local
  if (a === 172 && b >= 16 && b <= 31) return true;        // 172.16/12
  if (a === 192 && b === 168) return true;                 // 192.168/16
  if (a === 192 && b === 0) return true;                   // 192.0.0/24 etc
  if (a === 100 && b >= 64 && b <= 127) return true;       // CGNAT 100.64/10
  if (a === 198 && (b === 18 || b === 19)) return true;    // benchmarking
  if (a >= 224) return true;                               // multicast + reserved
  return false;
}
function ipv6IsPrivate(ip) {
  let v = ip.toLowerCase();
  if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1);
  if (v === '::1' || v === '::') return true;
  // IPv4-mapped / embedded (::ffff:1.2.3.4 or ::ffff:0:1.2.3.4 or 64:ff9b::1.2.3.4)
  const m = v.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (m) return ipv4IsPrivate(m[1]);
  const head = v.split(':')[0] || '';
  if (head.startsWith('fc') || head.startsWith('fd')) return true;     // ULA fc00::/7
  if (head.startsWith('fe8') || head.startsWith('fe9') || head.startsWith('fea') || head.startsWith('feb')) return true; // link-local fe80::/10
  if (head.startsWith('ff')) return true;                              // multicast
  return false;
}
function looksLikeIp(host) { return /^[0-9.]+$/.test(host) || host.includes(':') || /^\[.*\]$/.test(host); }
function ipIsPrivate(host) {
  const h = host.replace(/^\[|\]$/g, '');
  if (h.includes(':')) return ipv6IsPrivate(h);
  return ipv4IsPrivate(h);
}

// Validate a single URL string. Returns { ok:true, url } or { ok:false, error }.
async function validateUrl(raw) {
  let u;
  try { u = new URL(raw); } catch (e) { return { ok: false, error: 'Invalid feed URL.' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'Only http(s) feeds are supported.' };
  if (u.port && u.port !== '80' && u.port !== '443') return { ok: false, error: 'That port is not allowed.' };
  const host = u.hostname.toLowerCase();
  if (!host) return { ok: false, error: 'Invalid feed host.' };
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    return { ok: false, error: 'That host is not allowed.' };
  }
  if (looksLikeIp(host)) {
    if (ipIsPrivate(host)) return { ok: false, error: 'That address is not allowed.' };
    return { ok: true, url: u.toString() };
  }
  // Resolve and check every address
  let addrs;
  try { addrs = await dns.lookup(host, { all: true }); }
  catch (e) { return { ok: false, error: 'Could not resolve that host.' }; }
  if (!addrs || !addrs.length) return { ok: false, error: 'Could not resolve that host.' };
  for (const a of addrs) { if (ipIsPrivate(a.address)) return { ok: false, error: 'That host resolves to a blocked address.' }; }
  return { ok: true, url: u.toString() };
}

// Fetch with manual redirect following — each hop revalidated (SSRF on redirect).
const UPSTREAM_TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 4;
const MAX_BYTES = 3 * 1024 * 1024; // 3MB
async function safeFetch(startUrl) {
  let current = startUrl;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const v = await validateUrl(current);
    if (!v.ok) return { error: v.error, status: 400 };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    let r;
    try {
      r = await fetch(v.url, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TravelgenixWidgets/1.0; +https://tg-widgets.vercel.app)',
          'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5',
          'Accept-Language': 'en',
        },
      });
    } catch (e) {
      clearTimeout(timer);
      return { error: e.name === 'AbortError' ? 'Feed took too long to respond.' : 'Could not reach the feed.', status: e.name === 'AbortError' ? 504 : 502 };
    }
    clearTimeout(timer);
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location');
      if (!loc) return { error: 'Bad redirect from feed.', status: 502 };
      current = new URL(loc, v.url).toString();
      continue;
    }
    if (r.status === 404) return { error: 'Feed not found.', status: 404 };
    if (!r.ok) return { error: 'Feed returned an error.', status: 502 };

    // Size-capped read
    const reader = r.body && r.body.getReader ? r.body.getReader() : null;
    if (reader) {
      const chunks = []; let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > MAX_BYTES) { try { reader.cancel(); } catch (e) {} return { error: 'Feed is too large.', status: 413 }; }
        chunks.push(value);
      }
      return { text: Buffer.concat(chunks).toString('utf8') };
    }
    const text = await r.text();
    return { text: text.length > MAX_BYTES ? text.slice(0, MAX_BYTES) : text };
  }
  return { error: 'Too many redirects.', status: 502 };
}

// ─── XML helpers ─────────────────────────────────────────────────────────────
function decodeEntities(s) {
  if (!s) return '';
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#x2F;/gi, '/').replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch (e) { return ''; } })
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch (e) { return ''; } })
    .replace(/&amp;/g, '&');
}
function stripHtml(s) { return decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(); }
function firstMatch(re, str) { const m = re.exec(str); return m ? m[1] : ''; }
function clip(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; }

function extractImage(block) {
  let m = /<media:thumbnail[^>]*\burl=["']([^"']+)["']/i.exec(block); if (m) return m[1];
  m = /<media:content[^>]*\burl=["']([^"']+)["'][^>]*>/i.exec(block);
  if (m && /image|jpg|jpeg|png|webp|gif/i.test(m[0])) return m[1];
  m = /<enclosure[^>]*\burl=["']([^"']+)["'][^>]*type=["']image/i.exec(block); if (m) return m[1];
  m = /<enclosure[^>]*type=["']image[^>]*\burl=["']([^"']+)["']/i.exec(block); if (m) return m[1];
  m = /<itunes:image[^>]*\bhref=["']([^"']+)["']/i.exec(block); if (m) return m[1];
  m = /<img[^>]*\bsrc=["']([^"']+)["']/i.exec(block); if (m) return m[1];
  return '';
}
function safeImg(u) { return /^https?:\/\//i.test(String(u || '').trim()) ? u.trim() : ''; }
function toIso(d) { if (!d) return ''; const t = new Date(d.trim()); return isNaN(t.getTime()) ? '' : t.toISOString(); }

function parseFeed(xml) {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const headEnd = isAtom ? xml.search(/<entry[\s>]/i) : xml.search(/<item[\s>]/i);
  const head = headEnd > 0 ? xml.slice(0, headEnd) : xml;
  const feed = {
    title: stripHtml(firstMatch(/<title[^>]*>([\s\S]*?)<\/title>/i, head)),
    link: '',
  };
  if (isAtom) {
    feed.link = firstMatch(/<link[^>]*\bhref=["']([^"']+)["'][^>]*\/?>(?:<\/link>)?/i, head) || '';
  } else {
    feed.link = stripHtml(firstMatch(/<link>([\s\S]*?)<\/link>/i, head));
  }

  const items = [];
  const re = isAtom ? /<entry[\s>]([\s\S]*?)<\/entry>/gi : /<item[\s>]([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const b = m[1];
    const title = stripHtml(firstMatch(/<title[^>]*>([\s\S]*?)<\/title>/i, b)) || 'Untitled';
    let link = '';
    if (isAtom) {
      link = firstMatch(/<link[^>]*\brel=["']alternate["'][^>]*\bhref=["']([^"']+)["']/i, b)
        || firstMatch(/<link[^>]*\bhref=["']([^"']+)["']/i, b);
    } else {
      link = stripHtml(firstMatch(/<link>([\s\S]*?)<\/link>/i, b)) || firstMatch(/<link[^>]*\bhref=["']([^"']+)["']/i, b);
    }
    const date = isAtom
      ? (firstMatch(/<published>([\s\S]*?)<\/published>/i, b) || firstMatch(/<updated>([\s\S]*?)<\/updated>/i, b))
      : (firstMatch(/<pubDate>([\s\S]*?)<\/pubDate>/i, b) || firstMatch(/<dc:date>([\s\S]*?)<\/dc:date>/i, b));
    const rawDesc = isAtom
      ? (firstMatch(/<summary[^>]*>([\s\S]*?)<\/summary>/i, b) || firstMatch(/<content[^>]*>([\s\S]*?)<\/content>/i, b))
      : (firstMatch(/<description>([\s\S]*?)<\/description>/i, b) || firstMatch(/<content:encoded>([\s\S]*?)<\/content:encoded>/i, b));
    const image = safeImg(extractImage(b) || extractImage(rawDesc || ''));
    if (!link) continue;
    items.push({
      title,
      link: String(link).trim(),
      published: toIso(date),
      summary: clip(stripHtml(rawDesc), 400),
      image,
    });
  }
  return { feed, items };
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

  const rawUrl = String(req.query.url || '').trim();
  if (!rawUrl) return fail(res, 400, 'A feed url is required.');
  if (rawUrl.length > 600) return fail(res, 400, 'Feed url is too long.');

  let max = parseInt(req.query.max, 10);
  if (!Number.isFinite(max)) max = 12;
  max = Math.max(1, Math.min(30, max));

  const result = await safeFetch(rawUrl);
  if (result.error) return fail(res, result.status || 502, result.error);

  let parsed;
  try { parsed = parseFeed(result.text); }
  catch (e) { return fail(res, 502, 'Could not parse that feed.'); }
  if (!parsed.items.length) return fail(res, 422, 'No items found — is that a valid RSS or Atom feed?');

  res.setHeader('Cache-Control', `public, max-age=120, s-maxage=900, stale-while-revalidate=1800`);
  return res.status(200).json({
    ok: true,
    feed: { title: parsed.feed.title || '', link: parsed.feed.link || '', url: rawUrl },
    count: Math.min(parsed.items.length, max),
    items: parsed.items.slice(0, max),
    source: 'rss',
    updated: new Date().toISOString(),
  });
}
