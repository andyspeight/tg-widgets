// =============================================================================
//  /api/emailsig-click.js   →  GET /api/emailsig-click?id=WIDGET_ID
// =============================================================================
//
//  Click wrapper for the Email Signature promo banner. The banner <img> is
//  wrapped in a link to this endpoint; we log the click and 302 to the banner
//  destination stored in the widget config. Destination comes from the owner's
//  own saved config (never the request), so there is no open-redirect surface.
//
//  Public, fail-open. If there is no destination we fall back to the company
//  website, then to a 204 so nothing breaks.
//
// =============================================================================

import { safeWidgetId, safeHttpUrl, fetchWidgetConfig, clientIp } from './_lib/emailsig.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }

  const id = safeWidgetId(req.query && req.query.id);
  if (!id) return res.status(204).end();

  const config = await fetchWidgetConfig(req, id);
  const banner = config && typeof config.banner === 'object' ? config.banner : null;
  const contact = config && typeof config.contact === 'object' ? config.contact : null;
  const dest = (banner && safeHttpUrl(banner.linkUrl))
    || (contact && safeHttpUrl(contact.website))
    || '';

  console.log('[emailsig-click]', JSON.stringify({
    widgetId: id,
    to: dest ? 'redirect' : 'none',
    ip: clientIp(req).slice(0, 64),
    ts: new Date().toISOString(),
  }));

  if (!dest) return res.status(204).end();

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Location', dest);
  return res.status(302).end();
}
