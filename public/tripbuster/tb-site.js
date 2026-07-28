/*
 * Tripbuster consumer site — shared helpers and markup.
 *
 * THIS FILE RUNS IN TWO PLACES. The browser loads it as an ES module from
 * index.html, search.html and deal.html. The Vercel renderer in
 * api/tripbuster/page.js IMPORTS THE SAME FILE and calls the same functions to
 * produce the HTML a search engine receives.
 *
 * That is the whole reason it is a module rather than the IIFE it used to be.
 * The alternative was a second copy of every piece of markup living on the
 * server, and we already know how that ends: the opening-hours rules exist three
 * times, and the only thing keeping them honest is a test that runs two of them
 * side by side. One copy needs no such test.
 *
 * WHAT THAT COSTS: nothing here may touch `window`, `document`, `navigator` or
 * `fetch` at module scope. Every browser-only call sits inside a function body
 * that the server never reaches, and `dialer()` returns null rather than
 * guessing when there is no window to ask.
 *
 * Everything that reaches innerHTML goes through esc() first. Deal text is
 * written by travel agents, so these pages treat it as untrusted even though an
 * agent had to sign in to enter it.
 */

export var API = '/api/tripbuster';

export function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// Only absolute http(s) links leave these pages, and they always carry
// rel="noopener nofollow" — the destination is a third-party site.
export function safeUrl(u) {
  if (!u) return '';
  try {
    var url = new URL(String(u).trim());
    return (url.protocol === 'http:' || url.protocol === 'https:') ? url.toString() : '';
  } catch (e) {
    return '';
  }
}

var SYMBOLS = { GBP: '£', EUR: '€', USD: '$' };
export function money(amount, currency) {
  var n = Number(amount);
  if (!isFinite(n)) return '';
  return (SYMBOLS[currency] || SYMBOLS.GBP) + n.toLocaleString('en-GB');
}
export function num(n) { return Number(n || 0).toLocaleString('en-GB'); }

// Deterministic gradient per destination, so a deal with no photo still looks
// deliberate and looks the same on every page.
export function gradClass(seed) {
  var s = String(seed || '');
  var h = 0;
  for (var i = 0; i < s.length; i++) h = (h + s.charCodeAt(i)) % 6;
  return 'g' + h;
}

export var IC = {
  pin: '<path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0Z"/><circle cx="12" cy="10" r="3"/>',
  moon: '<path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="4"/>',
  plane: '<path d="M2 22h20M6 18l14-4M6 18l-2-6 3-1 4 3 5-1L9 3l2-1 8 8"/>',
  board: '<path d="M3 11h18M5 11V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4M4 11v7M20 11v7"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  shield: '<path d="M12 2 4 5v6c0 5 3.5 8.5 8 11 4.5-2.5 8-6 8-11V5l-8-3Z"/><path d="m9 12 2 2 4-4"/>',
  arrow: '<path d="M7 17 17 7M9 7h8v8"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  chev: '<path d="m6 9 6 6 6-6"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/>',
  tick: '<path d="M20 6 9 17l-5-5"/>',
  chevRight: '<path d="m9 18 6-6-6-6"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
};

export function svg(paths, extra) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' +
    (extra ? ' ' + extra : '') + '>' + paths + '</svg>';
}

export function starsMarkup(n) {
  var out = '';
  for (var i = 0; i < (Number(n) || 0); i++) {
    out += '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/></svg>';
  }
  return out ? '<span class="stars" role="img" aria-label="' + Number(n) + ' star hotel">' + out + '</span>' : '';
}

export function scoreColour(s) { return s >= 9 ? '#0CA678' : s >= 8 ? '#12A0D4' : '#5B93B0'; }
export function scoreWord(s) { return s >= 9 ? 'Superb' : s >= 8.5 ? 'Excellent' : s >= 8 ? 'Very good' : 'Good'; }

// ── where things live ───────────────────────────────────────────────────────
//
// Every internal link is built here rather than written out at each call site.
// A URL that appears in eight places is a URL that will only be changed in
// seven of them, and a comparison site that quietly starts 404ing half its own
// links has thrown away the only acquisition channel it has.

// The Unicode combining-diacritic block, built from escape sequences. Written
// out literally it is a range of invisible characters, which is unreadable in
// every editor and has been silently mangled by tooling here before.
var COMBINING = new RegExp('[\\u0300-\\u036f]', 'g');

