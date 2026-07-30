/**
 * A font you have not downloaded yet, drawn in itself.
 *
 * THE PROBLEM
 *
 * The Google search results are a list of names, and picking a typeface from a
 * list of names set in a different typeface is guessing. Every font picker worth
 * using shows each family in its own letters. To do that the browser needs the
 * file, and the whole point of the importer is that we have NOT fetched the file
 * yet.
 *
 * WHY THIS DOES NOT BREAK THE SELF-HOSTING RULE
 *
 * The obvious answer is to link fonts.googleapis.com from the editor, and it is
 * the wrong one. The rule in lib/fonts/google.ts is that Google is never
 * contacted by a browser, and while a staff editor is not a client's visitor, an
 * exception that is easy to make once is easy to make again on a page that ships.
 *
 * So the preview comes from OUR origin too. The route fetches from Google
 * server-side, exactly like the importer does, and streams the bytes back. The
 * browser only ever talks to this domain, and the rule holds with no asterisk.
 *
 * WHY THIS IS CHEAP DESPITE BEING A FONT PER ROW
 *
 * Google's css2 endpoint takes a `text` parameter and returns a file subset to
 * just those characters. A preview only ever renders the family's OWN NAME, so
 * asking for exactly those letters gives a file of two to four kilobytes instead
 * of twenty-five. Forty results cost about as much as one full font, the response
 * is immutable so it is cached for a year, and a family previewed once is never
 * fetched again by anybody.
 *
 * WHY NOT REUSE parseGoogleCss
 *
 * Because a `text` response has a different shape and the difference is silent.
 *
 * The importer's parser splits on the block comments Google writes before each
 * subset, which are the only place the subset is named. A subset-by-text response
 * carries no such comments, so parseGoogleCss returns an EMPTY array for one
 * rather than failing, and reusing it here would have meant a preview that never
 * worked and never complained. The parser below is four lines and cannot be
 * mistaken for the other one.
 */

import 'server-only';

import { BROWSER_UA, GSTATIC_ORIGIN, normaliseFamilyName, resolveFamilyName } from './google';
import { GOOGLE_FONTS } from './catalogue';

/** A preview file is tiny. Anything near this is not a text-subset font. */
export const MAX_PREVIEW_BYTES = 200_000;

/**
 * The characters a preview has to be able to draw.
 *
 * The family's own name, and nothing else. Deduplicated because `text` is a set of
 * characters rather than a string to typeset, so "Roboto" needs r, o, b, t once
 * each and repeating them only makes the URL longer.
 *
 * Sorted so the same family always produces the same URL, which is what lets the
 * response be cached rather than being a new URL every time the set iterates in a
 * different order.
 */
export function previewText(family: string): string {
  return [...new Set(family)].sort().join('');
}

/** The css2 URL for one family, subset to the characters in its own name. */
export function previewCssUrl(family: string): string {
  const params = new URLSearchParams({
    // One weight. A preview is a name at one size, and 400 is the weight every
    // family has: asking for 700 would return nothing for a single-weight face.
    family: `${family}:wght@400`,
    text: previewText(family),
    display: 'swap',
  });
  return `https://fonts.googleapis.com/css2?${params}`;
}

/**
 * The font file URL out of a text-subset response.
 *
 * Refuses anything not on Google's own file host, for the same reason the importer
 * does: this string goes straight into a server-side fetch, so without the check
 * a tampered or compromised response turns this route into an open proxy.
 */
export function parsePreviewCss(css: string): string | null {
  const url = /src:\s*url\(([^)]+)\)/.exec(css)?.[1];
  if (!url) return null;
  return url.startsWith(GSTATIC_ORIGIN) ? url : null;
}

/**
 * A family name that is definitely a real one, or null.
 *
 * The catalogue is the whitelist. Unlike the importer, this deliberately does NOT
 * fall back to the typed spelling when the catalogue has no match: the importer
 * needs that fallback so "any Google font" stays true for something published
 * since the snapshot, but this route exists to be hit by a URL, and a route that
 * forwards an arbitrary string to a third-party fetch is a route worth being
 * strict in. A family too new to preview still imports.
 */
export function resolvePreviewFamily(raw: unknown): string | null {
  const typed = normaliseFamilyName(raw);
  if (!typed) return null;
  return resolveFamilyName(typed, GOOGLE_FONTS);
}

/**
 * Fetch one family's preview file.
 *
 * Two hops, both server-side: the stylesheet, then the file it names. That is one
 * more than ideal and it happens once per family ever, because the route's
 * response is immutable and sits in front of it.
 */
export async function fetchPreviewFont(
  family: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ bytes: Uint8Array } | null> {
  const cssResponse = await fetchImpl(previewCssUrl(family), {
    // Ask as a browser or Google returns ttf, which is three times the size for
    // no benefit. The same trap as the importer, and the same fix.
    headers: { 'user-agent': BROWSER_UA },
    signal: AbortSignal.timeout(8_000),
  });
  if (!cssResponse.ok) return null;

  const fileUrl = parsePreviewCss(await cssResponse.text());
  if (!fileUrl) return null;

  const fileResponse = await fetchImpl(fileUrl, { signal: AbortSignal.timeout(8_000) });
  if (!fileResponse.ok) return null;

  const bytes = new Uint8Array(await fileResponse.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PREVIEW_BYTES) return null;

  return { bytes };
}
