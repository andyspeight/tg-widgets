/**
 * A destination is two things at once: facts we maintain, and words the client owns.
 *
 * These pin the contract between them. The payload is read back out of a jsonb
 * column, so every test here is really asking the same question: when the stored
 * value is not what we expected, does the page render less, or does it break?
 * Less is the answer, every time.
 */

import { describe, expect, it } from 'vitest';

import { safeSlug } from '../lib/content/collection';
import {
  climateMonths,
  referenceFacts,
  referenceRows,
  REFERENCE_KEY,
  type ReferenceClimate,
} from '../lib/content/reference';

const twelve = (fill: number) => Array.from({ length: 12 }, () => fill);

const CLIMATE: ReferenceClimate = {
  temps: [11, 11, 13, 16, 20, 24, 26, 27, 24, 20, 16, 13],
  rainfall: [75, 60, 40, 20, 10, 2, 0, 0, 5, 35, 65, 80],
  season: ['off', 'off', 'off', 'shoulder', 'best', 'best', 'best', 'best', 'best', 'shoulder', 'off', 'off'],
};

const GREECE = {
  [REFERENCE_KEY]: {
    kind: 'country',
    sourceId: 'recGreece123',
    region: 'Mediterranean · Southern Europe',
    flightTime: '3h 45m',
    timeZone: 'GMT +2',
    currency: 'Euro (€)',
    language: 'Greek',
    voltage: '230V · Type F',
    climate: CLIMATE,
    bestFor: ['Couples', 'Island hopping', 'Food'],
  },
};

describe('the reserved key cannot collide with a client field', () => {
  /*
   * The whole two-layer design rests on this. A field key goes through safeSlug,
   * which admits lower-case letters, digits and hyphens, so an underscore cannot
   * survive it. That makes the reservation structural rather than a convention
   * somebody has to remember when they add a field.
   */
  it('safeSlug cannot produce the reserved key, however it is asked', () => {
    for (const attempt of [REFERENCE_KEY, '__ref', '_ _ref', '__REF', 'a__ref']) {
      expect(safeSlug(attempt)).not.toBe(REFERENCE_KEY);
    }
  });

  it('and the reserved key starts with the character safeSlug drops', () => {
    expect(REFERENCE_KEY.startsWith('_')).toBe(true);
  });
});

describe('reading a payload back', () => {
  it('reads a whole record', () => {
    const facts = referenceFacts(GREECE);
    expect(facts?.kind).toBe('country');
    expect(facts?.sourceId).toBe('recGreece123');
    expect(facts?.flightTime).toBe('3h 45m');
    expect(facts?.climate?.temps).toHaveLength(12);
    expect(facts?.bestFor).toEqual(['Couples', 'Island hopping', 'Food']);
  });

  it('is null for an ordinary entry, which is most of them', () => {
    expect(referenceFacts({ title: 'Ten things about Crete' })).toBeNull();
    expect(referenceFacts(null)).toBeNull();
    expect(referenceFacts('nonsense')).toBeNull();
  });

  it('refuses a kind that is not one of the five', () => {
    expect(referenceFacts({ [REFERENCE_KEY]: { kind: 'hotel', sourceId: 'rec1' } })).toBeNull();
  });

  it('refuses a record a sync could never find again', () => {
    expect(referenceFacts({ [REFERENCE_KEY]: { kind: 'country' } })).toBeNull();
    expect(referenceFacts({ [REFERENCE_KEY]: { kind: 'country', sourceId: '  ' } })).toBeNull();
  });

  it('drops a fact that is not a string rather than rendering an object', () => {
    const facts = referenceFacts({
      [REFERENCE_KEY]: { kind: 'city', sourceId: 'rec1', currency: { usd: 1 }, language: 'Greek' },
    });
    expect(facts?.currency).toBeUndefined();
    expect(facts?.language).toBe('Greek');
  });
});

describe('the climate year, which is all three series or none', () => {
  it('takes a complete year', () => {
    expect(referenceFacts(GREECE)?.climate?.season[7]).toBe('best');
  });

  it('refuses a short series, because month eight would sit under month seven', () => {
    const short = { ...CLIMATE, temps: CLIMATE.temps.slice(0, 11) };
    expect(referenceFacts({ [REFERENCE_KEY]: { kind: 'country', sourceId: 'r', climate: short } })?.climate)
      .toBeUndefined();
  });

  it('refuses an impossible temperature outright rather than pinning it', () => {
    /*
     * A 400 degree August is a broken record, not a hot month. Clamping it to 60
     * would draw a chart that looks deliberate, which is worse than drawing none.
     */
    const broken = { ...CLIMATE, temps: [...twelve(20).slice(0, 7), 400, ...twelve(20).slice(0, 4)] };
    expect(referenceFacts({ [REFERENCE_KEY]: { kind: 'country', sourceId: 'r', climate: broken } })?.climate)
      .toBeUndefined();
  });

  it('refuses a season token outside the closed set', () => {
    const broken = { ...CLIMATE, season: [...CLIMATE.season.slice(0, 11), 'perfect'] };
    expect(referenceFacts({ [REFERENCE_KEY]: { kind: 'country', sourceId: 'r', climate: broken } })?.climate)
      .toBeUndefined();
  });

  it('drops the whole chart when only two of the three series are usable', () => {
    const partial = { temps: CLIMATE.temps, rainfall: CLIMATE.rainfall };
    expect(referenceFacts({ [REFERENCE_KEY]: { kind: 'country', sourceId: 'r', climate: partial } })?.climate)
      .toBeUndefined();
  });
});

describe('the rows a page draws', () => {
  it('puts flight time first, because on a UK outbound site it is the question', () => {
    const rows = referenceRows(referenceFacts(GREECE)!);
    expect(rows[0].label).toBe('Flight time');
  });

  it('leaves out a fact the corpus has not got, rather than drawing a gap', () => {
    const rows = referenceRows(referenceFacts(GREECE)!);
    expect(rows.map((r) => r.key)).not.toContain('visaStatus');
    expect(rows).toHaveLength(5);
  });
});

describe('scaling the chart', () => {
  it('scales to the place, so a cold country still has a readable year', () => {
    const cold: ReferenceClimate = { ...CLIMATE, temps: [2, 2, 4, 6, 9, 12, 14, 13, 10, 7, 4, 2] };
    const months = climateMonths(cold);
    // The warmest month fills the chart wherever the place is.
    expect(Math.max(...months.map((m) => m.height))).toBe(100);
    // And the coldest is still a bar somebody can see, not a line on the axis.
    expect(Math.min(...months.map((m) => m.height))).toBeGreaterThanOrEqual(8);
  });

  it('keeps the months in order and carries each one its own values', () => {
    const months = climateMonths(CLIMATE);
    expect(months).toHaveLength(12);
    expect(months[0].label).toBe('Jan');
    expect(months[7].label).toBe('Aug');
    expect(months[7].temp).toBe(27);
    expect(months[7].rainfall).toBe(0);
  });

  it('survives a year with no variation at all', () => {
    const flat: ReferenceClimate = { temps: twelve(20), rainfall: twelve(30), season: CLIMATE.season };
    const months = climateMonths(flat);
    expect(months.every((m) => Number.isFinite(m.height))).toBe(true);
  });
});
