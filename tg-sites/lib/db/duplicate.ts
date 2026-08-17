/**
 * Copying a whole site into another one.
 *
 * A site is a tenant, so a duplicate is a new tenant (see createTenant in
 * tenants.ts) plus a deep copy of everything the source owns. This file is where
 * that copy lives. It grows a slice at a time: the media first, then the pages
 * and regions, then collections and fonts, each reusing the map the media copy
 * returns to repoint the images embedded in the content.
 *
 * TWO TENANTS, NEVER ONE TRANSACTION. withTenant refuses to open a second tenant
 * inside the first (lib/db/withTenant.ts), which is the rule that stops a
 * cross-tenant write happening by accident, and it applies here too. So every
 * copy is a read from the source in its own scope, held in memory, then a write
 * into the destination in its own scope. The write side is atomic; the read side
 * is just a prior step.
 */

import 'server-only';

import { sanitisePage, sanitiseRegion } from '../content/sanitise-page';
import { parsePage, parseRegion, type Page, type Region } from '../content/schema';
import { copyIntoStore } from '../media/blob';
import { isAllowedMime, MAX_UPLOAD_BYTES, storagePathFor, type MediaMime } from '../media/limits';
import type { MediaItem } from '../media/types';
import { insertCopiedFont, listFontsForCopy } from './fonts';
import { insertMedia, listAllMedia, type NewMedia } from './media';
import { listPagesWithContent } from './pages';
import { getRegion } from './regions';
import { getSettings, saveSettings } from './settings';
import { createTenant, type Tenant } from './tenants';
import { getTheme, saveTheme } from './theme';
import { withTenant, type Tx } from './withTenant';

/** Same jsonb cast as every other write in this directory. See pages.ts. */
function json(tx: Tx, value: unknown) {
  return tx.json(value as Parameters<Tx['json']>[0]);
}

/**
 * The destination row for one copied image.
 *
 * Pure, so the split of where each field comes from is tested without a store: the
 * type and the byte count are the STORED object's own facts, straight off the copy
 * the store just made, while the label, dimensions, alt text and credit are
 * metadata the store never knew and are carried across from the source row. The
 * key and the url are the new object's, which is the whole point of an own-copy.
 */
export function copiedMediaRow(
  item: MediaItem,
  stored: { url: string; pathname: string; size: number; contentType: MediaMime },
): NewMedia {
  return {
    storageKey: stored.pathname,
    url: stored.url,
    filename: item.filename,
    mime: stored.contentType,
    bytes: stored.size,
    width: item.width,
    height: item.height,
    alt: item.alt,
    source: item.source,
    credit: item.credit,
  };
}

/**
 * Copy every image a site has into another site's own storage.
 *
 * OWN COPIES, NOT SHARED URLS. Each picture is re-uploaded into the destination
 * tenant's own prefix and gets its own blob object, so the two sites share
 * nothing: deleting or replacing an image on one can never break the other. This
 * is the isolation Andy chose over the cheaper option of pointing both sites at
 * one URL. copyIntoStore is the same copy a Pexels import already does.
 *
 * THREE PHASES, because a blob copy is slow network I/O that has no business
 * holding a transaction open, and because the two tenants cannot share one:
 *   1. read the whole source bank in the source's scope,
 *   2. copy each object into the destination's store, no database open,
 *   3. write all the destination rows in one destination transaction.
 * insertMedia opens its own withTenant, but for the same tenant and role it
 * reuses the one this opens, so the whole bank commits together or not at all. A
 * failure in phase three rolls the rows back and leaves a few orphaned objects,
 * which cost pennies and are the harmless side to fail on; the clone is a draft
 * the orchestrator can delete and remake.
 *
 * Returns the old-url to new-url map, which the later content slices use to
 * repoint every image embedded in the copied pages, regions and items. An empty
 * bank returns an empty map and touches the store not at all.
 */
export async function copyMediaToTenant(
  sourceTenantId: string,
  destTenantId: string,
): Promise<Map<string, string>> {
  const sources = await listAllMedia(sourceTenantId);
  if (sources.length === 0) return new Map();

  const copied: Array<{ fromUrl: string; row: NewMedia }> = [];

  for (const item of sources) {
    // The extension only; storagePathFor files it under the DESTINATION's prefix,
    // which is what keeps a copy out of the source tenant's storage.
    const mime: MediaMime = isAllowedMime(item.mime) ? item.mime : 'image/jpeg';
    const stored = await copyIntoStore(
      item.url,
      storagePathFor(destTenantId, item.filename, mime),
      MAX_UPLOAD_BYTES,
    );
    copied.push({ fromUrl: item.url, row: copiedMediaRow(item, stored) });
  }

  await withTenant(destTenantId, async () => {
    for (const { row } of copied) {
      await insertMedia(destTenantId, row);
    }
  });

  return new Map(copied.map(({ fromUrl, row }) => [fromUrl, row.url]));
}

