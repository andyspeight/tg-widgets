/**
 * Address search for the map field, proxied so the geocoder stays off the browser.
 *
 * WHY A ROUTE AND NOT A PHOTON URL IN THE EDITOR. The same reason the stock and
 * font previews are routes: the third party never touches the browser. The map
 * field asks this route for `?q=10 downing`, the route asks Photon, and what
 * comes back is JSON from our own origin. There is one host to allow if a content
 * security policy is ever added, and it is `connect-src 'self'` for the editor,
 * not a new third party. It also lets us set a User-Agent that names us, which
 * Photon's neighbours ask for and a browser fetch cannot send.
 *
 * WHY IT IS SAFE TO LEAVE OPEN. It is not a general proxy. It only ever asks
 * Photon, only ever for a capped query, and hands back a short, parsed list.
 * There is no key to leak, the query is bounded, the answer is cached hard, and
 * Photon rate limits us in any case, so a burst cannot run anything up.
 *
 * WHY IT FAILS QUIET. A search is a convenience: the client can always type the
 * address in full. No provider, a slow answer, a shape we did not expect, every
 * one of them answers an empty list, and the field simply shows no suggestions.
 * A field that showed an error where a match was missing would be worse than one
 * that let you carry on typing.
 */

import { NextResponse } from 'next/server';

import { parsePhotonMatches, photonUrl } from '../../../lib/content/geocode';

export const runtime = 'nodejs';

/** A month at the edge, a day in the browser: the same office is searched over
 * and over, so a warm cache should keep this from coming back to the function. */
const HIT = 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800';
/** A miss is cached briefly so a burst of keystrokes does not each retry. */
const MISS = 'public, max-age=600';

function empty(cache: string): NextResponse {
  return NextResponse.json({ matches: [] }, { headers: { 'cache-control': cache } });
}

export async function GET(request: Request): Promise<NextResponse> {
  const query = new URL(request.url).searchParams.get('q') ?? '';
  const url = photonUrl(query);
  if (!url) return empty(MISS);

  let json: unknown;
  try {
    const response = await fetch(url, {
      headers: {
        // Names us, as an open geocoder's neighbours ask. A browser fetch could
        // not set this, which is a second reason the search comes through here.
        'user-agent': 'tg-sites address search (https://travelgenixsites.com)',
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return empty(MISS);
    json = await response.json();
  } catch {
    // No provider, a timeout, or a body that is not JSON. The field carries on.
    return empty(MISS);
  }

  return NextResponse.json({ matches: parsePhotonMatches(json) }, { headers: { 'cache-control': HIT } });
}