/** Turn any text into the same URL-safe slug the database's tb_slugify makes. */
export function slugify(text) {
  return String(text === null || text === undefined ? '' : text)
    .normalize('NFD').replace(COMBINING, '')
    .replace(/ß/g, 'ss').replace(/[æÆ]/g, 'ae').replace(/[øØ]/g, 'o')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * The page a deal appears on.
 *
 * canonicalSlug first, and that is the whole point. A deal page shows every
 * agent advertising the same hotel, so three agents share one page, and the
 * group agrees on one URL: the earliest published deal in it. Linking to a
 * deal's own slug instead would send half the internal links through a redirect
 * and ask Google to index three copies of one page.
 *
 * Slugs are minted by the database at first publish and never change after, so
 * these links are safe to print, share and index. The legacy query-string form
 * is a fallback for a deal that somehow has no slug at all; /tripbuster/deal
 * redirects it rather than serving a second page with the same content on it.
 */
export function dealHref(d) {
  var slug = d && (d.canonicalSlug || d.slug
    || (d.compare && d.compare[0] && d.compare[0].slug));
  if (slug) return '/tripbuster/holiday/' + encodeURIComponent(slug);
  return '/tripbuster/deal?id=' + encodeURIComponent((d && d.id) || '');
}

/**
 * An agency's own page.
 *
 * The independent agent is the entire differentiator: the big comparison sites
 * cannot show you a person in a shop who will answer the phone. Until this
 * existed, "by Coastline Holidays" on a card was text that went nowhere.
 */
export function agentHref(slug) {
  return '/tripbuster/agent/' + encodeURIComponent(slug || '');
}

/** A country or resort landing page. Resort pages hang off their country. */
export function destinationHref(countrySlug, resortSlug) {
  var base = '/tripbuster/holidays/' + encodeURIComponent(countrySlug || '');
  return resortSlug ? base + '/' + encodeURIComponent(resortSlug) : base;
}

/**
 * The seven product types, as pages.
 *
 * `type` MUST match the CHECK constraint on deals.holiday_type exactly. That
 * string is the authority and lives in the database; everything else here is
 * presentation and lives in the repo, which is why the slugs are not in a
 * migration. A slug is minted once and never changed, same rule as a deal's.
 *
 * `lead` is the sentence at the top of the page. Written per type rather than
 * templated, because "cruises" and "flight only" want genuinely different
 * things said about them, and a template would produce the sort of prose that
 * makes a page look automatically generated. Which it would be.
 */
export var TRIP_TYPES = [
  {
    slug: 'package-holidays', type: 'Package holiday',
    plural: 'Package holidays', one: 'package holiday', placeholder: 'Anywhere sunny',
    lead: 'Flights, hotel and transfers booked together and protected together. '
      + 'Every one of these is sold by an independent UK agent you deal with direct.',
  },
  {
    slug: 'cruises', type: 'Cruise', plural: 'Cruises', one: 'cruise',
    placeholder: 'Fjords, Caribbean, Med',
    lead: 'Ocean and river sailings from UK ports and further afield. '
      + 'Cruise is where a good agent earns their keep, so ring them and ask.',
  },
  {
    slug: 'city-breaks', type: 'City break', plural: 'City breaks', one: 'city break',
    placeholder: 'Prague, Rome, Krakow',
    lead: 'Two, three or four nights somewhere with plenty to walk to. '
      + 'Short enough to go twice a year.',
  },
  {
    slug: 'flight-and-hotel', type: 'Flight + hotel',
    plural: 'Flight and hotel', one: 'flight and hotel trip', placeholder: 'Anywhere sunny',
    lead: 'Put together for you rather than bought off a shelf: the flights and '
      + 'the room booked as one, so there is one person to ring if anything moves.',
  },
  {
    slug: 'escorted-tours', type: 'Escorted tour',
    plural: 'Escorted tours', one: 'escorted tour',
    placeholder: 'Italy, Vietnam, Peru',
    lead: 'A guide, a route and somebody else doing the driving. '
      + 'You unpack once and see four places.',
  },
  {
    slug: 'hotels', type: 'Hotel only', plural: 'Hotels', one: 'hotel stay',
    placeholder: 'Resort or hotel name',
    lead: 'The room on its own, for when you already have your flights '
      + 'or you are not flying at all.',
  },
  {
    slug: 'flights', type: 'Flight only', plural: 'Flights', one: 'flight',
    placeholder: 'Where are you flying to',
    lead: 'Seats only, sold by an agent rather than a search engine. '
      + 'Worth a call if the dates are awkward or there are more than four of you.',
  },
];

/** Look a trip type up by its URL slug, or null. */
export function tripTypeBySlug(slug) {
  var want = String(slug || '').toLowerCase();
  for (var i = 0; i < TRIP_TYPES.length; i++) {
    if (TRIP_TYPES[i].slug === want) return TRIP_TYPES[i];
  }
  return null;
}

/** Look a trip type up by the string stored on the deal, or null. */
export function tripTypeByName(type) {
  var want = String(type || '');
  for (var i = 0; i < TRIP_TYPES.length; i++) {
    if (TRIP_TYPES[i].type === want) return TRIP_TYPES[i];
  }
  return null;
}

/** A trip type landing page. */
export function tripTypeHref(slug) {
  return '/tripbuster/trips/' + encodeURIComponent(slug || '');
}

/** GET the public deals feed. Returns { deals, total, ... } or throws. */
export async function fetchDeals(params) {
  var qs = new URLSearchParams();
  Object.keys(params || {}).forEach(function (k) {
    var v = params[k];
    if (v !== '' && v !== null && v !== undefined) qs.append(k, v);
  });
  var res = await fetch(API + '/deals?' + qs.toString(), { headers: { Accept: 'application/json' } });
  var data = null;
  try { data = await res.json(); } catch (e) { /* empty body */ }
  if (!res.ok) {
    var err = new Error((data && data.error) || 'Could not load deals');
    err.status = res.status;
    throw err;
  }
  return data || { deals: [], total: 0 };
}

/**
 * Report a click-out, then hand back so the caller can navigate.
 *
 * Fired at the moment the traveller commits to leaving, NOT when an
 * interstitial opens — counting a click the agent never received would
 * over-bill them. sendBeacon is used because the browser delivers it even as
 * the page unloads, which is exactly what happens next.
 */
export function reportClick(dealId, surface) {
  if (!dealId) return;
  beacon('/click', { dealId: dealId, surface: surface || 'site' });
}

/** Report that a set of deals was shown. Batched: one call per page render. */
export function reportImpressions(deals, surface) {
  var ids = (deals || []).map(function (d) { return d && d.id; }).filter(Boolean);
  if (!ids.length) return;
  beacon('/impressions', { dealIds: ids, surface: surface || 'site' });
}

function beacon(path, payload) {
  try {
    var body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      // text/plain avoids a CORS preflight a beacon cannot complete; the
      // endpoint parses either shape.
      if (navigator.sendBeacon(API + path, new Blob([body], { type: 'text/plain;charset=UTF-8' }))) return;
    }
    fetch(API + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true,
    }).catch(function () {});
  } catch (e) { /* tracking must never break the journey */ }
}

// ── ringing the agency ────────────────────────────────────────────────────

/**
 * Can this device actually place a call?
 *
 * A coarse pointer with no hover is a phone or a tablet. Deliberately not
 * user-agent sniffing, which is wrong about new devices roughly as soon as
 * they ship. If the answer is no we reveal the number instead of dialling it.
 *
 * NULL means "nobody has asked the device yet", which is the honest answer on
 * the server. callCta() then emits both versions and lets a media query pick,
 * so a phone gets a dialable number out of cached HTML with no JavaScript at
 * all — and, just as importantly, no flash of the wrong one.
 */
export function dialer() {
  if (typeof window === 'undefined' || !window.matchMedia) return null;
  try {
    return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  } catch (e) {
    return false;
  }
}

/** Strip a phone number down to something `tel:` will accept. */
export function telHref(phone) {
  var digits = String(phone || '').replace(/[^\d+]/g, '');
  return digits ? 'tel:' + digits : '';
}

/**
 * Report that a traveller went to ring an agency.
 *
 * Fired on the deliberate act — the tap that dials, or the click that reveals
 * the number. Both count, because both mean somebody wants to speak to this
 * agency about this holiday. What we cannot see is whether the phone was
 * answered: we do not own the number.
 */
export function reportCall(dealId, surface) {
  if (!dealId) return;
  beacon('/click', { dealId: dealId, eventType: 'call', surface: surface || 'site' });
}

/**
 * Everything the page needs to decide how to offer a phone call.
 *
 * One place, because the deal page, the compare drawer and the widget all have
 * to reach the same answer, and three separate readings of "are they open and
 * which number" is how they would drift apart.
 */
export function callRoute(entry, at) {
  var contact = (entry && entry.contact) || null;
  var state = openState(contact, at || new Date());
  var applicable = phonesFor(contact, state.open);
  // Falling back to entry.phone matters: it is the single resolved number the
  // read path has always returned, so a surface that has not been given the
  // full contact object still works rather than losing its call button.
  var primary = applicable.length ? applicable[0]
    : ((entry && entry.phone)
      ? { label: 'Main number', phone: entry.phone, whenShown: 'always' } : null);
  var behaviour = (contact && contact.closedBehaviour) || 'callback';
  var shut = state.scheduled && !state.open;
  return {
    state: state,
    open: state.open,
    phones: applicable.length ? applicable : (primary ? [primary] : []),
    primary: primary,
    behaviour: behaviour,
    // Nothing to show: no number anywhere, or closed and set to hide.
    silent: !primary || (shut && behaviour === 'hide'),
    // Closed, with the callback form taking over. The number still shows, but
    // as information rather than as a call we are pushing.
    muted: shut && behaviour === 'callback',
  };
}

/**
 * The call button.
 *
 * On a phone it is a `tel:` link, so a tap dials and a long press still offers
 * copy and save the way people expect. On a desktop it is a plain button with
 * no href, because "Show number" that reveals itself on hover would be a lie.
 *
 * EVERY CALL IS CHARGEABLE, whatever the time. So out of hours, under the
 * "ask for a call back" setting, this stops being a BUTTON at all: the number
 * shows as plain text, not a link, and nothing is reported. That is the whole
 * point of the setting — the agency said they would rather have a message than
 * a ring, and offering a tappable number anyway would bill them for calls they
 * explicitly chose not to invite.
 *
 * An agency that DOES want out-of-hours calls sets "show the number anyway",
 * and then it is an ordinary chargeable button at midnight exactly as it is at
 * midday. The agency decides whether a call can happen; we do not decide what
 * it was worth afterwards.
 */
