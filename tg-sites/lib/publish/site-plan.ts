/**
 * What a "Publish site" actually pushes live.
 *
 * Publishing in this product has always been per unit: one page, one header,
 * one footer. That is deliberate and it stays, but it left a gap. An agent who
 * edits six pages and presses Publish on one is surprised, rightly, that the
 * other five still read "Live, with unpublished edits". "Publish site" closes
 * that gap by doing every pending page in one sweep, and this module is the one
 * decision it rests on: which pages and which regions count as pending.
 *
 * THE RULE, and it is the whole point of this file: a page goes live from here
 * ONLY if it is ALREADY live and has been edited since. A draft is left exactly
 * as it is. That is what makes Draft the switch for "not yet": a page somebody
 * is still building, or one they deliberately took down with Unpublish, is never
 * swept public by a site-wide publish. A new page goes live the first time
 * through its own Publish, and joins every site publish after that.
 *
 * THE HEADER AND THE FOOTER HAVE NO DRAFT STATE of their own. Each is one
 * document per site, and building one is already the decision to show it, so
 * they publish whenever they carry unpublished changes. See lib/db/regions.ts.
 *
 * Kept pure and dependency-light on purpose: the selection is the part that must
 * not drift as the tree shape changes around it, so it is decided here from
 * plain rows in and a plain plan out, and pinned by tests/site-publish.test.ts.
 * The reading, the ordering and the publishing itself live in the action and the
 * dialog that call this.
 */

import type { RegionName } from '../content/schema';

/** One page the sweep will publish, in the site's own list order. */
export interface SitePublishPageTarget {
  id: string;
  title: string;
  slug: string;
}

/** Everything a site publish will touch, and what it is leaving alone. */
export interface SitePublishTargets {
  /** The live pages with edits waiting, in list order. */
  pages: SitePublishPageTarget[];
  /** The site furniture with edits waiting. */
  regions: RegionName[];
  /** How many pages are being left as drafts, so the overlay can say so. */
  draftsHeldBack: number;
}

/** The full plan the dialog works from: the targets, plus where to send them. */
export interface SitePublishPlan extends SitePublishTargets {
  /** The public front of the site, for the link shown when it is done. */
  siteUrl: string;
}

/** Just the fields of a page summary the selection reads. */
export interface SitePublishPageInput {
  id: string;
  title: string;
  slug: string;
  status: 'draft' | 'published';
  hasUnpublishedChanges: boolean;
}

/** Just the fields of a region record the selection reads. */
export interface SitePublishRegionInput {
  name: RegionName;
  hasUnpublishedChanges: boolean;
}

/**
 * Work out what a "Publish site" should push live, and what it should leave.
 *
 * The page list arrives in the order the site lists it (parents before
 * children), and the targets keep that order so the overlay publishes the home
 * page before the pages that hang off it.
 */
export function selectSitePublishTargets(
  pages: readonly SitePublishPageInput[],
  regions: readonly SitePublishRegionInput[],
): SitePublishTargets {
  const targetPages = pages
    .filter((page) => page.status === 'published' && page.hasUnpublishedChanges)
    .map((page) => ({ id: page.id, title: page.title, slug: page.slug }));

  // Everything not already live. A brand-new page, or one taken down on purpose:
  // both are drafts and both are left alone. Counted, not listed, because the
  // overlay is a reassurance ("your drafts are safe"), not a second worklist.
  const draftsHeldBack = pages.filter((page) => page.status === 'draft').length;

  const targetRegions = regions
    .filter((region) => region.hasUnpublishedChanges)
    .map((region) => region.name);

  return { pages: targetPages, regions: targetRegions, draftsHeldBack };
}

/** Whether a plan would publish nothing at all: the site is already up to date. */
export function planIsEmpty(
  targets: Pick<SitePublishTargets, 'pages' | 'regions'>,
): boolean {
  return targets.pages.length === 0 && targets.regions.length === 0;
}
