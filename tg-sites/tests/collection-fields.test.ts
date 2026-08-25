/**
 * A collection's own fields.
 *
 * The `fields` column has been on the collections table since migration 0004,
 * unused, because filling it in meant answering three questions first. Each
 * describe below is one of those answers, and the third is the one worth having
 * a suite for: what happens to two hundred entries' worth of writing when
 * somebody renames or deletes a field. The answer has to be "nothing", and
 * these are the tests that keep it true.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { emptyItem, parseItem, safeFieldBag, MAX_FIELDS } from '../lib/content/collection';
import { fillListings, itemAsCard, listingIn,
  listingKey,
} from '../lib/content/listings';
import { createSection } from '../lib/content/factory';
import { defaultPropsFor } from '../lib/content/blocks';
import {
  cleanFieldValues,
  FIELD_KINDS,
  FIELD_PRESETS,
  fieldFacts,
  formatFieldValue,
  missingRequired,
  mintFieldKey,
  parseFieldDefs,
  toursPresetFields,
  type FieldDef,
} from '../lib/content/collection-fields';

function def(over: Partial<FieldDef> = {}): FieldDef {
  return {
    key: 'nights',
    label: 'Nights',
    kind: 'number',
    required: false,
    choices: [],
    prefix: '',
    suffix: '',
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The schema designer
// ---------------------------------------------------------------------------

describe('parseFieldDefs', () => {
  it('reads a well-formed list back unchanged', () => {
    const defs = [def(), def({ key: 'board', label: 'Board', kind: 'choice', choices: ['Half board'] })];
    expect(parseFieldDefs(defs)).toEqual(defs);
  });

  it('is no fields at all for every collection made before this existed', () => {
    // The column defaults to '[]', but a jsonb column can hold anything and a
    // collection screen that throws is worse than one with no fields on it.
    expect(parseFieldDefs(undefined)).toEqual([]);
    expect(parseFieldDefs(null)).toEqual([]);
    expect(parseFieldDefs({})).toEqual([]);
    expect(parseFieldDefs('nights')).toEqual([]);
    expect(parseFieldDefs([])).toEqual([]);
  });

  it('drops a junk row rather than refusing the whole schema', () => {
    const defs = parseFieldDefs([{ nope: true }, def(), null, 42, { key: '', label: 'No key' }]);
    expect(defs).toHaveLength(1);
    expect(defs[0].key).toBe('nights');
  });

  it('keeps the first definition when two claim the same key', () => {
    const defs = parseFieldDefs([def({ label: 'Nights' }), def({ label: 'Nights aboard' })]);
    expect(defs).toHaveLength(1);
    expect(defs[0].label).toBe('Nights');
  });

  it('falls back to a short answer for a kind it has never heard of', () => {
    expect(parseFieldDefs([def({ kind: 'quantum' as never })])[0].kind).toBe('text');
  });

  it('tidies a choice list: trimmed, deduped, capped', () => {
    const [field] = parseFieldDefs([
      def({ kind: 'choice', choices: ['  Half board ', 'Half board', '', 'Full board', 7 as never] }),
    ]);
    expect(field.choices).toEqual(['Half board', 'Full board']);
  });

  it('caps how many fields one collection may declare', () => {
    const many = Array.from({ length: MAX_FIELDS + 10 }, (_, n) =>
      def({ key: `f-${n}`, label: `Field ${n}` }),
    );
    expect(parseFieldDefs(many)).toHaveLength(MAX_FIELDS);
  });

  it('required is a real boolean, whatever arrived', () => {
    expect(parseFieldDefs([def({ required: 'yes' as never })])[0].required).toBe(false);
    expect(parseFieldDefs([def({ required: true })])[0].required).toBe(true);
  });
});

describe('mintFieldKey', () => {
  it('takes the key from the label the client settled on', () => {
    expect(mintFieldKey('Price from, per person', [])).toBe('price-from-per-person');
  });

  it('suffixes past anything already taken', () => {
    expect(mintFieldKey('Nights', ['nights'])).toBe('nights-2');
    expect(mintFieldKey('Nights', ['nights', 'nights-2'])).toBe('nights-3');
  });

  it('still gives a key when the label reduces to nothing', () => {
    expect(mintFieldKey('。。。', [])).toBe('field');
  });
});

// ---------------------------------------------------------------------------
// The values an entry stores
// ---------------------------------------------------------------------------

describe('safeFieldBag', () => {
  it('keeps the three kinds of value a field can hold', () => {
    expect(safeFieldBag({ nights: 7, escorted: true, departs: 'Oban' })).toEqual({
      nights: 7,
      escorted: true,
      departs: 'Oban',
    });
  });

  it('is an empty bag for anything that is not one', () => {
    expect(safeFieldBag(null)).toEqual({});
    expect(safeFieldBag([1, 2])).toEqual({});
    expect(safeFieldBag('nights=7')).toEqual({});
  });

  it('throws away a value that is neither text, a number nor a tick', () => {
    expect(safeFieldBag({ a: { deep: true }, b: [1], c: null, d: NaN, e: 'kept' })).toEqual({ e: 'kept' });
  });

  it('reduces a key the same way a definition does, so the two always meet', () => {
    expect(safeFieldBag({ 'Price From': 'x' })).toEqual({ 'price-from': 'x' });
  });

  it('caps a single value rather than storing an essay', () => {
    const long = safeFieldBag({ notes: 'x'.repeat(5000) }).notes as string;
    expect(long).toHaveLength(2000);
  });
});

describe('cleanFieldValues', () => {
  it('reads a number out of what somebody typed', () => {
    expect(cleanFieldValues([def()], { nights: '7 nights' as never })).toEqual({ nights: 7 });
  });

  it('rounds a price to the penny', () => {
    const defs = [def({ key: 'price', label: 'Price', kind: 'price' })];
    expect(cleanFieldValues(defs, { price: '1299.999' as never })).toEqual({ price: 1300 });
    expect(cleanFieldValues(defs, { price: '£1,299.50' as never })).toEqual({ price: 1299.5 });
  });

  it('drops a number that is only words, rather than refusing the save', () => {
    // The whole entry has to survive one bad field: a save that throws would
    // lose the writing in the other thirteen.
    expect(cleanFieldValues([def()], { nights: 'a fortnight' as never })).toEqual({});
  });

  it('holds a date to the same YYYY-MM-DD a post is dated by', () => {
    const defs = [def({ key: 'departs-on', label: 'Departs on', kind: 'date' })];
    expect(cleanFieldValues(defs, { 'departs-on': '2026-09-14' })).toEqual({ 'departs-on': '2026-09-14' });
    expect(cleanFieldValues(defs, { 'departs-on': 'next Tuesday' })).toEqual({});
  });

  it('refuses a choice that is not on the list', () => {
    const defs = [def({ key: 'board', label: 'Board', kind: 'choice', choices: ['Half board', 'Full board'] })];
    expect(cleanFieldValues(defs, { board: 'Half board' })).toEqual({ board: 'Half board' });
    expect(cleanFieldValues(defs, { board: 'Anything I like' })).toEqual({});
  });

  it('puts a picture through the same allowlist as every other picture', () => {
    const defs = [def({ key: 'map', label: 'Map', kind: 'image' })];
    expect(cleanFieldValues(defs, { map: 'media-1' })).toEqual({ map: 'media-1' });
    expect(cleanFieldValues(defs, { map: 'https://example.com/a.jpg' })).toEqual({
      map: 'https://example.com/a.jpg',
    });
    expect(cleanFieldValues(defs, { map: 'javascript:alert(1)' })).toEqual({});
  });

  it('a tick is a tick, and false is an answer rather than a gap', () => {
    const defs = [def({ key: 'escorted', label: 'Escorted', kind: 'toggle' })];
    expect(cleanFieldValues(defs, { escorted: 'true' })).toEqual({ escorted: true });
    expect(cleanFieldValues(defs, { escorted: false })).toEqual({ escorted: false });
  });

  it('flattens a short answer to one line, and leaves a long one alone', () => {
    const short = def({ key: 'departs', label: 'Departs', kind: 'text' });
    const long = def({ key: 'notes', label: 'Notes', kind: 'longtext' });
    expect(cleanFieldValues([short], { departs: '  Oban,\n  Argyll ' })).toEqual({ departs: 'Oban, Argyll' });
    expect(cleanFieldValues([long], { notes: 'Line one\nLine two' })).toEqual({ notes: 'Line one\nLine two' });
  });
});

// ---------------------------------------------------------------------------
// The rename story: what a schema edit does to the writing
// ---------------------------------------------------------------------------

describe('a schema edit costs a client nothing', () => {
  const stored = { nights: 7, board: 'Half board' };

  it('renaming a label changes no entry at all, because entries store by key', () => {
    const before = [def(), def({ key: 'board', label: 'Board', kind: 'choice', choices: ['Half board'] })];
    const after = before.map((field) =>
      field.key === 'nights' ? { ...field, label: 'Nights aboard' } : field,
    );
    expect(cleanFieldValues(after, stored)).toEqual(cleanFieldValues(before, stored));
  });

  it('deleting a definition strands its answers rather than deleting them', () => {
    // Board is no longer declared. Its answer stays in the bag, invisible.
    const cleaned = cleanFieldValues([def()], stored);
    expect(cleaned).toEqual({ nights: 7, board: 'Half board' });
  });

  it('and adding the field back finds the answers still there', () => {
    const gone = cleanFieldValues([def()], stored);
    const back = cleanFieldValues(
      [def(), def({ key: 'board', label: 'Board', kind: 'choice', choices: ['Half board'] })],
      gone,
    );
    expect(back.board).toBe('Half board');
  });

  it('a key a newer deploy wrote survives a round trip through an older editor', () => {
    expect(cleanFieldValues([def()], { nights: 7, 'from-the-future': 'kept' })).toMatchObject({
      'from-the-future': 'kept',
    });
  });
});

// ---------------------------------------------------------------------------
// The prompt, and the starters
// ---------------------------------------------------------------------------

describe('missingRequired', () => {
  const defs = [
    def({ required: true }),
    def({ key: 'escorted', label: 'Escorted', kind: 'toggle', required: true }),
    def({ key: 'departs', label: 'Departs', kind: 'text' }),
  ];

  it('names the required fields nobody has answered', () => {
    expect(missingRequired(defs, {}).map((field) => field.key)).toEqual(['nights', 'escorted']);
  });

  it('counts a ticked-off No as answered, because it is one', () => {
    expect(missingRequired(defs, { nights: 7, escorted: false })).toEqual([]);
  });

  it('counts an empty string as unanswered', () => {
    expect(missingRequired([def({ key: 'departs', label: 'Departs', kind: 'text', required: true })], {
      departs: '',
    })).toHaveLength(1);
  });
});

describe('the starters', () => {
  it('every preset survives its own parser, which is what the save runs', () => {
    for (const preset of FIELD_PRESETS) {
      expect(parseFieldDefs(preset.fields)).toEqual(preset.fields);
    }
  });

  it('Tours carries the facts a travel card has to show', () => {
    expect(toursPresetFields().map((field) => field.key)).toEqual([
      'price-from',
      'nights',
      'departs',
      'next-departure',
      'board',
      'escorted',
    ]);
  });

  it('Blog declares nothing, because a post already has what it needs', () => {
    expect(FIELD_PRESETS.find((preset) => preset.id === 'blog')?.fields).toEqual([]);
  });

  it('every kind the editor can offer is one the cleaner knows', () => {
    for (const kind of FIELD_KINDS) {
      const [field] = parseFieldDefs([def({ kind })]);
      expect(field.kind).toBe(kind);
    }
  });
});

// ---------------------------------------------------------------------------
// Showing a value: what actually lands on a card
// ---------------------------------------------------------------------------

describe('formatFieldValue', () => {
  it('groups a number so a price reads as money', () => {
    const price = def({ key: 'price', label: 'Price', kind: 'price', prefix: '£' });
    expect(formatFieldValue(price, 1299)).toBe('£1,299');
  });

  it('shows the pence when there are pence, and not when there are none', () => {
    const price = def({ key: 'price', label: 'Price', kind: 'price', prefix: '£' });
    expect(formatFieldValue(price, 1299.5)).toBe('£1,299.50');
    expect(formatFieldValue(price, 1299)).toBe('£1,299');
  });

  it('but a plain number keeps the precision it was given', () => {
    // 4.5 is 4.5. Padding it to 4.50 would invent a decimal place nobody typed.
    expect(formatFieldValue(def({ kind: 'number' }), 4.5)).toBe('4.5');
    expect(formatFieldValue(def({ kind: 'number' }), 4)).toBe('4');
  });

  /*
   * The separator is the formatter's, not the stored affix's: the parser trims
   * every affix, so a suffix typed as " nights" would have arrived as "nights"
   * and rendered as 7nights. A word stands off the number, a symbol hugs it.
   */
  it('spaces a word off the number and keeps a symbol against it', () => {
    expect(formatFieldValue(def({ suffix: 'nights' }), 7)).toBe('7 nights');
    expect(formatFieldValue(def({ suffix: '%' }), 20)).toBe('20%');
    expect(formatFieldValue(def({ prefix: '£' }), 1299)).toBe('£1,299');
    expect(formatFieldValue(def({ prefix: 'from' }), 1299)).toBe('from 1,299');
  });

  it('shows a date as a day, never resolved through an instant', () => {
    // safeDate stores what a person typed precisely so the 14th is the 14th
    // everywhere; formatting it back through new Date is the bug that undoes it.
    const departs = def({ key: 'departs', label: 'Departs', kind: 'date' });
    expect(formatFieldValue(departs, '2026-09-14')).toBe('14 Sep 2026');
    expect(formatFieldValue(departs, 'not a date')).toBe('');
  });

  it('a yes is worth the space and a no is not', () => {
    const escorted = def({ key: 'escorted', label: 'Escorted', kind: 'toggle' });
    // "Yes", not the label: every place a fact is shown puts the label beside
    // the value, so the label as a value read "Escorted: Escorted".
    expect(formatFieldValue(escorted, true)).toBe('Yes');
    expect(formatFieldValue(escorted, false)).toBe('');
  });

  it('is nothing at all for an unanswered field', () => {
    expect(formatFieldValue(def(), undefined)).toBe('');
    expect(formatFieldValue(def({ kind: 'text' }), '')).toBe('');
  });

  it('gives a picture no words, because a picture is not words', () => {
    expect(formatFieldValue(def({ kind: 'image' }), 'media-1')).toBe('');
  });
});

