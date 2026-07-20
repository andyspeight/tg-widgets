// =============================================================================
//  /api/track/open.js   →   GET /api/track/open?t=TOKEN&s=SIG
// =============================================================================
//
//  YesAware open-tracking pixel. Returns a transparent 1x1 GIF and logs the
//  open. Public and FAIL-OPEN: it ALWAYS returns the image (even on a missing
//  or bad signature) so nothing ever breaks in the reader's inbox — it simply
//  does not log anything it cannot verify came from a tracker we minted.
//
// =============================================================================

import {
  TRANSPARENT_GIF, safeToken, verifySig, classifyOpen, clientIp,
  airtableInsert, EVENTS, seenRecently, trackingEnabled,
} from '../_lib/yesaware.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Content-Length', TRANSPARENT_GIF.length);
  // Never cache — us or Vercel's CDN. Every open must reach the function, so we
  // must NOT set s-maxage here (that would let the edge absorb opens).
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Flush the image first, then log — never add latency to the pixel. On
  // Vercel's Node runtime the function stays alive to finish the await below.
  res.status(200).end(TRANSPARENT_GIF);

  try {
    if (!trackingEnabled()) return; // global kill switch
    const token = safeToken(req.query && req.query.t);
    const sig = req.query && req.query.s;
    if (!token || !verifySig(token, sig)) return; // unsigned or forged — ignore

    const ip = clientIp(req);
    const ua = String(req.headers['user-agent'] || '').slice(0, 300);
    if (seenRecently('open|' + token + '|' + ip)) return; // dedupe proxy bursts

    await airtableInsert(EVENTS, {
      Token: token,
      Type: 'open',
      Source: classifyOpen(ip, ua),
      IP: ip.slice(0, 64),
      UA: ua,
    });
  } catch (e) {
    console.warn('[track/open] log failed', e && e.message);
  }
}
