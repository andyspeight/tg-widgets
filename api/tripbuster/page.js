/**
 * Tripbuster server-rendered pages
 *
 *   /tripbuster/holiday/<slug>                  one deal, every agent selling it
 *   /tripbuster/holidays/<country>              a country landing page
 *   /tripbuster/holidays/<country>/<resort>     a resort landing page
 *   /tripbuster/destinations                    the hub that links to them all
 *   /tripbuster/deal?id=<uuid>                  legacy, 301s to the real URL
 *
 * WHY THIS IS RENDERED ON THE SERVER AT ALL
 *
 * Tripbuster is a comparison site. Search is not one acquisition channel among
 * several, it is the channel, and until this existed every deal page carried a
 * noindex and rendered its entire body from JavaScript after two round trips.
 * There was nothing to rank and we had told Google not to look anyway.
 *
 * Google does execute JavaScript, but it does it late, unpredictably, and in a
 * second pass that a new site with no crawl budget waits a long time for. HTML
 * that already contains the hotel, the resort, the price and the agents costs us
 * one database call and removes the whole question.
 *
 * THE MARKUP IS NOT WRITTEN TWICE. Every function that produces HTML here comes
 * from public/tripbuster/tb-site.js — the same module the browser loads. See the
 * note at the top of that file.
 *
 * WHAT THE BROWSER STILL DOES: re-renders the booking panel once, because that
 * block depends on the clock (is this agency open) and on the device (does a tap
 * dial or reveal), and this response is cached at the edge for five minutes. The
 * static half of the page is left exactly as it was sent.
 */
import { tbConfigured, tbRpc } from '../_lib/tripbuster/db.js';
import { toDeal } from '../_lib/tripbuster/deal-view.js';
import * as TB from '../../public/tripbuster/tb-site.js';
import {
  htmlDocument, absolute, clamp, esc,
  breadcrumbLd, dealLd, itemListLd, siteLd, SITE_NAME,
} from '../_lib/tripbuster/seo.js';

// Long enough that a burst of crawler traffic never reaches Postgres, short
// enough that a price change is public within the hour. stale-while-revalidate
// does the rest: nobody waits for a rebuild, they just get the previous copy.
const CACHE = 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function str(v, max = 120) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}

/** The page chrome every rendered page shares. */
function shell(bodyHtml, opts) {
  return htmlDocument({
    ...opts,
    body: `${TB.header(opts.navActive || '')}
<main id="main" class="wrap">
${bodyHtml}
</main>
${TB.footer()}`,
  });
}

function sendHtml(res, status, html, cacheControl) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', cacheControl);
  // The pages are all first-party and same-origin; nothing here should ever be
  // framed by somebody else's site.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(status).send(html);
}

/**
 * A dead end, said plainly.
 *
 * noindex on purpose: a soft 404 that returns 200 with "nothing here" is how a
 * site ends up with thousands of indexed empty pages. This one is a real 404 AND
 * tells the crawler not to keep it.
 */
function notFound(req, res, what) {
  const html = shell(
    `<div class="empty" style="margin:40px 0"><b>${esc(what.title)}</b>${esc(what.body)}
     <a href="/tripbuster/search">Browse every deal</a> or
     <a href="/tripbuster/destinations">pick a destination</a>.</div>`,
    {
      title: `${what.title} | ${SITE_NAME}`,
      description: what.body,
      robots: 'noindex, follow',
    },
  );
  return sendHtml(res, 404, html, 'public, max-age=0, s-maxage=60');
}

function unavailable(req, res) {
  const html = shell(
    '<div class="empty" style="margin:40px 0"><b>We cannot load deals right now</b>'
    + 'Something is wrong at our end rather than yours. Please try again shortly.</div>',
    {
      title: `Temporarily unavailable | ${SITE_NAME}`,
      description: 'Tripbuster could not load deals just now.',
      robots: 'noindex, follow',
    },
  );
  // 503 rather than 200, so a crawler comes back instead of recording the outage
  // as the page's content.
  return sendHtml(res, 503, html, 'no-store');
}

