/**
 * Adopting a destination: what the client gets, and what cannot reach them.
 *
 * The seed is built from prose that arrived over the network from another
 * deployment, out of a base that is edited by hand. So half of these ask the
 * ordinary question, does the draft come out sensible, and half ask the hostile
 * one, can anything in that text act once it is on a client's page.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { proseToHtml, seedItemFromCorpus } from '../lib/content/adopt';
import { CollectionItemSchema } from '../lib/content/collection';

const GREECE = {
  name: 'Santorini',
  prose: {
    tagline: 'A flooded volcano you can have dinner on.',
    heroIntro: 'Whitewashed towns on a cliff edge.',
    overview: 'The caldera is what everyone comes for.\n\nThe east coast is where the beaches are.',
  },
};

describe('corpus prose becomes inert markup', () => {
  it('escapes anything that looks like a tag, because this text is not markup', () => {
    const html = proseToHtml('Sun & Sand <script>alert(1)</script> resort');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    // The ampersand is a word, not an entity waiting to happen.
    expect(html).toContain('Sun &amp; Sand');
  });

  it('escapes quotes and angle brackets that would break out of an attribute', () => {
    const html = proseToHtml('The "best" time is 5 > 4');
    expect(html).not.toMatch(/[^&]"/);
    expect(html).toContain('&gt;');
  });

  it('splits paragraphs on a blank line', () => {
    expect(proseToHtml('One.\n\nTwo.')).toBe('<p>One.</p><p>Two.</p>');
  });

  it('treats a single newline as a soft wrap rather than a new paragraph', () => {
    expect(proseToHtml('One\nstill one.')).toBe('<p>One still one.</p>');
  });

  it('answers empty for nothing, rather than an empty paragraph nobody asked for', () => {
    expect(proseToHtml('')).toBe('');
    expect(proseToHtml('   \n\n  ')).toBe('');
    expect(proseToHtml(null)).toBe('');
    expect(proseToHtml(42)).toBe('');
  });
});

describe('the seed a client starts from', () => {
  it('takes its title and summary from the corpus', () => {
    const item = seedItemFromCorpus(GREECE);
    expect(item.title).toBe('Santorini');
    expect(item.summary).toBe('A flooded volcano you can have dinner on.');
  });

  it('puts the hero intro and the overview into the body, in that order', () => {
    const item = seedItemFromCorpus(GREECE);
    const blocks = item.sections[0].rows[0].columns[0].blocks;
    expect(blocks).toHaveLength(2);
    expect(String(blocks[0].props.html)).toContain('Whitewashed towns');
    expect(String(blocks[1].props.html)).toContain('The caldera');
  });

  it('draws no heading block, because the page already prints the title', () => {
    const item = seedItemFromCorpus(GREECE);
    const types = item.sections.flatMap((s) => s.rows.flatMap((r) => r.columns.flatMap((c) => c.blocks))).map((b) => b.type);
    expect(types).not.toContain('heading');
  });

  it('still makes a usable item when the corpus holds no prose at all', () => {
    /*
     * Airports are the real case: the corpus carries no overview for one, so
     * adoption has to produce a page with a title and a facts panel rather than
     * something that looks broken in the editor.
     */
    const item = seedItemFromCorpus({ name: 'Dalaman' });
    expect(item.title).toBe('Dalaman');
    expect(item.summary).toBe('');
    expect(item.sections).toEqual([]);
  });

  it('never produces an untitled item from a blank name', () => {
    expect(seedItemFromCorpus({ name: '   ' }).title).toBe('Untitled');
  });

  it('holds the title and summary inside what the schema will accept', () => {
    const item = seedItemFromCorpus({
      name: 'x'.repeat(500),
      prose: { tagline: 'y'.repeat(900) },
    });
    expect(item.title).toHaveLength(200);
    expect(item.summary).toHaveLength(400);
  });

  it('SURVIVES THE PARSE THAT SAVES IT, which is the whole reason 0029 exists', () => {
    /*
     * The seed is written straight into the data column, and every later save
     * runs it back through this schema. A seed that did not round-trip cleanly
     * would be a page that changed the first time its owner touched it. This is
     * the cheap check that it does.
     */
    const item = seedItemFromCorpus(GREECE);
    const parsed = CollectionItemSchema.parse(item);
    expect(parsed.title).toBe('Santorini');
    expect(parsed.summary).toBe(item.summary);
    expect(parsed.sections).toHaveLength(1);
  });
});

