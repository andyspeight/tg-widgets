/**
 * What a client's llms.txt says.
 *
 * WHAT IT IS. The convention (llmstxt.org) is a plain-language map of a site,
 * written for an assistant rather than a browser, at /llms.txt. robots.txt tells
 * a crawler what it MAY read and sitemap.xml tells it what EXISTS; neither tells
 * it what any of it is ABOUT. An assistant answering "who runs small-ship
 * voyages around the Hebrides" has to guess that from whatever it happened to
 * crawl. This is the site saying it plainly, once.
 *
 * WHY IT IS WORTH HAVING NOW rather than when it is a standard. It costs one
 * static route, it cannot hurt anything that ignores it, and the whole file is
 * derived from data the site already holds. The downside of being early is a
 * file nobody reads; the downside of being late is a client invisible to the
 * engines their customers are starting to ask.
 *
 * NOTHING HERE IS A CLIENT SETTING, the same decision robots.txt records for
 * itself. Every line is derived: the company profile from Settings, the pages
 * from what is published, the descriptions from each page's own search
 * description. That last one matters, because since #239 those descriptions are
 * written automatically when a page is published, so a client who has filled in
 * nothing still gets a useful file.
 *
 * A NOINDEX PAGE IS LEFT OUT, for the reason the sitemap leaves it out: a page
 * hidden from search on purpose should not be handed to an assistant either.
 * Consistency across the three files is the point. A crawler that finds a page
 * in one and excluded from another has been told two things.
 */

import type { SiteSettings } from '../settings/schema';

/** A published page, as this file needs it. */
export interface LlmsPage {
  /** The URL path with no leading slash. Empty string is the home page. */
  path: string;
  title: string;
  description: string;
  noindex: boolean;
}

/** A published collection entry. */
export interface LlmsEntry {
  collection: string;
  slug: string;
  title: string;
}

/**
 * How many of each are listed.
 *
 * A file an assistant has to read is a file that has to fit in a context window,
 * and a blog with four hundred posts listed in full is a wall nobody reads to
 * the end of. Pages are effectively uncapped because a site has tens; entries
 * are capped because a collection has no ceiling. The sitemap is the exhaustive
 * list and is where a crawler goes for everything.
 */
const MAX_PAGES = 200;
const MAX_ENTRIES = 100;

/** One line, with the newlines that would break the list taken out. */
function line(value: string, max = 300): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** The site's own address for a path, with no double slash and no trailing one. */
function url(origin: string, path: string): string {
  const base = origin.replace(/\/+$/, '');
  const rest = path.replace(/^\/+/, '');
  return rest ? `${base}/${rest}` : base;
}

/**
 * Where the company is, as one line, from the parts that are filled in.
 *
 * Skipped entirely when nothing is filled in rather than printed as a row of
 * empty commas, which is the shape this kind of assembly usually fails into.
 */
function whereabouts(settings: SiteSettings): string {
  const parts = [
    settings.streetAddress,
    settings.addressLocality,
    settings.addressRegion,
    settings.postalCode,
    settings.addressCountry,
  ]
    .map((part) => line(part ?? '', 80))
    .filter(Boolean);

  return parts.join(', ');
}

/**
 * The whole file.
 *
 * MARKDOWN, WHICH IS THE CONVENTION'S OWN FORMAT: an H1 for who this is, a
 * blockquote for the one-line summary, then H2 sections of links. An assistant
 * reads it as prose and a person can read it too, which is a quiet advantage
 * over XML when a client asks what we are telling the AI engines about them.
 */
export function llmsTxt(
  origin: string,
  settings: SiteSettings,
  pages: readonly LlmsPage[],
  entries: readonly LlmsEntry[] = [],
): string {
  const name = line(settings.companyName, 120) || 'This website';
  const about = line(settings.companyAbout, 400);

  const out: string[] = [`# ${name}`];

  if (about) out.push('', `> ${about}`);

  /*
   * THE FACTS AN ASSISTANT IS MOST OFTEN ASKED FOR, stated rather than left to
   * be inferred from a contact page it may not have read. "Where are they" and
   * "how do I reach them" are the two questions behind most local searches.
   */
  const facts: string[] = [];
  const where = whereabouts(settings);
  if (where) facts.push(`Based in ${where}.`);
  if (line(settings.telephone, 40)) facts.push(`Telephone: ${line(settings.telephone, 40)}`);
  if (facts.length) out.push('', ...facts);

  const listed = pages
    .filter((page) => !page.noindex)
    .slice(0, MAX_PAGES)
    .map((page) => {
      const title = line(page.title, 160) || page.path || 'Home';
      const note = line(page.description, 300);
      return `- [${title}](${url(origin, page.path)})${note ? `: ${note}` : ''}`;
    });

  if (listed.length) out.push('', '## Pages', '', ...listed);

  /*
   * ENTRIES GROUPED BY THEIR COLLECTION, because "Tours" and "Blog" are
   * different kinds of thing and an assistant reading a flat list of forty URLs
   * cannot tell which is which. The collection's own short name is the heading,
   * which is what the client called it.
   */
  const byCollection = new Map<string, LlmsEntry[]>();
  for (const entry of entries.slice(0, MAX_ENTRIES)) {
    const list = byCollection.get(entry.collection) ?? [];
    list.push(entry);
    byCollection.set(entry.collection, list);
  }

  for (const [collection, list] of byCollection) {
    const heading = line(collection, 60);
    if (!heading || list.length === 0) continue;
    out.push(
      '',
      `## ${heading.charAt(0).toUpperCase()}${heading.slice(1)}`,
      '',
      ...list.map((entry) => {
        const title = line(entry.title, 160) || entry.slug;
        return `- [${title}](${url(origin, `${collection}/${entry.slug}`)})`;
      }),
    );
  }

  // The exhaustive machine-readable list lives next door, and an assistant that
  // wants every URL rather than the readable summary should be told where.
  out.push('', '## Everything', '', `- [Full sitemap](${url(origin, 'sitemap.xml')})`);

  return `${out.join('\n')}\n`;
}