// ── one deal ────────────────────────────────────────────────────────────────

/**
 * The title a traveller sees in the results.
 *
 * Hotel and resort first because that is what people type, price second because
 * that is what makes them click. The brand goes last: it is the least useful
 * word in the line and the first thing Google truncates.
 */
function dealTitle(d) {
  const name = d.accommodation || d.title;
  const place = d.resort || d.country;
  const price = d.priceFrom != null ? ` from ${TB.money(d.priceFrom, d.currency)}pp` : '';
  return clamp(`${name}${place ? `, ${place}` : ''}${price} | ${SITE_NAME}`, 70);
}

function dealDescription(d) {
  const agents = (d.compare && d.compare.length) || 1;
  const who = agents > 1
    ? `Compare ${agents} independent UK travel agents advertising`
    : `${(d.agent && d.agent.name) || 'An independent UK travel agent'} is advertising`;
  const stay = [
    d.nights ? `${d.nights} nights` : '',
    d.board ? d.board.toLowerCase() : '',
  ].filter(Boolean).join(' ');
  const at = `at ${d.accommodation || d.title}`;
  const place = [d.resort, d.country].filter(Boolean).join(', ');
  const price = d.priceFrom != null ? ` from ${TB.money(d.priceFrom, d.currency)}pp` : '';
  return clamp(
    `${who} ${stay} ${at}${place ? ` in ${place}` : ''}${price}. `
    + 'Compare the prices then book direct with the agent.',
    158,
  );
}

async function renderDeal(req, res, slug) {
  if (!SLUG_RE.test(slug)) {
    return notFound(req, res, {
      title: 'We could not find that holiday',
      body: 'That link does not look like one of ours.',
    });
  }

  let data;
  try {
    data = await tbRpc('tb_search_deals', {
      p_deal_slug: slug, p_compare: true, p_limit: 20, p_sort: 'price',
    });
  } catch (e) {
    console.error('[tripbuster/page] deal lookup failed', e && e.code);
    return unavailable(req, res);
  }

  const rows = Array.isArray(data && data.deals) ? data.deals : [];
  if (!rows.length) {
    return notFound(req, res, {
      title: 'This holiday is no longer advertised',
      body: 'It may have sold out, expired, or been taken down by the agent.',
    });
  }

  const deal = toDeal(rows[0]);

  // One hotel, one page, one URL. Every agent advertising the same hotel gets
  // the same page, so asking for a rival's slug redirects here rather than
  // serving a second copy for Google to weigh separately. A single hop, never a
  // chain: the canonical slug always resolves to itself.
  if (deal.canonicalSlug && deal.canonicalSlug !== slug) {
    res.setHeader('Location', `/tripbuster/holiday/${encodeURIComponent(deal.canonicalSlug)}`);
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600');
    return res.status(301).end();
  }

  const canonical = absolute(req, TB.dealHref(deal));
  const trail = TB.dealCrumbs(deal);

  const body = `${TB.dealPage(deal)}
<div class="overlay" id="overlay" role="dialog" aria-modal="true" aria-labelledby="mTitle">
  <div class="modal">
    <div class="modal-top">
      <div class="plane" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M2 12h20M14 5l7 7-7 7M6 8v8"/></svg></div>
      <h2 id="mTitle">Taking you to <span id="mAgent">the agent</span></h2>
      <p>You will finish booking on their website. Tripbuster does not take the booking or handle your payment.</p>
    </div>
    <div class="m-protect">
      <svg viewBox="0 0 24 24"><path d="M12 2 4 5v6c0 5 3.5 8.5 8 11 4.5-2.5 8-6 8-11V5l-8-3Z"/><path d="m9 12 2 2 4-4"/></svg>
      <span id="mProtect"></span>
    </div>
    <div class="modal-acts">
      <button class="btn btn-ghost" type="button" id="mCancel">Stay here</button>
      <a class="btn btn-primary" id="mGo" href="#" target="_blank" rel="noopener nofollow">Continue</a>
    </div>
    <p class="m-note">Tripbuster earns a small fee when you visit an agent. It never changes the price you pay.</p>
  </div>
</div>`;

  const html = shell(body, {
    title: dealTitle(deal),
    ogTitle: `${deal.accommodation || deal.title}${deal.resort ? `, ${deal.resort}` : ''}`,
    description: dealDescription(deal),
    canonical,
    ogType: 'product',
    image: deal.image || '',
    jsonLd: [breadcrumbLd(req, trail), dealLd(req, deal, canonical)],
    scripts: [
      // Handed to the browser as data rather than re-fetched. The page already
      // has everything; a second request for the same deal would only add a
      // spinner.
      `<script type="application/json" id="tb-deal">${
        JSON.stringify(deal).replace(/</g, '\\u003c')}</script>`,
      '<script type="module" src="/tripbuster/deal-page.js"></script>',
    ],
  });

  return sendHtml(res, 200, html, CACHE);
}

