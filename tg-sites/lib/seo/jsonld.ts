/**
 * Structured data, which is the single biggest thing we can do to be cited by
 * an AI engine.
 *
 * WHY THIS MATTERS MORE THAN IT USED TO. A search engine ranks pages; an
 * assistant answers a question and names its sources. The step in between is
 * ENTITY RESOLUTION: the engine has to be confident that "Someshop Travel" is a
 * particular business with a particular address and phone number, or it will
 * summarise the content without naming anybody. Organization markup is what
 * turns a page of text into a named thing that can be credited, and the product
 * had none of it: a grep for application/ld+json on 1 Aug 2026 returned nothing.
 *
 * BUILT FROM DATA THE CLIENT HAS ALREADY GIVEN US, never from a new field. The
 * company name, what they do and their locale are already in site settings for
 * the AI writer; the questions and answers are already in an accordion block on
 * the page. Asking somebody to type their business name a second time into an
 * "SEO" box is how the two end up disagreeing, and a mismatch between the
 * visible page and the structured data is worse than no structured data at all:
 * Google treats it as spam and an assistant treats it as untrustworthy.
 *
 * ONLY WHAT IS TRUE. Every builder below returns null when the facts are not
 * there. A FAQPage with no questions, or an Organization with no name, is a lie
 * in a machine-readable format, and this is the one part of the page written
 * specifically for something that cannot see when it is being told nonsense.
 *
 * SERVER RENDERED, like everything else here, so it is in the initial HTML and a
 * crawler that runs no JavaScript still gets it. That is most of them.
 */

import type { Page, Section } from '../content/schema';
import type { SiteSettings } from '../settings/schema';

/** A JSON-LD node. Loose on purpose: this is a document, not a domain model. */
export type JsonLd = Record<string, unknown>;

/** Anything falsy or blank becomes undefined, so it is dropped from the JSON. */
function clean(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : '';
  return text === '' ? undefined : text;
}

