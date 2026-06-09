/**
 * Travelgenix Widget Suite — YouTube Channel Resolver
 * GET /api/youtube-resolve?q=<channel URL | @handle | channelId>
 *
 * Authenticated, editor-only. Turns whatever an agent pastes (a channel URL, an
 * @handle, a custom /c/ or /user/ URL, a watch URL, or a raw UC… id) into a
 * canonical channelId — the same resolve-once-at-save pattern the Maps editor
 * uses for geocoding. The runtime widget never calls this; it only ever reads
 * the stored channelId and pulls the cached feed via /api/youtube-feed.
 *
 * Hardening:
 *   - requireAuth (logged-in editor session only)
 *   - rate limited per user
 *   - SSRF-safe: only ever fetches youtube.com / youtu.be, and the channelId we
 *     return is regex-validated (^UC[A-Za-z0-9_-]{22}$)
 *   - never leaks upstream detail; uniform { ok:false, error } on miss
 */

'use strict';

import { requireAuth, setCors, applyRateLimit, RATE_LIMITS } from './_auth.js';

const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);
const UPSTREAM_TIMEOUT_MS = 6000;

function decodeEntities(s) {
  if (!s) return '';
  return String(s)
    .replace(/\\u0026/g, '&').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch (e) { return ''; } })
    .trim();
}

// Build a safe youtube.com URL to fetch from whatever the agent pasted.
// Returns { url } to scrape, or { channelId } if we can read it directly, or null.
function planLookup(q) {
  const raw = String(q || '').trim();
  if (!raw) return null;
  if (CHANNEL_ID_RE.test(raw)) return { channelId: raw, url: `https://www.youtube.com/channel/${raw}` };

  if (/^https?:\/\//i.test(raw)) {
    let u;
    try { u = new URL(raw); } catch (e) { return null; }
    const host = u.hostname.toLowerCase();
    if (!YT_HOSTS.has(host)) return null;                 // SSRF guard — YouTube only
    const m = u.pathname.match(/\/channel\/(UC[A-Za-z0-9_-]{22})/);
    if (m) return { channelId: m[1], url: `https://www.youtube.com/channel/${m[1]}` };
    // Rebuild from validated host + path (drops any credentials/ports)
    return { url: `https://${host}${u.pathname}${u.search}` };
  }

  // Bare @handle or handle/custom token
  let handle = raw.replace(/^@/, '');
  if (!/^[A-Za-z0-9._-]{1,60}$/.test(handle)) return null;
  return { url: `https://www.youtube.com/@${handle}` };
}

function extractChannelId(html) {
  const patterns = [
    /"channelId":"(UC[A-Za-z0-9_-]{22})"/,
    /"externalId":"(UC[A-Za-z0-9_-]{22})"/,
    /<link[^>]+rel="canonical"[^>]+href="https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})"/,
    /youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})/,
  ];
  for (const re of patterns) { const m = re.exec(html); if (m && CHANNEL_ID_RE.test(m[1])) return m[1]; }
  return '';
}
function extractTitle(html) {
  let m = /<meta[^>]+property="og:title"[^>]+content="([^"]+)"/.exec(html);
  if (m) return decodeEntities(m[1]);
  m = /<meta[^>]+name="title"[^>]+content="([^"]+)"/.exec(html);
  if (m) return decodeEntities(m[1]);
  m = /<title>([^<]+)<\/title>/.exec(html);
  if (m) return decodeEntities(m[1]).replace(/\s*-\s*YouTube\s*$/, '');
  return '';
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TravelgenixWidgets/1.0; +https://tg-widgets.vercel.app)', 'Accept-Language': 'en' },
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    return await r.text();
  } catch (e) { clearTimeout(timer); return null; }
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const auth = requireAuth(req);
  if (auth.error) return res.status(auth.status).json({ ok: false, error: auth.error });

  const key = `ytresolve:${(auth.user && auth.user.email) || (req.headers['x-forwarded-for'] || 'ip')}`;
  if (!applyRateLimit(res, key, RATE_LIMITS.widgetRead)) return;

  const plan = planLookup(req.query.q);
  if (!plan) return res.status(400).json({ ok: false, error: 'Paste a YouTube channel URL, @handle or channel ID.' });

  // Fetch the page (gives us the title, and the channelId when we don't have it yet).
  const html = plan.url ? await fetchText(plan.url) : null;
  let channelId = plan.channelId || (html ? extractChannelId(html) : '');
  if (!CHANNEL_ID_RE.test(channelId)) {
    return res.status(404).json({ ok: false, error: 'Couldn’t find that channel. Check the URL or @handle and try again.' });
  }
  const title = html ? extractTitle(html) : '';

  res.setHeader('Cache-Control', 'private, max-age=300');
  return res.status(200).json({
    ok: true,
    channelId,
    title: title || '',
    url: `https://www.youtube.com/channel/${channelId}`,
  });
}