// ── the front page ──────────────────────────────────────────────────────────

/**
 * Rendered rather than static for the same reason as everything else here: it is
 * the page every external link points at, so it is the page whose HTML has to
 * carry the content and the canonical.
 *
 * Two calls, not one. The featured strip wants the six biggest savings; the
 * destination tiles want every country that has anything live, which is a
 * different question and the wrong answer if taken from a sample of six.
 */
async function renderHome(req, res) {
  let deals = [];
  let total = 0;
  let countries = [];
  try {
    const [feed, dests] = await Promise.all([
      tbRpc('tb_search_deals', { p_compare: true, p_sort: 'discount', p_limit: 6 }),
      tbRpc('tb_destinations', { p_min_deals: 1 }),
    ]);
    deals = (((feed || {}).deals) || []).map(toDeal);
    total = Number(feed && feed.total) || 0;
    countries = Array.isArray(dests && dests.countries) ? dests.countries : [];
  } catch (e) {
    console.error('[tripbuster/page] home failed', e && e.code);
    return unavailable(req, res);
  }

  // Counted across the whole catalogue rather than the six on show, because
  // "3 independent UK agents" has to be true of Tripbuster, not of this strip.
  const agentNames = new Set();
  deals.forEach((d) => {
    if (d.agent && d.agent.name) agentNames.add(d.agent.name);
    (d.compare || []).forEach((c) => { if (c.agent) agentNames.add(c.agent); });
  });

  const body = TB.homePage({
    deals,
    total,
    agentCount: agentNames.size,
    destinations: countries.slice(0, 6).map((c) => ({
      name: c.name, slug: c.slug, minPrice: c.min_price != null ? Number(c.min_price) : null,
    })),
  });

  const html = htmlDocument({
    title: `${SITE_NAME} — compare cheap holidays from independent UK travel agents`,
    description: 'Compare package holiday deals from independent UK travel agents, then '
      + 'book direct with them. No booking fee, no middleman markup.',
    canonical: absolute(req, '/tripbuster'),
    image: deals.length ? deals[0].image : '',
    jsonLd: siteLd(req),
    body: `${TB.header('home')}
<main id="main">
${body}
</main>
${TB.footer()}`,
    scripts: [
      `<script type="application/json" id="tb-shown">${
        JSON.stringify(deals.map((d) => d.id))}</script>`,
      '<script type="module" src="/tripbuster/list-page.js"></script>',
    ],
  });

  return sendHtml(res, 200, html, CACHE);
}

// ── a destination ───────────────────────────────────────────────────────────

function destinationCopy(place) {
  const name = place.resort || place.country;
  const where = place.resort ? `${place.resort}, ${place.country}` : place.country;
  const from = place.minPrice != null
    ? ` from ${TB.money(place.minPrice, 'GBP')}pp` : '';
  return {
    h1: `${name} holidays`,
    title: clamp(`Cheap ${name} holidays${from} | ${SITE_NAME}`, 70),
    description: clamp(
      `${place.dealCount} ${where} holiday deal${place.dealCount === 1 ? '' : 's'} from `
      + `${place.agentCount} independent UK travel agent${place.agentCount === 1 ? '' : 's'}`
      + `${from}. Compare the prices then book direct with the agent.`,
      158,
    ),
  };
}

