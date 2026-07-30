/**
 * Pexels: searching a photo library from inside the editor.
 *
 * WHAT IS AND IS NOT PROVEN HERE
 *
 * api.pexels.com is denied by this session's egress policy, so unlike the Google
 * Fonts importer next door, none of this was ever run against the real service.
 * That shapes the file. The HTTP call is eight lines at the bottom and does
 * nothing but set a header and hand the body to a parser; everything that could
 * be wrong about the DATA is in parsePhotos, which is pure and tested against a
 * recorded response. The first real search in production is what confirms the
 * eight lines.
 *
 * WHY THERE IS NO SDK
 *
 * Pexels publishes a JavaScript client. It is a wrapper over one GET request with
 * one header, and adding a dependency for that means a second thing to keep
 * current for no code saved. Same reasoning as the fonts importer, which also
 * talks to Google over plain fetch.
 *
 * WHAT THE TERMS REQUIRE
 *
 * The Pexels licence lets these photographs be used commercially without
 * attribution, but the API terms are stricter than the licence: an application
 * using the API must credit the photographer and link back to the photo's page
 * on Pexels. That is why MediaCredit is captured at import time and stored on the
 * row. It is not decoration and it is not optional.
 */

import 'server-only';

import { plainText as text } from './limits';
import type { MediaCredit, StockPhoto } from './types';

const API_BASE = 'https://api.pexels.com/v1';

/**
 * The two hosts anything from a response may point at.
 *
 * THIS IS AN SSRF WHITELIST, NOT TIDINESS. importPexelsPhoto hands a URL taken
 * out of a JSON body to a server-side fetch. Without this check, a response that
 * was tampered with, or a provider that was compromised, could aim that fetch at
 * a metadata endpoint or something on the internal network, and the reply would
 * be dutifully copied into the blob store. lib/fonts/google.ts refuses any src
 * not on fonts.gstatic.com for exactly the same reason.
 *
 * Prefix checks on the full URL rather than hostname parsing, because
 * "https://images.pexels.com.evil.test/" parses to a hostname that ends with the
 * wrong thing and a naive endsWith would pass it. Requiring the slash after the
 * host closes that.
 */
const IMAGE_ORIGIN = 'https://images.pexels.com/';
const PAGE_ORIGIN = 'https://www.pexels.com/';

/** A photo URL from a response, or null. See the note above. */
function imageUrl(value: unknown): string | null {
  return typeof value === 'string' && value.startsWith(IMAGE_ORIGIN) ? value : null;
}

/** A link back to Pexels, or null. */
function pageUrl(value: unknown): string | null {
  return typeof value === 'string' && value.startsWith(PAGE_ORIGIN) ? value : null;
}

/** A positive integer, or null. */
function positive(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  return rounded > 0 ? rounded : null;
}

/**
 * A hex colour, or null.
 *
 * Whitelisted rather than passed through, because this value is written into a
 * style attribute as the placeholder behind a loading thumbnail, and a string
 * from a network response reaching CSS unchecked is how a colour field becomes an
 * injection point.
 */
