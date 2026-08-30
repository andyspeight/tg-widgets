/**
 * Server-side personalisation, the pure half: the audience rule a section
 * carries, made safe, and the decision to draw it or not for a given visitor.
 *
 * THE ONE THAT MATTERS: the rule becomes part of a published page rendered per
 * request, and the decision runs on every section of every request, so it must
 * be total (nonsense in, a safe answer out, never a throw) and it must default
 * to VISIBLE, so a bad or missing rule never blanks a section that should show.
 */

import { describe, expect, it } from 'vitest';

import {
  classifyDevice,
  classifySource,
  DEFAULT_VISITOR_SIGNALS,
  normaliseCountry,
  parseAudience,
  sectionVisibleFor,
  type VisitorSignals,
} from '../lib/content/audience';
import { parsePage } from '../lib/content/schema';
import { sanitisePage } from '../lib/content/sanitise-page';

const signals = (over: Partial<VisitorSignals> = {}): VisitorSignals => ({
  ...DEFAULT_VISITOR_SIGNALS,
  ...over,
});

describe('parseAudience keeps only a real, safe rule', () => {
  it('is nothing when there is no facet, or the input is nonsense', () => {
    expect(parseAudience(undefined)).toBeUndefined();
    expect(parseAudience(null)).toBeUndefined();
    expect(parseAudience('gb')).toBeUndefined();
    expect(parseAudience([])).toBeUndefined();
    expect(parseAudience({})).toBeUndefined();
    // A bare mode is not a rule.
    expect(parseAudience({ mode: 'hide' })).toBeUndefined();
    // Facets that all drop away leave nothing. Country codes are validated by
    // SHAPE (two letters), not against the ISO list, so the junk here is
    // wrong-length or non-letter, which is what actually drops.
    expect(parseAudience({ countries: ['z', 5, 'usa'], source: ['nope'], device: 'watch' })).toBeUndefined();
  });

  it('uppercases and validates country codes, drops junk, dedupes and caps', () => {
    const a = parseAudience({ countries: ['gb', 'IE', 'gb', 'zzz', 7, 'us'] });
    expect(a?.countries).toEqual(['GB', 'IE', 'US']);
    const many = parseAudience({ countries: Array.from({ length: 200 }, (_, i) => `A${i}`) });
    // All invalid (three chars), so nothing survives.
    expect(many).toBeUndefined();
    const capped = parseAudience({ countries: Array.from({ length: 80 }, () => 'GB') });
    // Deduped to one.
    expect(capped?.countries).toEqual(['GB']);
  });

  it('whitelists source, device and visitor, and defaults mode to show', () => {
    const a = parseAudience({ source: ['search', 'x', 'social', 'search'], device: 'mobile', visitor: 'returning' });
    expect(a?.source).toEqual(['search', 'social']);
    expect(a?.device).toBe('mobile');
    expect(a?.visitor).toBe('returning');
    expect(a?.mode).toBe('show');
    expect(parseAudience({ device: 'mobile', mode: 'hide' })?.mode).toBe('hide');
    expect(parseAudience({ device: 'mobile', mode: 'sideways' })?.mode).toBe('show');
  });
});

