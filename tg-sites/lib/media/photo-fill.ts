/**
 * Resolving a photo plan against the photo library, best effort.
 *
 * The pure half (lib/content/photo-plan.ts) decided what is wanted and where
 * it goes; this half searches the library, copies each find into the tenant's
 * own media and writes the URLs in. It is called while a template page or a
 * whole starter site is being built in memory, BEFORE the tree is parsed,
 * sanitised and written, so the URLs go through exactly the same doors a
 * hand-picked picture would.
 *
 * BEST EFFORT, ALWAYS, at every grain. No photo key, no blob store, a search
 * that finds nothing, a rate limit, any error at all: that one picture stays
 * empty and the build carries on. A page with an empty frame is a page
 * somebody finishes by hand; a build that failed over a photograph would be
 * trading the whole site for a decoration. Nothing here throws.
 *
 * NEVER INSIDE A TRANSACTION. A photo fetch is two external calls; the
 * starter build runs this while its connection is idle, before withTenant
 * opens (see applyStarter).
 *
 * THE CACHE holds PROMISES, keyed by query, and is shared across one build.
 * Promises rather than values because the wizard builds its five pages in
 * parallel: two pages that end on the same call-to-action preset ask for the
 * same picture at the same moment, and the second must join the first's
 * import rather than race it into a duplicate in the client's media.
 */

import { pagePhotoPlan, applyPhoto, type PhotoTarget } from '../content/photo-plan';
import type { Section } from '../content/schema';
import type { StarterPage } from '../content/starters';
import { blobConfigured } from './blob';
import { pexelsConfigured, searchPexels } from './pexels';
import type { StockPhoto } from './types';
import { importStockPhoto } from './stock';

/** Query → the one in-flight or settled import for it. Null found nothing. */
export type PhotoCache = Map<string, Promise<string | null>>;

/** The cache key: plain query for the first result, suffixed for the rest. */
function keyOf(query: string, variant: number): string {
  return variant > 0 ? `${query}#${variant}` : query;
}

/**
 * One imported url per (query, variant).
 *
 * The variant is which of the query's RESULTS this caller wants: a gallery is
 * four frames of one subject, and resolving the same query four times gives
 * the same first photo four times. One search per query (shared through
 * `searches`), one import per distinct result actually used. A variant past
 * what the search returned is a null, not a repeat: a gallery with three good
 * frames beats one with two copies of the second.
 */
function resolve(
  tenantId: string,
  query: string,
  variant: number,
  cache: PhotoCache,
  searches: Map<string, Promise<StockPhoto[]>>,
): Promise<string | null> {
  const key = keyOf(query, variant);
  const known = cache.get(key);
  if (known) return known;

  let search = searches.get(query);
  if (!search) {
    search = searchPexels({ query, orientation: 'landscape' }).then((found) => found.photos);
    searches.set(query, search);
  }

  const pending = (async () => {
    try {
      const photo = (await search)[variant];
      return photo ? (await importStockPhoto(tenantId, photo)).url : null;
    } catch {
      // A miss stays cached, so a failing query is not retried per section.
      return null;
    }
  })();

  cache.set(key, pending);
  return pending;
}

/** Resolve every target and write in what was found. The shared core. */
async function fill(
  tenantId: string,
  plan: PhotoTarget[],
  sections: Section[],
  cache: PhotoCache,
): Promise<void> {
  try {
    if (plan.length === 0) return;
    if (!pexelsConfigured() || !blobConfigured()) return;

    const searches = new Map<string, Promise<StockPhoto[]>>();
    const wanted = new Map<string, { query: string; variant: number }>();
    for (const target of plan) {
      const variant = target.variant ?? 0;
      wanted.set(keyOf(target.query, variant), { query: target.query, variant });
    }

    const urls = new Map<string, string | null>();
    await Promise.all(
      [...wanted.entries()].map(async ([key, ask]) => {
        urls.set(key, await resolve(tenantId, ask.query, ask.variant, cache, searches));
      }),
    );

    for (const target of plan) {
      const url = urls.get(keyOf(target.query, target.variant ?? 0));
      if (url) applyPhoto(sections, target, url);
    }
  } catch {
    // The fill as a whole is as best-effort as each picture in it.
  }
}

/**
 * Fill a built page's photographs from its spec, in place.
 *
 * The distinct queries resolve together rather than one after another, so a
 * six-section page costs one round of latency, not six. Pass one cache across
 * a multi-page build so repeated presets share their pictures.
 */
export async function fillPagePhotos(
  tenantId: string,
  spec: StarterPage,
  sections: Section[],
  cache: PhotoCache = new Map(),
): Promise<void> {
  await fill(tenantId, pagePhotoPlan(spec, sections), sections, cache);
}

/**
 * The same, for one already-planned section: the drawer's designed insert,
 * whose caller planned with sectionPhotoTargets against index 0.
 */
export async function fillPlannedPhotos(
  tenantId: string,
  plan: PhotoTarget[],
  sections: Section[],
  cache: PhotoCache = new Map(),
): Promise<void> {
  await fill(tenantId, plan, sections, cache);
}
