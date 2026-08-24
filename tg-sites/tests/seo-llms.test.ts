/**
 * llms.txt, the third file a machine asks a site for.
 *
 * robots.txt says what a crawler MAY read and sitemap.xml says what EXISTS.
 * Neither says what any of it is ABOUT. This does, and because a person may well
 * read it too when they ask what we are telling the AI engines, the shape of the
 * output is asserted rather than just its parts.
 */

import { describe, expect, it } from 'vitest';

import { llmsTxt, type LlmsEntry, type LlmsPage } from '../lib/seo/llms';
import { DEFAULT_SETTINGS } from '../lib/settings/schema';

const SETTINGS = {
  ...DEFAULT_SETTINGS,
  companyName: 'Coastwise Voyages',
  companyAbout: 'Small-ship voyages around the coasts of Britain and Ireland.',
  addressLocality: 'Oban',
  addressRegion: 'Argyll',
  addressCountry: 'Scotland',
  telephone: '01631 555 0134',
};

const PAGES: LlmsPage[] = [
  { path: '', title: 'Coastwise Voyages', description: 'Small-ship voyages, ten guests at a time.', noindex: false },
  { path: 'walking-ashore', title: 'Walking ashore', description: 'Guided walks on every voyage.', noindex: false },
  { path: 'thanks', title: 'Thank you', description: '', noindex: true },
];

const ENTRIES: LlmsEntry[] = [
  { collection: 'blog', slug: 'a-week-in-rhodes', title: 'A week in Rhodes' },
  { collection: 'tours', slug: 'western-isles', title: 'The Western Isles' },
];

describe('the file names the company and says what it does', () => {
  const out = llmsTxt('https://coastwise.test', SETTINGS, PAGES, ENTRIES);

  it('opens with the company as the heading and the summary as a quote', () => {
    expect(out.startsWith('# Coastwise Voyages\n')).toBe(true);
    expect(out).toContain('> Small-ship voyages around the coasts of Britain and Ireland.');
  });

  it('states where they are and how to reach them', () => {
    // The two questions behind most local searches, stated rather than left to
    // be inferred from a contact page an assistant may not have read.
    expect(out).toContain('Based in Oban, Argyll, Scotland.');
    expect(out).toContain('Telephone: 01631 555 0134');
  });

  it('lists each page as a link with its own description', () => {
    expect(out).toContain('- [Coastwise Voyages](https://coastwise.test): Small-ship voyages, ten guests at a time.');
    expect(out).toContain('- [Walking ashore](https://coastwise.test/walking-ashore): Guided walks on every voyage.');
  });

  it('groups entries under their own collection', () => {
    // A flat list of forty URLs tells an assistant nothing about which is a tour
    // and which is a blog post.
    expect(out).toContain('## Blog');
    expect(out).toContain('- [A week in Rhodes](https://coastwise.test/blog/a-week-in-rhodes)');
    expect(out).toContain('## Tours');
    expect(out).toContain('- [The Western Isles](https://coastwise.test/tours/western-isles)');
  });

  it('sends anything wanting every URL to the sitemap', () => {
    expect(out).toContain('- [Full sitemap](https://coastwise.test/sitemap.xml)');
  });
});

describe('a hidden page is left out, exactly as the sitemap leaves it out', () => {
  it('never lists it', () => {
    /*
     * Consistency across the three files is the point. A crawler that finds a
     * page in one and excluded from another has been told two things.
     */
    const out = llmsTxt('https://coastwise.test', SETTINGS, PAGES);
    expect(out).not.toContain('Thank you');
    expect(out).not.toContain('/thanks');
  });
});

describe('it survives a site that has filled in nothing', () => {
  it('still produces a valid file rather than a row of empty commas', () => {
    const out = llmsTxt('https://new.test', DEFAULT_SETTINGS, []);
    expect(out).toContain('# This website');
    // No address parts, so no address line at all.
    expect(out).not.toContain('Based in');
    expect(out).not.toContain('Telephone:');
    expect(out).not.toContain('## Pages');
    // And it still points at the sitemap, which is the one thing always true.
    expect(out).toContain('sitemap.xml');
  });

  it('falls back to the path when a page has no title', () => {
    const out = llmsTxt('https://new.test', DEFAULT_SETTINGS, [
      { path: 'about', title: '', description: '', noindex: false },
    ]);
    expect(out).toContain('- [about](https://new.test/about)');
  });

  it('omits the colon when a page has no description', () => {
    const out = llmsTxt('https://new.test', DEFAULT_SETTINGS, [
      { path: 'about', title: 'About us', description: '', noindex: false },
    ]);
    expect(out).toContain('- [About us](https://new.test/about)\n');
    expect(out).not.toContain('About us](https://new.test/about):');
  });
});

describe('nothing a client typed can break the list', () => {
  it('flattens a newline that would otherwise start a new list item', () => {
    const out = llmsTxt('https://x.test', DEFAULT_SETTINGS, [
      { path: 'a', title: 'Two\nlines', description: 'Also\ntwo', noindex: false },
    ]);
    expect(out).toContain('- [Two lines](https://x.test/a): Also two');
  });

  it('builds the home page URL with no trailing slash and no double slash', () => {
    const out = llmsTxt('https://x.test/', DEFAULT_SETTINGS, [
      { path: '', title: 'Home', description: '', noindex: false },
    ]);
    expect(out).toContain('- [Home](https://x.test)');
    expect(out).not.toContain('x.test//');
  });
});