describe('sectionVisibleFor decides who sees a section', () => {
  it('shows a section with no audience to everyone', () => {
    expect(sectionVisibleFor(undefined, signals())).toBe(true);
  });

  it('shows a targeted section only to a match, hides the rest', () => {
    const uk = parseAudience({ countries: ['GB'] });
    expect(sectionVisibleFor(uk, signals({ country: 'GB' }))).toBe(true);
    expect(sectionVisibleFor(uk, signals({ country: 'US' }))).toBe(false);
    // Geo unknown fails a country facet, so a "show to GB" hides.
    expect(sectionVisibleFor(uk, signals({ country: null }))).toBe(false);
  });

  it('hides a section from a match under mode hide, shows it to the rest', () => {
    const notReturning = parseAudience({ visitor: 'returning', mode: 'hide' });
    expect(sectionVisibleFor(notReturning, signals({ visitor: 'returning' }))).toBe(false);
    expect(sectionVisibleFor(notReturning, signals({ visitor: 'new' }))).toBe(true);
  });

  it('ANDs the facets: every set one must match', () => {
    const a = parseAudience({ countries: ['GB'], device: 'mobile' });
    expect(sectionVisibleFor(a, signals({ country: 'GB', device: 'mobile' }))).toBe(true);
    expect(sectionVisibleFor(a, signals({ country: 'GB', device: 'desktop' }))).toBe(false);
    expect(sectionVisibleFor(a, signals({ country: 'US', device: 'mobile' }))).toBe(false);
  });

  it('a targeted section and a default that hides from it give everyone exactly one', () => {
    const targeted = parseAudience({ countries: ['GB'] }); // show to GB
    const fallback = parseAudience({ countries: ['GB'], mode: 'hide' }); // show to everyone but GB
    for (const country of ['GB', 'US', null] as const) {
      const seen = [targeted, fallback].filter((a) => sectionVisibleFor(a, signals({ country })));
      expect(seen).toHaveLength(1);
    }
  });
});

describe('classifiers sort a request into buckets', () => {
  it('reads a country header, or null', () => {
    expect(normaliseCountry('gb')).toBe('GB');
    expect(normaliseCountry(' Ie ')).toBe('IE');
    expect(normaliseCountry('GBR')).toBeNull();
    expect(normaliseCountry(null)).toBeNull();
    expect(normaliseCountry('')).toBeNull();
  });

  it('sorts a referer into search, social or direct', () => {
    expect(classifySource('https://www.google.com/search?q=x')).toBe('search');
    expect(classifySource('https://news.google.co.uk/')).toBe('search');
    expect(classifySource('https://l.facebook.com/')).toBe('social');
    expect(classifySource('https://t.co/abc')).toBe('social');
    expect(classifySource('https://example.org/blog')).toBe('direct');
    expect(classifySource(null)).toBe('direct');
    expect(classifySource('not a url')).toBe('direct');
    // A click from the site itself is not an arrival from anywhere.
    expect(classifySource('https://acme.travel/pricing', 'acme.travel')).toBe('direct');
  });

  it('sorts a user-agent into mobile or desktop, tablet as desktop', () => {
    expect(classifyDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148')).toBe('mobile');
    expect(classifyDevice('Mozilla/5.0 (Linux; Android 14) Mobile Safari')).toBe('mobile');
    expect(classifyDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari')).toBe('desktop');
    // An iPad reports as a Mac-like desktop and has no "Mobi", so desktop.
    expect(classifyDevice('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari')).toBe('desktop');
    expect(classifyDevice(null)).toBe('desktop');
  });
});

describe('a section audience survives the save path', () => {
  // A raw page as a real save stores it: plain JSON, one section carrying the
  // rule. parsePage is total, so a minimal section is enough.
  const rawPage = (audience: unknown) => ({
    version: 1,
    id: 'p1',
    title: 'Home',
    slug: '',
    sections: [{ id: 's1', rows: [], audience }],
  });

  it('round-trips a real rule through parsePage and sanitisePage', () => {
    const parsed = parsePage(rawPage({ mode: 'hide', countries: ['gb', 'ie'], device: 'mobile' }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const section = parsed.page.sections[0];
    expect(section.audience).toEqual({ mode: 'hide', countries: ['GB', 'IE'], device: 'mobile' });
    // And through the sanitiser, which cleans sections field by field.
    const clean = sanitisePage(parsed.page).sections[0];
    expect(clean.audience).toEqual({ mode: 'hide', countries: ['GB', 'IE'], device: 'mobile' });
  });

  it('drops an audience with no real facet rather than storing an empty rule', () => {
    const parsed = parsePage(rawPage({ mode: 'hide' }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.page.sections[0].audience).toBeUndefined();
  });
});
