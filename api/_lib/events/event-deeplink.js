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
 * WHAT WE CANNOT SEND
 * `lat`, `lng` and `rad` anchor the search geographically. The feed has no
 * coordinates for its 958 venues, and inventing them would be worse than
 * leaving them out, so all three are omitted. `refe` pins the exact event, so a
 * link without them should still land. If Travelify turns out to need the
 * anchor, the fix is a venue geocode table, not a guess here.
 *
 * Other deeplink shapes exist for ticket-plus-hotel and
 * ticket-plus-flight-plus-hotel. They are not built here yet.
 */

/** Travelify's deeplink host, as used by the offers widgets. */
export const DEEPLINK_BASE = 'https://dl.tvllnk.com/deeplink';

/** The Travelify product an event ticket belongs to. */
export const SEARCH_TYPE = 'TicketsAttractions';

/** Built against a real link rather than a guess. */
export const SPEC_VERIFIED = true;

export const DEFAULTS = { currency: 'GBP', adults: 2, children: 0, infants: 0 };

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
  const {
    appId = '',
    supplier = null,
    currency = DEFAULTS.currency,
    adults = DEFAULTS.adults,
    children = DEFAULTS.children,
    infants = DEFAULTS.infants,
  } = options;

  const none = (reason) => ({
    url: null, status: 'unavailable', reason, supplier: null, supplierId: null, reference: null,
  });

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

  const curr = CURRENCY_RE.test(String(currency)) ? currency : DEFAULTS.currency;
  const clamp = (n, max) => {
    const v = Number.parseInt(n, 10);
    return Number.isFinite(v) && v >= 0 && v <= max ? v : 0;
  };

  const params = new URLSearchParams();
  params.set('st', SEARCH_TYPE);
  if (supp) params.set('supp', supp);
  params.set('refe', refe);
  params.set('curr', curr);
  // A single-day event, so the window is the same date on both sides.
  params.set('fr', date);
  params.set('to', date);
  params.set('adt', String(Math.max(1, clamp(adults, 20) || DEFAULTS.adults)));
  params.set('chd', String(clamp(children, 20)));
  params.set('inf', String(clamp(infants, 20)));

  // lat/lng/rad deliberately absent — see the header. refe is the real pin.

  const rawName = String((source && source.rawName) || event.rawName || event.title || '').trim();
  if (rawName) {
    const stamp = formatDeeplinkDate(date);
    params.set('loc', stamp ? `${rawName}: ${stamp}` : rawName);
  }

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
 * What a surface should tell the user about a link's state. Kept here so the
 * pages, and any future widget, say the same thing.
 */
export const DEEPLINK_STATUS_TEXT = {
  ready: null,
  unavailable: 'No booking link for this event',
};