// ---------------------------------------------------------------------------
// The content
// ---------------------------------------------------------------------------

/**
 * Repoint every copied image, everywhere it is mentioned.
 *
 * A deep walk over any stored value, swapping each source url for its copy from
 * the media map. SUBSTRING, not whole-string, because an image url turns up
 * embedded as often as alone: a plain src is the whole string, but a CSS
 * `url(...)` background or a two-part srcset is the url inside a longer one, and
 * both have to move. Blob urls are long and carry a random suffix, so a
 * substring match has no realistic false positive.
 *
 * Longest key first, so a url that happens to be a prefix of another cannot be
 * half-rewritten by the shorter one landing first.
 *
 * The `http` guard is the whole speed story: almost nothing in a page is a url,
 * and skipping the map for those makes the walk cost about what a plain clone
 * would. An empty map returns the value untouched.
 */
export function rewriteUrls<T>(value: T, map: Map<string, string>): T {
  if (map.size === 0) return value;
  const pairs = [...map].sort((a, b) => b[0].length - a[0].length);
  return walkUrls(value, pairs) as T;
}

function walkUrls(value: unknown, pairs: Array<[string, string]>): unknown {
  if (typeof value === 'string') return swapUrls(value, pairs);
  if (Array.isArray(value)) return value.map((item) => walkUrls(item, pairs));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = walkUrls(item, pairs);
    return out;
  }
  return value;
}

function swapUrls(str: string, pairs: Array<[string, string]>): string {
  if (!str.includes('http')) return str;
  let out = str;
  for (const [from, to] of pairs) {
    if (out.includes(from)) out = out.split(from).join(to);
  }
  return out;
}

/**
 * Parse and sanitise a copied page the same way a save would, so the stored tree
 * is identical in shape to one the editor wrote rather than one that came in a
 * side door. See the same reasoning in lib/db/starters.ts.
 */
function readyPage(page: Page): Page {
  const parsed = parsePage(page);
  if (!parsed.ok) {
    throw new Error(`A copied page will not parse: ${parsed.errors.join('; ')}`);
  }
  return sanitisePage(parsed.page);
}

function readyRegion(region: Region): Region {
  const parsed = parseRegion(region, region.region);
  if (!parsed.ok) {
    throw new Error(`A copied ${region.region} will not parse: ${parsed.errors.join('; ')}`);
  }
  return sanitiseRegion(parsed.region);
}

/** What the copy did, for the orchestrator to report. */
export interface ContentCopyResult {
  pages: number;
}

/**
 * Copy a site's pages, header, footer, theme and settings into another site,
 * with every embedded image repointed at its copy.
 *
 * THE PAGE TREE IS REMAPPED, NOT PRESERVED BY ID. Each page gets a fresh id in
 * the destination, so a child's parent_id has to point at the id just minted for
 * its parent, not the source's. listPagesWithContent hands them back parents
 * first, and idMap carries source id to new id down the tree. Everything else a
 * page refers to travels by value not id: a nav link is a path, a listing block
 * a collection key, so copying slugs and keys verbatim needs no further remap.
 *
 * ADDRESSES ARE REUSED. createTenant already left a blank home at slug '' in the
 * destination, so the copy upserts on (parent_id, slug) exactly as applyStarter
 * does: the source home fills the blank one in rather than colliding with it.
 *
 * TWO TENANTS, TWO PHASES. The source is read in its own scope, held, then the
 * destination is written in ONE transaction: the pages and regions on this tx,
 * and saveTheme/saveSettings reusing it because withTenant hands a nested call
 * for the same tenant the open scope. So the whole content copy commits together
 * or not at all. Nothing is published: pages are written as drafts and the
 * published columns are left behind, because a clone is a draft the staff
 * rebrand before it goes out.
 *
 * THE HEAD AND BODY CUSTOM CODE (staff_settings) IS DELIBERATELY NOT COPIED. It
 * is raw HTML injected into every page, the most dangerous field a site has and
 * the one a different client is least likely to want verbatim: an analytics id,
 * a chat widget tied to an account, a verification meta tag. It is left for staff
 * to add through the one gated path, which keeps that column's single-writer
 * guarantee intact rather than making a duplicate a second way to set it.
 */
