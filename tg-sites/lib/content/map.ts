/**
 * The embed URL for a Location map.
 *
 * KEYLESS AND HOST-FIXED, which is the whole of why this is safe. The client
 * only ever supplies an address; the host is a literal in here, so nothing they
 * type can become a different origin, and the address is percent-encoded so it
 * cannot break out of the query into another parameter or a second URL. There is
 * no API key, so there is nothing to leak, nothing to bill, and nothing for a
 * client to set up. Google resolves the address to a pin.
 *
 * A NOTE FOR WHOEVER LANDS THE CSP (see next.config.ts): the published page
 * frames this, so the policy needs `frame-src https://www.google.com` or the map
 * goes blank. It is the one third party a Location map pulls in.
 */

/** The one host a map ever points at. A literal, never anything the client typed. */
export const MAP_EMBED_HOST = 'https://www.google.com/maps';

/** The zoom levels the field offers and the render clamps to. */
export const MAP_MIN_ZOOM = 1;
export const MAP_MAX_ZOOM = 20;
export const MAP_DEFAULT_ZOOM = 14;

/** A cap on the address, so a pathological value cannot make a giant URL. */
export const MAP_ADDRESS_MAX = 300;

/**
 * Build the sealed embed URL, or null when there is no address to show.
 *
 * The address is trimmed, capped and percent-encoded; the zoom is pinned to the
 * range and rounded. Everything else is the fixed host. Given no address it
 * returns null, which the renderer reads as the empty state rather than a map of
 * nowhere.
 */
export function mapEmbedSrc(address: unknown, zoom: unknown): string | null {
  const text = (typeof address === 'string' ? address : '').trim().slice(0, MAP_ADDRESS_MAX);
  if (!text) return null;

  const z = typeof zoom === 'number' && Number.isFinite(zoom) ? zoom : Number(zoom);
  const clamped = Number.isFinite(z)
    ? Math.min(MAP_MAX_ZOOM, Math.max(MAP_MIN_ZOOM, Math.round(z)))
    : MAP_DEFAULT_ZOOM;

  return `${MAP_EMBED_HOST}?q=${encodeURIComponent(text)}&z=${clamped}&output=embed`;
}

/**
 * A link to directions, for a location card.
 *
 * WHY A LINK RATHER THAN A FRAME. The Location block frames a map, which is
 * right for one address: a visitor sees where it is without leaving the page.
 * The Multi Location block lists several, and framing six maps means six
 * third-party page loads before a visitor has decided which branch they want.
 * A link costs nothing until it is clicked, and clicking it opens the maps app
 * on a phone, which is what somebody looking for a branch actually wants.
 *
 * Same safety as the embed above and for the same reason: the host is a literal
 * here and the address is percent-encoded, so nothing a client types can become
 * a different origin or a second parameter.
 */
export function mapDirectionsUrl(address: unknown): string | null {
  const text = (typeof address === 'string' ? address : '').trim().slice(0, MAP_ADDRESS_MAX);
  if (!text) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(text)}`;
}
