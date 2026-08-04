/**
 * One preview photograph for a hero thumbnail, proxied from the photo library.
 *
 * WHY A ROUTE AND NOT A PEXELS URL IN THE MARKUP. The same reason the font
 * preview route exists: the third party stays off the browser. The picker asks
 * this route for `?q=greek island coastline`, the route asks Pexels, and what
 * comes back is an image from our own origin. Nothing about Pexels reaches the
 * page, there is one URL to allow if a content security policy is ever added,
 * and the API key never leaves the server.
 *
 * WHY IT IS SAFE TO LEAVE OPEN. It is not a general proxy. The only URL it will
 * fetch is the one Pexels itself returned for the search, and parsePhotos has
 * already checked that is on the provider's own image host, so a query cannot
 * steer it at an arbitrary address. The query is capped, the answer is cached
 * hard, and Pexels rate limits us in any case, so a burst cannot run the bill up.
 *
 * WHY IT FAILS QUIET. A preview is a convenience. No key, no match, a slow CDN:
 * every one of them answers 404, and the thumbnail falls back to its grey frame.
 * A picker that showed an error where a photograph was missing would be worse
 * than one that simply showed the layout.
 */

import { NextResponse } from 'next/server';

import { searchPexels } from '../../../lib/media/pexels';

export const runtime = 'nodejs';

/** A miss, cached briefly so a wall of tiles asking at once does not each retry. */
function miss(): NextResponse {
  return new NextResponse(null, {
    status: 404,
    headers: { 'cache-control': 'public, max-age=300' },
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  const query = (new URL(request.url).searchParams.get('q') ?? '').trim().slice(0, 80);
  if (!query) return miss();

  // One photograph for the term. Landscape, because a hero picture is wide, and
  // the first result, because these are our own curated palette terms.
  let source: string | undefined;
  try {
    const found = await searchPexels({ query, orientation: 'landscape' });
    source = found.photos[0]?.thumbUrl;
  } catch {
    // No key, a rate limit, or a bad answer. The frame shows instead.
    return miss();
  }
  if (!source) return miss();

  let bytes: ArrayBuffer;
  let type = 'image/jpeg';
  try {
    const response = await fetch(source, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return miss();
    const declared = response.headers.get('content-type') ?? '';
    // Only ever an image, so a surprising content type is treated as a miss
    // rather than passed through.
    if (!declared.startsWith('image/')) return miss();
    type = declared;
    bytes = await response.arrayBuffer();
  } catch {
    return miss();
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'content-type': type,
      // A day in the browser, a week at the edge: the picker asks for the same
      // few palette terms over and over, so this should almost never come back
      // to the function once it is warm.
      'cache-control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800',
      'x-content-type-options': 'nosniff',
    },
  });
}