describe('fieldFacts', () => {
  const defs = [
    def({ key: 'price', label: 'Price from', kind: 'price', prefix: '£' }),
    def({ key: 'nights', label: 'Nights', suffix: 'nights' }),
    def({ key: 'board', label: 'Board', kind: 'choice', choices: ['Half board'] }),
  ];
  const values = { price: 1299, nights: 7, board: 'Half board' };

  it('keeps the collections order, because that order is the choice', () => {
    expect(fieldFacts(defs, values).map((fact) => fact.value)).toEqual([
      '£1,299',
      '7 nights',
      'Half board',
    ]);
  });

  it('takes the first few when a block asks for fewer', () => {
    expect(fieldFacts(defs, values, 2).map((fact) => fact.key)).toEqual(['price', 'nights']);
    expect(fieldFacts(defs, values, 0)).toEqual([]);
  });

  it('skips a field with no answer rather than leaving a gap on the card', () => {
    expect(fieldFacts(defs, { nights: 7 }).map((fact) => fact.key)).toEqual(['nights']);
  });

  it('leaves out what a card cannot show in a line', () => {
    const wide = [
      def({ key: 'map', label: 'Map', kind: 'image' }),
      def({ key: 'notes', label: 'Notes', kind: 'longtext' }),
      def({ key: 'nights', label: 'Nights' }),
    ];
    expect(fieldFacts(wide, { map: 'media-1', notes: 'A paragraph', nights: 7 })).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The seam with the item itself
// ---------------------------------------------------------------------------

describe('an item carries its answers', () => {
  it('a fresh item has an empty bag rather than no bag', () => {
    expect(emptyItem().fields).toEqual({});
  });

  it('parses stored answers back without needing the definitions', () => {
    const parsed = parseItem({ title: 'Western Isles', fields: { nights: 7, escorted: true } });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.item.fields).toEqual({ nights: 7, escorted: true });
  });

  it('an entry written before fields existed parses to an empty bag', () => {
    const parsed = parseItem({ title: 'An old post' });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.item.fields).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// The screen, read as source: this runner has no JSX, by the deliberate choice
// in vitest.config.ts, so the schema editor is checked the way the schedule
// control next door in collections.test.ts is.
// ---------------------------------------------------------------------------

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

// ---------------------------------------------------------------------------
// The entry's own page, and the site search
// ---------------------------------------------------------------------------

describe('an entry shows its own facts', () => {
  const route = read('app', 'site', '[host]', '[[...path]]', 'page.tsx');

  it('reads the schema back with the entry, from the join already there', () => {
    const db = read('lib', 'db', 'collections.ts');
    const start = db.indexOf('export async function getPublishedItem');
    const fn = db.slice(start, db.indexOf('\nexport ', start + 10));
    expect(fn).toContain('select i.data, i.published_at, c.fields');
    expect(fn).toContain('fields: parseFieldDefs(asObject(row.fields))');
    /*
     * ONE QUERY, which is the actual claim. This used to assert against the
     * first 900 characters of the function, which broke the moment a comment
     * grew and said nothing about whether a second read had crept in. Counting
     * the queries pins what the test is for.
     */
    expect(fn.match(/await tx`/g) ?? []).toHaveLength(1);
  });

  it('shows ALL of them, unlike a card, which shows the first few', () => {
    // No limit argument: a card is a glance, this is the page somebody opened
    // to find these out.
    expect(route).toContain('const facts = fieldFacts(entry.fields, item.fields);');
  });

  it('puts them above the picture, where the decision is made', () => {
    const head = route.slice(route.indexOf('tgs-entry__summary'), route.indexOf('tgs-entry__image'));
    expect(head).toContain('tgs-entry__facts');
    expect(head.indexOf('tgs-entry__facts')).toBeLessThan(head.indexOf('tgs-entry__tags'));
  });

  it('as a definition list, the same as the card', () => {
    expect(route).toContain('<dl className="tgs-entry__facts">');
    expect(route).toContain('<dt>{fact.label}</dt>');
    expect(route).toContain('<dd>{fact.value}</dd>');
  });

  it('ruled off, in the data typeface, following the dark palette', () => {
    const css = read('app', 'globals.css');
    const rule = css.slice(css.indexOf('.tgs-entry__facts {'), css.indexOf('.tgs-entry__fact dt'));
    // The theme's own border token rather than a hard-coded grey, so the rule
    // is visible on a dark site as well as a light one.
    expect(rule).toContain('border-top: 1px solid var(--tgs-border)');
    const value = css.slice(css.indexOf('.tgs-entry__fact dd {'));
    expect(value.slice(0, 400)).toContain('font-family: var(--tgs-font-data, inherit)');
    expect(value.slice(0, 400)).toContain('font-variant-numeric: tabular-nums');
  });
});

describe('the site search can find an entry by its facts', () => {
  const db = read('lib', 'db', 'collections.ts');
  const fn = db.slice(db.indexOf('export async function listPublishedItemsForSearch'));

  it('indexes both the label and the value', () => {
    // People search either way: "half board" is the value, "board basis" is
    // close to the label, and one should find a tour that answers the other.
    expect(fn).toContain('`${fact.label} ${fact.value}`');
  });

  it('parses each collections schema once, not once per entry', () => {
    // Five hundred rows share a handful of schemas. Parsing per row would be
    // the same work five hundred times.
    expect(fn).toContain('const schemas = new Map<string, FieldDef[]>()');
    expect(fn).toContain('if (!schemas.has(key)) schemas.set(key, parseFieldDefs(asObject(row.fields)))');
  });

  it('puts them after the prose, so a result still shows a sentence', () => {
    expect(fn).toContain('const extras = [item.author, ...item.tags, declared]');
  });

  it('still has no status filter, because the policy is what hides a draft', () => {
    expect(fn).not.toContain("status = 'published'");
    expect(fn).toContain('withPublicTenant');
  });
});

// ---------------------------------------------------------------------------
// The card: what a listing block actually shows
// ---------------------------------------------------------------------------

describe('a collections facts on its cards', () => {
  const defs = [
    def({ key: 'price', label: 'Price from', kind: 'price', prefix: '£' }),
    def({ key: 'nights', label: 'Nights', suffix: 'nights' }),
    def({ key: 'board', label: 'Board', kind: 'choice', choices: ['Half board'] }),
  ];

  const tour = () => ({
    ...emptyItem(),
    title: 'The Western Isles',
    fields: { price: 1299, nights: 7, board: 'Half board' },
  });

  it('a blog card is exactly what it always was', () => {
    // No declared fields, so no facts, and nothing else about the card moves.
    const card = itemAsCard({ ...emptyItem(), title: 'A post' }, 'blog', 'a-post');
    expect(card.facts).toEqual([]);
    expect(card.title).toBe('A post');
    expect(card.linkHref).toBe('/blog/a-post');
  });

  it('a tour card carries its facts, formatted and in order', () => {
    const card = itemAsCard(tour(), 'tours', 'western-isles', defs);
    expect(card.facts).toEqual([
      { key: 'price', label: 'Price from', value: '£1,299', kind: 'price' },
      { key: 'nights', label: 'Nights', value: '7 nights', kind: 'number' },
      { key: 'board', label: 'Board', value: 'Half board', kind: 'choice' },
    ]);
  });

  /*
   * The whole list travels on the card and each block trims it, so a page with
   * a four-fact grid and a two-fact one is still ONE read of the collection.
   * That is the promise at the top of lib/content/listings.ts, and this is the
   * part of it a facts count could quietly have broken.
   */
  it('each block trims to its own count from one shared read', () => {
    const grid = (facts: number) => ({
      ...createSection('one'),
      rows: [
        {
          ...createSection('one').rows[0],
          columns: [
            {
              ...createSection('one').rows[0].columns[0],
              blocks: [
                {
                  id: `b-${facts}`,
                  type: 'cards',
                  props: {
                    ...defaultPropsFor('cards'),
                    source: 'collection',
                    collection: 'tours',
                    count: 6,
                    facts,
                  },
                },
              ],
            },
          ],
        },
      ],
    });

    const tree = { sections: [grid(1), grid(3)] };
    const card = itemAsCard(tour(), 'tours', 'western-isles', defs);
    // Keyed by the whole request now, not by the collection's name, because two
    // blocks narrowing one collection differently are two answers (#238).
    const key = listingKey({ collection: 'tours', count: 0, facts: 0, filter: null, sort: null });
    const filled = fillListings(tree, new Map([[key, [card]]]));

    const factsOn = (index: number) => {
      const props = filled.sections[index].rows[0].columns[0].blocks[0].props as Record<string, unknown>;
      const items = props.items as Array<Record<string, unknown>>;
      return items[0].facts as unknown[];
    };

    expect(factsOn(0)).toHaveLength(1);
    expect(factsOn(1)).toHaveLength(3);
  });

  it('asks the database for the most facts any block on the page wanted', () => {
    const request = listingIn({
      type: 'cards',
      props: { source: 'collection', collection: 'tours', count: 6, facts: 9 },
    });
    // Clamped: past four a card is a spec sheet.
    expect(request?.facts).toBe(4);
    expect(listingIn({ type: 'cards', props: { source: 'collection', collection: 'tours' } })?.facts)
      .toBe(2);
  });

  it('renders the facts as a definition list, label and value', () => {
    const blocks = read('components', 'render', 'blocks.tsx');
    expect(blocks).toContain('<dl className="tgs-card__facts">');
    expect(blocks).toContain('<dt>{fact.label}</dt>');
    expect(blocks).toContain('<dd>{fact.value}</dd>');
  });

  it('a typed-in card cannot put anything but strings on the page', () => {
    const blocks = read('components', 'render', 'blocks.tsx');
    // Same defensive read the tags prop gets: both halves must be strings.
    expect(blocks).toContain("typeof (fact as { value?: unknown }).value === 'string'");
    expect(blocks).toContain("typeof (fact as { label?: unknown }).label === 'string'");
  });

  it('sets the value in the data typeface, with figures that line up', () => {
    const css = read('app', 'globals.css');
    const rule = css.slice(css.indexOf('.tgs-card__fact dd {'));
    expect(rule.slice(0, 300)).toContain('font-family: var(--tgs-font-data, inherit)');
    expect(rule.slice(0, 300)).toContain('font-variant-numeric: tabular-nums');
  });
});


describe('the fields editor on the collections screen', () => {
  const dash = read('components', 'collections', 'CollectionsDashboard.tsx');

  it('opens from the collection bar, labelled with the count', () => {
    expect(dash).toContain("setDialog({ kind: 'fields', collection: { ...open, fields } })");
    expect(dash).toContain("? 'Add fields'");
  });

  it('mints a key only for a field that has never had one', () => {
    expect(dash).toContain('if (row.key) return { ...row, label: row.label.trim() }');
    expect(dash).toContain('const key = mintFieldKey(row.label, taken)');
  });

  it('says plainly that deleting a field keeps the answers', () => {
    expect(dash).toContain('stays put and comes back if you add');
  });

  it('will not save a choice field with nothing to choose from', () => {
    expect(dash).toContain("row.kind === 'choice' && row.choices.length === 0");
  });

  it('offers the starters when a collection is made, not a blank designer', () => {
    expect(dash).toContain('FIELD_PRESETS.map');
    expect(dash).toContain('fields: presetFields');
  });

  it('routes the save through the action that revalidates the preview tree', () => {
    expect(dash).toContain('updateCollectionFieldsAction(collectionId, next)');
    const actions = read('app', 'actions', 'collections.ts');
    const fn = actions.slice(actions.indexOf('export async function updateCollectionFieldsAction'));
    expect(fn).toContain("revalidatePath('/preview', 'layout')");
  });

  it('draws one control per definition in the entry editor', () => {
    const props = read('components', 'editor', 'Properties.tsx');
    expect(props).toContain('function DeclaredFields');
    expect(props).toContain('defs.map((def)');
    // Keyed by the definition's key, which is what makes a rename free.
    expect(props).toContain('const value = values[def.key]');
    expect(props).toContain('if (defs.length === 0) return null');
  });

  it('prompts for a required field rather than refusing the save', () => {
    const props = read('components', 'editor', 'Properties.tsx');
    expect(props).toContain('missingRequired(defs, values)');
    expect(props).toContain('Asked for before publishing.');
    // Nothing here throws or blocks: a draft is allowed to be half written.
    expect(props).not.toContain('cannot publish until');
  });

  it('has a readable colour for that prompt in both themes', () => {
    const css = read('components', 'editor', 'editor.css');
    expect(css).toContain(".ed-help[data-tone='warn'] { color: var(--ed-warn); }");
    // Once for light and once for each dark block, so it is never undefined.
    expect(css.match(/--ed-warn:/g)).toHaveLength(3);
  });

  it('reaches the editor from the entry read, not from the browser', () => {
    const page = read('app', 'editor', 'page.tsx');
    expect(page).toContain('itemFields={found.collectionFields}');
  });

  it('has styles of its own for the rows and the starter picker', () => {
    const css = read('components', 'sites', 'sites.css');
    expect(css).toContain('.sv-fieldrow');
    expect(css).toContain('.sv-choice[data-on=');
    // A select and a textarea are new to these dialogs, so they need the same
    // treatment the inputs have or they read as a different form.
    expect(css).toContain('.sv-field textarea');
  });
});
