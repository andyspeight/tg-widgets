/**
 * Supplier event feed — booking deeplinks.
 *
 * THIS IS THE ONLY PLACE THE BOOKING URL IS BUILT.
 *
 * Built to the live Travelify ticket deeplink Andy supplied on 21 Aug 2026:
 *
 *   https://dl.tvllnk.com/deeplink/384?st=TicketsAttractions
 *     &supp=144
 *     &refe=168e50ee39a24acf870d4527d5c20a38_spp
 *     &curr=GBP
 *     &fr=2026-09-04&to=2026-09-04
 *     &lat=45.617548&lng=9.28127&rad=20
 *     &adt=2&chd=0&inf=0
 *     &loc=Italian+Grand+Prix+(Formula+1)%3A+04-Sep-2026
 *
 * HOW THE FEED MAPS ONTO IT
 * The feed's two id columns are the two halves of the pin, and the deeplink
 * wants them apart rather than joined:
 *
 *   "Event ID For Searchbox"  144:168e50...  ->  supp=144  +  refe=168e50...
 *   "Event ID For Filters"    168e50...      ->  refe
 *
 * So `supp` is the supplier prefix (179 SportsEvents365, 144 XS2Event) and
 * `refe` is the bare filter id. A merged event carries both suppliers' ids, so
 * the pair always comes from the SAME source row: sending one supplier's
 * reference under the other's id would pin nothing.
 *
 * `loc` is the raw feed event name plus ": DD-Mon-YYYY", brackets and all
 * ("Italian Grand Prix (Formula 1): 04-Sep-2026"). That is the name before the
 * normalisation pass strips the taxonomy off it, which is why each source keeps
 * its own rawName.
 *
 * THE ANCHOR IS MANDATORY
 * `lat`, `lng` and `rad` anchor the search geographically, and Travelify
 * refuses the link without them: "Unable to match location". Proved by probe
 * on 21 Aug 2026 — the identical link 400s bare and 302s to the results page
 * with the anchor added, and even Andy's own working example dies with its
 * anchor removed, so `refe` alone pins nothing. The feed carries no
 * coordinates, so they come from api/_data/venue-geo.json (built by
 * scripts/build-venue-geo notes in the handover), passed in as `event.geo`.
 * An event whose venue has no entry gets NO url and status 'no-anchor',
 * because a missing button is honest and a dead one is not.
 *
 * THE PACKAGE LINK (ticket + accommodation + flight)
 * Built to the live example Andy supplied on 24 Aug 2026:
 *
 *   https://dl.tvllnk.com/deeplink/384?st=TicketAccommodationFlight
 *     &supp=144&refe=1939276025ff419489c076968d8f51b8_gnr
 *     &curr=GBP&fr=2026-09-16&to=2026-09-16
 *     &lat=41.38087&lng=2.122802&rad=20
 *     &org=LGW&dst=BCN&frd=0&dur=1&dir=false
 *     &adt=2&chd=0&inf=0
 *     &loc=FC+Barcelona+vs+Racing+de+Santander+(Football%2C+La+Liga)%3A+...
 *
 * Same pin, same mandatory anchor, five more parameters. `org` is the
 * visitor's departure airport and is the one thing neither the feed nor the
 * widget config can know, so the builder emits a URL with the __ORG__
 * placeholder and status 'needs-origin'; the surfaces ask the visitor on
 * button press (the /fly chooser) and substitute a validated IATA code.
 * `dst` is the airport nearest the EVENT's own anchor (so a merged venue key
 * flies to the right city), supplied by the caller as options.destAirport;
 * without one the option is not offered (status 'no-airport'). `frd`, `dur`
 * and `dir` are copied verbatim from the working example.
 *
 * THE HOTEL LINK (ticket + accommodation) is the package minus the flight
 * leg — same pin and anchor plus frd and dur, nothing else — so it needs no
 * chooser and ships ready. See buildEventHotelDeeplink for its live example.
 */

/** Travelify's deeplink host, as used by the offers widgets. */
export const DEEPLINK_BASE = 'https://dl.tvllnk.com/deeplink';

/** The Travelify product an event ticket belongs to. */
export const SEARCH_TYPE = 'TicketsAttractions';

/** The Travelify product a ticket + accommodation + flight package belongs to. */
export const SEARCH_TYPE_PACKAGE = 'TicketAccommodationFlight';

/** The Travelify product a ticket + accommodation package belongs to. */
export const SEARCH_TYPE_HOTEL = 'TicketAccommodation';

/**
 * Stands in for the visitor's departure airport in a package link until they
 * choose one. Alphanumeric + underscores so URLSearchParams leaves it alone;
 * surfaces replace it with a validated three-letter IATA code.
 */
export const ORG_PLACEHOLDER = '__ORG__';

/** Built against a real link rather than a guess. */
export const SPEC_VERIFIED = true;

