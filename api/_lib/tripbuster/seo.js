/**
 * Tripbuster SEO — the document shell, the meta tags and the structured data.
 *
 * Everything a crawler reads is built here, so there is one place to change a
 * title template and one place to check what we are claiming about a holiday.
 *
 * WHAT WE DELIBERATELY DO NOT EMIT
 *
 * No aggregateRating. Deals carry a guest_score, but that number is typed in by
 * the advertising agent and we have not verified it or collected a single review
 * ourselves. Publishing it as review structured data would tell Google we hold
 * ratings we do not hold. That is a manual-action risk, and under the DMCC Act
 * it is a consumer-protection risk too. If we ever want star ratings in the
 * search results we have to earn them by collecting real reviews.
 *
 * Prices, savings and agent counts ARE emitted, because those come from the
 * advertiser's own listing and are exactly what the page shows a traveller.
 */

const SITE_NAME = 'Tripbuster';
const BASE_PATH = '/tripbuster';

/**
 * The origin every canonical URL is written against.
 *
 * Set TRIPBUSTER_SITE_ORIGIN once Tripbuster has its own domain. Until then this
 * falls back to whichever host answered the request, which is honest but leaves
 * the preview deployments and the production alias each canonicalising to
 * themselves. That is fine while nothing is indexed and MUST be fixed before it
 * is: two hosts serving the same pages with no shared canonical is the textbook
 * way to split your own ranking in half.
 */
export function siteOrigin(req) {
  const configured = (process.env.TRIPBUSTER_SITE_ORIGIN || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  const host = (req && req.headers
    && (req.headers['x-forwarded-host'] || req.headers.host)) || 'tg-widgets.vercel.app';
  const proto = (req && req.headers && req.headers['x-forwarded-proto']) || 'https';
  return `${proto}://${String(host).split(',')[0].trim()}`;
}

/** Absolute URL for an internal path. Canonicals and sitemaps need absolutes. */
export function absolute(req, path) {
  return siteOrigin(req) + (path.startsWith('/') ? path : `/${path}`);
}

export function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/**
 * Trim to a length without cutting a word in half.
 *
 * Meta descriptions are rewritten by Google roughly as often as they are used,
 * but a description that ends mid-word looks broken in the one case where it is
 * shown verbatim, and it is shown verbatim in social previews every time.
 */
export function clamp(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[,;:.\s]+$/, '')}…`;
}

/** JSON safe to sit inside a <script> element. */
function jsonLdBlock(obj) {
  // `<` is escaped rather than trusted, because a hotel called "</script>" is a
  // page takeover otherwise, and agent-supplied text reaches these fields.
  const json = JSON.stringify(obj).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
}

/**
 * The whole document.
 *
 * Written out here rather than templated from a file because there is no build
 * step in this repo and a serverless function that reads HTML off disk on every
 * request is a cold-start cost for nothing.
 */
export function htmlDocument(opts) {
  const o = opts || {};
  const canonical = o.canonical || '';
  const image = o.image || '';
  const blocks = (o.jsonLd || []).filter(Boolean).map(jsonLdBlock).join('\n');

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
${o.robots ? `<meta name="robots" content="${esc(o.robots)}">` : '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">'}
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
<meta property="og:type" content="${esc(o.ogType || 'website')}">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:locale" content="en_GB">
<meta property="og:title" content="${esc(o.ogTitle || o.title)}">
<meta property="og:description" content="${esc(o.description)}">
${canonical ? `<meta property="og:url" content="${esc(canonical)}">` : ''}
${image ? `<meta property="og:image" content="${esc(image)}">` : ''}
<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${esc(o.ogTitle || o.title)}">
<meta name="twitter:description" content="${esc(o.description)}">
${image ? `<meta name="twitter:image" content="${esc(image)}">` : ''}
${(o.links || []).join('\n')}
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23FF5C39'/%3E%3Cpath d='M6 16h20M19 9l7 7-7 7M10 12v8' stroke='white' stroke-width='2.6' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E">
<link rel="stylesheet" href="/tripbuster/tb-site.css">
${blocks}
</head>
<body>
${o.body || ''}
${(o.scripts || []).join('\n')}
</body>
</html>`;
}

