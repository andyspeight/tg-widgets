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
import {
  cleanFieldValues,
  FIELD_KINDS,
  FIELD_PRESETS,
  missingRequired,
  mintFieldKey,
  parseFieldDefs,
  toursPresetFields,
  type FieldDef,
} from '../lib/content/collection-fields';

function def(over: Partial<FieldDef> = {}): FieldDef {
  return { key: 'nights', label: 'Nights', kind: 'number', required: false, choices: [], ...over };
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
