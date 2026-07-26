/**
 * Visitor fingerprinting for Tripbuster tracking — deliberately coarse.
 *
 * Click-outs are the billable event, so we need just enough to de-duplicate a
 * refresh-happy visitor and spot obvious bots. We do NOT need to know who anyone
 * is, so under UK GDPR data minimisation:
 *
 *   • the IP address is never stored, only a salted SHA-256 of it
 *   • the user agent is reduced to a coarse family ("chrome", "bot"), not kept
 *   • the referrer is reduced to a host, never the full URL with its query string
 *
 * The hash is salted so the stored values cannot be reversed by hashing the IPv4
 * space, which is small enough to brute force unsalted.
 *
 * Optional env:
 *   TRIPBUSTER_IP_SALT — dedicated salt. When absent, one is derived from
 *   TRIPBUSTER_SESSION_SECRET under a fixed label, so the salt is never the
 *   signing secret itself and tracking works without a second variable to set.
 */
import { createHash } from 'crypto';
import { getRequestIp } from '../auth/http.js';

let cachedSalt = null;
function salt() {
  if (cachedSalt !== null) return cachedSalt;
  const explicit = process.env.TRIPBUSTER_IP_SALT;
  if (explicit && explicit.length >= 16) {
    cachedSalt = explicit;
  } else if (process.env.TRIPBUSTER_SESSION_SECRET) {
    cachedSalt = createHash('sha256')
      .update('tripbuster-ip-hash-salt:' + process.env.TRIPBUSTER_SESSION_SECRET)
      .digest('hex');
  } else {
    cachedSalt = '';
  }
  return cachedSalt;
}

/**
 * Salted hash of an arbitrary contact detail, under its own label so it can
 * never collide with an IP hash of the same string.
 *
 * Used to spot the same person asking to be rung twice. Deliberately keyed on
 * the contact detail rather than the IP: one person asking from home and again
 * from work is a single enquiry, while a family sharing a wifi connection is
 * genuinely two.
 */
export function contactHash(value) {
  const s = salt();
  if (!s || !value) return null;
  const key = String(value).toLowerCase().replace(/[^a-z0-9@.+]/g, '');
  if (!key) return null;
  return createHash('sha256').update(s + ':contact:' + key).digest('hex').slice(0, 40);
}

/** Salted hash of the caller's IP, or null when no salt is configured. */
export function ipHash(req) {
  const s = salt();
  if (!s) return null;
  const ip = getRequestIp(req);
  if (!ip) return null;
  return createHash('sha256').update(s + ':' + ip).digest('hex').slice(0, 40);
}

// Matched against the lower-cased UA. Not exhaustive and not meant to be — the
// aim is to keep obvious automated traffic out of what an agent is billed for,
// and a bot that fakes a browser UA is caught by de-duplication instead.
const BOT_RE = /(bot|crawl|spider|slurp|headless|phantom|puppeteer|playwright|curl\/|wget|python-requests|okhttp|scrapy|axios\/|go-http|java\/|libwww|facebookexternalhit|bingpreview|preview|monitor|uptime|pingdom|lighthouse)/;

const FAMILIES = [
  [/edg\//, 'edge'],
  [/opr\/|opera/, 'opera'],
  [/samsungbrowser/, 'samsung'],
  [/chrome\/|crios/, 'chrome'],
  [/firefox\/|fxios/, 'firefox'],
  [/safari\//, 'safari'],
];

/**
 * Coarse UA bucket plus a bot verdict.
 * A missing or implausibly short UA counts as suspect: real browsers send one.
 */
export function userAgentInfo(req) {
  const raw = (req.headers && (req.headers['user-agent'] || req.headers['User-Agent'])) || '';
  const ua = String(raw).toLowerCase();
  if (!ua || ua.length < 12) return { family: 'unknown', bot: true };
  if (BOT_RE.test(ua)) return { family: 'bot', bot: true };
  for (const [re, name] of FAMILIES) {
    if (re.test(ua)) return { family: name, bot: false };
  }
  return { family: 'other', bot: false };
}

/** Host of the referring page. The path and query are dropped on purpose. */
export function referrerHost(req) {
  const raw = (req.headers && (req.headers.referer || req.headers.referrer)) || '';
  if (!raw) return null;
  try {
    const h = new URL(String(raw)).host;
    return h ? h.slice(0, 120) : null;
  } catch {
    return null;
  }
}

/** Two-letter country from the edge, when the platform provides one. */
export function countryCode(req) {
  const raw = (req.headers && (req.headers['x-vercel-ip-country'] || req.headers['cf-ipcountry'])) || '';
  const c = String(raw).trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : null;
}

/** Everything the tracking endpoints need, in one call. */
export function visitorContext(req) {
  const ua = userAgentInfo(req);
  return {
    ipHash: ipHash(req),
    uaFamily: ua.family,
    suspectBot: ua.bot,
    referrerHost: referrerHost(req),
    countryCode: countryCode(req),
  };
}
