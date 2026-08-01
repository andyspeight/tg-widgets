/**
 * Being found: robots.txt, sitemap.xml and structured data.
 *
 * WHAT WAS ACTUALLY BROKEN, because this started as a defect rather than a
 * feature. On 1 Aug 2026 a site on this platform had NO robots.txt and NO
 * sitemap at all. /robots.txt is not in isPlatformPath, so middleware rewrote it
 * into the page renderer, which went looking for a page whose slug was
 * "robots.txt" and 404d. The only robots.txt in the product was app/robots.ts,
 * which says `disallow: /` for everything. And a grep for application/ld+json
 * returned nothing anywhere.
 *
 * SO THE LOAD-BEARING TESTS HERE ARE THE ONES ABOUT NOT LYING TO A MACHINE.
 * Everything in this file is read by something that cannot tell when it is being
 * told nonsense, and the failure mode is silent in every case:
 *
 *   - a robots.txt that blocks the citation engines costs a client business and
 *     nothing anywhere reports it;
 *   - a sitemap listing URLs that 404, or omitting the pages that exist, is
 *     worse than no sitemap;
 *   - structured data that disagrees with the visible page is treated as spam by
 *     Google and as untrustworthy by an assistant, so it is worse than none.
 *
 * The route handlers are not tested here: they are three lines of plumbing over
 * these functions and a database call, and the browser harness has no database.
 */

import { describe, expect, it } from 'vitest';

import { parsePage } from '../lib/content/schema';
import { DEFAULT_SETTINGS } from '../lib/settings/schema';
import { AI_AGENTS, platformRobotsTxt, robotsTxt } from '../lib/seo/robots';
import { absoluteUrl, MAX_SITEMAP_URLS, sitemapXml } from '../lib/seo/sitemap';
import {
  articleLd,
  breadcrumbLd,
  faqLd,
  jsonLdScript,
  organisationLd,
  pageJsonLd,
  plainText,
  websiteLd,
} from '../lib/seo/jsonld';

const ORIGIN = 'https://www.someagency.co.uk';

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