async function renderDestination(req, res, countrySlug, resortSlug) {
  if (!SLUG_RE.test(countrySlug) || (resortSlug && !SLUG_RE.test(resortSlug))) {
    return notFound(req, res, {
      title: 'We could not find that destination',
      body: 'That link does not look like one of ours.',
    });
  }

  let data;
  try {
    data = await tbRpc('tb_destination', {
      p_country_slug: countrySlug,
      p_resort_slug: resortSlug || null,
      p_limit: 24,
    });
  } catch (e) {
    console.error('[tripbuster/page] destination lookup failed', e && e.code);
    return unavailable(req, res);
  }

  // The function returns a null country for a slug nothing live matches, which
  // is the difference between "Spain has no deals this week" and "there is no
  // such place". Only the second is a 404, and right now they are the same
  // thing: a country page exists exactly while somebody is advertising there.
  if (!data || !data.country) {
    return notFound(req, res, {
      title: 'Nothing advertised there at the moment',
      body: 'No agent has a live deal for that destination just now.',
    });
  }

  const place = {
    country: data.country,
    countrySlug: data.countrySlug,
    resort: data.resort,
    resortSlug: data.resortSlug,
    dealCount: Number(data.dealCount) || 0,
    agentCount: Number(data.agentCount) || 0,
    minPrice: data.minPrice != null ? Number(data.minPrice) : null,
    maxDiscount: Number(data.maxDiscount) || 0,
  };
  const deals = (((data.results || {}).deals) || []).map(toDeal);
  const children = Array.isArray(data.children) ? data.children : [];
  const copy = destinationCopy(place);

  const trail = [{ label: 'Home', href: '/tripbuster' },
    { label: 'Destinations', href: '/tripbuster/destinations' }];
  if (place.resort) {
    trail.push({ label: place.country, href: TB.destinationHref(place.countrySlug) });
    trail.push({ label: place.resort });
  } else {
    trail.push({ label: place.country });
  }

  const canonical = absolute(req, TB.destinationHref(place.countrySlug, place.resortSlug));

  const facts = [
    `${place.dealCount} deal${place.dealCount === 1 ? '' : 's'} live now`,
    `${place.agentCount} agent${place.agentCount === 1 ? '' : 's'}`,
    place.minPrice != null ? `from ${TB.money(place.minPrice, 'GBP')}pp` : '',
    place.maxDiscount ? `up to ${place.maxDiscount}% off` : '',
  ].filter(Boolean);

  const body = `${TB.crumbs(trail)}
<header class="dest-head">
  <h1>${esc(copy.h1)}</h1>
  <p class="dest-lead">Every deal below is advertised by an independent UK travel agent.
    Compare their prices, then book direct with whichever one you pick.</p>
  <div class="chips">${facts.map((f) => `<span class="chip">${esc(f)}</span>`).join('')}</div>
</header>
${children.length ? `<nav class="dest-kids" aria-label="Resorts in ${esc(place.country)}">
  <h2>Where in ${esc(place.country)}</h2>
  <ul>${children.map((c) => `<li><a href="${
    esc(TB.destinationHref(place.countrySlug, c.slug))}"><b>${esc(c.name)}</b>
    <span>${c.dealCount} deal${c.dealCount === 1 ? '' : 's'}${
  c.minPrice != null ? `, from ${esc(TB.money(c.minPrice, 'GBP'))}pp` : ''}</span></a></li>`).join('')}</ul>
</nav>` : ''}
<section class="grid">${deals.map((d) => TB.dealCard(d)).join('')}</section>
${deals.length ? TB.rankingNote() : ''}
${deals.length >= 24 ? `<p class="dest-more"><a class="btn btn-dark" href="/tripbuster/search?country=${
  encodeURIComponent(place.country)}${place.resort ? `&resort=${encodeURIComponent(place.resort)}` : ''}">
  See all ${place.dealCount} deals</a></p>` : ''}`;

  const html = shell(body, {
    title: copy.title,
    ogTitle: copy.h1,
    description: copy.description,
    canonical,
    navActive: 'Destinations',
    image: deals.length ? deals[0].image : '',
    jsonLd: [breadcrumbLd(req, trail), itemListLd(req, deals, (d) => TB.dealHref(d))],
    scripts: [
      `<script type="application/json" id="tb-shown">${
        JSON.stringify(deals.map((d) => d.id))}</script>`,
      '<script type="module" src="/tripbuster/list-page.js"></script>',
    ],
  });

  return sendHtml(res, 200, html, CACHE);
}

