/**
 * Narrowing and ordering a listing by what its collection declares (#238).
 *
 * The engine is pure and lives away from the query on purpose: the values it
 * compares are jsonb the database does not constrain, so the comparisons happen
 * in JS where the parse has already typed them. That also makes every rule here
 * drivable without a database.
 */

import { describe, expect, it } from 'vitest';

import {
  canFilter,
  canSort,
  compareByField,
  matchesFilter,
  OPS_FOR_KIND,
  parseFilter,
  parseSort,
} from '../lib/content/collection-filter';
import { FIELD_KINDS, type FieldDef } from '../lib/content/collection-fields';
import { listingIn, listingKey, listingsIn } from '../lib/content/listings';

const DEFS: FieldDef[] = [
  { key: 'price', label: 'Price from', kind: 'price', required: false, choices: [], prefix: '£', suffix: 'pp' },
  { key: 'nights', label: 'Nights', kind: 'number', required: false, choices: [], prefix: '', suffix: '' },
  { key: 'board', label: 'Board basis', kind: 'choice', required: false, choices: ['Half board', 'Full board'], prefix: '', suffix: '' },
  { key: 'escort', label: 'Escorted', kind: 'toggle', required: false, choices: [], prefix: '', suffix: '' },
  { key: 'departs', label: 'Departs', kind: 'date', required: false, choices: [], prefix: '', suffix: '' },
  { key: 'blurb', label: 'Blurb', kind: 'longtext', required: false, choices: [], prefix: '', suffix: '' },
];

describe('only kinds with an operator a client could pick are filterable', () => {
  it('names them, and leaves prose and pictures out', () => {
    expect(canFilter('choice')).toBe(true);
    expect(canFilter('toggle')).toBe(true);
    expect(canFilter('number')).toBe(true);
    expect(canFilter('price')).toBe(true);
    expect(canFilter('date')).toBe(true);
    // "Contains" over free prose is a search box, and the search block is one.
    expect(canFilter('text')).toBe(false);
    expect(canFilter('longtext')).toBe(false);
    expect(canFilter('image')).toBe(false);
  });

  it('every kind has an entry, so a new one cannot be forgotten into a crash', () => {
    for (const kind of FIELD_KINDS) {
      expect(Array.isArray(OPS_FOR_KIND[kind])).toBe(true);
    }
  });

  it('a toggle sorts into two heaps, which is no use, so it does not sort', () => {
    expect(canSort('toggle')).toBe(false);
    expect(canSort('price')).toBe(true);
    expect(canSort('date')).toBe(true);
  });
});

describe('a filter is read against the schema it names, and degrades to none', () => {
  it('accepts one the collection can answer', () => {
    expect(parseFilter(DEFS, { field: 'board', op: 'is', value: 'Half board' })).toEqual({
      field: 'board',
      op: 'is',
      value: 'Half board',
    });
  });

  it('refuses a field the collection no longer declares', () => {
    // The case a rename leaves behind. No filter beats an empty page.
    expect(parseFilter(DEFS, { field: 'gone', op: 'is', value: 'x' })).toBeNull();
  });

  it('refuses an operator that does not belong to the kind', () => {
    expect(parseFilter(DEFS, { field: 'board', op: 'atLeast', value: 'Half board' })).toBeNull();
    expect(parseFilter(DEFS, { field: 'price', op: 'before', value: '100' })).toBeNull();
  });

  it('refuses a field that cannot be filtered at all', () => {
    expect(parseFilter(DEFS, { field: 'blurb', op: 'is', value: 'x' })).toBeNull();
  });

  it('refuses a choice compared to something that is not one of its options', () => {
    // What a renamed option leaves: a filter that could never match anything.
    expect(parseFilter(DEFS, { field: 'board', op: 'is', value: 'Room only' })).toBeNull();
  });

  it('refuses a number compared to words, and junk of every shape', () => {
    expect(parseFilter(DEFS, { field: 'price', op: 'atMost', value: 'cheap' })).toBeNull();
    expect(parseFilter(DEFS, null)).toBeNull();
    expect(parseFilter(DEFS, 'board')).toBeNull();
    expect(parseFilter(DEFS, { field: 'board', op: 'is', value: '' })).toBeNull();
  });
});

describe('matching an item against the filter', () => {
  it('compares a choice both ways round', () => {
    const item = { board: 'Half board' };
    expect(matchesFilter(DEFS, item, { field: 'board', op: 'is', value: 'Half board' })).toBe(true);
    expect(matchesFilter(DEFS, item, { field: 'board', op: 'is', value: 'Full board' })).toBe(false);
    expect(matchesFilter(DEFS, item, { field: 'board', op: 'isNot', value: 'Full board' })).toBe(true);
  });

  it('compares a number by at least and at most', () => {
    const item = { price: 1299 };
    expect(matchesFilter(DEFS, item, { field: 'price', op: 'atMost', value: '1500' })).toBe(true);
    expect(matchesFilter(DEFS, item, { field: 'price', op: 'atMost', value: '1000' })).toBe(false);
    expect(matchesFilter(DEFS, item, { field: 'price', op: 'atLeast', value: '1299' })).toBe(true);
  });

  it('compares a toggle as yes or no', () => {
    expect(matchesFilter(DEFS, { escort: true }, { field: 'escort', op: 'is', value: 'yes' })).toBe(true);
    expect(matchesFilter(DEFS, { escort: true }, { field: 'escort', op: 'is', value: 'no' })).toBe(false);
    expect(matchesFilter(DEFS, { escort: false }, { field: 'escort', op: 'is', value: 'no' })).toBe(true);
  });

  it('compares a date before and after', () => {
    const item = { departs: '2026-06-01' };
    expect(matchesFilter(DEFS, item, { field: 'departs', op: 'after', value: '2026-01-01' })).toBe(true);
    expect(matchesFilter(DEFS, item, { field: 'departs', op: 'before', value: '2026-01-01' })).toBe(false);
  });

  it('leaves an item that never answered OUT, even of an "is not"', () => {
    /*
     * The one judgement call in the engine. A client filtering to "board basis
     * is not full board" is building a list of tours they know the board basis
     * of; letting the blanks through would fill the page with the ones they have
     * not got round to filling in.
     */
    expect(matchesFilter(DEFS, {}, { field: 'board', op: 'isNot', value: 'Full board' })).toBe(false);
    expect(matchesFilter(DEFS, { board: '' }, { field: 'board', op: 'is', value: 'Half board' })).toBe(false);
    expect(matchesFilter(DEFS, {}, { field: 'price', op: 'atMost', value: '2000' })).toBe(false);
  });
});

