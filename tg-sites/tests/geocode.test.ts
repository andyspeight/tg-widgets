/**
 * Address search for the map field.
 *
 * The network lives in the route; everything worth testing is pure. Two things
 * matter: the query URL is host-fixed and bounded exactly as the map's embed URL
 * is, so nothing typed can steer it, and Photon's parts-of-an-address answer is
 * turned into a clean one-line label without ever throwing on a shape we did not
 * expect. A search is a convenience, so a bad answer is an empty list, not an error.
 */

import { describe, expect, it } from 'vitest';

import {
  PHOTON_HOST,
  PLACE_QUERY_MAX,
  PLACE_RESULT_MAX,
  parsePhotonMatches,
  photonUrl,
  placeLabel,
} from '../lib/content/geocode';

describe('the place-search URL', () => {
  it('builds a host-fixed, encoded query', () => {
    const url = photonUrl('10 Downing Street', 5)!;
    expect(url.startsWith(`${PHOTON_HOST}?`)).toBe(true);
    expect(url).toContain(`q=${encodeURIComponent('10 Downing Street')}`);
    expect(url).toContain('limit=5');
    expect(url).toContain('lang=en');
  });

  it('is empty for a query too short to search', () => {
    expect(photonUrl('', 5)).toBeNull();
    expect(photonUrl('  ', 5)).toBeNull();
    expect(photonUrl('ab', 5)).toBeNull();
    expect(photonUrl(undefined, 5)).toBeNull();
    expect(photonUrl(null, 5)).toBeNull();
  });

  it('cannot be steered to another host or a second parameter', () => {
    const url = new URL(photonUrl('x&limit=999&lang=evil', 5)!);
    expect(url.origin + url.pathname).toBe(PHOTON_HOST);
    // The hostile text is encoded inside q, not parameters of its own.
    expect(url.searchParams.get('limit')).toBe('5');
    expect(url.searchParams.get('lang')).toBe('en');
    expect(url.searchParams.getAll('limit').length).toBe(1);
  });

  it('pins the result count', () => {
    expect(photonUrl('London', 99)).toContain(`limit=${PLACE_RESULT_MAX}`);
    expect(photonUrl('London', 0)).toContain('limit=1');
    expect(photonUrl('London', Number.NaN)).toContain(`limit=${PLACE_RESULT_MAX}`);
  });

  it('caps a pathologically long query', () => {
    const url = new URL(photonUrl('a'.repeat(1000), 5)!);
    expect(url.searchParams.get('q')!.length).toBeLessThanOrEqual(PLACE_QUERY_MAX);
  });
});

describe('the place label', () => {
  it('composes a one-line address from the parts', () => {
    expect(
      placeLabel({ housenumber: '10', street: 'Downing Street', city: 'London', state: 'England', postcode: 'SW1A 2AA', country: 'United Kingdom' }),
    ).toBe('10 Downing Street, London, England, SW1A 2AA, United Kingdom');
  });

  it('does not repeat a name that is also the street', () => {
    // A named place whose name equals its street should say it once.
    expect(placeLabel({ name: 'Baker Street', street: 'Baker Street', city: 'London' })).toBe('Baker Street, London');
  });

  it('keeps a name that adds to the street', () => {
    expect(placeLabel({ name: 'The Shard', street: 'St Thomas Street', city: 'London' })).toBe('The Shard, St Thomas Street, London');
  });

  it('is empty when there is nothing to say', () => {
    expect(placeLabel({})).toBe('');
    expect(placeLabel({ name: 123 as unknown as string })).toBe('');
  });
});

describe('parsing Photon', () => {
  const feature = (properties: Record<string, unknown>, coordinates: unknown = [-0.1276, 51.5074]) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates },
    properties,
  });

  it('turns features into matches with a label and coordinates', () => {
    const matches = parsePhotonMatches({
      features: [feature({ name: 'Big Ben', city: 'London', country: 'United Kingdom' })],
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].label).toBe('Big Ben, London, United Kingdom');
    expect(matches[0].lat).toBeCloseTo(51.5074);
    expect(matches[0].lon).toBeCloseTo(-0.1276);
  });

  it('skips a feature with no label or no real coordinates', () => {
    const matches = parsePhotonMatches({
      features: [
        feature({}),
        feature({ name: 'Nowhere' }, ['x', 'y']),
        feature({ name: 'Somewhere', city: 'Leeds' }),
      ],
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].label).toBe('Somewhere, Leeds');
  });

  it('never returns more than the cap', () => {
    const many = Array.from({ length: 20 }, (_, i) => feature({ name: `Place ${i}`, city: 'Town' }));
    expect(parsePhotonMatches({ features: many }).length).toBe(PLACE_RESULT_MAX);
  });

  it('returns an empty list for anything that is not the shape we expect', () => {
    expect(parsePhotonMatches(null)).toEqual([]);
    expect(parsePhotonMatches('nope')).toEqual([]);
    expect(parsePhotonMatches({})).toEqual([]);
    expect(parsePhotonMatches({ features: 'nope' })).toEqual([]);
    expect(parsePhotonMatches({ features: [null, 42, {}] })).toEqual([]);
  });
});
