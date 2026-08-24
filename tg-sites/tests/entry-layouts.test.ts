/**
 * How a collection's published entries are laid out.
 *
 * A published entry had exactly one look from the day the blog shipped, which
 * is a good article page and a poor product page. This is the choice, and the
 * invariants that keep the other two from quietly becoming the first.
 *
 * WHAT IS MEASURED ELSEWHERE. The hero puts words on a photograph, and contrast
 * over an unknown picture cannot be asserted from source. It was measured in a
 * browser against a worst-case image and the numbers are in the commit; what
 * this file holds is the structure that produced them.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ENTRY_LAYOUTS,
  ENTRY_LAYOUT_LABEL,
  parseEntryLayout,
} from '../lib/content/collection-layout';

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}
/* Strip comments before asserting on source: this repo has been caught by a
   grep matching the comment that explains the thing rather than the thing. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const css = read('app', 'globals.css');

describe('parseEntryLayout', () => {
  it('reads the three back', () => {
    for (const layout of ENTRY_LAYOUTS) expect(parseEntryLayout(layout)).toBe(layout);
  });

  /*
   * The whole reason migration 0026 could default the column to '' and backfill
   * nothing: an empty value, and any value a newer deploy invents, is the look
   * every published site already has.
   */
  it('is the standard layout for anything it has not heard of', () => {
    expect(parseEntryLayout('')).toBe('standard');
    expect(parseEntryLayout(null)).toBe('standard');
    expect(parseEntryLayout(undefined)).toBe('standard');
    expect(parseEntryLayout('something-a-newer-deploy-wrote')).toBe('standard');
    expect(parseEntryLayout(7)).toBe('standard');
  });

  it('names each one in words a client would use', () => {
    expect(ENTRY_LAYOUT_LABEL.standard).toBe('Standard');
    expect(ENTRY_LAYOUT_LABEL.hero).toBe('Picture first');
  });
});

describe('the column it lives in', () => {
  const migration = read('db', 'migrations', '0026_collection_layout.sql');

  it('is additive with a default, so nothing needs backfilling', () => {
    expect(migration).toContain('add column if not exists layout text not null default');
  });

  it('adds no policy, because the table already has its own', () => {
    // collections got its row level security in 0004 and a new column inherits
    // it. A grant here would imply column-level security this schema never uses.
    expect(migration.toLowerCase()).not.toContain('create policy');
    expect(migration.toLowerCase()).not.toContain('grant ');
  });

  it('is read on the same join the facts already ride, not a second query', () => {
    const db = code(read('lib', 'db', 'collections.ts'));
    expect(db).toContain('select i.data, i.published_at, c.fields, c.layout');
    expect(db).toContain('layout: parseEntryLayout(row.layout)');
  });
});

describe('the three layouts', () => {
  const route = code(read('app', 'site', '[host]', '[[...path]]', 'page.tsx'));

  it('are one attribute on one article, not three components', () => {
    expect(route).toContain('data-layout={entry.layout}');
    // One entry component. A second per layout is how two of them drift apart.
    expect(route.match(/className="tgs-page tgs-entry"/g)).toHaveLength(1);
  });

  it('leave the standard layout without a selector of its own', () => {
    // Standard IS the base rules. A collection that never chose gets them.
    expect(css).not.toContain("[data-layout='standard']");
  });

  it('hold the centred measure in characters, not pixels', () => {
    // What makes a line hard to read is how many words are on it, so a client
    // who set a larger body size must not also get a longer line.
    const rule = css.slice(css.indexOf(".tgs-entry[data-layout='centred'] .tgs-entry__head {"));
    expect(rule.slice(0, 200)).toContain('max-width: 68ch');
  });

  it('move the hero picture with order, never in the markup', () => {
    // A picture that moves up the page visually must not move up the article:
    // the document order is what a screen reader and a crawler read.
    const rule = css.slice(css.indexOf(".tgs-entry[data-layout='hero'] .tgs-entry__image {"));
    expect(rule.slice(0, 260)).toContain('order: -1');
  });

  /*
   * The one a render caught and the first contrast probe did not: the date takes
   * the brand colour, a brand is usually dark, and a navy date on a dark
   * photograph is unreadable. Every token the header re-points has to include it.
   */
  it('re-point the brand colour inside the hero header, not just the text ones', () => {
    const from = css.indexOf(".tgs-entry[data-layout='hero'] .tgs-entry__head {\n  color:");
    const rule = css.slice(from, css.indexOf('\n}', from));
    expect(rule).toContain('--tgs-text: var(--tgs-text-invert)');
    expect(rule).toContain('--tgs-primary: var(--tgs-text-invert)');
  });

  /*
   * A date above a heading is the eyebrow the craft floor bans. The standard
   * layout has carried one since the blog shipped and that is not this change's
   * business, but a layout designed now does not get to reproduce it. It also
   * measured 3.16:1 up there, where the scrim is lightest.
   */
  it('open the hero with the title and put the date under it', () => {
    expect(css).toContain(".tgs-entry[data-layout='hero'] .tgs-entry__title { order: 0; }");
    expect(css).toContain(".tgs-entry[data-layout='hero'] .tgs-entry__date { order: 1;");
  });

  it('give an entry with no picture a band rather than a grey slab', () => {
    expect(css).toContain(":not(:has(.tgs-entry__image))");
  });
});

describe('choosing it', () => {
  const dash = code(read('components', 'collections', 'CollectionsDashboard.tsx'));

  it('is a segmented control on the collection, beside its address', () => {
    expect(dash).toContain('ENTRY_LAYOUTS.map((option)');
    expect(dash).toContain("aria-pressed={option === layout}");
  });

  it('moves at once and puts itself back if the save fails', () => {
    expect(dash).toContain('setLayout(next);');
    expect(dash).toContain("setLayout(open?.layout ?? 'standard');");
  });

  it('routes through the action that refreshes every entry in the collection', () => {
    expect(dash).toContain('updateCollectionLayoutAction(collectionId, next)');
    const actions = read('app', 'actions', 'collections.ts');
    const fn = actions.slice(actions.indexOf('export async function updateCollectionLayoutAction'));
    expect(fn).toContain("revalidatePath('/preview', 'layout')");
  });
});