export function callCta(entry, opts) {
  var o = opts || {};
  var route = o.route || callRoute(entry);
  if (route.silent) return '';
  var cls = o.className || 'btn btn-call';
  var id = (entry && (entry.dealId || entry.id)) || '';
  var phone = route.primary.phone;

  // Information, not an invitation. No href and no data-call, so a tap cannot
  // dial and nothing reaches the recorder. Same on both device shapes, so this
  // one needs no media query.
  if (route.muted) {
    return '<span class="' + cls + ' is-shut">' + svg(IC.phone) + esc(phone) + '</span>';
  }

  var onPhone = '<a class="' + cls + '" data-call="' + esc(id) + '" href="' + esc(telHref(phone)) + '">'
    + svg(IC.phone) + esc(o.phoneLabel || o.label || 'Call us') + '</a>';
  var onDesk = '<button class="' + cls + '" type="button" data-call="' + esc(id) + '"'
    + ' data-phone="' + esc(phone) + '">' + svg(IC.phone)
    + esc(o.deskLabel || o.label || 'Show number') + '</button>';

  var d = dialer();
  if (d === true) return onPhone;
  if (d === false) return onDesk;
  // Rendered on the server, where there is no device to ask. Ship both and let
  // the media query in tb-site.css decide, which also survives the page being
  // cached at the edge and served to whoever asks next.
  return '<span class="tb-onphone">' + onPhone + '</span>'
    + '<span class="tb-ondesk">' + onDesk + '</span>';
}

/**
 * The agency's other numbers, when there are any.
 *
 * A branch line or an out-of-hours mobile is only useful if it says which it
 * is, so the label travels with the number. The first one is already the button
 * above, so this lists the rest.
 */
export function extraPhones(entry, opts) {
  var o = opts || {};
  var route = o.route || callRoute(entry);
  if (route.silent || route.phones.length < 2) return '';
  var id = (entry && (entry.dealId || entry.id)) || '';
  // Same rule as the button above: under "ask for a call back" these are
  // readable but not dialable, so an agency is never billed for a number it
  // chose not to offer at this hour.
  return '<ul class="ar-more">' + route.phones.slice(1).map(function (p) {
    var value = route.muted
      ? '<span class="ar-more-nm">' + esc(p.phone) + '</span>'
      : '<a data-call="' + esc(id) + '" href="' + esc(telHref(p.phone)) + '">'
        + esc(p.phone) + '</a>';
    return '<li><span class="ar-more-lb">' + esc(p.label) + '</span>' + value + '</li>';
  }).join('') + '</ul>';
}

/**
 * Wire every call button inside `root`.
 *
 * One delegated listener, so buttons added by a later render are covered
 * without re-binding. The event is reported before anything else happens,
 * because on a phone the browser is about to leave for the dialler.
 */
export function wireCalls(root, surface) {
  if (!root || root._tbCallsWired) return;
  root._tbCallsWired = true;
  root.addEventListener('click', function (e) {
    var el = e.target.closest('[data-call]');
    if (!el) return;
    var id = el.getAttribute('data-call');
    reportCall(id, surface);

    var phone = el.getAttribute('data-phone');
    if (!phone) return; // the `tel:` anchor: let the browser dial

    // Desktop: swap the button for the number itself, still as a tel: link so
    // a laptop with a softphone can use it.
    e.preventDefault();
    var shown = document.createElement('a');
    shown.className = el.className + ' is-revealed';
    shown.href = telHref(phone);
    shown.textContent = phone;
    el.replaceWith(shown);
  });
}