function hexColour(value: unknown): string | null {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export interface SearchResults {
  photos: StockPhoto[];
  /** Which page this is, from 1. */
  page: number;
  /** Whether asking for the next page would return anything. */
  hasMore: boolean;
  /** Total matches, for "about 12,000 photos". Zero when the API omits it. */
  total: number;
}

/**
 * A Pexels response body, turned into something this product can render.
 *
 * Total. A body that is not an object, a photos array full of nulls, a photo with
 * no usable image URL: all of them come back as an empty or shorter list rather
 * than throwing. A photo library is a convenience, and a convenience must never
 * be the reason the editor shows an error page.
 *
 * WHICH SIZES ARE USED, AND WHY THEY ARE PEXELS' OWN
 *
 * thumbUrl is src.medium and fullUrl is src.large2x, both URLs Pexels generated.
 * It is tempting to build a URL instead by appending imgix parameters to
 * src.original, which would give an exact long-edge cap. That would also mean
 * relying on undocumented behaviour of somebody else's image CDN, and the failure
 * mode is silent: the parameters get ignored, the original comes back at nine
 * megabytes, and the only symptom is imports failing the size check. large2x is
 * around 1880px wide, comfortably inside the 2400px ceiling, so there is nothing
 * to gain by being clever here.
 */
export function parsePhotos(body: unknown): SearchResults {
  const root = isObject(body) ? body : {};
  const raw = Array.isArray(root.photos) ? root.photos : [];

  const photos: StockPhoto[] = [];
  for (const entry of raw) {
    const photo = toPhoto(entry);
    if (photo) photos.push(photo);
  }

  const page = positive(root.page) ?? 1;
  const total = positive(root.total_results) ?? 0;

  return {
    photos,
    page,
    /*
     * next_page is a URL when there is another page and absent when there is not,
     * which makes its PRESENCE the signal. Deriving it from total_results instead
     * would be wrong at the boundary: the count is approximate, so a page that
     * should exist by arithmetic can come back empty.
     */
    hasMore: typeof root.next_page === 'string' && root.next_page.length > 0,
    total,
  };
}

function toPhoto(entry: unknown): StockPhoto | null {
  if (!isObject(entry)) return null;

  const src = isObject(entry.src) ? entry.src : {};
  const full = imageUrl(src.large2x) ?? imageUrl(src.large) ?? imageUrl(src.original);
  const thumb = imageUrl(src.medium) ?? imageUrl(src.small) ?? full;

  // No usable image means nothing to show and nothing to import, so the entry is
  // dropped rather than rendered as a broken tile.
  if (!full || !thumb) return null;

  const id = String(entry.id ?? '').trim();
  if (!id || !/^[0-9]{1,20}$/.test(id)) return null;

  const credit: MediaCredit = {
    providerId: id,
    photographer: text(entry.photographer, 120) || undefined,
    photographerUrl: pageUrl(entry.photographer_url) ?? undefined,
    providerUrl: pageUrl(entry.url) ?? undefined,
  };

  return {
    id,
    thumbUrl: thumb,
    fullUrl: full,
    // Falling back to 0 rather than null: these only drive the grid's tile shape,
    // and StockPhoto is not a stored row, so there is no constraint to satisfy.
    width: positive(entry.width) ?? 0,
    height: positive(entry.height) ?? 0,
    description: text(entry.alt, 300),
    credit,
    averageColour: hexColour(entry.avg_color),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const PER_PAGE = 24;

/** Orientations worth offering. A CMS mostly wants landscape. */
export const ORIENTATIONS = ['landscape', 'portrait', 'square'] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

export function pexelsConfigured(): boolean {
  return Boolean(process.env.PEXELS_API_KEY);
}

export interface SearchOptions {
  query: string;
  page?: number;
  orientation?: Orientation | null;
}

/**
 * Search, or the curated feed when there is no query.
 *
 * The empty query going to /curated rather than returning nothing is the
 * difference between opening the tab to a wall of photographs and opening it to
 * an empty box with a search field. The first invites a look, the second asks for
 * work before showing anything.
 */
export async function searchPexels(options: SearchOptions): Promise<SearchResults> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) {
    throw new Error(
      'The photo library is not connected yet. Add PEXELS_API_KEY to this project ' +
        'in Vercel and redeploy.',
    );
  }

  const query = options.query.trim().slice(0, 100);
  const page = Math.min(50, Math.max(1, Math.round(options.page ?? 1)));

  const params = new URLSearchParams({
    per_page: String(PER_PAGE),
    page: String(page),
  });
  if (query) params.set('query', query);
  if (options.orientation) params.set('orientation', options.orientation);
  // UK English, because these are UK travel businesses and the results differ:
  // "holiday" finds something different in en-US.
  params.set('locale', 'en-GB');

  const endpoint = query ? 'search' : 'curated';
  const response = await fetch(`${API_BASE}/${endpoint}?${params}`, {
    // Not "Bearer". Pexels takes the bare key, and sending it with a scheme
    // prefix is a 401 that reads exactly like a wrong key.
    headers: { Authorization: key },
    // The editor is asking on somebody's behalf and they are waiting. No point
    // holding a connection open longer than a person will wait for a grid.
    signal: AbortSignal.timeout(10_000),
  });

  if (response.status === 401) {
    throw new Error('The photo library rejected our key. It needs checking in Vercel.');
  }
  if (response.status === 429) {
    throw new Error(
      'The photo library is rate limited for now. It resets hourly, so try again shortly.',
    );
  }
  if (!response.ok) {
    throw new Error(`The photo library did not answer (${response.status}).`);
  }

  return parsePhotos(await response.json());
}

/**
 * The URL of one photo, checked, ready to be copied into our own store.
 *
 * Takes the whole StockPhoto rather than a URL string, so the only way to import
 * something is to have parsed it out of a real response first. A function that
 * took a URL would be a function somebody could hand a URL from a request body,
 * and then the whitelist above would be decoration.
 */
export function importableUrl(photo: StockPhoto): string {
  const url = imageUrl(photo.fullUrl);
  if (!url) throw new Error('That photo has no usable image.');
  return url;
}

/** The credit line, as one string, for a UI that has room for one line. */
export function creditLine(credit: MediaCredit): string {
  if (!credit.photographer) return 'Pexels';
  return `${credit.photographer} on Pexels`;
}