// ── structured data ─────────────────────────────────────────────────────────

export function breadcrumbLd(req, trail) {
  const items = trail.filter((t) => t && t.label);
  if (items.length < 2) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((t, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: t.label,
      ...(t.href ? { item: absolute(req, t.href) } : {}),
    })),
  };
}

/**
 * A deal, as a Product with one Offer per advertising agent.
 *
 * AggregateOffer rather than a single Offer whenever more than one agent
 * advertises the same hotel, because that IS the product: a spread of prices for
 * one holiday. lowPrice is the number the page leads with, so it is the number
 * the markup leads with too.
 *
 * seller is the AGENT, never Tripbuster. We do not sell this and the markup must
 * not imply we do.
 */
export function dealLd(req, deal, canonical) {
  const agents = (deal.compare && deal.compare.length)
    ? deal.compare
    : [{ agent: deal.agent && deal.agent.name, price: deal.priceFrom, slug: deal.slug }];

  const prices = agents.map((a) => Number(a.price)).filter((n) => Number.isFinite(n));
  const currency = deal.currency || 'GBP';

  const offers = prices.length > 1
    ? {
        '@type': 'AggregateOffer',
        priceCurrency: currency,
        lowPrice: Math.min(...prices),
        highPrice: Math.max(...prices),
        offerCount: agents.length,
        offers: agents
          .filter((a) => Number.isFinite(Number(a.price)))
          .map((a) => ({
            '@type': 'Offer',
            price: Number(a.price),
            priceCurrency: currency,
            availability: deal.availability === 'Available'
              ? 'https://schema.org/InStock' : 'https://schema.org/LimitedAvailability',
            url: canonical,
            seller: { '@type': 'TravelAgency', name: a.agent || '' },
          })),
      }
    : (prices.length === 1 ? {
        '@type': 'Offer',
        price: prices[0],
        priceCurrency: currency,
        availability: deal.availability === 'Available'
          ? 'https://schema.org/InStock' : 'https://schema.org/LimitedAvailability',
        url: canonical,
        seller: { '@type': 'TravelAgency', name: (agents[0] && agents[0].agent) || '' },
      } : null);

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: deal.accommodation || deal.title,
    description: clamp(deal.overview || deal.strapline || deal.title, 300),
    url: canonical,
    category: deal.holidayType || 'Package holiday',
  };
  if (deal.image) ld.image = deal.image;
  if (offers) ld.offers = offers;
  if (deal.resort || deal.country) {
    ld.areaServed = {
      '@type': 'Place',
      name: [deal.resort, deal.country].filter(Boolean).join(', '),
    };
  }
  return ld;
}

/** A destination page, as an ordered list of the deals it shows. */
export function itemListLd(req, deals, hrefFor) {
  if (!deals.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    numberOfItems: deals.length,
    itemListElement: deals.map((d, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: d.accommodation || d.title,
      url: absolute(req, hrefFor(d)),
    })),
  };
}

/**
 * Who we are and what we are not.
 *
 * Emitted on the home page only. The description says "advertising platform" on
 * purpose: it is the plainest way to tell both a crawler and a person reading a
 * knowledge panel that we do not sell holidays.
 */
export function siteLd(req) {
  const origin = siteOrigin(req);
  return [{
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: `${origin}${BASE_PATH}`,
    inLanguage: 'en-GB',
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${origin}${BASE_PATH}/search?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  }, {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: `${origin}${BASE_PATH}`,
    description: 'An advertising platform where independent UK travel agents list '
      + 'holiday deals. Travellers compare prices then book direct with the agent. '
      + 'Tripbuster does not sell holidays and does not take bookings.',
  }];
}

export { SITE_NAME, BASE_PATH };
