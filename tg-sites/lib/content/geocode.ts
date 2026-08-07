/**
 * Address search for the Location map.
 *
 * This is the "matches as you type" half of the map. It turns what a client is
 * typing into a short list of real places, so they can see the product found
 * their office before they trust the map to it. The picked label becomes the
 * map's address exactly as if they had typed it; see lib/content/map.ts for how
 * that sealed embed is then built.
 *
 * KEYLESS, AND THE THIRD PARTY STAYS OFF THE BROWSER. The provider is Photon
 * (photon.komoot.io), an open geocoder built for as-you-type search, with no
 * key to set up, leak or bill. The browser never talks to it: it asks our own
 * /api/place-search route, which asks Photon, the same arrangement the font and
 * stock-photo previews use. So there is one host to allow if a content security
 * policy is ever added, and it is a `connect-src 'self'` for the editor, not a
 * new third party, because the only outbound call to Photon is server to server.
 *
 * Everything here is pure: it builds the query URL and parses the answer. The
 * fetch itself lives in the route. That keeps the label composition and the
 * bounds testable without a network, the same split map.ts draws.
 */

/** The one geocoder a search ever points at. A literal, never anything typed. */
export const PHOTON_HOST = 'https://photon.komoot.io/api/';

/** Below this many characters there is nothing worth searching for. */
export const PLACE_QUERY_MIN = 3;

/** A cap on the query, so a pathological value cannot make a giant URL. */
export const PLACE_QUERY_MAX = 120;

/** How many matches a search offers. A short menu, not a directory. */
export const PLACE_RESULT_MAX = 5;

/** One place the search found: a human label, and where it sits. */
export interface PlaceMatch {
  /** A one-line address, the thing that becomes the map's address if picked. */
  label: string;
  lat: number;
  lon: number;
}

/**
 * Build the search URL, or null when the query is too short to bother.
 *
 * The query is trimmed, capped and percent-encoded; the limit is pinned to the
 * range. The host is the fixed literal, so nothing typed can steer it elsewhere.
 */
export function photonUrl(query: unknown, limit: number = PLACE_RESULT_MAX): string | null {
  const q = (typeof query === 'string' ? query : '').trim().slice(0, PLACE_QUERY_MAX);
  if (q.length < PLACE_QUERY_MIN) return null;

  const n = Number(limit);
  const lim = Number.isFinite(n) ? Math.min(PLACE_RESULT_MAX, Math.max(1, Math.round(n))) : PLACE_RESULT_MAX;

  return `${PHOTON_HOST}?q=${encodeURIComponent(q)}&limit=${lim}&lang=en`;
}

/** A property off a Photon feature, as a trimmed string or empty. */
function field(props: Record<string, unknown>, key: string): string {
  const value = props[key];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Compose a one-line address from a Photon feature's parts.
 *
 * Photon gives the parts of an address, not a formatted line: a name, a street
 * and number, a place, a region, a postcode, a country, any of which may be
 * missing. This joins the ones that are there, in reading order, dropping a part
 * that only repeats the one before it (a place whose name IS its street should
 * not say it twice). Capped, so a freak value cannot become an enormous label.
 */
export function placeLabel(props: Record<string, unknown>): string {
  const name = field(props, 'name');
  const street = [field(props, 'housenumber'), field(props, 'street')].filter(Boolean).join(' ');
  const place = field(props, 'city') || field(props, 'district') || field(props, 'county');

  const ordered = [
    name,
    street && street !== name ? street : '',
    place,
    field(props, 'state'),
    field(props, 'postcode'),
    field(props, 'country'),
  ].filter(Boolean);

  const deduped: string[] = [];
  for (const part of ordered) {
    if (deduped[deduped.length - 1] !== part) deduped.push(part);
  }

  return deduped.join(', ').slice(0, 200);
}

/**
 * Turn Photon's GeoJSON answer into a short list of matches.
 *
 * Defensive throughout: an answer that is not the shape we expect, a feature
 * with no label or no real coordinates, simply does not make the list. A search
 * is a convenience, so a bad answer is an empty menu, never a throw.
 */
export function parsePhotonMatches(json: unknown): PlaceMatch[] {
  const root = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  const features = Array.isArray(root.features) ? root.features : [];

  const out: PlaceMatch[] = [];
  for (const feature of features) {
    if (!feature || typeof feature !== 'object') continue;
    const f = feature as Record<string, unknown>;

    const props = f.properties && typeof f.properties === 'object' ? (f.properties as Record<string, unknown>) : {};
    const geometry = f.geometry && typeof f.geometry === 'object' ? (f.geometry as Record<string, unknown>) : {};
    const coords = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];

    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    const label = placeLabel(props);
    if (!label || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    out.push({ label, lat, lon });
    if (out.length >= PLACE_RESULT_MAX) break;
  }

  return out;
}
