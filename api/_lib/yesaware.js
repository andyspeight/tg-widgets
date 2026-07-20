// =============================================================================
//  /api/_lib/yesaware.js
// =============================================================================
//
//  Shared helpers for YesAware, Andy's personal email tracking tool. Powers the
//  three tracking endpoints:
//    - /api/track/open     open-tracking pixel   (public, signed)
//    - /api/track/click    click redirect         (public, signed)
//    - /api/track/register mint a tracker          (admin only)
//
//  Design rules (mirroring api/_lib/emailsig.js + api/_lib/telemetry.js):
//    - The pixel and redirect are hit from inside inboxes and image proxies, so
//      they are PUBLIC and FAIL-OPEN: always return the image / do something
//      safe, never a 4xx that would break in the reader's inbox.
//    - Events are logged AFTER the response is sent (respond-first), bounded by
//      a short timeout, and never throw.
//    - Every logged hit must carry a valid HMAC signature we minted, so nobody
//      can forge opens or clicks or enumerate tokens, and the redirect can only
//      ever go to a URL we signed (there is no open-redirect surface).
//
//  Secret: reuses TG_SESSION_SECRET (already server-side, high entropy) with a
//  domain-separation label, so no new env var is required. Set YESAWARE_SECRET
//  to override with a dedicated key.
//
//  Store: two Airtable tables in the widget-suite base (AIRTABLE_BASE_ID), so
//  the existing AIRTABLE_KEY already covers them — no new PAT or scope. See
//  docs/yesaware-handover.md.
// =============================================================================

import { createHmac, timingSafeEqual, randomBytes } from 'crypto';
import { TRANSPARENT_GIF, safeHttpUrl, clientIp } from './emailsig.js';

// Re-export the bits the endpoints share so they import from one place.
export { TRANSPARENT_GIF, safeHttpUrl, clientIp };

const AIRTABLE_API = 'https://api.airtable.com/v0';
const AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID || 'appAYzWZxvK6qlwXK';
const INSERT_TIMEOUT_MS = 1500;

export const MESSAGES = 'YesAware Messages';
export const EVENTS = 'YesAware Events';

// Global kill switch. Set YESAWARE_DISABLED='1' in Vercel to stop all logging
// and block new trackers instantly, without a redeploy. The pixel and redirect
// still serve (fail-open), they just stop recording.
export function trackingEnabled() {
  return process.env.YESAWARE_DISABLED !== '1';
}

// Stable public host for pasted pixels and links — must outlive any one deploy,
// so never the ephemeral *.vercel.app deployment URL.
export function publicOrigin() {
  return (process.env.YESAWARE_PUBLIC_ORIGIN || 'https://widgets.travelify.io').replace(/\/+$/, '');
}

// ── Tokens ──────────────────────────────────────────────────────────────────
const TOKEN_RE = /^[A-Za-z0-9]{8,64}$/;

// 15 random bytes → 30 hex chars: url-safe and unguessable.
export function newToken() {
  return randomBytes(15).toString('hex');
}

export function safeToken(raw) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return TOKEN_RE.test(s) ? s : '';
}

// ── Signing (HMAC-SHA256) ────────────────────────────────────────────────────
function secret() {
  return process.env.YESAWARE_SECRET || process.env.TG_SESSION_SECRET || 'yesaware-dev-only-insecure';
}

// ~128-bit tag, url-safe. Domain-separated so it can never collide with any
// other use of the shared session secret.
export function sign(value) {
  return createHmac('sha256', secret())
    .update('yesaware:' + String(value))
    .digest('base64url')
    .slice(0, 22);
}

export function verifySig(value, sig) {
  const expected = sign(value);
  if (typeof sig !== 'string' || sig.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ── Open classification (bot / proxy tagging) ────────────────────────────────
// An open can never be fully trusted. Tag the obvious machine sources so the
// dashboard can discount them: Apple Mail Privacy Protection prefetches from
// 17.0.0.0/8; Gmail and Yahoo proxy image loads with a tell-tale user-agent.
export function classifyOpen(ip, ua) {
  const u = String(ua || '').toLowerCase();
  const firstOctet = String(ip || '').split(',')[0].trim().split('.')[0];
  if (firstOctet === '17') return 'apple-mpp';
  if (u.includes('googleimageproxy') || u.includes('ggpht.com')) return 'google-proxy';
  if (u.includes('yahooimageproxy') || u.includes('ymailproxy')) return 'yahoo-proxy';
  return 'direct';
}

// ── Tracked pixel + link building (used by register) ─────────────────────────
export function pixelUrl(token) {
  const t = encodeURIComponent(token);
  return `${publicOrigin()}/api/track/open?t=${t}&s=${sign(token)}`;
}

// Signs the NORMALISED url (safeHttpUrl), so the click endpoint — which also
// normalises before verifying — produces the identical signature. Returns ''
// for anything that is not an http(s) url.
export function trackedLinkUrl(token, url) {
  const clean = safeHttpUrl(url);
  if (!clean) return '';
  const t = encodeURIComponent(token);
  const u = encodeURIComponent(clean);
  const s = sign(token + '|' + clean);
  return `${publicOrigin()}/api/track/click?t=${t}&u=${u}&s=${s}`;
}

// ── Airtable write (fail-open, bounded, never throws) ─────────────────────────
export async function airtableInsert(table, fields) {
  const key = process.env.AIRTABLE_KEY;
  if (!key) return null; // not configured (e.g. local dev) — skip silently
  let timer;
  try {
    const ctrl = new AbortController();
    timer = setTimeout(() => ctrl.abort(), INSERT_TIMEOUT_MS);
    const res = await fetch(`${AIRTABLE_API}/${AIRTABLE_BASE}/${encodeURIComponent(table)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: [{ fields }], typecast: true }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn('[yesaware] airtable insert non-2xx', res.status, body.slice(0, 200));
      return null;
    }
    const data = await res.json().catch(() => null);
    return (data && data.records && data.records[0]) || null;
  } catch (e) {
    console.warn('[yesaware] airtable insert failed', e && e.message);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── In-memory dedupe (best-effort, per instance) ──────────────────────────────
// Collapses the burst of proxy re-fetches into one logical event. Serverless
// instances are ephemeral, so this is a best-effort first pass; the dashboard
// also dedupes on read.
const recent = new Map();
const DEDUPE_MS = 10 * 1000;
const RECENT_CAP = 5000;

export function seenRecently(keyStr) {
  const now = Date.now();
  const last = recent.get(keyStr);
  if (last && now - last < DEDUPE_MS) return true;
  recent.set(keyStr, now);
  if (recent.size > RECENT_CAP) {
    for (const [k, t] of recent) { if (now - t > DEDUPE_MS) recent.delete(k); }
  }
  return false;
}