// ── trip types ──────────────────────────────────────────────────────────────
//
// Somebody googling "cruises from Southampton" had nothing to land on: the only
// way to see a cruise was to know the search filter existed, and search is
// noindex on purpose. These pages are the answer, built the same way the
// destination pages are, off the same single read path with p_holiday_type set.

async function renderTripType(req, res, slug) {
  const meta = TB.tripTypeBySlug(slug);
  // An unknown slug is a 404 rather than an empty list. The seven are fixed by
  // the CHECK constraint, so anything else is a typo or a probe.
  if (!meta) {
    return notFound(req, res, {
      title: 'We do not have that kind of trip',
      body: 'Try the full list of what our agents are advertising.',
    });
  }

  let data;
  let counts;
  try {
    [data, counts] = await Promise.all([
      tbRpc('tb_search_deals', {
        p_holiday_type: meta.type, p_compare: false, p_sort: 'discount', p_limit: 24,
      }),
      tbRpc('tb_trip_types', {}).catch(() => null),
    ]);
  } catch (e) {
    console.error('[tripbuster/page] trip type failed', e && e.code);
    return unavailable(req, res);
  }

  const deals = (((data || {}).deals) || []).map(toDeal);
  // A type nobody is advertising has no page. Same rule as a destination: the
  // page exists exactly while somebody is selling one.
  if (!deals.length) {
    return notFound(req, res, {
      title: `No ${esc(meta.one)}s advertised at the moment`,
      body: 'No agent has one live just now. There is plenty else on.',
    });
  }

  const row = (Array.isArray(counts) ? counts : [])
    .find((r) => r.holiday_type === meta.type) || {};
  const total = Number(row.deals) || deals.length;
  const facts = [
    `${total} live now`,
    row.agents ? `${row.agents} agent${Number(row.agents) === 1 ? '' : 's'}` : '',
    row.countries ? `${row.countries} countr${Number(row.countries) === 1 ? 'y' : 'ies'}` : '',
    row.min_price != null ? `from ${TB.money(row.min_price, 'GBP')}pp` : '',
    row.max_discount ? `up to ${row.max_discount}% off` : '',
  ].filter(Boolean);

  const trail = [
    { label: 'Home', href: '/tripbuster' },
    { label: 'Types of trip', href: '/tripbuster/trips' },
    { label: meta.plural },
  ];
  const canonical = absolute(req, TB.tripTypeHref(meta.slug));

  const body = `${TB.crumbs(trail)}
<header class="dest-head">
  <h1>${esc(meta.plural)} from independent UK travel agents</h1>
  <p class="dest-lead">${esc(meta.lead)}</p>
  <div class="chips">${facts.map((f) => `<span class="chip">${esc(f)}</span>`).join('')}</div>
</header>
${TB.searchForm({ holidayType: meta.type, placeholder: meta.placeholder })}
<section class="grid">${deals.map((d) => TB.dealCard(d)).join('')}</section>
${TB.rankingNote()}
${total > deals.length ? `<p class="dest-more"><a class="btn btn-dark" href="/tripbuster/search?holidayType=${
  encodeURIComponent(meta.type)}">See all ${total} ${esc(meta.plural.toLowerCase())}</a></p>` : ''}`;

  const html = shell(body, {
    title: clamp(`${meta.plural} from UK travel agents | ${SITE_NAME}`, 70),
    ogTitle: meta.plural,
    description: clamp(`${total} ${meta.plural.toLowerCase()} advertised by independent UK `
      + `travel agents${row.min_price != null ? `, from ${TB.money(row.min_price, 'GBP')}pp` : ''}. `
      + 'Compare the prices then book direct with the agent.', 158),
    canonical,
    navActive: meta.slug === 'cruises' ? 'Cruises' : (meta.slug === 'flights' ? 'Flights' : ''),
    image: deals.length ? deals[0].image : '',
    jsonLd: [breadcrumbLd(req, trail), itemListLd(req, deals, (d) => TB.dealHref(d))],
    scripts: [
      `<script type="application/json" id="tb-shown">${
        JSON.stringify(deals.map((d) => d.id))}</script>`,
      '<script type="module" src="/tripbuster/list-page.js"></script>',
    ],
  });

  return sendHtml(res, 200, html, CACHE);
}

