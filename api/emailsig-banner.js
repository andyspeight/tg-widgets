// =============================================================================
//  /api/emailsig-banner.js   →  GET /api/emailsig-banner?id=WIDGET_ID
// =============================================================================
//
//  Serves the Email Signature widget's promo banner by 302-redirecting to the
//  banner image URL stored in the widget config. The indirection is the whole
//  point: the owner can swap the banner image later (in the editor) and every
//  already-sent signature picks it up on the next open — no re-paste.
//
//  Public, fail-open. If there is no banner (or the widget is gone) it returns
//  a transparent 1x1 so the email never shows a broken-image icon.
//
//  Note: email image proxies (Gmail's googleusercontent, etc.) cache what they
//  fetch, so a swapped banner propagates within the short cache window below,
//  not instantly. That is inherent to how email renders images.
//
// =============================================================================

import { TRANSPARENT_GIF, safeWidgetId, safeHttpUrl, fetchWidgetConfig, clientIp } from './_lib/emailsig.js';

function sendPixel(res) {
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  return res.status(200).end(TRANSPARENT_GIF);
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }

  const id = safeWidgetId(req.query && req.query.id);
  if (!id) return sendPixel(res);

  const config = await fetchWidgetConfig(req, id);
  const banner = config && typeof config.banner === 'object' ? config.banner : null;
  const imageUrl = banner && banner.enabled !== false ? safeHttpUrl(banner.imageUrl) : '';

  console.log('[emailsig-banner]', JSON.stringify({
    widgetId: id,
    served: imageUrl ? 'redirect' : 'empty',
    ip: clientIp(req).slice(0, 64),
    ts: new Date().toISOString(),
  }));

  if (!imageUrl) return sendPixel(res);

  // Short cache so an updated banner propagates within minutes.
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  res.setHeader('Location', imageUrl);
  return res.status(302).end();
}
