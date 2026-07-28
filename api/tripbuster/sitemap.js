/**
 * Tripbuster sitemap — GET /tripbuster/sitemap.xml
 *
 * Generated from the live catalogue on every (cached) request rather than
 * written to a file, because the catalogue is the thing that changes. A deal
 * that expires overnight drops out of here the next morning without anybody
 * remembering to regenerate anything.
 *
 * lastmod is the real timestamp of the thing the URL describes. That matters
 * more than it looks: a sitemap that claims every page changed today, every day,
 * gets its lastmod ignored entirely, and then a genuinely repriced deal queues
 * behind fifty pages that did not move.
 *
 * priority is deliberately conservative and mostly ignored by Google anyway. The
 * ordering it expresses is the honest one for this site: destination pages are
 * what people search for, individual deals are what they land on afterwards.
 */
import { tbConfigured, tbRpc } from '../_lib/tripbuster/db.js';
import { siteOrigin } from '../_lib/tripbuster/seo.js';
// Same module the pages render from, so a type's URL slug is defined once.
import * as TB from '../../public/tripbuster/tb-site.js';

// Google stops reading a sitemap at 50,000 URLs or 50MB. We are a very long way
// from either, but a cap that is never hit still beats discovering the limit in
// production, and a sitemap index can be added the day this fires.
const MAX_URLS = 45000;

function xmlEscape(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function isoDay(value) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function urlNode(loc, lastmod, changefreq, priority) {
  return `  <url>
    <loc>${xmlEscape(loc)}</loc>${lastmod ? `
    <lastmod>${lastmod}</lastmod>` : ''}
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }

  const origin = siteOrigin(req);
  const base = `${origin}/tripbuster`;

  if (!tbConfigured()) {
    // Still a valid sitemap, listing only the pages that exist without a
    // database. An empty 200 is better than a 500 that makes Search Console
    // report the sitemap as broken.
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlNode(base, '', 'daily', '1.0')}
</urlset>`);
  }

  let data;
  try {
    data = await tbRpc('tb_sitemap', {});
  } catch (e) {
    console.error('[tripbuster/sitemap] failed', e && e.code);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).end();
  }

  const destinations = (data && data.destinations) || {};
  const countries = Array.isArray(destinations.countries) ? destinations.countries : [];
  const resorts = Array.isArray(destinations.resorts) ? destinations.resorts : [];
  const deals = Array.isArray(data && data.deals) ? data.deals : [];
  const agents = Array.isArray(data && data.agents) ? data.agents : [];

  const urls = [
    urlNode(base, isoDay(data && data.generated), 'daily', '1.0'),
    urlNode(`${base}/destinations`, isoDay(data && data.generated), 'daily', '0.9'),
  ];

  // Trip types sit high on purpose. There are at most seven of them, they never
  // expire, and "cruises" is the sort of thing somebody actually types into
  // Google — unlike any single deal, which is gone in a fortnight.
  const tripTypes = Array.isArray(data && data.tripTypes) ? data.tripTypes : [];
  if (tripTypes.length) {
    urls.push(urlNode(`${base}/trips`, isoDay(data && data.generated), 'weekly', '0.9'));
  }
  tripTypes.forEach((t) => {
    const meta = TB.tripTypeByName(t.holiday_type);
    if (!meta) return;   // a type with no page defined is simply not listed
    urls.push(urlNode(`${base}/trips/${encodeURIComponent(meta.slug)}`,
      isoDay(t.last_change), 'daily', '0.8'));
  });

  if (agents.length) {
    urls.push(urlNode(`${base}/agents`, isoDay(data && data.generated), 'weekly', '0.8'));
  }
  agents.forEach((a) => {
    // An agency page changes when their deals do, which is what lastmod carries.
    urls.push(urlNode(`${base}/agent/${encodeURIComponent(a.slug)}`,
      isoDay(a.lastChange), 'daily', '0.7'));
  });

  countries.forEach((c) => {
    urls.push(urlNode(`${base}/holidays/${encodeURIComponent(c.slug)}`,
      isoDay(c.last_change), 'daily', '0.8'));
  });

  resorts.forEach((r) => {
    urls.push(urlNode(
      `${base}/holidays/${encodeURIComponent(r.country_slug)}/${encodeURIComponent(r.slug)}`,
      isoDay(r.last_change), 'daily', '0.7',
    ));
  });

  deals.forEach((d) => {
    if (urls.length >= MAX_URLS) return;
    urls.push(urlNode(`${base}/holiday/${encodeURIComponent(d.slug)}`,
      isoDay(d.lastmod), 'weekly', '0.6'));
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=1800, stale-while-revalidate=86400');
  return res.status(200).send(xml);
}