export const DEFAULTS = {
  currency: 'GBP', adults: 2, children: 0, infants: 0, radiusKm: 20,
  // Package parameters, verbatim from the live 24 Aug 2026 example. `nights`
  // becomes `dur`; `flightFlexDays` becomes `frd`; `directOnly` becomes `dir`.
  nights: 1, flightFlexDays: 0, directOnly: false,
};

const APPID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const REF_RE = /^[A-Za-z0-9_-]{1,120}$/;
const SUPP_RE = /^[0-9]{1,8}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-09-04' -> '04-Sep-2026', the format the live link uses inside `loc`. */
export function formatDeeplinkDate(iso) {
  if (!DATE_RE.test(String(iso || ''))) return '';
  const [y, m, d] = iso.split('-');
  const mi = Number(m) - 1;
  if (mi < 0 || mi > 11) return '';
  return `${d}-${MONTHS[mi]}-${y}`;
}

/**
 * Split a searchbox id into its supplier prefix and reference.
 * Falls back to the bare filter id when the searchbox id is missing.
 */
function pinFrom(source) {
  const searchbox = String((source && source.searchboxId) || '').trim();
  const filterId = String((source && source.filterId) || '').trim();
  const colon = searchbox.indexOf(':');
  if (colon > 0) {
    return { supp: searchbox.slice(0, colon), refe: searchbox.slice(colon + 1) };
  }
  return { supp: '', refe: filterId };
}

/**
 * Build a booking deeplink for one normalised event.
 *
 * @param {object} event Needs `sources` and `startDate`. A record from
 *   normaliseSupplierEvents().events satisfies this.
 * @param {object} [options]
 * @param {string} [options.appId] The client's Travelify AppID. Required: a
 *   deeplink opens the client's own application, never ours.
 * @param {string} [options.supplier] Prefer this supplier's copy of the event.
 * @param {string} [options.currency] ISO 4217, defaults to GBP.
 * @param {number} [options.adults] Defaults to 2, matching the live example.
 * @param {number} [options.children]
 * @param {number} [options.infants]
 * @returns {{ url: string|null, status: 'ready'|'unavailable', reason: string|null,
 *             supplier: string|null, supplierId: string|null, reference: string|null }}
 */
export function buildEventDeeplink(event, options = {}) {
  const pre = preflight(event, options);
  if (pre.err) return pre.err;
  const { id, source, supp, refe, geo, date, curr, adt, chd, inf } = pre;

  const params = new URLSearchParams();
  params.set('st', SEARCH_TYPE);
  if (supp) params.set('supp', supp);
  params.set('refe', refe);
  params.set('curr', curr);
  // A single-day event, so the window is the same date on both sides.
  params.set('fr', date);
  params.set('to', date);
  // In the working example the anchor sits between the dates and the pax
  // counts, and it is reproduced in that exact position.
  params.set('lat', String(geo.lat));
  params.set('lng', String(geo.lng));
  params.set('rad', String(DEFAULTS.radiusKm));
  params.set('adt', adt);
  params.set('chd', chd);
  params.set('inf', inf);
  setLoc(params, source, event, date);

  return {
    url: `${DEEPLINK_BASE}/${encodeURIComponent(id)}?${params.toString()}`,
    status: 'ready',
    reason: null,
    supplier: source.supplier || null,
    supplierId: supp || null,
    reference: refe,
  };
}

/**
 * Everything the two link shapes validate identically: the app id, the
 * supplier pin, the date and the mandatory anchor. Returns { err } with the
 * finished failure result, or the validated pieces.
 */
function preflight(event, options = {}) {
  const {
    appId = '',
    supplier = null,
    currency = DEFAULTS.currency,
    adults = DEFAULTS.adults,
    children = DEFAULTS.children,
    infants = DEFAULTS.infants,
  } = options;

  const none = (reason) => ({ err: {
    url: null, status: 'unavailable', reason, supplier: null, supplierId: null, reference: null,
  } });

  if (!event || !Array.isArray(event.sources) || !event.sources.length) return none('no-source');

  const id = String(appId || '').trim();
  if (!id) return none('no-appid');
  if (!APPID_RE.test(id)) return none('bad-appid');

  const source = (supplier && event.sources.find((s) => s.supplier === supplier)) || event.sources[0];
  const { supp, refe } = pinFrom(source);
  if (!refe || !REF_RE.test(refe)) return none('bad-reference');
  if (supp && !SUPP_RE.test(supp)) return none('bad-supplier-id');

  const date = DATE_RE.test(String(event.startDate || '')) ? event.startDate : '';
  if (!date) return none('no-date');

  // Travelify requires the geographic anchor (see header). No coordinates for
  // this venue means no link at all, surfaced as its own status so the report
  // and the widgets can tell "venue not located yet" from a broken event.
  const geo = event.geo && Number.isFinite(event.geo.lat) && Number.isFinite(event.geo.lng)
    ? event.geo
    : null;
  if (!geo) {
    return { err: { url: null, status: 'no-anchor', reason: 'venue-not-geocoded',
      supplier: source.supplier || null, supplierId: supp || null, reference: refe } };
  }

  const clamp = (n, max) => {
    const v = Number.parseInt(n, 10);
    return Number.isFinite(v) && v >= 0 && v <= max ? v : 0;
  };

  return {
    id, source, supp, refe, geo, date,
    curr: CURRENCY_RE.test(String(currency)) ? currency : DEFAULTS.currency,
    adt: String(Math.max(1, clamp(adults, 20) || DEFAULTS.adults)),
    chd: String(clamp(children, 20)),
    inf: String(clamp(infants, 20)),
  };
}