describe('ordering by a declared field', () => {
  const sortBy = (field: string, dir: 'asc' | 'desc') => parseSort(DEFS, { field, dir })!;

  it('puts the cheapest first, and reverses on request', () => {
    const asc = sortBy('price', 'asc');
    expect(compareByField(DEFS, asc, { price: 900 }, { price: 1299 })).toBeLessThan(0);
    expect(compareByField(DEFS, sortBy('price', 'desc'), { price: 900 }, { price: 1299 })).toBeGreaterThan(0);
  });

  it('sinks the blanks whichever way it runs', () => {
    /*
     * "Cheapest first" and "dearest first" both mean "of the ones that have a
     * price". Reversing the direction must not promote the unpriced to the top.
     */
    for (const dir of ['asc', 'desc'] as const) {
      expect(compareByField(DEFS, sortBy('price', dir), {}, { price: 1299 })).toBeGreaterThan(0);
      expect(compareByField(DEFS, sortBy('price', dir), { price: 1299 }, {})).toBeLessThan(0);
    }
  });

  it('reads words the way a person does, so Tour 9 comes before Tour 10', () => {
    const order = sortBy('board', 'asc');
    expect(compareByField(DEFS, order, { board: 'Tour 9' }, { board: 'Tour 10' })).toBeLessThan(0);
  });

  it('refuses a sort the collection cannot answer', () => {
    expect(parseSort(DEFS, { field: 'escort', dir: 'asc' })).toBeNull();
    expect(parseSort(DEFS, { field: 'gone', dir: 'asc' })).toBeNull();
    expect(parseSort(DEFS, null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The plumbing: from a block's props to a request, and back to its own rows.
// ---------------------------------------------------------------------------

describe('a block carries its narrowing into the request', () => {
  const block = (props: Record<string, unknown>) => ({
    id: 'b1',
    type: 'cards',
    props: { source: 'collection', collection: 'tours', count: 6, ...props },
  });

  it('reads the filter and the sort off the props', () => {
    const request = listingIn(block({
      filterField: 'board',
      filterOp: 'is',
      filterValue: 'Half board',
      sortField: 'price',
      sortDir: 'asc',
    }));
    expect(request?.filter).toEqual({ field: 'board', op: 'is', value: 'Half board' });
    expect(request?.sort).toEqual({ field: 'price', dir: 'asc' });
  });

  it('answers null for a half-chosen filter, so the grid shows everything', () => {
    /*
     * The state the pane is in between picking a field and picking a value. An
     * empty grid there would look like a broken block rather than an unfinished
     * choice.
     */
    expect(listingIn(block({ filterField: 'board', filterOp: 'is' }))?.filter).toBeNull();
    expect(listingIn(block({ filterField: 'board', filterValue: 'Half board' }))?.filter).toBeNull();
    expect(listingIn(block({}))?.filter).toBeNull();
  });
});

describe('two blocks narrowing one collection differently are two reads', () => {
  const block = (id: string, props: Record<string, unknown>) => ({
    id,
    type: 'cards',
    props: { source: 'collection', collection: 'tours', count: 6, ...props },
  });
  const tree = (blocks: ReturnType<typeof block>[]) => ({
    sections: [
      { id: 's1', rows: [{ id: 'r1', columns: [{ id: 'c1', width: 100, blocks }] }] },
    ],
  });

  it('keys them apart, so neither is handed the other rows', () => {
    /*
     * The whole reason listingKey exists. Keyed by the collection alone, these
     * two would collide and one grid would silently show the other's tours.
     */
    const wanted = listingsIn([
      tree([
        block('a', { filterField: 'board', filterOp: 'is', filterValue: 'Half board' }),
        block('b', { filterField: 'board', filterOp: 'is', filterValue: 'Full board' }),
      ]) as never,
    ]);
    expect(wanted).toHaveLength(2);
    expect(new Set(wanted.map(listingKey)).size).toBe(2);
  });

  it('but two blocks asking the same question still share one read', () => {
    const wanted = listingsIn([
      tree([
        block('a', { filterField: 'board', filterOp: 'is', filterValue: 'Half board', count: 3 }),
        block('b', { filterField: 'board', filterOp: 'is', filterValue: 'Half board', count: 9 }),
      ]) as never,
    ]);
    expect(wanted).toHaveLength(1);
    // For the larger count, so the block wanting nine is not short-changed.
    expect(wanted[0].count).toBe(9);
  });

  it('and a count or a facts difference alone never splits a read', () => {
    // Those trim a shared answer rather than change it.
    const wanted = listingsIn([
      tree([block('a', { count: 3, facts: 0 }), block('b', { count: 9, facts: 4 })]) as never,
    ]);
    expect(wanted).toHaveLength(1);
    expect(wanted[0]).toMatchObject({ count: 9, facts: 4 });
  });
});
