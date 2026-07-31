/**
 * The seam between "the editor edits a Page" and "a header is not a Page".
 *
 * WHY THERE IS A SEAM AT ALL
 *
 * The editor is a large, well-tested thing that knows how to select, drag,
 * undo, style and save a Page. A header is sections, rows, columns and blocks,
 * which is a Page in every way that the editor cares about and in no way that
 * the database cares about. Building a second editor for the difference would
 * have meant two of everything and only one of them ever exercised.
 *
 * So the region screen wraps the region's sections as a Page on the way in and
 * unwraps them on the way out, and the editor never learns that anything is
 * different. Both directions live here, in one file, so they cannot disagree
 * about what the wrapper looks like.
 *
 * THE WRAPPER FIELDS ARE FAKE AND NONE OF THEM IS SAVED. A region has no title,
 * no slug and no SEO. The title is what the editor puts in its top bar, so it
 * says "Header"; the slug is empty and the SEO is off. pageAsRegion throws all
 * three away, which is why the region screen also hides the fields that would
 * let somebody type into them and watch the typing vanish.
 */

import { CONTENT_VERSION, type Page, type Region, type RegionName } from './schema';

const TITLES: Record<RegionName, string> = {
  header: 'Header',
  footer: 'Footer',
};

/** A region as something the editor will accept. */
export function regionAsPage(region: Region): Page {
  return {
    version: CONTENT_VERSION,
    /*
     * A stable id rather than a generated one. Nothing looks a region up by it,
     * and React keys off section and block ids rather than this, so a fresh
     * value on every render would buy nothing and cost a re-mount.
     */
    id: `region-${region.region}`,
    title: TITLES[region.region],
    slug: '',
    seo: { noindex: false },
    sections: region.sections,
  };
}

/** What the editor is holding, back into a region worth saving. */
export function pageAsRegion(
  page: Page,
  name: RegionName,
  flags: { sticky: boolean; overlay: boolean },
): Region {
  return {
    version: CONTENT_VERSION,
    region: name,
    // Both are header-only in the product. Stored as false on a footer rather
    // than omitted, so the shape is the same whichever region is being read.
    sticky: name === 'header' && flags.sticky,
    overlay: name === 'header' && flags.overlay,
    sections: page.sections,
  };
}

export const REGION_TITLES = TITLES;
