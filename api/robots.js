/**
 * /robots.txt
 *
 * Served by a function rather than dropped in public/ for one reason: the
 * Sitemap line has to be an absolute URL, and this repo answers on more than one
 * host (tg-widgets.vercel.app, widgets.travelify.io, every preview deployment,
 * and whatever domain Tripbuster ends up on). A hard-coded hostname would be
 * wrong on all but one of them, and a Sitemap line pointing at the wrong host is
 * ignored.
 *
 * SCOPE: this is deliberately narrow. It disallows the API, the Tripbuster
 * advertiser dashboard and the owner console, and allows everything else, which is what was already
 * happening when there was no robots.txt at all. The widget product's own
 * indexing posture — the client dashboard at /, the editor pages — is a separate
 * decision and is not being made here by accident.
 *
 * Note what is NOT disallowed: /tripbuster/search. It carries a noindex tag
 * instead, and a crawler has to be allowed to fetch a page in order to see that
 * it should not keep it. Disallowing it would leave the URL indexable-by-link
 * with no way for us to say otherwise.
 */
import { siteOrigin } from './_lib/tripbuster/seo.js';

export default function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }

  const origin = siteOrigin(req);

  const body = `# Tripbuster and the Travelgenix widget suite
User-agent: *
Disallow: /api/
Disallow: /tripbuster/dashboard
Disallow: /tripbuster/admin
Allow: /

Sitemap: ${origin}/tripbuster/sitemap.xml
`;

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).send(body);
}
