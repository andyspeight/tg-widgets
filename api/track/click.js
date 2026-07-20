// =============================================================================
//  /api/track/click.js   →   GET /api/track/click?t=TOKEN&u=URL&s=SIG
// =============================================================================
//
//  YesAware click redirect. Verifies that WE signed this exact (token, url)
//  pair, logs the click, then 302s to the destination. Because the destination
//  is only honoured when the signature matches, there is NO open-redirect
//  surface: an attacker cannot craft a link to an arbitrary URL that we will
//  follow. On any problem we send a 204 (nothing followed, nothing broken).
//
// =============================================================================

import {
  safeToken, safeHttpUrl, verifySig, classifyOpen, clientIp,
  airtableInsert, EVENTS, seenRecently, trackingEnabled,
} from '../_lib/yesaware.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');

  const token = safeToken(req.query && req.query.t);
  const rawUrl = req.query && req.query.u;
  const url = safeHttpUrl(typeof rawUrl === 'string' ? rawUrl : '');
  const sig = req.query && req.query.s;

  // Only redirect to a destination we signed for this token. No valid signature
  // means no redirect — this is what closes the open-redirect hole.
  if (!token || !url || !verifySig(token + '|' + url, sig)) {
    return res.status(204).end();
  }

  // Redirect immediately; log after (best-effort).
  res.setHeader('Location', url);
  res.status(302).end();

  try {
    if (!trackingEnabled()) return; // global kill switch (still redirected above)
    const ip = clientIp(req);
    const ua = String(req.headers['user-agent'] || '').slice(0, 300);
    if (seenRecently('click|' + token + '|' + url + '|' + ip)) return;

    await airtableInsert(EVENTS, {
      Token: token,
      Type: 'click',
      URL: url.slice(0, 500),
      Source: classifyOpen(ip, ua),
      IP: ip.slice(0, 64),
      UA: ua,
    });
  } catch (e) {
    console.warn('[track/click] log failed', e && e.message);
  }
}