/** POST a callback request. Resolves with the response, or throws. */
export async function submitLead(payload) {
  var res = await fetch(API + '/lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  var data = null;
  try { data = await res.json(); } catch (e) { /* empty body */ }
  if (!res.ok) {
    var err = new Error((data && data.error) || 'Could not send that just now');
    err.status = res.status;
    err.fieldErrors = (data && data.errors) || null;
    throw err;
  }
  return data || {};
}

// ── opening hours ─────────────────────────────────────────────────────────
//
// THIS IS A MIRROR OF api/_lib/tripbuster/hours.js, AND THAT IS DELIBERATE BUT
// NOT FREE. There are three implementations of the same few rules: this one for
// what the page shows, hours.js for the API, and tb_agent_is_open in the
// database for what gets charged. The database one is the authority.
//
// The duplication exists because /api/tripbuster/deals is CDN-cached, so the
// response cannot carry a computed "open right now" — a cached yes would still
// read yes an hour after closing. The page therefore has to work it out itself.
//
// (Since the SEO work this file is a module the server CAN import, so the second
// copy is no longer forced. hours.js survives because the API uses it on paths
// that never render markup — validating a schedule an agent has just typed. If
// that stops being true, delete it and import this instead.)
//
// The mitigation is a test that runs THIS copy and hours.js against the same
// table of cases and fails if they ever disagree. If you change a rule here,
// change it in both other places or that test will tell you.

var DAY_LABEL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** 'HH:MM' to minutes past midnight. '24:00' is 1440, meaning end of day. */
function hhmm(value) {
  if (typeof value !== 'string') return null;
  var m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) return null;
  var h = Number(m[1]);
  var min = Number(m[2]);
  if (min > 59 || h > 24 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

/** The agency's own wall clock, whatever the traveller's device is set to. */
function agencyNow(contact, at) {
  var tz = (contact && contact.timeZone) || 'Europe/London';
  var parts = {};
  try {
    var fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, weekday: 'short', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    fmt.formatToParts(at).forEach(function (p) { parts[p.type] = p.value; });
  } catch (e) {
    return null;
  }
  var days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    date: parts.year + '-' + parts.month + '-' + parts.day,
    day: days[parts.weekday],
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function periodsOn(contact, dateStr, dow) {
  var special = ((contact && contact.specialDays) || []).filter(function (s) {
    return s && s.date === dateStr;
  })[0];
  if (special) {
    return (special.opens && special.closes)
      ? [{ opens: special.opens, closes: special.closes }] : [];
  }
  return ((contact && contact.hours) || []).filter(function (h) {
    return h && h.day === dow;
  }).map(function (h) {
    return { opens: h.opens, closes: h.closes };
  }).sort(function (a, b) { return hhmm(a.opens) - hhmm(b.opens); });
}

function shiftDate(dateStr, n) {
  var d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Open or closed, and when that next changes.
 *
 * An agency with no schedule is never closed, so every agency that has not
 * filled the form in behaves exactly as it did before hours existed. If the
 * browser cannot do the time zone at all we also say open, because failing that
 * way shows a working phone number instead of hiding one.
 */
export function openState(contact, at) {
  var c = contact || {};
  var now = at || new Date();
  if (c.hoursMode !== 'scheduled') {
    return { open: true, scheduled: false, closesAt: null, opensAt: null, opensDay: null };
  }
  var local = agencyNow(c, now);
  if (!local) {
    return { open: true, scheduled: false, closesAt: null, opensAt: null, opensDay: null };
  }

  var today = periodsOn(c, local.date, local.day);
  var i;
  for (i = 0; i < today.length; i += 1) {
    if (local.minutes >= hhmm(today[i].opens) && local.minutes < hhmm(today[i].closes)) {
      return {
        open: true, scheduled: true, closesAt: today[i].closes, opensAt: null, opensDay: null,
      };
    }
  }
  for (i = 0; i < today.length; i += 1) {
    if (hhmm(today[i].opens) > local.minutes) {
      return {
        open: false, scheduled: true, closesAt: null,
        opensAt: today[i].opens, opensDay: local.day,
      };
    }
  }
  for (i = 1; i <= 14; i += 1) {
    var ahead = periodsOn(c, shiftDate(local.date, i), (local.day + i) % 7);
    if (ahead.length) {
      return {
        open: false, scheduled: true, closesAt: null,
        opensAt: ahead[0].opens, opensDay: (local.day + i) % 7,
      };
    }
  }
  return { open: false, scheduled: true, closesAt: null, opensAt: null, opensDay: null };
}

/** "5:30pm" from "17:30". Midnight and noon get words, because 12am confuses. */
export function clockLabel(value) {
  var mins = hhmm(value);
  if (mins === null) return '';
  if (mins === 0 || mins === 1440) return 'midnight';
  if (mins === 720) return 'midday';
  var h = Math.floor(mins / 60);
  var m = mins % 60;
  var suffix = h < 12 ? 'am' : 'pm';
  var h12 = h % 12 === 0 ? 12 : h % 12;
  return h12 + (m ? ':' + String(m).padStart(2, '0') : '') + suffix;
}

/**
 * The sentence a traveller reads. "Closed" on its own stops somebody; "Closed,
 * opens 9am tomorrow" tells them what to do instead.
 */
export function openLabel(contact, at) {
  var state = openState(contact, at);
  if (!state.scheduled) return '';
  if (state.open) {
    return state.closesAt ? 'Open now, until ' + clockLabel(state.closesAt) : 'Open now';
  }
  if (!state.opensAt) return 'Closed at the moment';
  var local = agencyNow(contact, at || new Date());
  if (local && state.opensDay === local.day) return 'Closed, opens at ' + clockLabel(state.opensAt);
  if (local && state.opensDay === (local.day + 1) % 7) {
    return 'Closed, opens ' + clockLabel(state.opensAt) + ' tomorrow';
  }
  return 'Closed, opens ' + clockLabel(state.opensAt) + ' ' + DAY_LABEL[state.opensDay];
}

/** Which numbers apply right now: a shop line while open, a mobile while shut. */
export function phonesFor(contact, open) {
  return (((contact || {}).phones) || []).filter(function (p) {
    if (!p || !p.phone) return false;
    if (p.whenShown === 'open') return open;
    if (p.whenShown === 'closed') return !open;
    return true;
  });
}

/**
 * The whole week, for the panel on a deal page.
 *
 * Worth showing even when they are open: it is a small trust signal that this
 * is a real shop with real hours, and it explains why the callback form is
 * there at nine at night.
 */
export function hoursTable(contact) {
  var c = contact || {};
  if (c.hoursMode !== 'scheduled') return '';
  var local = agencyNow(c, new Date());
  var rows = '';
  // Monday first, because a British week starts on Monday even though dow does not.
  var order = [1, 2, 3, 4, 5, 6, 0];
  order.forEach(function (dow) {
    var periods = ((c.hours) || []).filter(function (h) { return h && h.day === dow; })
      .sort(function (a, b) { return hhmm(a.opens) - hhmm(b.opens); });
    var text = periods.length
      ? periods.map(function (p) {
        return clockLabel(p.opens) + ' to ' + clockLabel(p.closes);
      }).join(', ')
      : 'Closed';
    rows += '<tr' + (local && local.day === dow ? ' class="oh-today"' : '') + '>'
      + '<th scope="row">' + esc(DAY_LABEL[dow]) + '</th>'
      + '<td>' + esc(text) + '</td></tr>';
  });

  var upcoming = ((c.specialDays) || []).filter(function (s) {
    return s && (!local || s.date >= local.date);
  }).slice(0, 4).map(function (s) {
    var when = (s.opens && s.closes)
      ? clockLabel(s.opens) + ' to ' + clockLabel(s.closes) : 'Closed';
    return '<li>' + esc(ukDate(s.date)) + (s.note ? ' — ' + esc(s.note) : '')
      + ': <b>' + esc(when) + '</b></li>';
  }).join('');

  return '<div class="oh"><h3>Opening hours</h3>'
    + '<table class="oh-tbl"><tbody>' + rows + '</tbody></table>'
    + (upcoming ? '<ul class="oh-special">' + upcoming + '</ul>' : '')
    + '</div>';
}

/** 2026-12-26 as 26/12/2026. This is a UK product; dates read day first. */
export function ukDate(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? m[3] + '/' + m[2] + '/' + m[1] : String(iso || '');
}

/**
 * The "ask us to ring you" form.
 *
 * Either a phone number or an email address will do, which is the whole point:
 * plenty of people would rather be emailed, and refusing them loses the
 * enquiry. The line naming the agency is not decoration — someone handing over
 * their number deserves to know exactly who receives it.
 *
 * `closed` changes the framing rather than the form. Out of hours this IS the
 * main call to action, so it says so, and it is the reason an out-of-hours
 * enquiry still earns the agency something instead of being lost.
 */
export function callbackForm(deal, closed) {
  var agent = (deal.agent && deal.agent.name) || 'the agency';
  return '<form class="cbf' + (closed ? ' is-primary' : '') + '" novalidate>'
    + '<h3>' + (closed ? 'Ask for a call back' : 'Prefer a call back?') + '</h3>'
    + '<p class="cbf-lead">' + (closed
      ? '<b>' + esc(agent) + '</b> is closed at the moment. Leave your details and '
        + 'they will get in touch about this holiday when they open.'
      : 'Leave your details and <b>' + esc(agent)
        + '</b> will get in touch about this holiday.') + '</p>'
    + '<div class="cbf-err" role="alert" hidden></div>'
    + '<div class="cbf-row"><label>Your name'
    + '<input name="name" autocomplete="name" required></label></div>'
    + '<div class="cbf-grid">'
    + '<label>Phone<input name="phone" type="tel" autocomplete="tel" '
    + 'placeholder="07700 900123"></label>'
    + '<label>Email<input name="email" type="email" autocomplete="email" '
    + 'placeholder="you@example.co.uk"></label>'
    + '</div>'
    + '<p class="cbf-hint">Either is fine, or both if you like.</p>'
    + '<div class="cbf-row"><label>Best time to call '
    + '<span class="cbf-opt">optional</span>'
    + '<input name="preferredTime" placeholder="Evenings, or weekends"></label></div>'
    + '<div class="cbf-row"><label>Anything else? <span class="cbf-opt">optional</span>'
    + '<textarea name="message" rows="2" placeholder="Dates, how many of you, questions"></textarea>'
    + '</label></div>'
    // Hidden from people, irresistible to bots that fill in every input.
    + '<div class="cbf-hp" aria-hidden="true">'
    + '<label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>'
    + '<button class="btn btn-primary cbf-go" type="submit">Ask ' + esc(agent) + ' to call me</button>'
    + '<p class="cbf-privacy">Your details go to ' + esc(agent)
    + ' so they can reply about this holiday. Tripbuster does not use them for anything else.</p>'
    + '</form>';
}

/** Wire a callback form: validate lightly, submit, and confirm in place. */
export function wireCallback(form, deal, surface) {
  if (!form || form._tbWired) return;
  form._tbWired = true;
  var errBox = form.querySelector('.cbf-err');
  var go = form.querySelector('.cbf-go');

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    errBox.hidden = true;
    var fd = new FormData(form);
    var payload = {
      dealId: deal.id,
      surface: surface || 'site',
      name: (fd.get('name') || '').trim(),
      phone: (fd.get('phone') || '').trim(),
      email: (fd.get('email') || '').trim(),
      message: (fd.get('message') || '').trim(),
      preferredTime: (fd.get('preferredTime') || '').trim(),
      website: (fd.get('website') || '').trim(),
    };

    // Checked here only to save a round trip and give an instant answer. The
    // server checks the same thing and is the one that decides.
    if (!payload.phone && !payload.email) {
      errBox.textContent = 'Leave a phone number or an email address so they can reply.';
      errBox.hidden = false;
      return;
    }

    go.disabled = true;
    go.textContent = 'Sending…';
    try {
      var out = await submitLead(payload);
      form.innerHTML = '<div class="cbf-done">' + svg(IC.tick)
        + '<h3>That is on its way</h3><p>'
        + esc(out.agentName || 'The agency') + ' has your details and will be in touch.</p></div>';
    } catch (err) {
      errBox.textContent = ((err.fieldErrors || [])[0] || {}).message || err.message;
      errBox.hidden = false;
      go.disabled = false;
      go.textContent = 'Ask ' + ((deal.agent && deal.agent.name) || 'them') + ' to call me';
    }
  });
}

/**
 * The promoted label.
 *
 * EVERY LISTING ON TRIPBUSTER IS ADVERTISING. Standard agents pay per click, per
 * call and per enquiry; premium agents pay more, and what the extra buys is
 * POSITION — top five in the results and the headline slot on a compare card.
 *
 * So this badge does NOT mean "this one is paid for". They all are, and saying
 * otherwise on a per-listing basis would imply the unbadged ones are editorial
 * picks, which is misleading in the opposite direction and is its own compliance
 * problem. The badge means "this one paid to be higher up than it otherwise
 * would be", which is the only thing that distinguishes it.
 *
 * "Promoted" rather than "Sponsored" for exactly that reason. The fact that
 * money changed hands is carried site-wide by the footer and by rankingNote();
 * this word carries the narrower claim about ORDER. It is a disclosure either
 * way, so do not drop it to tidy a layout and do not soften it to "Featured" or
 * "Recommended" — "Recommended" implies we are recommending, which we are not.
 */
export function sponsoredTag(cls) {
  return '<span class="' + (cls || 'spon') + '" title="This agent pays more to appear '
    + 'higher up. Every deal on Tripbuster is advertising.">Promoted</span>';
}

/**
 * How this site makes its money and how the order is decided.
 *
 * Shown on every page that lists deals, whether or not anything on it is
 * promoted, because the first half is always true. A disclosure that only
 * appears sometimes teaches people that its absence means something.
 */
export function rankingNote() {
  return '<p class="rank-note">' + svg(IC.info)
    + '<span><b>Every deal here is an advert.</b> Agents pay us when you click '
    + 'through, ring them or leave your details, and some pay more to appear '
    + 'higher up — those are marked <b>Promoted</b>. Everything else is ordered '
    + 'by the filters you chose. Prices are set by the agent, we never add '
    + 'anything to them, and we show you every agent selling the same holiday so '
    + 'you can always find the cheapest.</span></p>';
}

export function chipsFor(d) {
  var out = [];
  if (d.nights) out.push('<span class="chip">' + svg(IC.moon) + esc(d.nights) + ' nights</span>');
  if (d.board) out.push('<span class="chip">' + svg(IC.board) + esc(d.board) + '</span>');
  if (d.airport) out.push('<span class="chip">' + svg(IC.plane) + esc(d.airport) + '</span>');
  if (d.dates) out.push('<span class="chip">' + svg(IC.cal) + esc(d.dates) + '</span>');
  return out.join('');
}

export function priceBlock(d) {
  return '<div class="price">' +
    (d.wasPrice ? '<div class="strike tnum">' + esc(money(d.wasPrice, d.currency)) + '</div>' : '') +
    (d.priceFrom != null
      ? '<div class="amt tnum">' + esc(money(d.priceFrom, d.currency)) + '<small> pp</small></div>'
      : '<div class="amt">Ask the agent</div>') +
    '</div>';
}

export function bgStyle(d) {
  var img = safeUrl(d.image || d.hero || '');
  return img ? ' style="background-image:url(' + esc(img) + ')"' : '';
}

/** Grid card, used on the front page, search and every destination page. */
export function dealCard(d) {
  return '<a class="dc" href="' + esc(dealHref(d)) + '">' +
    '<div class="dc-img ' + gradClass(d.resort || d.title) + '"' + bgStyle(d) + '>' +
      (d.discount ? '<span class="tag">-' + esc(d.discount) + '%</span>' : '') +
      (d.badge ? '<span class="tag-dark">' + esc(d.badge) + '</span>' : '') +
      '<span class="dc-place">' + esc(d.resort || '') +
        (d.country ? '<small>' + esc(d.country) + '</small>' : '') + '</span>' +
    '</div>' +
    '<div class="dc-body">' +
      '<h3 class="dc-title">' + esc(d.title) + '</h3>' +
      '<div class="chips">' + chipsFor(d) + '</div>' +
      '<div class="byagent">by <b>' + esc(d.agent && d.agent.name) + '</b>' +
        (d.sponsored ? sponsoredTag() : '') +
        (d.atol ? '<span class="prot">' + svg(IC.shield) + 'ATOL ' + esc(d.atol) + '</span>' : '') +
        (d.agentCount > 1
          ? '<span>+' + (d.agentCount - 1) + ' more agent' + (d.agentCount > 2 ? 's' : '') + '</span>'
          : '') +
      '</div>' +
    '</div>' +
    '<div class="dc-foot">' + priceBlock(d) +
      '<span class="btn btn-dark">View deal ' + svg(IC.arrow) + '</span>' +
    '</div>' +
  '</a>';
}

// ── the deal page ───────────────────────────────────────────────────────────
//
// Split in two on purpose. `dealArticle` is everything that reads the same at
// nine in the morning and nine at night, so the server renders it once and the
// browser leaves it alone. `bookingPanel` is everything that depends on the
// clock and on the device — is this agency open, which of their numbers applies
// now, does a tap dial or reveal — so the browser re-renders just that block
// once it knows both. That is why the edge can cache this page at all.

export function crumbs(items) {
  return '<div class="crumb">' + items.map(function (it, i) {
    var sep = i ? svg(IC.chevRight) : '';
    return sep + (it.href
      ? '<a href="' + esc(it.href) + '">' + esc(it.label) + '</a>'
      : '<span>' + esc(it.label) + '</span>');
  }).join('') + '</div>';
}

/** Where a deal sits: home, country, resort, this hotel. */
export function dealCrumbs(d) {
  var trail = [{ label: 'Home', href: '/tripbuster' }];
  if (d.country) {
    trail.push({ label: d.country, href: destinationHref(slugify(d.country)) });
    if (d.resort) {
      trail.push({
        label: d.resort,
        href: destinationHref(slugify(d.country), slugify(d.resort)),
      });
    }
  }
  trail.push({ label: d.accommodation || d.title });
  return trail;
}

/** Every agency advertising this hotel, cheapest first. */
export function agentList(d) {
  if (d.compare && d.compare.length) return d.compare;
  return [{
    dealId: d.id, slug: d.slug, agent: d.agent && d.agent.name,
    agentSlug: d.agent && d.agent.slug,
    atol: d.atol, price: d.priceFrom, clickoutUrl: d.clickoutUrl,
    phone: d.phone, billingMode: d.billingMode, contact: d.contact,
  }];
}

/** What a given agency charges for. Already resolved server-side. */
function modeOf(entry, deal) {
  return (entry && entry.billingMode) || (deal && deal.billingMode) || 'click';
}

/** The static half: headline, photo, description, facilities. */
export function dealArticle(d) {
  var agents = agentList(d);
  var best = agents[0] || {};
  var place = [d.resort, d.country].filter(Boolean).join(', ');

  var glance = [];
  if (d.board) glance.push('<span class="chip">' + svg(IC.board) + esc(d.board) + '</span>');
  if (d.starRating) glance.push('<span class="chip">' + esc(d.starRating) + '-star hotel</span>');
  if (d.nights) glance.push('<span class="chip">' + svg(IC.moon) + esc(d.nights) + ' nights</span>');
  if (d.holidayType) glance.push('<span class="chip">' + esc(d.holidayType) + '</span>');
  if (d.distanceToBeach) glance.push('<span class="chip">' + svg(IC.pin) + esc(d.distanceToBeach) + ' to the beach</span>');
  (d.allAirports || []).slice(0, 3).forEach(function (a) {
    glance.push('<span class="chip">' + svg(IC.plane) + esc(a) + '</span>');
  });

  return crumbs(dealCrumbs(d)) +

    '<div class="dhead"><div>' +
      '<h1>' + esc(d.accommodation || d.title) + ' ' + starsMarkup(d.starRating) + '</h1>' +
      '<div class="rc-loc">' + svg(IC.pin) + esc(place) +
        (d.distanceToBeach ? ' · ' + esc(d.distanceToBeach) + ' to the beach' : '') + '</div>' +
    '</div></div>' +

    '<div class="hero-img ' + gradClass(d.resort || d.title) + '"' + bgStyle(d) + '>' +
      (d.guestScore
        ? '<div class="score-badge"><span class="score-box" style="background:' + scoreColour(d.guestScore) + '">' +
          esc(Number(d.guestScore).toFixed(1)) + '</span><span class="score-txt"><b>' +
          esc(scoreWord(d.guestScore)) + '</b><span>guest rating</span></span></div>'
        : '') +
    '</div>' +

    '<div class="card">' +
      '<div class="sec"><h2>' + esc(d.title) + '</h2>' +
        (d.strapline ? '<p style="margin-bottom:12px">' + esc(d.strapline) + '</p>' : '') +
        '<div class="glance">' + glance.join('') + '</div></div>' +

      (d.overview ? '<div class="sec"><h2>About this holiday</h2><p>' + esc(d.overview) + '</p></div>' : '') +

      ((d.sellingPoints || []).length
        ? '<div class="sec"><h2>Why this one</h2><ul class="points">' +
          d.sellingPoints.map(function (p) {
            return '<li>' + svg(IC.tick) + '<span>' + esc(p) + '</span></li>';
          }).join('') +
          '</ul></div>'
        : '') +

      ((d.facilities || []).length
        ? '<div class="sec"><h2>Facilities</h2><div class="facil">' +
          d.facilities.map(function (f) { return '<div class="fac">' + svg(IC.tick) + esc(f) + '</div>'; }).join('') +
          '</div></div>'
        : '') +

      '<div class="sec"><h2>Good to know</h2><p>' +
        'This holiday is advertised on Tripbuster by ' +
        (agents.length > 1 ? esc(agents.length) + ' independent UK travel agents' : '<strong>' + esc(best.agent) + '</strong>') +
        '. You book with the agent you choose, on their own website, and they hold the financial protection for your trip. ' +
        'Tripbuster never takes a booking or handles your money.' +
        (d.availability && d.availability !== 'Available'
          ? ' Availability is currently marked <strong>' + esc(d.availability.toLowerCase()) + '</strong>.'
          : '') +
      '</p></div>' +
    '</div>';
}

/**
 * The clock-dependent half: prices, every agency, call routes and hours.
 *
 * Re-rendered in the browser on load. The server's version is correct at the
 * moment it was rendered and stays on the page for anyone without JavaScript,
 * which is the right trade: a slightly stale "opens at 9am" beats an empty box.
 */
export function bookingPanel(d) {
  var agents = agentList(d);
  var best = agents[0] || {};

  return '<div class="book-card">' +
    '<div class="book-top">' +
      '<div class="rc-from">' + (d.nights ? esc(d.nights) + ' nights · ' : '') +
        esc(d.board || '') + ' · from</div>' +
      priceBlock(d) +
      (d.dates ? '<div class="chips" style="margin-top:9px"><span class="chip">' +
        svg(IC.cal) + esc(d.dates) + '</span></div>' : '') +
    '</div>' +
    '<div class="book-h">' + (agents.length > 1 ? 'Compare ' + agents.length + ' agents' : 'Book with') +
      '<span>You book direct</span></div>' +
    agents.map(function (a, i) {
      var initials = String(a.agent || '?').split(/\s+/).map(function (w) { return w[0]; })
        .join('').slice(0, 2).toUpperCase();
      // Worked out once per agency and handed to both the button and the
      // extra-numbers list, so they cannot disagree about whether the shop
      // is open — which they would if each asked separately either side of
      // a closing time.
      var route = callRoute(a);
      var mode = modeOf(a, d);
      return '<div class="agent-row' + (i === 0 ? ' best' : '') + '">' +
        '<span class="ar-av">' + esc(initials) + '</span>' +
        '<span class="ar-mid"><span class="ar-nm">' +
          (a.agentSlug
            ? '<a href="' + esc(agentHref(a.agentSlug)) + '">' + esc(a.agent) + '</a>'
            : esc(a.agent)) +
          // Cheapest is a fact about the price; sponsored is a fact about who
          // paid. They are different claims and both can be true at once, so
          // neither replaces the other.
          (i === 0 && agents.length > 1 ? '<span class="best-tag">CHEAPEST</span>' : '') +
          (a.sponsored ? sponsoredTag() : '') + '</span>' +
          (a.atol ? '<span class="prot" style="font-size:11px">' + svg(IC.shield) +
            'ATOL ' + esc(a.atol) + '</span>' : '') + '</span>' +
        '<span class="ar-right"><span class="ar-price tnum">' +
          esc(money(a.price, d.currency)) + '<small> pp</small></span><br>' +
          // Which routes this agency offers. On "both" the traveller gets
          // the choice; on call-only there is nothing to click through to.
          (mode !== 'call' && a.clickoutUrl
            ? '<button class="ar-book" type="button" data-idx="' + i + '">Book</button>' : '') +
          (mode !== 'click'
            ? callCta(a, { route: route, className: 'btn btn-call ar-call',
              phoneLabel: 'Call', deskLabel: 'Show number' }) : '') +
          // "Closed, opens 9am tomorrow" rather than a bare Closed, so a
          // traveller knows what to do instead of just being stopped.
          (mode !== 'click' && route.state.scheduled
            ? '<span class="ar-open' + (route.open ? ' is-on' : '') + '">' +
              esc(openLabel(a.contact)) + '</span>' : '') +
          (mode !== 'click' ? extraPhones(a, { route: route }) : '') +
        '</span></div>';
    }).join('') +
    '<div class="book-foot">' + svg(IC.info) +
      '<span>Tripbuster is free to use. Each holiday is sold and financially protected by the agent you book with.</span>' +
    '</div>' +
  '</div>' +
  // Offered whenever the cheapest agency takes calls. It suits the people
  // a phone number does not: anyone browsing at their desk, anyone who
  // would rather be emailed, and anyone looking outside office hours.
  // Out of hours it stops being the alternative and becomes the main route,
  // which is the whole reason a closed agency still earns an enquiry.
  (modeOf(best, d) !== 'click' ? callbackForm(d, !callRoute(best).open) : '') +
  // The week itself. A small trust signal that this is a real shop, and it
  // explains why the form is there at nine at night.
  (modeOf(best, d) !== 'click' ? hoursTable(best.contact) : '');
}

/** The whole deal page body, server and browser alike. */
export function dealPage(d) {
  return '<div class="dlayout">' + dealArticle(d) +
    '<aside class="book" id="book">' + bookingPanel(d) + '</aside></div>';
}

// ── an agency's own page ────────────────────────────────────────────────────

/** "Trading since 1998", "3 shops", the things that say this is a real business. */
function agentFacts(p) {
  var out = [];
  if (p.liveDeals) {
    out.push(p.liveDeals + ' holiday' + (p.liveDeals === 1 ? '' : 's') + ' on offer');
  }
  if (p.countries > 1) out.push(p.countries + ' countries');
  if (p.minPrice != null) out.push('from ' + money(p.minPrice, 'GBP') + 'pp');
  if (p.foundedYear) out.push('trading since ' + p.foundedYear);
  if (p.maxDiscount) out.push('up to ' + p.maxDiscount + '% off');
  return out.map(function (f) { return '<span class="chip">' + esc(f) + '</span>'; }).join('');
}

/** ATOL, ABTA, the protection the AGENT holds. Never Tripbuster's. */
function agentProtection(p) {
  var bits = [];
  if (p.atolNumber) bits.push('ATOL ' + p.atolNumber);
  if (p.abtaNumber) bits.push('ABTA ' + p.abtaNumber);
  if (!bits.length && p.protectionType) bits.push(p.protectionType);
  if (!bits.length) return '';
  return '<div class="ag-prot">' + svg(IC.shield)
    + '<span>Your holiday is financially protected by <b>' + esc(p.name)
    + '</b> under ' + esc(bits.join(' and ')) + '. Tripbuster does not sell it '
    + 'and does not hold your money.</span></div>';
}

export function agentProfile(p, deals) {
  var where = [p.town, p.region].filter(Boolean).join(', ');
  var site = safeUrl(p.website);

  return '<header class="ag-head">'
    + '<div class="ag-badge">' + esc(String(p.name || '?').split(/\s+/)
      .map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase()) + '</div>'
    + '<div class="ag-head-txt">'
      + '<h1>' + esc(p.name) + '</h1>'
      + (where ? '<div class="rc-loc">' + svg(IC.pin) + esc(where) + '</div>' : '')
      + '<div class="chips" style="margin-top:10px">' + agentFacts(p) + '</div>'
    + '</div></header>'

    + agentProtection(p)

    + (p.about
      ? '<div class="card"><div class="sec"><h2>About ' + esc(p.name) + '</h2>'
        + '<p>' + esc(p.about) + '</p>'
        + (site
          ? '<p style="margin-top:10px"><a href="' + esc(site) + '" rel="nofollow noopener" '
            + 'target="_blank">Their own website ' + svg(IC.arrow) + '</a></p>'
          : '')
        + '</div></div>'
      : '')

    + hoursTable(p.contact)

    + '<div class="sec-head" style="margin-top:22px"><div>'
      + '<h2>Holidays ' + esc(p.name) + ' is advertising</h2>'
      + '<p>Book direct with them. Tripbuster never takes the booking.</p>'
    + '</div></div>'
    + (deals.length
      ? '<section class="grid">' + deals.map(dealCard).join('') + '</section>' + rankingNote()
      : '<div class="empty"><b>Nothing live just now</b>'
        + 'This agency has no holidays on offer at the moment.</div>');
}

/** The directory. Every agency with something live, and a reason to click. */
export function agentDirectory(list) {
  if (!list.length) {
    return '<div class="empty"><b>No agencies yet</b>Nobody is advertising just now.</div>';
  }
  return '<div class="ag-grid">' + list.map(function (a) {
    var where = [a.town, a.region].filter(Boolean).join(', ');
    return '<a class="ag-card" href="' + esc(agentHref(a.slug)) + '">'
      + '<div class="ag-card-top">'
        + '<span class="ag-badge sm">' + esc(String(a.name || '?').split(/\s+/)
          .map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase()) + '</span>'
        + '<span><span class="ag-card-nm">' + esc(a.name) + '</span>'
        + (where ? '<span class="ag-card-where">' + esc(where) + '</span>' : '') + '</span>'
      + '</div>'
      + (a.about ? '<p class="ag-card-about">' + esc(a.about) + '</p>' : '')
      + '<div class="ag-card-foot">'
        + '<span>' + esc(a.liveDeals) + ' holiday' + (a.liveDeals === 1 ? '' : 's')
        + (a.minPrice != null ? ' from ' + esc(money(a.minPrice, 'GBP')) + 'pp' : '') + '</span>'
        + (a.atolNumber
          ? '<span class="prot">' + svg(IC.shield) + 'ATOL ' + esc(a.atolNumber) + '</span>' : '')
      + '</div></a>';
  }).join('') + '</div>';
}

/**
 * The trip-type hub.
 *
 * Driven by what tb_trip_types() says is actually on sale, NOT by the TRIP_TYPES
 * list, so a type with nothing live simply does not appear rather than offering
 * a crawler an empty page. Order comes from the database too: most deals first,
 * which is the honest ranking and needs no editorial decision.
 */
export function tripTypeDirectory(rows) {
  var list = (rows || []).map(function (r) {
    var meta = tripTypeByName(r.holiday_type);
    return meta ? { meta: meta, row: r } : null;
  }).filter(Boolean);

  if (!list.length) {
    return '<div class="empty"><b>Nothing on sale just now</b>Come back shortly.</div>';
  }
  return '<div class="ag-grid">' + list.map(function (x) {
    var r = x.row;
    var facts = [];
    if (r.countries) facts.push(esc(r.countries) + ' countr' + (r.countries === 1 ? 'y' : 'ies'));
    if (r.agents) facts.push(esc(r.agents) + ' agent' + (r.agents === 1 ? '' : 's'));
    return '<a class="ag-card" href="' + esc(tripTypeHref(x.meta.slug)) + '">'
      + '<div class="ag-card-top"><span><span class="ag-card-nm">' + esc(x.meta.plural) + '</span>'
      + (facts.length ? '<span class="ag-card-where">' + facts.join(' · ') + '</span>' : '')
      + '</span></div>'
      + '<p class="ag-card-about">' + esc(x.meta.lead) + '</p>'
      + '<div class="ag-card-foot"><span>' + esc(r.deals) + ' deal'
        + (Number(r.deals) === 1 ? '' : 's')
        + (r.min_price != null ? ' from ' + esc(money(r.min_price, 'GBP')) + 'pp' : '')
        + '</span>'
      + (r.max_discount ? '<span class="prot">up to ' + esc(r.max_discount) + '% off</span>' : '')
      + '</div></a>';
  }).join('') + '</div>';
}

// ── the front page ──────────────────────────────────────────────────────────

/**
 * The search form.
 *
 * A real GET form with a real action, so it works before any JavaScript runs and
 * so a crawler can see where it goes. The values are prefilled from whatever the
 * caller passes, which is how "no results, widen your search" keeps what the
 * traveller typed.
 */
export function searchForm(values) {
  var v = values || {};
  // A type page scopes its form to that type, so the search it runs is the one
  // the page promised. Carried as a hidden field rather than baked into the
  // action, so it survives the form being submitted with everything else empty.
  var type = v.holidayType || '';
  // Which fields even MEAN anything depends on the type, and that is derived
  // here rather than passed in: a caller cannot then ask for a board filter on
  // a flights page. Board says nothing about a seat, and an airport says
  // nothing about a room somebody else is flying them to.
  var showBoard = type !== 'Flight only';
  var showAirport = type !== 'Hotel only';
  var sel = function (name, label, options) {
    return '<div class="s-field"><label for="' + name + '">' + esc(label) + '</label>'
      + '<select id="' + name + '" name="' + name + '">'
      + options.map(function (o) {
        return '<option value="' + esc(o.value) + '"'
          + (String(v[name] || '') === String(o.value) ? ' selected' : '')
          + '>' + esc(o.label) + '</option>';
      }).join('') + '</select></div>';
  };
  return '<form class="searchcard" id="searchForm" action="/tripbuster/search" method="get">'
    + (type ? '<input type="hidden" name="holidayType" value="' + esc(type) + '">' : '')
    + '<div class="s-field"><label for="q">Where to</label>'
    + '<input id="q" name="q" type="search" placeholder="' + esc(v.placeholder || 'Anywhere sunny')
    + '" autocomplete="off" value="' + esc(v.q || '') + '"></div>'
    + (showAirport ? '<div class="s-field"><label for="airport">Flying from</label>'
      + '<input id="airport" name="airport" type="text" placeholder="Any UK airport"'
      + ' autocomplete="off" value="' + esc(v.airport || '') + '"></div>' : '')
    + (showBoard ? sel('board', 'Board', [
      { value: '', label: 'Any board' },
      { value: 'All inclusive', label: 'All inclusive' },
      { value: 'Half board', label: 'Half board' },
      { value: 'Bed & breakfast', label: 'Bed & breakfast' },
      { value: 'Self catering', label: 'Self catering' },
    ]) : '')
    + sel('maxPrice', 'Up to', [
      { value: '', label: 'Any price' },
      { value: '299', label: '£299 per person' },
      { value: '499', label: '£499 per person' },
      { value: '799', label: '£799 per person' },
    ])
    + '<button class="s-go" type="submit">Search</button>'
    + '</form>';
}

/**
 * The whole front page.
 *
 * Server-rendered like the rest, and for the same reason: it is the page every
 * link points at and the one Google weighs the site by. The destination tiles
 * are built from live data rather than a hardcoded list, so the front page never
 * links to an empty result, and each tile now goes to a real landing page rather
 * than a search query — which is what gives every country page a crawlable route
 * in from the home page.
 */
/**
 * The top of a landing page: hero, then the search card overlapping it.
 *
 * ONE helper for the home page and every landing page, because the overlap is
 * load-bearing and easy to break. .searchwrap has margin-top:-70px, which only
 * works if it is the element immediately after .hero — bolt a form on anywhere
 * else and it sits flat against whatever follows, which is exactly what the
 * first version of the type pages did.
 *
 * The headline is taken in two pieces rather than as markup, so a caller cannot
 * pass HTML through it and every page gets the same two-line treatment.
 */
export function landingHero(o) {
  var v = o || {};
  return '<header class="hero"><div class="wrap hero-in">'
    + (v.badge
      ? '<span class="hero-badge"><i></i> <span'
        + (v.badgeId ? ' id="' + esc(v.badgeId) + '"' : '') + '>'
        + esc(v.badge) + '</span></span>'
      : '')
    + '<h1>' + esc(v.h1 || '') + (v.h1em ? '<br><em>' + esc(v.h1em) + '</em>' : '') + '</h1>'
    + (v.sub ? '<p class="sub">' + esc(v.sub) + '</p>' : '')
    + '</div></header>'
    + '<div class="wrap searchwrap">' + searchForm(v.search || {})
    + '<div class="trust">'
    + '<span>' + svg(IC.shield) + ' Every deal <b>protected by the agent</b> who sells it</span>'
    + (v.agentCount
      ? '<span>' + svg(IC.tick) + ' <b>' + esc(num(v.agentCount)) + '</b> independent UK agent'
        + (Number(v.agentCount) === 1 ? '' : 's') + '</span>'
      : '')
    + '<span>' + svg(IC.tick) + ' You book direct, <b>no booking fee</b></span>'
    + '</div></div>';
}

export function homePage(view) {
  var v = view || {};
  var deals = v.deals || [];
  var dests = v.destinations || [];

  var featured = deals.length
    ? deals.map(dealCard).join('')
    : '<div class="empty"><b>No deals live just yet</b>'
      + 'Agents are still adding them. Do check back.</div>';

  var tiles = dests.map(function (p) {
    return '<a class="dest ' + gradClass(p.seed || p.name) + '" href="'
      + esc(destinationHref(p.slug)) + '"><span>' + esc(p.name)
      + (p.minPrice != null ? '<small>from ' + esc(money(p.minPrice, 'GBP')) + '</small>' : '')
      + '</span></a>';
  }).join('');

  return landingHero({
    badgeId: 'dealCount',
    badge: v.total
      ? num(v.total) + ' hotel' + (v.total === 1 ? '' : 's') + ' with live deals today'
      : 'Deals from independent UK agents',
    h1: 'Cheap holidays,',
    h1em: 'price busted.',
    sub: 'Compare package deals from independent UK travel agents, then '
      + 'book direct with them. No booking fee, no middleman markup.',
    search: v.search,
    agentCount: v.agentCount || 0,
  })

    + '<section class="wrap section"><div class="sec-head">'
    + '<div><h2>This week\'s best savings</h2>'
    + '<p>The biggest discounts our agents are advertising right now.</p></div>'
    + '<a class="btn btn-ghost" href="/tripbuster/search">See all deals</a></div>'
    + '<div class="grid" id="featured">' + featured + '</div>'
    + (deals.length ? rankingNote() : '')
    + '</section>'

    + (tiles
      ? '<section class="destsec"><div class="wrap section"><div class="sec-head">'
        + '<div><h2>Where the deals are</h2>'
        + '<p>Every price for that destination, from every agent advertising it.</p></div>'
        + '<a class="btn btn-ghost" href="/tripbuster/destinations">All destinations</a></div>'
        + '<div class="dest-grid" id="dests">' + tiles + '</div></div></section>'
      : '')

    + '<section class="wrap section"><div class="advcard">'
    + '<div class="advcard-txt"><h2>Run a travel agency? Get your deals seen.</h2>'
    + '<p>List your holidays on Tripbuster, keep every booking, and show the same '
    + 'deals on your own website with one line of code.</p></div>'
    + '<div class="acts"><a class="adv-primary" href="/tripbuster/dashboard">List your deals</a></div>'
    + '</div></section>';
}

// ── shared page chrome ──────────────────────────────────────────────────────

/** So the header and footer cannot drift between pages. */
export function header(active) {
  var link = function (href, label) {
    return '<a href="' + href + '"' + (active === label ? ' aria-current="page"' : '') + '>' + label + '</a>';
  };
  return '<a class="skip" href="#main">Skip to content</a>' +
    '<nav class="nav"><div class="wrap nav-in">' +
    '<a class="brand" href="/tripbuster" aria-label="Tripbuster home">' +
      '<span class="ticket">' + svg('<path d="M2 12h20M14 5l7 7-7 7M6 8v8"/>') + '</span>' +
      '<span class="brand-name">Trip<b>buster</b></span></a>' +
    '<div class="nav-links">' +
      link('/tripbuster/destinations', 'Destinations') +
      link('/tripbuster/agents', 'Our agents') +
      // Two product types in the nav rather than five. These are the ones a
      // traveller sets out looking for by name, and a nav listing all seven
      // would say "we have a database" rather than "we have holidays".
      // Everything else is a click away in the search filters.
      // These point at the real landing pages, not the search filter. Sending
      // the nav at /search would aim every internal link on the site at a
      // noindex URL, which is the opposite of why those pages were built.
      link(tripTypeHref('cruises'), 'Cruises') +
      link(tripTypeHref('flights'), 'Flights') +
      link('/tripbuster/search?board=All+inclusive', 'All inclusive') +
      link('/tripbuster/search?sort=discount', 'Biggest savings') +
    '</div>' +
    '<div class="nav-right"><a class="nav-cta" href="/tripbuster/dashboard">List your deals</a></div>' +
    '</div></nav>';
}

export function footer() {
  return '<footer class="foot"><div class="wrap foot-in">' +
    '<span class="atol">' + svg(IC.shield) +
    ' Every deal on Tripbuster is advertised by the agent, who pays us when you '
    + 'get in touch. Holidays are sold and financially protected by that agent, '
    + 'not by Tripbuster, and we never add anything to the price.</span>' +
    '<span><a href="/tripbuster/trips">Types of trip</a> &middot; ' +
    '<a href="/tripbuster/destinations">All destinations</a> &middot; ' +
    '<a href="/tripbuster/agents">Our agents</a> &middot; ' +
    '&copy; 2026 Tripbuster &middot; a Travelgenix product</span>' +
    '</div></footer>';
}
