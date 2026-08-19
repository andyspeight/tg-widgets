/**
 * Writing a whole starter site, in one transaction.
 *
 * WHY IT IS ALL ONE TRANSACTION. A starter makes five pages, a header and a
 * footer. Half of that is worse than none: a site with three of five pages, a
 * menu pointing at the two that failed and no way to tell which is which is a
 * mess somebody has to unpick by hand. Either the client gets a site or they get
 * the empty one they already had.
 *
 * NOTHING IS PUBLISHED. Every page and both regions are written as DRAFTS. A
 * site appearing live on a client's own domain because somebody pressed a button
 * in a wizard, with placeholder copy still in it, would be the single most
 * embarrassing thing this product could do. They look at it, they change it,
 * they publish it.
 *
 * IT ONLY RUNS ON AN EMPTY SITE, checked inside the same transaction rather than
 * on the screen. The screen's version of that check is a courtesy to the person
 * looking at it; this one is the control, because a server action is a public
 * endpoint whose URL is in the page's own JavaScript. See the note at the top of
 * app/actions/settings.ts.
 */

import { sanitisePage, sanitiseRegion } from '../content/sanitise-page';
import { parsePage, parseRegion, type Page, type Region } from '../content/schema';
import {
  buildStarterPage,
  buildStarterRegion,
  starterById,
  type StarterFacts,
} from '../content/starters';
import { withTenant, type Tx } from './withTenant';
import { importDesignedFonts } from '../content/designed-fonts';
import { fillPagePhotos, type PhotoCache } from '../media/photo-fill';

/** What happened, for the screen to say. */
export interface StarterResult {
  pages: number;
  /** The id of the home page, so the editor can be opened straight at it. */
  homePageId: string | null;
}

function json(tx: Tx, value: unknown) {
  return tx.json(value as Parameters<Tx['json']>[0]);
}

/**
 * Whether this site has any content at all.
 *
 * EMPTY MEANS NO SECTIONS ANYWHERE, not "no pages". A brand new site already has
 * one blank home page, and refusing to run because a page exists would mean the
 * starter never runs at all. Refusing because somebody has already put a section
 * on that page is the real rule: at that point it is their work, and a starter
 * would overwrite it.
 *
 * The published copy is checked as well as the draft. A page that has been
 * published and then emptied is still a page that was on the internet, and
 * replacing its content is not a decision a wizard should take.
 */
export async function siteIsEmpty(tenantId: string): Promise<boolean> {
  return withTenant(tenantId, async (tx) => isEmpty(tx));
}

async function isEmpty(tx: Tx): Promise<boolean> {
  const rows = await tx`
    select
      coalesce(jsonb_array_length(draft_content -> 'sections'), 0) as draft_sections,
      coalesce(jsonb_array_length(published_content -> 'sections'), 0) as live_sections
    from public.pages
  `;

  for (const raw of rows) {
    const row = raw as Record<string, unknown>;
    if (Number(row.draft_sections ?? 0) > 0) return false;
    if (Number(row.live_sections ?? 0) > 0) return false;
  }

  // A region somebody has already built counts too, for the same reason.
  const regions = await tx`
    select coalesce(jsonb_array_length(draft_content -> 'sections'), 0) as sections
    from public.site_regions
  `;

  for (const raw of regions) {
    if (Number((raw as Record<string, unknown>).sections ?? 0) > 0) return false;
  }

  return true;
}

/**
 * Everything the tree needs, parsed and sanitised the same way a save would be.
 *
 * THROUGH parsePage AND sanitisePage, not straight into the column. The starter
 * data is ours rather than a client's, so this is not about hostile input: it is
 * about the stored tree being IDENTICAL in shape to one the editor saved. A page
 * that went in by a different door would be the one page in the site whose
 * column widths were never normalised, and nothing would say so.
 */
function ready(page: Page): Page {
  const parsed = parsePage(page);
  if (!parsed.ok) {
    throw new Error(`The starter built a page the schema refuses: ${parsed.errors.join('; ')}`);
  }
  return sanitisePage(parsed.page);
}