export async function copyContentToTenant(
  sourceTenantId: string,
  destTenantId: string,
  urlMap: Map<string, string>,
  userId?: string,
): Promise<ContentCopyResult> {
  // Phase one: read the source, each reader in the source's own scope.
  const pages = await listPagesWithContent(sourceTenantId);
  const header = await getRegion(sourceTenantId, 'header');
  const footer = await getRegion(sourceTenantId, 'footer');
  const theme = await getTheme(sourceTenantId);
  const settings = await getSettings(sourceTenantId);

  const rw = <T>(value: T): T => rewriteUrls(value, urlMap);

  // Phase two: rewrite in memory and write the destination in one transaction.
  return withTenant(destTenantId, async (tx) => {
    const idMap = new Map<string, string>();

    for (const page of pages) {
      const parentId = page.parentId ? idMap.get(page.parentId) ?? null : null;
      const seo = json(tx, rw(page.seo));
      const content = json(tx, readyPage(rw(page.content)));

      const existing = parentId === null
        ? await tx`
            select id from public.pages where parent_id is null and slug = ${page.slug} limit 1
          `
        : await tx`
            select id from public.pages where parent_id = ${parentId}::uuid and slug = ${page.slug} limit 1
          `;

      const rows = existing.length
        ? await tx`
            update public.pages set
              title = ${page.title}, seo = ${seo}, draft_content = ${content},
              updated_by = ${userId ?? null}::text
            where id = ${String((existing[0] as Record<string, unknown>).id)}::uuid
            returning id
          `
        : await tx`
            insert into public.pages (tenant_id, parent_id, slug, title, seo, draft_content, updated_by)
            values (
              ${destTenantId}::uuid, ${parentId}::uuid, ${page.slug}, ${page.title},
              ${seo}, ${content}, ${userId ?? null}::text
            )
            returning id
          `;

      idMap.set(page.id, String((rows[0] as Record<string, unknown>).id));
    }

    for (const record of [header, footer]) {
      const region = readyRegion(rw(record.region));
      await tx`
        insert into public.site_regions (tenant_id, region, draft_content, updated_by)
        values (${destTenantId}::uuid, ${region.region}, ${json(tx, region)}, ${userId ?? null}::text)
        on conflict (tenant_id, region) do update set
          draft_content = excluded.draft_content,
          updated_by    = excluded.updated_by
      `;
    }

    // Both sit on the tenants row createTenant already made, so they are updates.
    // Called by id, they reuse this transaction rather than open their own.
    await saveTheme(destTenantId, rw(theme));
    await saveSettings(destTenantId, rw(settings));

    return { pages: pages.length };
  });
}

// ---------------------------------------------------------------------------
// The fonts
// ---------------------------------------------------------------------------

/** What the font copy did, for the orchestrator to report. */
export interface FontCopyResult {
  fonts: number;
  files: number;
}

/**
 * Copy a site's whole font library into another site.
 *
 * FONTS ARE DESIGN, SO THEY TRAVEL WITH A CLONE, where the blog and the other
 * collections do NOT: those are the first client's own writing and have no place
 * in the next client's site. Slice 3 copied the theme, which names its typefaces
 * by slug, so those faces have to exist in the clone or a styled heading falls
 * back to a system font. No urls are involved: a font is bytes and metadata, not
 * a reference, so there is nothing for the media map to rewrite.
 *
 * Read the source in its own scope, hold it, then write the destination in ONE
 * transaction: insertCopiedFont is called by id, so it reuses this scope and the
 * whole library commits together or not at all. An empty library does no work.
 */
export async function copyFontsToTenant(
  sourceTenantId: string,
  destTenantId: string,
): Promise<FontCopyResult> {
  const fonts = await listFontsForCopy(sourceTenantId);
  if (fonts.length === 0) return { fonts: 0, files: 0 };

  return withTenant(destTenantId, async () => {
    let files = 0;
    for (const font of fonts) {
      await insertCopiedFont(destTenantId, font);
      files += font.files.length;
    }
    return { fonts: fonts.length, files };
  });
}

// ---------------------------------------------------------------------------
// The whole thing
// ---------------------------------------------------------------------------

/**
 * Duplicate a whole site: make the clone, then fill it from the source.
 *
 * THE ONE ORDER THAT WORKS, and it is enforced by the code rather than a comment.
 * createTenant first, because everything else writes into the tenant it makes.
 * Then the media, because its copy returns the old-to-new url map the content
 * copy needs to repoint every image: urlMap is a const the content call takes, so
 * the media copy cannot be moved after it without TypeScript noticing. Then the
 * content, then the fonts.
 *
 * A CLONE IS A DRAFT, which is what makes a failure safe. createTenant leaves the
 * published columns null and every copy writes drafts, so a duplicate that dies
 * between steps (a blob store hiccup, say) is an unpublished site on no domain,
 * something staff can delete, never something a visitor can reach. That is why
 * there is no grand rollback spanning the four transactions: the failure mode is
 * already harmless, and a half-copied draft is more use to staff than nothing.
 *
 * The blog and the other collections are NOT copied, by decision: they are the
 * first client's writing, with no place in the next client's site. Nor is the
 * head and body custom code, the custom domain, or the site's history. See the
 * copiers for each.
 */
export async function duplicateSite(
  sourceTenantId: string,
  ownerId: string,
  name: string,
): Promise<Tenant> {
  const clone = await createTenant({ name }, ownerId);

  const urlMap = await copyMediaToTenant(sourceTenantId, clone.id);
  await copyContentToTenant(sourceTenantId, clone.id, urlMap, ownerId);
  await copyFontsToTenant(sourceTenantId, clone.id);

  return clone;
}
