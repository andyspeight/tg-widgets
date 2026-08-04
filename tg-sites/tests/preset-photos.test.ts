/**
 * The photograph layer on the designed heroes.
 *
 * The real photographs cannot be tested here, and could not be anywhere without
 * a key and a bill: they come from Pexels at request time. What IS tested is the
 * part that decides WHICH photograph, and where it is asked for, which is where
 * the behaviour lives. The picker draws a picture in a hero bar from the same
 * query the fill-on-insert will use, so the two agree; only heroes get them, so
 * the picker asks the library for the one tab that wants it; and the query is
 * stable, so a preview and the hero a client then adds look like each other.
 */

import { describe, expect, it } from 'vitest';

import {
  HERO_PHOTO_QUERIES,
  heroPhotoQuery,
  presetById,
  presetThumb,
  stockPreviewUrl,
} from '../lib/content/presets';
import type { SectionPreset } from '../lib/content/preset-types';

describe('the query a hero picture draws from', () => {
  it('is stable and always one of the palette', () => {
    const first = heroPhotoQuery('hero-split-right', 0);
    expect(first).toBe(heroPhotoQuery('hero-split-right', 0));
    expect(HERO_PHOTO_QUERIES).toContain(first);
  });

  it('varies with the picture position, so two images in one hero differ', () => {
    // Not a guarantee for every id, but the seed changes, so the common case is
    // two subjects rather than the same one twice.
    const seen = new Set(
      Array.from({ length: 8 }, (_, index) => heroPhotoQuery('hero-two-up', index)),
    );
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('the preview URL', () => {
  it('is same-origin and carries the query, encoded', () => {
    expect(stockPreviewUrl('greek island coastline')).toBe(
      '/api/stock-preview?q=greek%20island%20coastline',
    );
  });
});

describe('which previews carry a photograph', () => {
  const heroWithImage: SectionPreset = {
    id: 'test-hero-img',
    category: 'hero',
    label: 'x',
    description: 'x',
    rows: [
      {
        widths: [1, 1],
        columns: [
          [{ type: 'heading', props: { html: 'Title', style: 'h1' } }],
          [{ type: 'image', props: { ratio: '4/3' } }],
        ],
      },
    ],
  };

  it('puts a query on a hero picture bar and nothing on its words', () => {
    const bars = presetThumb(heroWithImage).bars;
    const withQuery = bars.filter((bar) => bar.query);
    // Exactly the one picture carries a query; the heading does not.
    expect(withQuery).toHaveLength(1);
    expect(HERO_PHOTO_QUERIES).toContain(withQuery[0].query);
  });

  it('lets a block name its own subject, which wins over the palette', () => {
    const named: SectionPreset = {
      ...heroWithImage,
      rows: [
        {
          widths: [1],
          columns: [[{ type: 'image', props: { ratio: '4/3' }, photo: 'lisbon tram street' }]],
        },
      ],
    };
    const picture = presetThumb(named).bars.find((bar) => bar.query);
    expect(picture?.query).toBe('lisbon tram street');
  });

  it('leaves a NON-hero preset with a picture unphotographed', () => {
    const feature: SectionPreset = { ...heroWithImage, id: 'test-feature', category: 'features' };
    const bars = presetThumb(feature).bars;
    expect(bars.some((bar) => bar.query)).toBe(false);
  });

  it('carries a whole-section query for an over-photo hero, and only a hero', () => {
    const overPhoto: SectionPreset = {
      id: 'test-hero-bg',
      category: 'hero',
      label: 'x',
      description: 'x',
      rows: [{ widths: [1], columns: [[{ type: 'heading', props: { html: 'Hi', style: 'h1' } }]] }],
      section: { tone: 'dark', backgroundQuery: 'santorini sunset sea' },
    };
    expect(presetThumb(overPhoto).background).toBe('santorini sunset sea');

    const notHero: SectionPreset = { ...overPhoto, id: 'test-cta-bg', category: 'cta' };
    expect(presetThumb(notHero).background).toBeUndefined();
  });
});

describe('the real heroes are wired to the layer', () => {
  it('gives hero-background a background query the preview can draw', () => {
    const preset = presetById('hero-background');
    expect(preset).toBeDefined();
    expect(presetThumb(preset!).background).toBeTruthy();
  });

  it('photographs the picture in a split hero', () => {
    const preset = presetById('hero-split-right');
    expect(preset).toBeDefined();
    expect(presetThumb(preset!).bars.some((bar) => bar.query)).toBe(true);
  });
});