async function renderTripTypeIndex(req, res) {
  let rows;
  try {
    rows = await tbRpc('tb_trip_types', {});
  } catch (e) {
    console.error('[tripbuster/page] trip types failed', e && e.code);
    return unavailable(req, res);
  }
  const list = Array.isArray(rows) ? rows : [];
  const trail = [{ label: 'Home', href: '/tripbuster' }, { label: 'Types of trip' }];
  const named = list.map((r) => TB.tripTypeByName(r.holiday_type)).filter(Boolean);

  const body = `${TB.crumbs(trail)}
<header class="dest-head">
  <h1>What our agents are advertising</h1>
  <p class="dest-lead">Not just package holidays. Independent agents sell the awkward
    things a website is bad at, which is exactly when it is worth ringing one.</p>
</header>
${TB.tripTypeDirectory(list)}`;

  const html = shell(body, {
    title: `Types of trip from UK travel agents | ${SITE_NAME}`,
    ogTitle: 'What our agents are advertising',
    description: clamp(`${named.map((m) => m.plural.toLowerCase()).join(', ')} `
      + 'from independent UK travel agents. Compare the prices then book direct.', 158),
    canonical: absolute(req, '/tripbuster/trips'),
    jsonLd: [breadcrumbLd(req, trail), itemListLd(req, named.map((m) => ({
      title: m.plural, id: m.slug,
    })), (m) => TB.tripTypeHref(m.id))],
  });

  return sendHtml(res, 200, html, CACHE);
}

// ── the hub ─────────────────────────────────────────────────────────────────
//
// Every destination page needs a crawlable path from the home page, and a link
// in the footer of every page is that path. Without it a country page only
// exists if a deal happens to be on the front page today.

async function renderDestinationIndex(req, res) {
  let data;
  try {
    data = await tbRpc('tb_destinations', { p_min_deals: 1 });
  } catch (e) {
    console.error('[tripbuster/page] destinations failed', e && e.code);
    return unavailable(req, res);
  }

  const countries = Array.isArray(data && data.countries) ? data.countries : [];
  const resorts = Array.isArray(data && data.resorts) ? data.resorts : [];
  const trail = [{ label: 'Home', href: '/tripbuster' }, { label: 'Destinations' }];

  const byCountry = countries.map((c) => {
    const kids = resorts.filter((r) => r.country_slug === c.slug);
    return `<section class="dest-block">
      <h2><a href="${esc(TB.destinationHref(c.slug))}">${esc(c.name)}</a>
        <span class="dest-count">${c.deal_count} deal${c.deal_count === 1 ? '' : 's'}${
  c.min_price != null ? `, from ${esc(TB.money(c.min_price, 'GBP'))}pp` : ''}</span></h2>
      ${kids.length ? `<ul class="dest-list">${kids.map((r) => `<li><a href="${
    esc(TB.destinationHref(c.slug, r.slug))}">${esc(r.name)}
        <span>${r.deal_count}</span></a></li>`).join('')}</ul>` : ''}
    </section>`;
  }).join('');

  const total = countries.reduce((n, c) => n + Number(c.deal_count || 0), 0);

  const body = `${TB.crumbs(trail)}
<header class="dest-head">
  <h1>Where UK agents are advertising this week</h1>
  <p class="dest-lead">${total} live deal${total === 1 ? '' : 's'} across
    ${countries.length} countr${countries.length === 1 ? 'y' : 'ies'} and
    ${resorts.length} resort${resorts.length === 1 ? '' : 's'}. This list is built from
    what agents actually have on right now, so it changes as their deals do.</p>
</header>
<div class="dest-cols">${byCountry}</div>`;

  const html = shell(body, {
    title: `Holiday destinations from UK travel agents | ${SITE_NAME}`,
    description: clamp(
      `Browse ${total} holiday deals across ${countries.length} countries and `
      + `${resorts.length} resorts, all advertised by independent UK travel agents.`,
      158,
    ),
    canonical: absolute(req, '/tripbuster/destinations'),
    navActive: 'Destinations',
    jsonLd: [breadcrumbLd(req, trail)],
  });

  return sendHtml(res, 200, html, CACHE);
}