describe("a client site's robots.txt", () => {
  const txt = robotsTxt(ORIGIN);

  /*
   * THE ONE THAT MATTERS MOST, and the one somebody breaks by pasting in a
   * block-all-AI robots.txt they read about. These are the SEARCH-TIME bots:
   * they are what produces a citation in an AI answer. Blocking them is what
   * actually costs a travel agency business.
   */
  it('lets the engines that produce citations in', () => {
    for (const agent of ['OAI-SearchBot', 'PerplexityBot', 'ChatGPT-User', 'Claude-SearchBot']) {
      expect(txt, agent).toContain(`User-agent: ${agent}`);
    }
    expect(txt).not.toMatch(/Disallow: \/\s*$/m);
  });

  it('lets the training crawlers in too, which is the decision of 1 Aug 2026', () => {
    for (const agent of ['GPTBot', 'ClaudeBot', 'Google-Extended', 'CCBot']) {
      expect(txt, agent).toContain(`User-agent: ${agent}`);
    }
  });

  it('disallows nothing but the two paths that are not content', () => {
    const disallowed = [...txt.matchAll(/^Disallow: (.+)$/gm)].map((match) => match[1].trim());
    expect(disallowed.sort()).toEqual(['/api/', '/site/']);
  });

  /*
   * An absolute Sitemap line, which the spec requires and several crawlers
   * enforce. A relative one is silently ignored, which is the worst outcome:
   * the file looks right and the sitemap is never fetched.
   */
  it('points at the sitemap with an absolute address', () => {
    expect(txt).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  });

  it('says what each named agent is for, so nobody blocks the wrong half', () => {
    for (const agent of AI_AGENTS) {
      expect(agent.purpose.trim().length, agent.name).toBeGreaterThan(0);
    }
    // Both kinds are represented, or the list has drifted into one camp.
    expect(AI_AGENTS.some((a) => /search|fetch/i.test(a.purpose))).toBe(true);
    expect(AI_AGENTS.some((a) => /training/i.test(a.purpose))).toBe(true);
  });

  it('names no agent twice', () => {
    const names = AI_AGENTS.map((agent) => agent.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("the platform's own robots.txt, which is the opposite answer", () => {
  it('blocks everything, because it serves the dashboard and duplicated content', () => {
    const txt = platformRobotsTxt();
    expect(txt).toContain('User-agent: *');
    expect(txt).toMatch(/^Disallow: \/$/m);
  });

  /*
   * The two files must not converge. A copy-and-paste that made the client one
   * look like this would take every client site out of every index, and nothing
   * would report it.
   */
  it('is not the same file a client gets', () => {
    expect(platformRobotsTxt()).not.toBe(robotsTxt(ORIGIN));
    expect(robotsTxt(ORIGIN)).not.toMatch(/^Disallow: \/$/m);
  });
});

// ---------------------------------------------------------------------------
// sitemap.xml
// ---------------------------------------------------------------------------

describe('turning a path into an address', () => {
  it('handles the home page, which is the empty path', () => {
    expect(absoluteUrl(ORIGIN, '')).toBe(ORIGIN);
  });

  it('handles a nested page', () => {
    expect(absoluteUrl(ORIGIN, 'destinations/greece')).toBe(`${ORIGIN}/destinations/greece`);
  });

  it('tolerates a leading slash, since callers disagree about that', () => {
    expect(absoluteUrl(ORIGIN, '/about')).toBe(`${ORIGIN}/about`);
  });

  /*
   * THE ONE WORTH HAVING. "//evil.test/x" is protocol-relative, so new URL
   * resolves it to a DIFFERENT ORIGIN, and a sitemap is a list of pages you are
   * asserting are yours. Submitting somebody else's URL is the shape of a real
   * abuse, not a typo.
   */
  it('refuses a path that would escape to another site', () => {
    expect(absoluteUrl(ORIGIN, '//evil.test/x')).toBeNull();
    expect(absoluteUrl(ORIGIN, 'https://evil.test/x')).toBeNull();
  });

  /*
   * A CONTROL CHARACTER, NOT A SPACE, and the distinction cost a round. My first
   * version expected a space to be refused and it is not: new URL percent-encodes
   * it, which is what a browser does and is correct. A control character is the
   * one with no legitimate reading, never present in a slug, and the classic way
   * a URL gets smuggled past a naive check.
   *
   * Written as an ESCAPE SEQUENCE rather than a literal byte, which is the rule
   * safeUrl in lib/content/sanitise.ts already states and which I broke while
   * writing this file: a raw control byte survives Node's parser and gets
   * mangled by a bundler, leaving an invalid character class at runtime. Both
   * this file and lib/seo/sitemap.ts had to be repaired byte by byte.
   */
  it('refuses a path it cannot parse rather than emitting it broken', () => {
    expect(absoluteUrl(ORIGIN, 'a\u0000b')).toBeNull();
    expect(absoluteUrl(ORIGIN, 'a\u000Ab')).toBeNull();
    expect(absoluteUrl('not a url', 'about')).toBeNull();
    // A space is encoded rather than refused, which is the browser's own answer.
    expect(absoluteUrl(ORIGIN, 'a b')).toBe(`${ORIGIN}/a%20b`);
  });
});

describe('the sitemap', () => {
  const xml = sitemapXml(ORIGIN, [
    { path: '', updatedAt: '2026-07-30T09:00:00.000Z' },
    { path: 'about', updatedAt: null },
    { path: 'blog/crete', updatedAt: '2026-08-01T10:00:00.000Z' },
  ]);

  it('is a well formed urlset', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
  });

  it('lists every address given to it', () => {
    expect(xml).toContain(`<loc>${ORIGIN}</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/about</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/blog/crete</loc>`);
  });

  it('gives a lastmod only where one is actually known', () => {
    expect(xml).toContain('<lastmod>2026-07-30T09:00:00.000Z</lastmod>');
    // Three URLs, two dates. The third must not get today's date invented for
    // it: a lastmod is only a useful hint while it is honest.
    expect([...xml.matchAll(/<lastmod>/g)]).toHaveLength(2);
  });

  /*
   * A page and a collection entry can in principle claim one address, and for a
   * visitor the page always wins. A sitemap listing it twice would be telling a
   * crawler something the site does not do.
   */
  it('lists an address once even when two things claim it', () => {
    const duped = sitemapXml(ORIGIN, [
      { path: 'blog/crete', updatedAt: null },
      { path: '/blog/crete', updatedAt: null },
    ]);
    expect([...duped.matchAll(/<loc>/g)]).toHaveLength(1);
  });

  it('drops an address it cannot make absolute rather than emitting it broken', () => {
    const bad = sitemapXml(ORIGIN, [{ path: '//evil.test/x', updatedAt: null }]);
    expect(bad).not.toContain('evil.test');
    expect([...bad.matchAll(/<loc>/g)]).toHaveLength(0);
  });

  it('escapes an ampersand, which is what makes XML invalid', () => {
    const amp = sitemapXml(ORIGIN, [{ path: 'a?b=1&c=2', updatedAt: null }]);
    expect(amp).toContain('&amp;');
    expect(amp).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
  });

  /*
   * NO SILENT TRUNCATION. Past the limit the file says how many it left out, so
   * a capped sitemap does not read as "that is the whole site".
   */
  it('says out loud when it has had to leave URLs out', () => {
    const many = Array.from({ length: MAX_SITEMAP_URLS + 3 }, (_, i) => ({
      path: `p${i}`,
      updatedAt: null,
    }));
    const capped = sitemapXml(ORIGIN, many);

    expect([...capped.matchAll(/<loc>/g)]).toHaveLength(MAX_SITEMAP_URLS);
    expect(capped).toContain('3 further URLs omitted');
  });
});

// ---------------------------------------------------------------------------
// Structured data
// ---------------------------------------------------------------------------

const settings = { ...DEFAULT_SETTINGS, companyName: 'Someshop Travel', companyAbout: 'A high street agency in Leeds.' };

describe('the business, as an entity', () => {
  it('is a TravelAgency, which is more use to an engine than an Organization', () => {
    const node = organisationLd(settings, ORIGIN, 'Someshop');
    expect(node?.['@type']).toBe('TravelAgency');
    expect(node?.name).toBe('Someshop Travel');
    expect(node?.description).toBe('A high street agency in Leeds.');
  });

  /*
   * A STABLE @id, because the other nodes point at it. Without one an engine
   * reading three blocks has three unrelated claims rather than one story.
   */
  it('has an id the other nodes can point at', () => {
    expect(organisationLd(settings, ORIGIN, 'Someshop')?.['@id']).toBe(`${ORIGIN}/#organisation`);
    expect(websiteLd(ORIGIN, 'Someshop')?.publisher).toEqual({ '@id': `${ORIGIN}/#organisation` });
  });

  /*
   * ONLY WHAT IS TRUE. A client who has not filled in the profile gets no
   * Organization node rather than one naming their hostname, because structured
   * data that disagrees with the page is treated as spam.
   */
  it('is left out entirely when there is no name to give', () => {
    expect(organisationLd(DEFAULT_SETTINGS, ORIGIN, '')).toBeNull();
  });

  it('drops the fields that are empty rather than emitting them null', () => {
    const node = organisationLd({ ...DEFAULT_SETTINGS, companyName: 'X' }, ORIGIN, '');
    expect(node).not.toBeNull();
    expect('description' in node!).toBe(false);
    expect('logo' in node!).toBe(false);
  });
});

describe('the breadcrumb trail', () => {
  it('is left out on the home page, where a trail of one is not a trail', () => {
    expect(breadcrumbLd(ORIGIN, '', 'Home')).toBeNull();
  });

  it('walks the address, because the address IS the hierarchy', () => {
    const node = breadcrumbLd(ORIGIN, 'destinations/greek-islands', 'Greek islands');
    const items = node?.itemListElement as Array<Record<string, unknown>>;

    expect(items.map((item) => item.item)).toEqual([
      ORIGIN,
      `${ORIGIN}/destinations`,
      `${ORIGIN}/destinations/greek-islands`,
    ]);
    expect(items.map((item) => item.position)).toEqual([1, 2, 3]);
    // The last one is this page, so its real title is known. The one in
    // between is an address we have not loaded, so the slug becomes words.
    expect(items[1].name).toBe('Destinations');
    expect(items[2].name).toBe('Greek islands');
  });
});

describe('the questions on the page', () => {
  function pageWithAccordion(items: Array<{ title: string; body: string }>) {
    const parsed = parsePage({
      version: 1,
      id: 'pg',
      title: 'FAQ',
      slug: 'faq',
      seo: { noindex: false },
      sections: [
        {
          id: 's1',
          rows: [
            {
              id: 'r1',
              columns: [
                { id: 'c1', width: 100, blocks: [{ id: 'b1', type: 'accordion', props: { items } }] },
              ],
            },
          ],
        },
      ],
    });
    if (!parsed.ok) throw new Error(parsed.errors.join('; '));
    return parsed.page;
  }

  it('becomes a FAQPage, which is exactly what somebody asks an assistant', () => {
    const node = faqLd(pageWithAccordion([
      { title: 'Is my money protected?', body: 'Yes. Every package we sell is ATOL protected.' },
      { title: "What's included?", body: 'Flights, transfers and seven nights.' },
    ]));

    expect(node?.['@type']).toBe('FAQPage');
    const questions = node?.mainEntity as Array<Record<string, unknown>>;
    expect(questions).toHaveLength(2);
    expect(questions[0].name).toBe('Is my money protected?');
    expect((questions[0].acceptedAnswer as Record<string, unknown>).text)
      .toBe('Yes. Every package we sell is ATOL protected.');
  });

  /*
   * One question is not a FAQ, and an engine is entitled to read a single-entry
   * FAQPage as somebody gaming the format.
   */
  it('is left out when there is only one question', () => {
    expect(faqLd(pageWithAccordion([{ title: 'One', body: 'Only' }]))).toBeNull();
  });

  it('is left out when the entries have no answers', () => {
    expect(faqLd(pageWithAccordion([
      { title: 'A question', body: '' },
      { title: 'Another', body: '' },
    ]))).toBeNull();
  });
});

describe('turning stored markup into plain text', () => {
  /*
   * JSON-LD is not HTML. An engine reading <p>Yes.</p> as an answer either shows
   * the markup or discards the node, and both are worse than the sentence.
   */
  it('strips the tags and the entities', () => {
    expect(plainText('<p>Yes. <strong>Every</strong> package &amp; transfer.</p>'))
      .toBe('Yes. Every package & transfer.');
  });

  it('collapses the whitespace a block of markup leaves behind', () => {
    expect(plainText('<p>One</p>\n\n<p>Two</p>')).toBe('One Two');
  });

  it('answers with nothing for anything that is not a string', () => {
    expect(plainText(null)).toBe('');
    expect(plainText(42)).toBe('');
  });
});

describe('a blog entry', () => {
  it('carries the date, which is how an assistant tells current from stale', () => {
    const node = articleLd(
      ORIGIN,
      `${ORIGIN}/blog/crete`,
      { title: 'Ten things about Crete', summary: 'A short guide.', image: null },
      new Date('2026-07-15T08:00:00.000Z'),
    );

    expect(node?.['@type']).toBe('Article');
    expect(node?.headline).toBe('Ten things about Crete');
    expect(node?.datePublished).toBe('2026-07-15T08:00:00.000Z');
    expect(node?.publisher).toEqual({ '@id': `${ORIGIN}/#organisation` });
  });

  it('is left out with no headline, rather than titled with the URL', () => {
    expect(articleLd(ORIGIN, ORIGIN, { title: '' }, null)).toBeNull();
  });
});

describe('everything for one page', () => {
  it('is one array of nodes that reference each other', () => {
    const nodes = pageJsonLd({
      origin: ORIGIN,
      url: `${ORIGIN}/about`,
      path: 'about',
      siteName: 'Someshop Travel',
      settings,
      pageTitle: 'About us',
      page: null,
      entry: null,
    });

    const types = nodes.map((node) => node['@type']);
    expect(types).toContain('TravelAgency');
    expect(types).toContain('WebSite');
    expect(types).toContain('BreadcrumbList');
  });

  it('gives a site with nothing filled in no structured data at all', () => {
    const nodes = pageJsonLd({
      origin: ORIGIN,
      url: ORIGIN,
      path: '',
      siteName: '',
      settings: DEFAULT_SETTINGS,
      pageTitle: '',
      page: null,
      entry: null,
    });

    expect(nodes).toEqual([]);
  });
});

describe('putting it in the page', () => {
  /*
   * THE ONE SECURITY CHECK IN THIS FILE. `</script>` inside a JSON string ends
   * the tag early in an HTML parser whatever JSON thinks, and everything after
   * it becomes markup. The content here has been sanitised twice already, so
   * this is the last gate rather than the only one, but it is the gate that
   * matters because a script tag is the one place escaping works differently.
   */
  it('cannot be broken out of with a closing script tag', () => {
    const escaped = jsonLdScript([{ '@type': 'Thing', name: '</script><img onerror=alert(1)>' }]);

    expect(escaped).not.toContain('</script>');
    expect(escaped).not.toContain('<');
    expect(escaped).not.toContain('>');
    // Still valid JSON that parses back to the original string, so escaping has
    // not corrupted the data to achieve it.
    expect(JSON.parse(escaped).name).toBe('</script><img onerror=alert(1)>');
  });

  it('emits one object rather than an array of one, which is what parsers prefer', () => {
    expect(JSON.parse(jsonLdScript([{ '@type': 'Thing' }]))).toEqual({ '@type': 'Thing' });
    expect(Array.isArray(JSON.parse(jsonLdScript([{ '@type': 'A' }, { '@type': 'B' }])))).toBe(true);
  });
});