describe('the wiring the renderer depends on', () => {
  const route = readFileSync(
    resolve(__dirname, '..', 'app', 'site', '[host]', '[[...path]]', 'page.tsx'),
    'utf8',
  );
  const collections = readFileSync(resolve(__dirname, '..', 'lib', 'db', 'collections.ts'), 'utf8');

  it('reads the facts off the join, never out of the client field bag', () => {
    /*
     * The first version called referenceFacts(item.fields), which is the
     * client's answers to their own collection's questions. It would have found
     * nothing there however many destinations were adopted, and the panel would
     * simply never have appeared.
     */
    expect(route).not.toContain('referenceFacts(item.fields)');
    expect(route).toContain('entry.reference');
  });

  it('joins the corpus with a LEFT join, so ordinary posts keep being served', () => {
    const start = collections.indexOf('export async function getPublishedItem');
    const fn = collections.slice(start, collections.indexOf('\nexport ', start + 10));
    const joins = fn.match(/\b(left join|join)\s+public\.reference_records/g) ?? [];
    // An inner join here would have stopped serving every blog post on every site.
    expect(joins).toEqual(['left join public.reference_records']);
  });

  it('validates the joined payload rather than trusting what the sync wrote', () => {
    const fn = collections.slice(collections.indexOf('export async function getPublishedItem'));
    expect(fn).toContain('referenceFacts(row.reference_facts)');
  });
});

describe('the picker', () => {
  const dialog = readFileSync(
    resolve(__dirname, '..', 'components', 'collections', 'AdoptDialog.tsx'),
    'utf8',
  );
  const actions = readFileSync(resolve(__dirname, '..', 'app', 'actions', 'collections.ts'), 'utf8');

  it('takes focus once on mount and never on a re-render', () => {
    /*
     * The rule in CLAUDE.md, and the bug behind it: a focus call that runs on
     * every render steals the cursor out of the box being typed into, one
     * letter at a time. The effect that focuses must have an empty dependency
     * list, which is what makes it a mount effect rather than a render effect.
     */
    const focus = dialog.slice(dialog.indexOf('box.current?.focus()'));
    expect(focus.slice(0, 40)).toContain('}, []);');
    expect(dialog.match(/\.focus\(\)/g) ?? []).toHaveLength(1);
  });

  it('throws away an answer that arrives after a newer request', () => {
    // Typing "por" then "porto" must not end up showing the results for "por".
    expect(dialog).toContain('if (latest.current !== ticket) return;');
  });

  it('shows what is already added rather than hiding it', () => {
    /*
     * A client who searches for Santorini and cannot see it will reasonably
     * conclude we do not have it, and write one by hand. That duplication is
     * the thing adoption exists to prevent.
     */
    expect(dialog).toContain('Added');
    expect(dialog).toContain('entry.adopted');
  });

  it('disables only the row being adopted, not the whole list', () => {
    expect(dialog).toContain("adopting === entry.sourceId ? 'Adding' : 'Add'");
  });

  it('narrows the kind on the server rather than trusting the browser', () => {
    const fn = actions.slice(actions.indexOf('export async function listAdoptableAction'));
    expect(fn.slice(0, 900)).toContain('REFERENCE_KINDS as readonly string[]).includes');
  });

  it('guards both actions with the same capability creating an entry needs', () => {
    for (const name of ['listAdoptableAction', 'adoptDestinationAction']) {
      const fn = actions.slice(actions.indexOf(`export async function ${name}`));
      expect(fn.slice(0, 900), name).toContain("requireEitherCapability('collections', 'blog')");
    }
  });
});