// ── an agency ───────────────────────────────────────────────────────────────

async function renderAgent(req, res, slug) {
  if (!SLUG_RE.test(slug)) {
    return notFound(req, res, {
      title: 'We could not find that agency',
      body: 'That link does not look like one of ours.',
    });
  }

  let p;
  try {
    p = await tbRpc('tb_agent_profile', { p_slug: slug, p_limit: 24 });
  } catch (e) {
    console.error('[tripbuster/page] agent lookup failed', e && e.code);
    return unavailable(req, res);
  }
  // Null covers both "no such agency" and "not trading", deliberately. A paused
  // agency's page should go away rather than linger with stale deals on it.
  if (!p || !p.name) {
    return notFound(req, res, {
      title: 'That agency is not advertising with us',
      body: 'They may have paused their account.',
    });
  }

  const deals = (((p.results || {}).deals) || []).map(toDeal);
  const where = [p.town, p.region].filter(Boolean).join(', ');
  const canonical = absolute(req, TB.agentHref(p.slug));
  const trail = [
    { label: 'Home', href: '/tripbuster' },
    { label: 'Our agents', href: '/tripbuster/agents' },
    { label: p.name },
  ];

  // TravelAgency, because that is what they are. Tripbuster is not the seller
  // and must not appear as one anywhere in this markup.
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'TravelAgency',
    name: p.name,
    url: canonical,
    ...(p.about ? { description: clamp(p.about, 300) } : {}),
    ...(p.website ? { sameAs: [p.website] } : {}),
    ...(where ? { address: { '@type': 'PostalAddress', addressLocality: p.town || where, addressCountry: 'GB' } } : {}),
  };
  const phone = ((p.contact || {}).phones || [])[0];
  if (phone && phone.phone) ld.telephone = phone.phone;

  const html = shell(`${TB.crumbs(trail)}${TB.agentProfile(p, deals)}`, {
    title: clamp(`${p.name}${where ? `, ${where}` : ''} — holiday deals | ${SITE_NAME}`, 70),
    ogTitle: p.name,
    description: clamp(
      p.about
        ? `${p.name}${where ? ` in ${where}` : ''}. ${p.about}`
        : `${p.name}${where ? ` in ${where}` : ''} advertises ${p.liveDeals} holiday`
          + `${p.liveDeals === 1 ? '' : 's'} on Tripbuster. Book direct with them.`,
      158,
    ),
    canonical,
    navActive: 'Our agents',
    image: deals.length ? deals[0].image : '',
    jsonLd: [breadcrumbLd(req, trail), ld],
    scripts: [
      `<script type="application/json" id="tb-shown">${
        JSON.stringify(deals.map((d) => d.id))}</script>`,
      '<script type="module" src="/tripbuster/list-page.js"></script>',
    ],
  });

  return sendHtml(res, 200, html, CACHE);
}