/** `loc` is the raw feed event name plus ": DD-Mon-YYYY", brackets and all. */
function setLoc(params, source, event, date) {
  const rawName = String((source && source.rawName) || event.rawName || event.title || '').trim();
  if (!rawName) return;
  const stamp = formatDeeplinkDate(date);
  params.set('loc', stamp ? `${rawName}: ${stamp}` : rawName);
}

/**
 * Build a ticket + accommodation package deeplink.
 *
 * Built to the live example Andy supplied on 24 Aug 2026:
 *
 *   https://dl.tvllnk.com/deeplink/384?st=TicketAccommodation
 *     &supp=144&refe=1939276025ff419489c076968d8f51b8_gnr
 *     &curr=GBP&fr=2026-09-16&to=2026-09-16
 *     &lat=41.38087&lng=2.122802&rad=20&frd=0&dur=1
 *     &adt=2&chd=0&inf=0&loc=FC+Barcelona+vs+...
 *
 * The flight package minus the flight leg: same pin, same mandatory anchor,
 * frd and dur verbatim, and nothing the feed does not already know — so it
 * comes back 'ready' with a finished url, no chooser involved.
 */
export function buildEventHotelDeeplink(event, options = {}) {
  const pre = preflight(event, options);
  if (pre.err) return pre.err;
  const { id, source, supp, refe, geo, date, curr, adt, chd, inf } = pre;

  const params = new URLSearchParams();
  params.set('st', SEARCH_TYPE_HOTEL);
  if (supp) params.set('supp', supp);
  params.set('refe', refe);
  params.set('curr', curr);
  params.set('fr', date);
  params.set('to', date);
  params.set('lat', String(geo.lat));
  params.set('lng', String(geo.lng));
  params.set('rad', String(DEFAULTS.radiusKm));
  params.set('frd', String(DEFAULTS.flightFlexDays));
  params.set('dur', String(DEFAULTS.nights));
  params.set('adt', adt);
  params.set('chd', chd);
  params.set('inf', inf);
  setLoc(params, source, event, date);

  return {
    url: `${DEEPLINK_BASE}/${encodeURIComponent(id)}?${params.toString()}`,
    status: 'ready',
    reason: null,
    supplier: source.supplier || null,
    supplierId: supp || null,
    reference: refe,
  };
}

const IATA_RE = /^[A-Z]{3}$/;

/**
 * Build a ticket + accommodation + flight package deeplink.
 *
 * Same pin and anchor as the ticket link, plus the flight leg. The departure
 * airport is the visitor's own choice, so without options.origin the result
 * carries `urlTemplate` (with __ORG__ where the IATA code goes) and status
 * 'needs-origin'; a surface asks on button press and substitutes. With a
 * valid options.origin the finished url comes back 'ready'.
 *
 * @param {object} event As buildEventDeeplink.
 * @param {object} [options] As buildEventDeeplink, plus:
 *   @param {string} [options.destAirport] IATA of the airport nearest the
 *     EVENT's anchor. Required: no airport, no package (status 'no-airport').
 *   @param {string} [options.origin] The visitor's departure airport, when
 *     already known (e.g. the API's &org= parameter).
 */
