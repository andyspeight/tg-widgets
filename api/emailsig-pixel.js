// =============================================================================
//  /api/emailsig-pixel.js   →  GET /api/emailsig-pixel?id=WIDGET_ID
// =============================================================================
//
//  Open-tracking pixel for the Email Signature widget. Returns a transparent
//  1x1 GIF and logs the open. Public, fail-open — it ALWAYS returns the image
//  (never a 4xx that would render a broken-image icon in the reader's inbox).
//
//  Phase 1 (current): structured stdout log only, grep on `[emailsig-open]`.
//  Phase 2: write per-open rows once an Airtable Opens table exists — mirrors
//  the staged approach in /api/share-track.js.
//
// =============================================================================

import { TRANSPARENT_GIF, safeWidgetId, clientIp } from './_lib/emailsig.js';

export default function handler(req, res) {
  // Always serve the pixel, even on odd methods, so nothing ever breaks in a
  // reader's inbox. Only GET/HEAD are expected.
  res.setHeader('Content-Type', 'image/gif');
  // Never cache — we want every open to hit us (email proxies still cache, but
  // that is out of our hands).
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');

  const id = safeWidgetId(req.query && req.query.id);
  if (id) {
    console.log('[emailsig-open]', JSON.stringify({
      widgetId: id,
      ua: String(req.headers['user-agent'] || '').slice(0, 200),
      ip: clientIp(req).slice(0, 64),
      ts: new Date().toISOString(),
    }));
  }

  return res.status(200).end(TRANSPARENT_GIF);
}
