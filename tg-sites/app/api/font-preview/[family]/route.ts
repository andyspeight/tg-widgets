/**
 * Serves a tiny sample of a Google font so the picker can draw it in itself.
 *
 * The browser asks this domain, this route asks Google, and the file comes back
 * down the connection that is already open. That is the whole reason the route
 * exists rather than the editor linking fonts.googleapis.com: the rule that no
 * browser talks to Google holds with no exception, on the editor as well as on a
 * client's page. See lib/fonts/preview.ts.
 *
 * WHAT IT WILL AND WILL NOT FETCH
 *
 * The family name in the URL is matched against the committed 1,941-entry
 * catalogue and nothing else reaches a fetch. That matters: this route forwards a
 * request to a third party, so without the whitelist it would be an open proxy
 * for anybody who found the URL. A family too new to be in the snapshot gets a
 * 404 here and still imports perfectly well, which is the right way round.
 *
 * NOT AUTHENTICATED, deliberately. What it discloses is a public Google font, at
 * one weight, subset to the letters of its own name. Putting it behind the session
 * would mean the font could not be cached by the CDN for everyone, which is the
 * thing that makes it cheap, in exchange for hiding nothing.
 */

import { NextResponse } from 'next/server';

import { fetchPreviewFont, resolvePreviewFamily } from '../../../../lib/fonts/preview';

/** Fetches, so not an edge function. */
export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ family: string }> },
): Promise<NextResponse> {
  const { family: raw } = await params;

  const family = resolvePreviewFamily(safeDecode(raw));
  if (!family) {
    // 404 rather than 400. From the caller's point of view there is no such
    // preview, and which of "not a name" or "not in the catalogue" it was is not
    // something a picker can act on differently.
    return new NextResponse(null, { status: 404 });
  }

  let font: { bytes: Uint8Array } | null;
  try {
    font = await fetchPreviewFont(family);
  } catch (error) {
    console.error('[tg-sites] font preview failed', family, error);
    font = null;
  }

  if (!font) {
    /*
     * 404 with a SHORT cache, not no cache.
     *
     * A family that has no 400 weight, or a hiccup at Google, would otherwise be
     * retried by every row of every search for as long as the screen is open. Five
     * minutes is long enough to stop that and short enough that a transient
     * failure heals itself without anybody being told to clear a cache.
     */
    return new NextResponse(null, {
      status: 404,
      headers: { 'cache-control': 'public, max-age=300' },
    });
  }

  return new NextResponse(new Uint8Array(font.bytes), {
    headers: {
      'content-type': 'font/woff2',
      /*
       * A year, immutable. The URL is the family name and the bytes for a given
       * family never change, so this can be cached as hard as the CDN allows. It is
       * what turns "two requests to Google per font" into "two requests to Google
       * per font, ever".
       */
      'cache-control': 'public, max-age=31536000, immutable',
      /*
       * Fonts are fetched in CORS mode by the CSS engine even same-origin, and the
       * Font Loading API is stricter still. Without this the load rejects with a
       * network error that says nothing about CORS being the cause.
       */
      'access-control-allow-origin': '*',
      'x-content-type-options': 'nosniff',
    },
  });
}

/**
 * decodeURIComponent throws on a malformed escape, and a thrown decode is a 500
 * for what is really just a bad URL.
 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}