export function buildEventPackageDeeplink(event, options = {}) {
  const pre = preflight(event, options);
  if (pre.err) return pre.err;
  const { id, source, supp, refe, geo, date, curr, adt, chd, inf } = pre;

  const base = { supplier: source.supplier || null, supplierId: supp || null, reference: refe };

  const dst = String(options.destAirport || '').trim().toUpperCase();
  if (!IATA_RE.test(dst)) {
    return { url: null, status: 'no-airport', reason: 'no-airport-near-event', ...base };
  }
  const org = String(options.origin || '').trim().toUpperCase();
  const hasOrigin = IATA_RE.test(org);

  const params = new URLSearchParams();
  params.set('st', SEARCH_TYPE_PACKAGE);
  if (supp) params.set('supp', supp);
  params.set('refe', refe);
  params.set('curr', curr);
  params.set('fr', date);
  params.set('to', date);
  params.set('lat', String(geo.lat));
  params.set('lng', String(geo.lng));
  params.set('rad', String(DEFAULTS.radiusKm));
  // The flight leg sits between the anchor and the pax counts in the live
  // example, and frd/dur/dir are copied from it verbatim.
  params.set('org', hasOrigin ? org : ORG_PLACEHOLDER);
  params.set('dst', dst);
  params.set('frd', String(DEFAULTS.flightFlexDays));
  params.set('dur', String(DEFAULTS.nights));
  params.set('dir', String(DEFAULTS.directOnly));
  params.set('adt', adt);
  params.set('chd', chd);
  params.set('inf', inf);
  setLoc(params, source, event, date);

  const url = `${DEEPLINK_BASE}/${encodeURIComponent(id)}?${params.toString()}`;
  if (hasOrigin) return { url, status: 'ready', reason: null, dst, ...base };
  return { url: null, urlTemplate: url, status: 'needs-origin', reason: null, dst, ...base };
}

// ── Booking options: ticket, ticket + hotel, ticket + flight + hotel ────────
//
// A Book button is the wrong shape for this product. An agent earns far more on
// a ticket sold with a hotel than on a ticket alone, so every event needs to be
// bookable three ways and the widget needs to offer all three.
//
// All three are now built from verified live examples (ticket 21 Aug 2026,
// the flight package and ticket + hotel both 24 Aug 2026). The table stays,
// because a future combination will want the same treatment:
//
//   - a surface can render exactly the options that work and silently omit the
//     rest, rather than showing a button that dead-ends
//   - an editor can list all three and mark the unavailable ones
//   - when the two remaining Travelify examples arrive, filling in `build` on
//     each entry below lights them up everywhere at once, with no change to any
//     widget, editor or API
//
// That last point is the whole reason this is a table rather than an if-else.

export const BOOKING_KINDS = [
  {
    kind: 'ticket',
    label: 'Ticket only',
    short: 'Ticket',
    ready: true,
    build: buildEventDeeplink,
  },
  {
    kind: 'ticket-hotel',
    label: 'Ticket + hotel',
    short: '+ Hotel',
    ready: true,
    build: buildEventHotelDeeplink,
  },
  {
    kind: 'ticket-flight-hotel',
    label: 'Ticket, flight + hotel',
    short: '+ Flight & hotel',
    ready: true,
    build: buildEventPackageDeeplink,
  },
];

const KIND_BY_NAME = new Map(BOOKING_KINDS.map((k) => [k.kind, k]));

/**
 * Build every booking option a surface asked for.
 *
 * @param {object} event A normalised event with `sources` and `startDate`.
 * @param {object} [options] Passed through to each builder. Adds:
 *   @param {string[]} [options.kinds] Which options to build, in order.
 *     Defaults to ticket only.
 *   @param {boolean} [options.includeUnavailable] Return entries for options
 *     that cannot be built yet. A widget wants false, an editor wants true.
 * @returns {Array<{kind, label, short, url, status, reason}>}
 */
export function buildBookingOptions(event, options = {}) {
  const { kinds = ['ticket'], includeUnavailable = false } = options;
  const out = [];

  for (const name of kinds) {
    const def = KIND_BY_NAME.get(name);
    if (!def) continue;

    if (!def.ready || typeof def.build !== 'function') {
      if (includeUnavailable) {
        out.push({
          kind: def.kind,
          label: def.label,
          short: def.short,
          url: null,
          status: 'spec-needed',
          reason: 'Awaiting the Travelify deeplink spec for this combination',
        });
      }
      continue;
    }

    const link = def.build(event, options);
    if (!link.url && !link.urlTemplate && !includeUnavailable) continue;
    const row = {
      kind: def.kind,
      label: def.label,
      short: def.short,
      url: link.url,
      status: link.status,
      reason: link.reason,
      supplier: link.supplier,
    };
    // A package link the visitor still has to choose an airport for.
    if (link.urlTemplate) row.urlTemplate = link.urlTemplate;
    if (link.dst) row.dst = link.dst;
    out.push(row);
  }

  return out;
}

/** Kinds a surface can actually offer today. */
export function readyBookingKinds() {
  return BOOKING_KINDS.filter((k) => k.ready && typeof k.build === 'function').map((k) => k.kind);
}

/**
 * What a surface should tell the user about a link's state. Kept here so the
 * pages, and any future widget, say the same thing.
 */
export const DEEPLINK_STATUS_TEXT = {
  ready: null,
  // Usable, the visitor just chooses a departure airport first.
  'needs-origin': null,
  unavailable: 'No booking link for this event',
  'no-anchor': 'Booking opens once this venue\u2019s location is confirmed',
  'no-airport': 'No major airport near enough to this venue for a flight package',
};
