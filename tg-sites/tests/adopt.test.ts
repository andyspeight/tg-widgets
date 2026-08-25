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

import { altFromCredit, proseToHtml, seedItemFromCorpus } from '../lib/content/adopt';
import { CollectionItemSchema } from '../lib/content/collection';

const GREECE = {
  name: 'Santorini',
  prose: {
    tagline: 'A flooded volcano you can have dinner on.',
    heroIntro: 'Whitewashed towns on a cliff edge.',
    overview: 'The caldera is what everyone comes for.\n\nThe east coast is where the beaches are.',
    images: ['https://images.unsplash.com/one', 'https://images.unsplash.com/two', 'https://images.unsplash.com/three'],
    credits: [
      'Photo by A on Unsplash (https://unsplash.com/photos/a-white-church-above-a-blue-sea-G8T7njOVE6Y)',
      'Photo by B on Unsplash (https://unsplash.com/photos/a-boat-in-a-caldera-uW_84e6O_eA)',
      'Photo by C on Unsplash (https://unsplash.com/photos/steps-down-to-the-water-sykAvzRvHIg)',
    ],
    highlights: [
      { icon: 'mountain', title: 'The caldera rim', description: 'Three hundred metres straight down.' },
      { icon: 'wine', title: 'Assyrtiko', description: 'Vines coiled into baskets against the wind.' },
      { icon: 'nonsense', title: 'Akrotiri', description: 'A bronze age town under the ash.' },
    ],
    events: [
      { month: 'Jul-Aug', name: 'Arts Factory', description: 'Concerts in a converted tomato factory.' },
    ],
    thingsToDo: ['Walk the caldera path', 'Eat at Metaxi Mas'],
  },
  facts: { lat: 36.3932, lng: 25.4615 },
};

