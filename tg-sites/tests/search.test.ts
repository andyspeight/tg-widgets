/**
 * The site's own search, the pure half (Andy, 19 Aug 2026).
 *
 * Ranking and snippets over plain SearchDocs, so the rules that decide which
 * page wins and what a result reads like are pinned here. The DB read that
 * fills the docs and the page that renders them are checked elsewhere; this is
 * strings in, ranked hits out, which is exactly what must not drift.
 */

import { describe, expect, it } from 'vitest';

import { searchDocs, type SearchDoc } from '../lib/content/search';

const DOCS: SearchDoc[] = [
  { path: '', title: 'Home', text: 'Welcome to our travel company. We plan holidays around the world.' },
  { path: 'greece', title: 'Holidays in Greece', text: 'Greece is a land of islands and old stones. Crete, Rhodes and more.' },
  { path: 'italy', title: 'Holidays in Italy', text: 'Italy has Rome, Florence and the coast. A mention of Greece in passing.' },
  { path: 'about', title: 'About us', text: 'A small team who love to travel. Nothing about any one country here.' },
];

function titles(query: string): string[] {
  return searchDocs(DOCS, query).map((hit) => hit.title);
}

describe('searchDocs', () => {
  it('returns nothing for an empty or whitespace query', () => {
    expect(searchDocs(DOCS, '')).toEqual([]);
    expect(searchDocs(DOCS, '   ')).toEqual([]);
  });

  it('finds a page by a word in its title', () => {
    expect(titles('greece')).toContain('Holidays in Greece');
  });

  it('ranks a title match above a mere body mention', () => {
    // Both Greece (title) and Italy (body "Greece in passing") match; the title
    // one must come first.
    const order = titles('greece');
    expect(order[0]).toBe('Holidays in Greece');
    expect(order).toContain('Holidays in Italy');
    expect(order.indexOf('Holidays in Greece')).toBeLessThan(order.indexOf('Holidays in Italy'));
  });

  it('gives an exact phrase in the title the strongest pull', () => {
    expect(titles('holidays in italy')[0]).toBe('Holidays in Italy');
  });

  it('marks the matched word in the snippet and leaves the rest plain', () => {
    const hit = searchDocs(DOCS, 'islands').find((h) => h.path === 'greece');
    expect(hit).toBeTruthy();
    const marked = hit!.snippet.filter((s) => s.hit).map((s) => s.text.toLowerCase());
    expect(marked).toContain('islands');
    // The non-hit runs carry the words around it.
    expect(hit!.snippet.some((s) => !s.hit && s.text.length > 0)).toBe(true);
  });

  it('cuts the snippet around the first match with an ellipsis when trimmed', () => {
    // A long page, the match buried in the middle, so the window is trimmed at
    // both ends and an ellipsis marks each cut. (A short page shows whole and
    // needs none, which is why this uses its own long doc.)
    const long = `${'word '.repeat(60)}islands here ${'word '.repeat(60)}`;
    const docs: SearchDoc[] = [{ path: 'x', title: 'X', text: long }];
    const snippet = searchDocs(docs, 'islands')[0].snippet.map((s) => s.text).join('');
    expect(snippet).toContain('…');
    expect(snippet).toContain('islands');
    expect(snippet.length).toBeLessThan(long.length);
  });

  it('is case insensitive', () => {
    expect(titles('GREECE')).toContain('Holidays in Greece');
  });

  it('does not throw on regex metacharacters in the query', () => {
    expect(() => searchDocs(DOCS, 'a(b [c')).not.toThrow();
    expect(searchDocs(DOCS, 'a(b [c')).toEqual([]);
  });

  it('caps a single word so repetition cannot beat a title match', () => {
    const docs: SearchDoc[] = [
      { path: 'a', title: 'Greece', text: 'A calm page.' },
      { path: 'b', title: 'Spam', text: 'greece '.repeat(50) },
    ];
    // The title match (10) plus one occurrence beats fifty capped at five.
    expect(searchDocs(docs, 'greece')[0].title).toBe('Greece');
  });

  it('honours the max cap', () => {
    const many: SearchDoc[] = Array.from({ length: 30 }, (_, i) => ({
      path: `p${i}`,
      title: `Greece ${i}`,
      text: 'greece',
    }));
    expect(searchDocs(many, 'greece', 10)).toHaveLength(10);
  });
});