/** An object with every undefined key removed, or null if nothing is left. */
function compact(node: JsonLd): JsonLd | null {
  const out: JsonLd = {};
  for (const [key, value] of Object.entries(node)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  // '@context' and '@type' alone is not a statement about anything.
  return Object.keys(out).length > 2 ? out : null;
}

/**
 * The client's own profiles, gathered from the Social links blocks they have
 * already filled in.
 *
 * WHY THIS IS WORTH A WALK OF THE TREE. `sameAs` is how a search engine or an
 * assistant confirms that the business on this website is the SAME ENTITY as
 * that Facebook page and that Tripadvisor listing. Without it an engine has a
 * name and a description and no way to connect them to anything it already
 * knows, which is exactly the position it is in when it decides not to name a
 * business in an answer.
 *
 * FROM THE FOOTER THEY ALREADY BUILT, never a new field. The addresses are in a
 * Social links block because a visitor should be able to click them, and asking
 * for them a second time in an SEO panel would be two lists to keep in step.
 *
 * ONLY http AND https. The Social block deliberately allows mailto: and tel:,
 * because a follow us row usually ends with an email and a phone number, and
 * neither is a "reference Web page that unambiguously indicates the identity of
 * the item", which is what sameAs is defined as. A mailto: in there is not
 * merely useless, it is a claim that does not parse.
 */
export function profileLinks(trees: ReadonlyArray<{ sections: Section[] } | null | undefined>): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  for (const tree of trees) {
    for (const section of tree?.sections ?? []) {
      for (const row of section.rows) {
        for (const column of row.columns) {
          for (const block of column.blocks) {
            if (block.type !== 'social') continue;

            const items = Array.isArray(block.props.items) ? block.props.items : [];
            for (const raw of items) {
              const item = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
              const href = typeof item.href === 'string' ? item.href.trim() : '';
              if (!/^https?:\/\//i.test(href) || seen.has(href)) continue;
              seen.add(href);
              found.push(href);
            }
          }
        }
      }
    }
  }

  return found;
}

/**
 * The business itself.
 *
 * TravelAgency RATHER THAN Organization, and this is the one judgement call in
 * the file. TravelAgency is a real schema.org type and it is a subtype of
 * LocalBusiness, which is more specific and therefore more useful to an engine
 * deciding whether to name this business in an answer about booking a holiday.
 * Every site on this platform is a travel business, so the specific type is
 * always true here in a way it would not be on a general purpose CMS.
 */
export function organisationLd(
  settings: SiteSettings,
  origin: string,
  siteName: string,
  sameAs: readonly string[] = [],
): JsonLd | null {
  const name = clean(settings.companyName) ?? clean(siteName);
  if (!name) return null;

  return compact({
    '@context': 'https://schema.org',
    '@type': 'TravelAgency',
    // A stable identifier the other nodes point at, so an engine reading three
    // separate blocks knows they are about one business rather than three.
    '@id': `${origin}/#organisation`,
    name,
    description: clean(settings.companyAbout),
    url: origin,
    logo: clean(settings.socialImageUrl),
    image: clean(settings.socialImageUrl),
    // Dropped by compact() when the client has not linked any profiles yet,
    // rather than emitted as an empty array, which asserts "this business has
    // no presence anywhere" instead of saying nothing.
    sameAs: sameAs.length > 0 ? [...sameAs] : undefined,
  });
}

/** The site, so a search box and the site's name are attributable to it. */
export function websiteLd(origin: string, siteName: string): JsonLd | null {
  const name = clean(siteName);
  if (!name) return null;

  return compact({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${origin}/#website`,
    name,
    url: origin,
    publisher: { '@id': `${origin}/#organisation` },
  });
}

/**
 * Where this page sits, for the trail an engine shows under a result.
 *
 * BUILT FROM THE URL, not from a field. The path already describes the
 * hierarchy, because a child page's address is its parent's plus its own slug,
 * so anything else would be a second source of truth that could disagree.
 *
 * Null for the home page: a breadcrumb with one entry is not a trail.
 */
export function breadcrumbLd(
  origin: string,
  path: string,
  pageTitle: string,
): JsonLd | null {
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  const items = [{ name: 'Home', url: origin }];
  let walked = '';

  for (const [index, segment] of segments.entries()) {
    walked += `/${segment}`;
    items.push({
      // The last one is this page, and we know its real title. The ones in
      // between are addresses we have not loaded, so the slug is turned back
      // into words. Better than nothing and honest about being derived.
      name: index === segments.length - 1 ? pageTitle : titleFromSlug(segment),
      url: `${origin}${walked}`,
    });
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

/** greek-island-hopping becomes Greek island hopping. */
function titleFromSlug(slug: string): string {
  const words = slug.replace(/-+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : slug;
}

/**
 * Strip tags and collapse whitespace, for a value that must be plain text.
 *
 * JSON-LD is not HTML and an engine reading `<p>Yes. Every package.</p>` as an
 * answer will either show the markup or discard the node. Deliberately simple:
 * the input has already been through the sanitiser on save and again on render,
 * so this is about FORMAT rather than safety.
 */
export function plainText(html: unknown, max = 1000): string {
  if (typeof html !== 'string') return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * Questions and answers, taken from the accordion blocks already on the page.
 *
 * THE ONE THAT PAYS FOR ITSELF FASTEST. "Is my money protected?" and "what is
 * included?" are exactly the questions somebody asks an assistant, and an
 * FAQPage node is a direct answer in the format the engine wants. The client
 * writes it once, in an accordion, because it is also what a visitor should
 * read; nobody has to fill in an SEO form.
 *
 * ONLY THE FIRST ACCORDION ON THE PAGE. Two FAQPage nodes on one page is
 * invalid, and merging every accordion would sweep in an itinerary, which is a
 * day by day list rather than a set of questions, and would tell an engine that
 * "Day three" is a question somebody asked.
 */
export function faqLd(page: Page): JsonLd | null {
  const accordion = findFirstAccordion(page.sections);
  if (!accordion) return null;

  const items = (Array.isArray(accordion.items) ? accordion.items : [])
    .map((raw) => {
      const item = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
      return { question: plainText(item.title, 300), answer: plainText(item.body, 1000) };
    })
    .filter((item) => item.question !== '' && item.answer !== '');

  // One question is not a FAQ, and an engine is entitled to treat a single-entry
  // FAQPage as somebody gaming the format.
  if (items.length < 2) return null;

  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };
}

function findFirstAccordion(sections: readonly Section[]): Record<string, unknown> | null {
  for (const section of sections) {
    for (const row of section.rows) {
      for (const column of row.columns) {
        for (const block of column.blocks) {
          if (block.type === 'accordion') return block.props;
        }
      }
    }
  }
  return null;
}

/**
 * A blog entry, as an Article.
 *
 * The date is what this is really for. An assistant asked for something current
 * has to be able to tell a piece written last week from one written in 2019, and
 * datePublished is the only machine-readable way to say so.
 */
export function articleLd(
  origin: string,
  url: string,
  entry: { title: string; summary?: string | null; image?: string | null },
  publishedAt: Date | null,
): JsonLd | null {
  const headline = clean(entry.title);
  if (!headline) return null;

  return compact({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline,
    description: clean(entry.summary),
    image: clean(entry.image),
    datePublished: publishedAt ? publishedAt.toISOString() : undefined,
    mainEntityOfPage: url,
    publisher: { '@id': `${origin}/#organisation` },
  });
}

/**
 * Every node for one page, ready to be written into a script tag.
 *
 * ONE ARRAY, ONE SCRIPT TAG. Several separate blocks is legal and is what most
 * plugins emit; a single array of nodes that reference each other by @id is what
 * lets an engine see that the Article, the FAQ and the business are one story
 * rather than three unrelated claims found on the same page.
 */
export function pageJsonLd(input: {
  origin: string;
  url: string;
  path: string;
  siteName: string;
  settings: SiteSettings;
  pageTitle: string;
  page?: Page | null;
  entry?: { title: string; summary?: string | null; image?: string | null } | null;
  publishedAt?: Date | null;
  /** The client's own profile addresses, from their Social links blocks. */
  sameAs?: readonly string[];
}): JsonLd[] {
  const { origin, url, path, siteName, settings, pageTitle } = input;

  const nodes: Array<JsonLd | null> = [
    organisationLd(settings, origin, siteName, input.sameAs ?? []),
    websiteLd(origin, siteName),
    breadcrumbLd(origin, path, pageTitle),
    input.page ? faqLd(input.page) : null,
    input.entry ? articleLd(origin, url, input.entry, input.publishedAt ?? null) : null,
  ];

  return nodes.filter((node): node is JsonLd => node !== null);
}

/**
 * The JSON to put in the script tag, with the one character that can break out
 * of it dealt with.
 *
 * `</script>` inside a JSON string ends the tag early in an HTML parser, whatever
 * JSON thinks, and everything after it becomes markup. Escaping the `<` as <
 * is valid JSON, parses back to the same string, and cannot close the tag. This
 * is the reason this function exists rather than a bare JSON.stringify at the
 * call site.
 */
export function jsonLdScript(nodes: readonly JsonLd[]): string {
  return JSON.stringify(nodes.length === 1 ? nodes[0] : nodes)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}