async function renderAgentIndex(req, res) {
  let list;
  try {
    list = await tbRpc('tb_agents_public', {});
  } catch (e) {
    console.error('[tripbuster/page] agents failed', e && e.code);
    return unavailable(req, res);
  }
  const agents = Array.isArray(list) ? list : [];
  const trail = [{ label: 'Home', href: '/tripbuster' }, { label: 'Our agents' }];
  const towns = [...new Set(agents.map((a) => a.town).filter(Boolean))];

  const body = `${TB.crumbs(trail)}
<header class="dest-head">
  <h1>The agents advertising on Tripbuster</h1>
  <p class="dest-lead">Independent UK travel agents, most of them small, most of them
    with a shop and a phone somebody actually answers. You book with them direct,
    and they hold the financial protection for your trip.</p>
</header>
${TB.agentDirectory(agents)}`;

  const html = shell(body, {
    title: `Independent UK travel agents | ${SITE_NAME}`,
    description: clamp(
      `${agents.length} independent UK travel agent${agents.length === 1 ? '' : 's'} `
      + `advertising holidays on Tripbuster${towns.length ? `, from ${towns.slice(0, 4).join(', ')}` : ''}. `
      + 'Compare their prices then book direct.',
      158,
    ),
    canonical: absolute(req, '/tripbuster/agents'),
    navActive: 'Our agents',
    jsonLd: [breadcrumbLd(req, trail), itemListLd(req, agents.map((a) => ({
      accommodation: a.name, title: a.name, slug: a.slug,
    })), (a) => TB.agentHref(a.slug))],
  });

  return sendHtml(res, 200, html, CACHE);
}

// ── the old URL ─────────────────────────────────────────────────────────────

/**
 * /tripbuster/deal?id=<uuid> — permanently moved.
 *
 * A 301 rather than a rewrite, because two URLs serving the same page is exactly
 * the duplicate-content split the slugs were introduced to avoid. Anything
 * already shared or bookmarked lands on the real page and passes its value there.
 */
async function redirectLegacy(req, res, id) {
  if (!UUID_RE.test(id)) {
    return notFound(req, res, {
      title: 'We could not find that deal',
      body: 'The link may be out of date.',
    });
  }
  let data;
  try {
    data = await tbRpc('tb_search_deals', { p_compare: false, p_limit: 60 });
  } catch (e) {
    return unavailable(req, res);
  }
  const hit = (((data && data.deals) || [])).find((r) => r.id === id);
  const target = hit && (hit.canonical_slug || hit.slug);
  if (!target) {
    return notFound(req, res, {
      title: 'This deal is no longer available',
      body: 'It may have sold out or expired.',
    });
  }
  // Straight to the canonical page, not to this deal's own slug, or an old link
  // would redirect twice.
  res.setHeader('Location', `/tripbuster/holiday/${encodeURIComponent(target)}`);
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600');
  return res.status(301).end();
}

// ── routing ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!tbConfigured()) return unavailable(req, res);

  const q = req.query || {};
  const type = str(q.type, 20);

  try {
    if (type === 'home') return await renderHome(req, res);
    if (type === 'deal') return await renderDeal(req, res, str(q.slug, 140));
    if (type === 'destinations') return await renderDestinationIndex(req, res);
    if (type === 'agent') return await renderAgent(req, res, str(q.slug, 90));
    if (type === 'agents') return await renderAgentIndex(req, res);
    if (type === 'trip') return await renderTripType(req, res, str(q.slug, 40));
    if (type === 'trips') return await renderTripTypeIndex(req, res);
    if (type === 'destination') {
      return await renderDestination(req, res, str(q.country, 80), str(q.resort, 80));
    }
    if (type === 'legacy') return await redirectLegacy(req, res, str(q.id, 64));
  } catch (e) {
    console.error('[tripbuster/page] render failed', e && e.message);
    return unavailable(req, res);
  }

  return notFound(req, res, {
    title: 'Page not found',
    body: 'There is nothing at that address.',
  });
}
