/**
 * Filling a page's search listing for a client who would not have (#239).
 *
 * The rules here are the safety of the whole feature, because it runs by itself
 * when somebody presses Publish. Two of them carry the weight: never overwrite
 * what the client wrote, and never store a failed answer just to satisfy a blank.
 */

import { describe, expect, it } from 'vitest';

import { createPage } from '../lib/content/factory';
import {
  applySeoFill,
  cleanWritten,
  hasGap,
  seoGaps,
  wasFilled,
  DESCRIPTION_MAX,
  TITLE_MAX,
} from '../lib/seo/autofill';
import type { Page } from '../lib/content/schema';

const withSeo = (seo: Partial<Page['seo']>): Page => {
  const page = createPage('Walking the Western Isles');
  return { ...page, seo: { noindex: false, ...seo } };
};

describe('what a page is missing', () => {
  it('both, on a page nobody has filled in', () => {
    expect(seoGaps(withSeo({}))).toEqual({ title: true, description: true });
  });

  it('only the blank one, when the client wrote the other', () => {
    expect(seoGaps(withSeo({ title: 'Walking holidays in the Western Isles' })))
      .toEqual({ title: false, description: true });
  });

  it('counts whitespace as blank, because a space is not a title', () => {
    expect(seoGaps(withSeo({ title: '   ', description: '\n' })))
      .toEqual({ title: true, description: true });
  });

  it('NOTHING on a page hidden from search on purpose', () => {
    /*
     * Writing a search listing for a page nobody will see is work nobody asked
     * for, and the audit stops at the same place for the same reason.
     */
    expect(seoGaps(withSeo({ noindex: true }))).toEqual({ title: false, description: false });
    expect(hasGap(seoGaps(withSeo({ noindex: true })))).toBe(false);
  });

  it('treats the page NAME as a label rather than a search title', () => {
    // "Contact" is what the client called it in their sidebar, not the line
    // somebody clicks in a result.
    expect(seoGaps(createPage('Contact')).title).toBe(true);
  });
});

describe('a model answers in prose, and this field is not prose', () => {
  it('strips a label the model repeated back', () => {
    expect(cleanWritten({ title: 'Search title: Walking holidays in the Western Isles' }).title)
      .toBe('Walking holidays in the Western Isles');
    expect(cleanWritten({ title: 'Title - Walking holidays in the Western Isles' }).title)
      .toBe('Walking holidays in the Western Isles');
  });

  it('strips matching quotes of either kind', () => {
    expect(cleanWritten({ title: '"Walking holidays in the Western Isles"' }).title)
      .toBe('Walking holidays in the Western Isles');
    expect(cleanWritten({ title: '“Walking holidays in the Western Isles”' }).title)
      .toBe('Walking holidays in the Western Isles');
  });

  it('flattens the newlines of a model that explained itself', () => {
    expect(cleanWritten({ title: 'Walking holidays\nin the  Western Isles' }).title)
      .toBe('Walking holidays in the Western Isles');
  });

  it('truncates at a word, never mid-word', () => {
    /*
     * A description cut to exactly the cap ends "...and everything carried
     * betwe", which is worse than the shorter sentence.
     */
    const long = `${'Small group walking trips across Harris and Lewis '.repeat(8)}`;
    const out = cleanWritten({ description: long }).description!;
    expect(out.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(out).not.toMatch(/\s\S{1,3}$/);
    expect(long).toContain(out);
  });

  it('holds a title to its own cap', () => {
    const out = cleanWritten({ title: 'Walking and wildlife holidays across the whole of the Outer Hebrides every season' }).title!;
    expect(out.length).toBeLessThanOrEqual(TITLE_MAX);
  });
});

describe('a failed answer is dropped rather than stored', () => {
  it('refuses a title too short to be one', () => {
    /*
     * "Holidays" is not a title, it is a word. Storing it would satisfy the
     * blank and leave the client worse off than the honest empty field the
     * audit would have flagged.
     */
    expect(cleanWritten({ title: 'Holidays' }).title).toBeUndefined();
    expect(cleanWritten({ description: 'Walking trips.' }).description).toBeUndefined();
  });

  it('refuses anything that is not a string, in any shape', () => {
    expect(cleanWritten(null)).toEqual({});
    expect(cleanWritten({ title: 42, description: [] })).toEqual({});
    expect(cleanWritten('a title')).toEqual({});
    expect(cleanWritten(undefined)).toEqual({});
  });
});

describe('filling fills BLANKS and nothing else', () => {
  it('never overwrites what the client wrote, however poor', () => {
    /*
     * The rule the whole feature's safety rests on. A client who wrote a bad
     * title owns it and may have reasons; running automatically means the worst
     * this can do is fill an empty field.
     */
    const page = withSeo({ title: 'Holidays', description: 'We do walking holidays.' });
    const { page: next, filled } = applySeoFill(page, {
      title: 'Walking holidays in the Western Isles',
      description: 'Small group walking trips across Harris and Lewis with a local guide.',
    });

    expect(next.seo.title).toBe('Holidays');
    expect(next.seo.description).toBe('We do walking holidays.');
    expect(wasFilled(filled)).toBe(false);
  });

  it('fills only the side that was blank', () => {
    const page = withSeo({ title: 'A title the client wrote themselves' });
    const { page: next, filled } = applySeoFill(page, {
      title: 'Something else entirely',
      description: 'Small group walking trips across Harris and Lewis with a local guide.',
    });

    expect(next.seo.title).toBe('A title the client wrote themselves');
    expect(next.seo.description).toContain('Harris and Lewis');
    expect(filled.title).toBeUndefined();
    expect(filled.description).toBeDefined();
  });

  it('hands back the very same page when nothing was written', () => {
    // So the caller can skip the save rather than storing an identical page.
    const page = withSeo({});
    expect(applySeoFill(page, {}).page).toBe(page);
    // Through the real pipeline: a failed answer is dropped by cleanWritten
    // before it ever reaches the fill, so there is nothing to store.
    expect(applySeoFill(page, cleanWritten({ title: 'Holidays' })).page).toBe(page);
  });

  it('leaves a hidden page alone even when the writer answered', () => {
    const page = withSeo({ noindex: true });
    const { page: next, filled } = applySeoFill(page, {
      title: 'Walking holidays in the Western Isles',
      description: 'Small group walking trips across Harris and Lewis with a local guide.',
    });
    expect(next).toBe(page);
    expect(wasFilled(filled)).toBe(false);
  });

  it('keeps the rest of the seo block untouched', () => {
    const page = withSeo({ canonical: 'https://example.test/x', noindex: false });
    const { page: next } = applySeoFill(page, {
      title: 'Walking holidays in the Western Isles',
      description: 'Small group walking trips across Harris and Lewis with a local guide.',
    });
    expect(next.seo.canonical).toBe('https://example.test/x');
    expect(next.seo.noindex).toBe(false);
  });
});
