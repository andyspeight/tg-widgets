/**
 * Travelgenix Widget Suite — YouTube Feed API
 * /api/youtube-feed?channelId=UC...&max=12
 *
 * Proxies a channel's PUBLIC YouTube RSS feed (no API key, no quota, no Google
 * Cloud project) with Travelgenix hardening on top — mirrors weather-current.js:
 *   - Strict channelId validation (^UC[A-Za-z0-9_-]{22}$) — also the SSRF guard,
 *     since the upstream URL is only ever built from a validated channelId
 *   - In-memory per-IP rate limiting (anonymous, public endpoint)
 *   - 30-minute edge cache via CDN headers (uploads change slowly)
 *   - Locked CORS to approved origins (shared TG_ALLOWED_ORIGINS env + Duda previews)
 *   - Uniform error shape that never leaks upstream details
 *   - Opinionated response — only what the widget needs, parsed from Atom XML
 *
 * Upstream: https://www.youtube.com/feeds/videos.xml?channel_id=UC...
 * Returns the latest ~15 uploads. The RSS feed also carries view counts for
 * free (media:statistics), so we surface those without touching the Data API.
 *
 * Response:
 *   { ok:true, channel:{ id, title, url }, count, videos:[
 *       { id, title, url, embedUrl, published, thumbnail, thumbnails:{...},
 *         description, views }
 *     ], source:'youtube-rss', updated:'2026-06-09T…Z' }
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
    } catch (e) { /* fall through */ }
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

// ─── Rate limit (per-IP, in-memory; resets on cold start — abuse defence) ────
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 30;
const ipHits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  hits.push(now);
  ipHits.set(ip, hits);
  if (ipHits.size > 5000) { // crude memory cap
    for (const [k, v] of ipHits) { if (!v.length || now - v[v.length - 1] > RATE_LIMIT_WINDOW_MS) ipHits.delete(k); }
  }
  return hits.length > RATE_LIMIT_MAX;
}

// ─── Caching / upstream ──────────────────────────────────────────────────────
const CACHE_SECONDS = 1800;            // 30 min edge cache
const STALE_WHILE_REVALIDATE = 3600;   // 1 hour
const UPSTREAM_TIMEOUT_MS = 5000;
const FEED_BASE = 'https://www.youtube.com/feeds/videos.xml';
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

// ─── XML helpers (no dependency — the YouTube feed shape is stable) ──────────
function decodeEntities(s) {
  if (!s) return '';
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#x2F;/gi, '/').replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch (e) { return ''; } })
    .replace(/&amp;/g, '&')
    .trim();
}
function firstMatch(re, str) { const m = re.exec(str); return m ? m[1] : ''; }

function parseFeed(xml) {
  const headEnd = xml.indexOf('<entry>');
  const head = headEnd >= 0 ? xml.slice(0, headEnd) : xml;
  const channel = {
    id: firstMatch(/<yt:channelId>([\s\S]*?)<\/yt:channelId>/, head),
    title: decodeEntities(firstMatch(/<title>([\s\S]*?)<\/title>/, head)),
    url: '',
  };
  const authorUri = firstMatch(/<author>[\s\S]*?<uri>([\s\S]*?)<\/uri>[\s\S]*?<\/author>/, head);
  channel.url = authorUri || (channel.id ? `https://www.youtube.com/channel/${channel.id}` : '');

  const videos = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRe.exec(xml)) !== null) {
    const e = m[1];
    const id = firstMatch(/<yt:videoId>([\s\S]*?)<\/yt:videoId>/, e).trim();
    if (!VIDEO_ID_RE.test(id)) continue;
    const title = decodeEntities(firstMatch(/<title>([\s\S]*?)<\/title>/, e));
    const published = firstMatch(/<published>([\s\S]*?)<\/published>/, e).trim();
    const description = decodeEntities(firstMatch(/<media:description>([\s\S]*?)<\/media:description>/, e));
    const viewsRaw = firstMatch(/<media:statistics[^>]*\bviews="(\d+)"/, e);
    videos.push({
      id,
      title: title || 'Untitled',
      url: `https://www.youtube.com/watch?v=${id}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
      published,
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      thumbnails: {
        default: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
        medium: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        high: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
      },
      description,
      views: viewsRaw ? parseInt(viewsRaw, 10) : null,
    });
  }
  return { channel, videos };
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

  const channelId = String(req.query.channelId || '').trim();
  if (!CHANNEL_ID_RE.test(channelId)) return fail(res, 400, 'A valid channelId (UC…) is required.');

  let max = parseInt(req.query.max, 10);
  if (!Number.isFinite(max)) max = 15;
  max = Math.max(1, Math.min(15, max));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = `${FEED_BASE}?channel_id=${encodeURIComponent(channelId)}`;
    const r = await fetch(upstream, {
      signal: controller.signal,
      headers: { 'User-Agent': 'TravelgenixWidgets/1.0 (+https://tg-widgets.vercel.app)', 'Accept': 'application/atom+xml, text/xml' },
    });
    clearTimeout(timer);
    if (r.status === 404) return fail(res, 404, 'Channel not found or has no public feed.');
    if (!r.ok) return fail(res, 502, 'Could not reach YouTube.');
    const xml = await r.text();
    const { channel, videos } = parseFeed(xml);
    if (!videos.length) return fail(res, 404, 'No public videos found for this channel.');

    res.setHeader('Cache-Control', `public, max-age=300, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_WHILE_REVALIDATE}`);
    return res.status(200).json({
      ok: true,
      channel: { id: channel.id || channelId, title: channel.title || '', url: channel.url || `https://www.youtube.com/channel/${channelId}` },
      count: Math.min(videos.length, max),
      videos: videos.slice(0, max),
      source: 'youtube-rss',
      updated: new Date().toISOString(),
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') return fail(res, 504, 'YouTube took too long to respond.');
    console.error('[youtube-feed] error', e.message);
    return fail(res, 500, 'Unexpected error fetching the feed.');
  }
}