function readyRegion(region: Region): Region {
  const parsed = parseRegion(region, region.region);
  if (!parsed.ok) {
    throw new Error(`The starter built a ${region.region} the schema refuses: ${parsed.errors.join('; ')}`);
  }
  return sanitiseRegion(parsed.region);
}

/**
 * Build the site.
 *
 * Returns null when the site is not empty, which the action turns into a
 * sentence rather than an error: it is a refusal a person can act on, not a
 * fault.
 */
export async function applyStarter(
  tenantId: string,
  starterId: string,
  facts: StarterFacts,
  userId?: string,
): Promise<StarterResult | null> {
  const starter = starterById(starterId);
  if (!starter) return null;

  /*
   * BUILT BEFORE THE TRANSACTION OPENS. Every page and both regions are made,
   * parsed and sanitised in memory first, so a starter that cannot build is a
   * throw with the connection still idle rather than a rollback halfway through
   * writing somebody's site.
   *
   * The photographs are fetched here too, for the same reason: two external
   * calls per picture have no business inside a write transaction. One cache
   * across the five pages, so the sections they share (every page ends on a
   * call to action) share their pictures instead of importing five copies.
   * The fill never throws; with no photo key the site is simply built with
   * its frames empty, exactly as it was before photographs existed.
   */
  const photoCache: PhotoCache = new Map();
  const pages = await Promise.all(
    starter.pages.map(async (page) => {
      const built = await buildStarterPage(page, facts);
      await fillPagePhotos(tenantId, page, built.sections, photoCache);
      return { spec: page, content: ready(built) };
    }),
  );

  const header = readyRegion(buildStarterRegion(starter.header, 'header', starter.pages, facts));
  const footer = readyRegion(buildStarterRegion(starter.footer, 'footer', starter.pages, facts));

  const result = await withTenant(tenantId, async (tx) => {
    if (!(await isEmpty(tx))) return null;

    let homePageId: string | null = null;

    for (const { spec, content } of pages) {
      /*
       * UPSERT ON THE ADDRESS, because a new site already HAS a home page at the
       * empty slug and a second one is refused by the unique index. Reusing it
       * is also the kinder answer: whatever the client called it, the page they
       * were already looking at is the one that fills up.
       *
       * Top level only, which is all any starter builds. A nested starter page
       * would need the parent's id threading through here, and until one exists
       * that would be a branch nothing takes and nothing tests.
       */
      const existing = await tx`
        select id from public.pages
        where parent_id is null and slug = ${spec.slug}
        limit 1
      `;

      const rows = existing.length
        ? await tx`
            update public.pages set
              title         = ${content.title},
              draft_content = ${json(tx, content)},
              updated_by    = ${userId ?? null}::text
            where id = ${String((existing[0] as Record<string, unknown>).id)}::uuid
            returning id
          `
        : await tx`
            insert into public.pages (tenant_id, parent_id, slug, title, draft_content, updated_by)
            values (
              ${tenantId}::uuid,
              null,
              ${spec.slug},
              ${content.title},
              ${json(tx, content)},
              ${userId ?? null}::text
            )
            returning id
          `;

      const id = String((rows[0] as Record<string, unknown>).id);
      if (spec.slug === '') homePageId = id;
    }

    for (const region of [header, footer]) {
      await tx`
        insert into public.site_regions (tenant_id, region, draft_content, updated_by)
        values (${tenantId}::uuid, ${region.region}, ${json(tx, region)}, ${userId ?? null}::text)
        on conflict (tenant_id, region) do update set
          draft_content = excluded.draft_content,
          updated_by    = excluded.updated_by
      `;
    }

    return { pages: pages.length, homePageId };
  });

  /*
   * A DESIGNED STARTER CARRIES ITS OWN TYPEFACES. Its home is a frozen concept
   * whose CSS names fonts like "Bodoni Moda"; loading them into this site's
   * library is what makes the type exact rather than a fallback. Done AFTER the
   * transaction, best effort: a font fetch is slow and external, and must never
   * hold a write lock or roll a whole site back over a typeface. Only when a site
   * was actually built (result is not null).
   */
  if (result && starterId.startsWith('design-')) {
    await importDesignedFonts(tenantId, starterId.slice('design-'.length));
  }

  return result;
}