/** Every block on the page, in document order. */
function blocksOf(item: { sections: Array<{ rows: Array<{ columns: Array<{ blocks: unknown[] }> }> }> }) {
  return item.sections.flatMap((s) => s.rows.flatMap((r) => r.columns.flatMap((c) => c.blocks))) as Array<
    { type: string; props: Record<string, unknown> }
  >;
}

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

  it('opens with the hero intro then the overview, in that order', () => {
    const item = seedItemFromCorpus(GREECE);
    const blocks = item.sections[0].rows[0].columns[0].blocks;
    expect(blocks).toHaveLength(2);
    expect(String(blocks[0].props.html)).toContain('Whitewashed towns');
    expect(String(blocks[1].props.html)).toContain('The caldera');
  });

  it('gives the opening no heading, because the banner already prints the title', () => {
    /*
     * The page has headings further down and should: "Where it is" and "Worth
     * doing" are section titles doing real work. What it must never do is print
     * the place name twice, once in the banner and again over the first
     * paragraph, which is what the old two-block seed would have needed.
     */
    const item = seedItemFromCorpus(GREECE);
    const opening = item.sections[0].rows[0].columns[0].blocks;
    expect(opening.map((b) => b.type)).not.toContain('heading');

    const headings = blocksOf(item).filter((b) => b.type === 'heading');
    expect(headings.length).toBeGreaterThan(0);
    for (const h of headings) expect(String(h.props.html)).not.toBe('Santorini');
  });

  it('still builds a page when the corpus holds no prose at all', () => {
    /*
     * Airports are the real case: the corpus carries no overview, no pictures
     * and no highlights for one. That must still come out as a page somebody
     * could publish, which means the map and the way to get in touch, not an
     * empty item that looks broken in the editor.
     */
    const item = seedItemFromCorpus({ name: 'Dalaman', facts: { lat: 36.7131, lng: 28.7925 } });
    expect(item.title).toBe('Dalaman');
    expect(item.summary).toBe('');
    expect(item.image).toBe('');

    const types = blocksOf(item).map((b) => b.type);
    expect(types).toContain('map');
    expect(types).toContain('button-group');
    // And nothing that would have drawn a heading over emptiness.
    expect(types).not.toContain('cards');
    expect(types).not.toContain('list');
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
    // Every band survives, not just the first: a section the schema rejected
    // would be dropped silently and the page would come out short.
    expect(parsed.sections).toHaveLength(item.sections.length);
    expect(blocksOf(parsed).length).toBe(blocksOf(item).length);
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

describe('the magazine page it builds', () => {
  const item = seedItemFromCorpus(GREECE);
  const blocks = blocksOf(item);
  const find = (type: string) => blocks.filter((b) => b.type === type);

  it('takes the first picture as the banner and the rest into the page', () => {
    expect(item.image).toBe('https://images.unsplash.com/one');
    const backgrounds = item.sections.map((s) => (s as { backgroundImage?: string }).backgroundImage).filter(Boolean);
    expect(backgrounds).toContain('https://images.unsplash.com/two');
    expect(find('image').map((b) => b.props.src)).toContain('https://images.unsplash.com/three');
  });

  it('writes real alt text out of the credit rather than the place name', () => {
    /*
     * "Santorini" as alt on a photograph of Santorini tells a screen reader
     * nothing the heading has not already said. The credit's Unsplash slug is a
     * description somebody actually wrote.
     */
    expect(item.alt).toBe('A white church above a blue sea');
    expect(find('image')[0].props.alt).toBe('Steps down to the water');
  });

  it('falls back to the place name when a credit carries no description', () => {
    expect(altFromCredit('Photo by Someone', 'Hvar')).toBe('Hvar');
    expect(altFromCredit(undefined, 'Hvar')).toBe('Hvar');
    // And drops the opaque id on the end rather than reading it out.
    expect(altFromCredit('https://unsplash.com/photos/a-boat-in-a-caldera-uW_84e6O_eA', 'x'))
      .toBe('A boat in a caldera');
  });

  it('drops an id that arrives in more than one part', () => {
    /*
     * Caught on the real Dalmatian Islands banner. The id "Ch-odXM4SCg" carries
     * a hyphen, so it splits into two parts and a single pop left the alt text
     * reading "...during daytime Ch".
     */
    expect(altFromCredit(
      'https://unsplash.com/photos/aerial-view-of-city-near-body-of-water-during-daytime-Ch-odXM4SCg',
      'x',
    )).toBe('Aerial view of city near body of water during daytime');
  });

  it('maps the corpus icon vocabulary onto the one tg-sites can actually draw', () => {
    /*
     * The corpus says "mountain" and "wine"; tg-sites draws "mountain-snow" and
     * "wine". An unmapped name is not an error, it is a blank space where an
     * icon should be, so an unknown one has to land somewhere real.
     */
    const icons = (find('cards')[0].props.items as Array<{ icon: string }>).map((i) => i.icon);
    expect(icons).toEqual(['mountain-snow', 'wine', 'map-pin']);
  });

  it('sets the highlights two across, never three', () => {
    // Three equal cards is the first entry on this client's anti-reference list,
    // and five highlights in threes leaves a widowed row of two either way.
    expect(find('cards')[0].props.columns).toBe('2');
  });

  it('never asks the cards block to lead with nothing, which it cannot do', () => {
    /*
     * `lead` takes 'image' or 'icon' and there is no third value. An earlier
     * version passed 'none' for the events grid and got three cards each with an
     * empty picture frame on top. Every cards block here leads with icons it has.
     */
    for (const card of find('cards')) {
      expect(card.props.lead).toBe('icon');
      for (const entry of card.props.items as Array<{ icon: string }>) {
        expect(entry.icon).toBeTruthy();
      }
    }
  });

  it('leads each event with its month, and never in a table', () => {
    /*
     * A table was tried and the render killed it: the corpus descriptions run
     * past two hundred characters, the table correctly refuses to squash, and
     * the band scrolled sideways. A month, a name and a paragraph is a list.
     */
    expect(find('table')).toHaveLength(0);
    const items = find('icon-item');
    expect(items).toHaveLength(1);
    expect(items[0].props.title).toBe('Jul-Aug \u00b7 Arts Factory');
    expect(items[0].props.body).toContain('tomato factory');
    expect(items[0].props.icon).toBe('calendar-check');
  });

  it('pins the map on the place and captions it with the coordinates', () => {
    const map = find('map')[0];
    expect(map.props.address).toBe('Santorini');
    expect(map.props.caption).toBe('36.3932° N, 25.4615° E');
  });

  it('leaves the map uncaptioned rather than guessing when there is no position', () => {
    const nowhere = seedItemFromCorpus({ name: 'Santorini', prose: GREECE.prose });
    expect(blocksOf(nowhere).filter((b) => b.type === 'map')[0].props.caption).toBe('');
  });

  it('gets the hemispheres right, which a sign alone would not', () => {
    const south = seedItemFromCorpus({ name: 'Queenstown', facts: { lat: -45.0312, lng: 168.6626 } });
    expect(blocksOf(south).filter((b) => b.type === 'map')[0].props.caption)
      .toBe('45.0312° S, 168.6626° E');
  });

  it('moves the water and nothing else', () => {
    /*
     * The client's world: the water moves, the type does not chase it. Ken Burns
     * belongs to the one full-bleed photograph and to nothing that holds words.
     */
    const moving = item.sections.filter((s) => (s as { kenBurns?: boolean }).kenBurns);
    expect(moving).toHaveLength(1);
    expect((moving[0] as { backgroundImage?: string }).backgroundImage).toBe('https://images.unsplash.com/two');
    expect(moving[0].rows.flatMap((r) => r.columns.flatMap((c) => c.blocks))).toHaveLength(0);
  });

  it('bands the page rather than running it on one ground', () => {
    const tones = item.sections.map((s) => (s as { tone?: string }).tone);
    expect(new Set(tones).size).toBeGreaterThan(1);
    // And it closes on the dark ground the rest of the site closes on.
    expect(tones[tones.length - 1]).toBe('dark');
  });

  it('names the destination in the button rather than saying "enquire"', () => {
    const buttons = find('button-group')[0].props.buttons as Array<{ label: string; href: string }>;
    expect(buttons).toHaveLength(1);
    expect(buttons[0].label).toBe('Enquire about Santorini');
    expect(buttons[0].href).toBe('/contact');
  });

  it('numbers the things to do, because the corpus ranks them', () => {
    const list = find('list')[0];
    expect(list.props.style).toBe('number');
    expect((list.props.items as Array<{ text: string }>).map((i) => i.text))
      .toEqual(['Walk the caldera path', 'Eat at Metaxi Mas']);
  });

  it('escapes a hostile place name everywhere it puts it', () => {
    const nasty = seedItemFromCorpus({ name: '<img src=x onerror=alert(1)>', facts: { lat: 1, lng: 1 } });
    const headings = blocksOf(nasty).filter((b) => b.type === 'heading');
    for (const h of headings) expect(String(h.props.html)).not.toContain('<img');
    expect(headings.some((h) => String(h.props.html).includes('&lt;img'))).toBe(true);
  });
});
