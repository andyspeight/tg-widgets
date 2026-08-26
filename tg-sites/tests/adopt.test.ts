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

import { proseToHtml, seedItemFromCorpus, shortName } from '../lib/content/adopt';
import { CollectionItemSchema } from '../lib/content/collection';
import { carriesOwnBanner } from '../lib/content/collection-layout';
import { itemAsCard } from '../lib/content/listings';

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

/** The item alone. The plan is asserted separately, further down. */
const seed = (input: Parameters<typeof seedItemFromCorpus>[0]) => seedItemFromCorpus(input).item;

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
    const item = seed(GREECE);
    expect(item.title).toBe('Santorini');
    expect(item.summary).toBe('A flooded volcano you can have dinner on.');
  });

  it('opens with the hero intro then the overview, in that order', () => {
    const item = seed(GREECE);
    // [0] is the banner; the words start in the band after it.
    const blocks = item.sections[1].rows[0].columns[0].blocks;
    expect(blocks).toHaveLength(2);
    expect(String(blocks[0].props.html)).toContain('Whitewashed towns');
    expect(String(blocks[1].props.html)).toContain('The caldera');
  });

  it('prints the place name once, in the banner, and never again', () => {
    const item = seed(GREECE);
    const opening = item.sections[1].rows[0].columns[0].blocks;
    expect(opening.map((b) => b.type)).not.toContain('heading');

    const named = blocksOf(item)
      .filter((b) => b.type === 'heading' && String(b.props.html) === 'Santorini');
    expect(named).toHaveLength(1);
    expect(named[0].props.style).toBe('h1');
  });

  it('builds the banner the way the hand-built pages build theirs', () => {
    /*
     * Matched to tools/coastwise-site.ts banner(): the trail inside it rather
     * than above the picture, an h2 set at h1 so the type matches every other
     * page, and the same scrim and height. Without this the entry drew its own
     * blog header instead: different type, a stray trail above the photograph
     * and "3 min read" on a page about an island.
     */
    const item = seed(GREECE);
    const banner = item.sections[0] as Record<string, unknown>;
    expect(banner.name).toBe('Banner');
    expect(banner.tone).toBe('dark');
    expect(banner.minHeight).toBe(420);
    expect(banner.overlay).toBe(45);

    const blocks = item.sections[0].rows[0].columns[0].blocks as Array<{ type: string; props: Record<string, unknown> }>;
    expect(blocks.map((b) => b.type)).toEqual(['breadcrumbs', 'heading', 'text']);
    expect(blocks[1].props.level).toBe('h2');
    expect(blocks[1].props.style).toBe('h1');
  });

  it('carries a trail inside the banner, which is what stands the automatic one down', () => {
    const item = seed(GREECE);
    expect(blocksOf(item).filter((b) => b.type === 'breadcrumbs')).toHaveLength(1);
  });

  it('still builds a page when the corpus holds no prose at all', () => {
    /*
     * Airports are the real case: the corpus carries no overview, no pictures
     * and no highlights for one. That must still come out as a page somebody
     * could publish, which means the map and the way to get in touch, not an
     * empty item that looks broken in the editor.
     */
    const item = seed({ name: 'Dalaman', facts: { lat: 36.7131, lng: 28.7925 } });
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
    expect(seed({ name: '   ' }).title).toBe('Untitled');
  });

  it('holds the title and summary inside what the schema will accept', () => {
    const item = seed({
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
    const item = seed(GREECE);
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
  const item = seed(GREECE);
  const blocks = blocksOf(item);
  const find = (type: string) => blocks.filter((b) => b.type === type);

  it('asks the photo library for three pictures, each with its own job', () => {
    /*
     * The slots leave here EMPTY and the importer fills them, so what this pins
     * is the plan: the banner searches the place, and the two supporting
     * pictures search real highlights the corpus already wrote about it rather
     * than a modifier bolted onto the name.
     */
    const { photos } = seedItemFromCorpus(GREECE);
    expect(photos.map((t) => t.query)).toEqual(['Santorini', 'The caldera rim', 'Assyrtiko']);
    expect(photos.map((t) => t.place.kind)).toEqual(['background', 'image', 'background']);
    // Every target points at a slot that is actually there and actually empty.
    for (const t of photos) {
      const section = item.sections[t.section] as Record<string, unknown>;
      expect(section, `no section ${t.section}`).toBeTruthy();
      if (t.place.kind === 'background') expect(section.backgroundImage).toBe('');
      else expect(find('image')[0].props.src).toBe('');
    }
  });

  it('falls back to the place name when there are no highlights to search for', () => {
    const { photos } = seedItemFromCorpus({ name: 'Dalaman', facts: { lat: 1, lng: 1 } });
    for (const t of photos) expect(t.query).toBe('Dalaman');
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
    const nowhere = seed({ name: 'Santorini', prose: GREECE.prose });
    expect(blocksOf(nowhere).filter((b) => b.type === 'map')[0].props.caption).toBe('');
  });

  it('gets the hemispheres right, which a sign alone would not', () => {
    const south = seed({ name: 'Queenstown', facts: { lat: -45.0312, lng: 168.6626 } });
    expect(blocksOf(south).filter((b) => b.type === 'map')[0].props.caption)
      .toBe('45.0312° S, 168.6626° E');
  });

  it('moves the water and nothing else', () => {
    /*
     * The client's world: the water moves, the type does not chase it. Ken Burns
     * belongs to the one full-bleed photograph and to nothing that holds words.
     */
    const moving = item.sections.filter((s) => (s as { kenBurns?: boolean }).kenBurns);
    // The banner and the full-width picture. Both photographs, neither is type.
    expect(moving.map((s) => (s as { name?: string }).name)).toEqual(['Banner', 'The wide view']);
  });

  it('bands the page rather than running it on one ground', () => {
    const tones = item.sections.map((s) => (s as { tone?: string }).tone);
    expect(new Set(tones).size).toBeGreaterThan(1);
    // Two dark bands: the banner and the full-width photograph. Both pictures.
    expect(tones.filter((t) => t === 'dark')).toHaveLength(2);
  });

  it('never puts two bands of the same ground next to each other', () => {
    /*
     * Two adjacent subtle bands is not a band, it is one taller band with a
     * heading in the middle of it, and the alternation is the whole point.
     * Caught by reading the built page rather than by looking at it: on screen
     * the two simply merged and the seam was invisible.
     *
     * A section that draws nothing is skipped when the corpus is thin, so the
     * neighbours change per record. Checking every kind of record here rather
     * than the full one only.
     */
    for (const prose of [GREECE.prose, { ...GREECE.prose, events: [] }, { ...GREECE.prose, highlights: [] },
                         { ...GREECE.prose, thingsToDo: [] }, {}]) {
      const built = seed({ name: 'X', prose, facts: { lat: 1, lng: 1 } });
      const tones = built.sections.map((s) => (s as { tone?: string }).tone);
      for (let i = 1; i < tones.length; i += 1) {
        expect(tones[i], `${tones.join(' ')} repeats at ${i}`).not.toBe(tones[i - 1]);
      }
    }
  });

  it('closes the way the rest of this kind of site closes', () => {
    /*
     * Centred, on a paper ground, with the way to book first and the way to ask
     * second. Taken from the hand-built site rather than invented: an adopted
     * page that closed differently from every other page on the same site would
     * be the tell that it was generated.
     */
    const group = find('button-group')[0];
    expect(group.props.align).toBe('centre');
    const buttons = group.props.buttons as Array<{ label: string; href: string; variant: string }>;
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toMatchObject({ label: 'Enquire about Santorini', href: '/contact', variant: 'primary' });
    expect(buttons[1]).toMatchObject({ label: 'Talk to us', variant: 'secondary' });

    const closing = item.sections[item.sections.length - 1] as { name?: string; tone?: string };
    expect(closing.name).toBe('Closing');
    expect(closing.tone).not.toBe('dark');
  });

  it('says the short name in a sentence, and keeps the full one as the title', () => {
    /*
     * The corpus NAMES a record, it does not write a sentence. "Enquire about
     * Split Old Town & Diocletian's Palace" is not a line anybody says out loud.
     */
    expect(shortName("Split Old Town & Diocletian's Palace")).toBe('Split Old Town');
    expect(shortName('Sousse & Port El Kantaoui')).toBe('Sousse');
    expect(shortName('Patagonia, Mendoza & the Andes')).toBe('Patagonia');
    expect(shortName('Dalmatian Islands')).toBe('Dalmatian Islands');
    expect(shortName('Hvar')).toBe('Hvar');

    const built = seed({ name: "Split Old Town & Diocletian's Palace", facts: { lat: 1, lng: 1 } });
    expect(built.title).toBe("Split Old Town & Diocletian's Palace");
    const cta = blocksOf(built).find((b) => b.type === 'button-group');
    expect((cta!.props.buttons as Array<{ label: string }>)[0].label).toBe('Enquire about Split Old Town');
  });

  it('never writes a heading that would need an article it cannot know about', () => {
    /*
     * "Thinking about Hvar?" reads fine. "Thinking about Dalmatian Islands?"
     * does not, and no rule can tell which corpus names take "the": it holds
     * both "The Azores" and "Dalmatian Islands" and both are correct.
     */
    for (const name of ['Hvar', 'Dalmatian Islands', 'The Azores', 'Patagonia, Mendoza & the Andes']) {
      const built = seed({ name, facts: { lat: 1, lng: 1 } });
      /*
       * The banner heading IS the place name and should be. What must never
       * happen is a SENTENCE built around it, because no rule knows which names
       * take "the".
       */
      const headings = blocksOf(built)
        .filter((b) => b.type === 'heading' && b.props.style !== 'h1')
        .map((h) => String(h.props.html));
      for (const h of headings) {
        expect(h, `${name}: "${h}"`).not.toMatch(/\b(about|to|in|at|for)\s*$/);
        expect(h, `${name}: "${h}"`).not.toContain(name);
      }
    }
  });

  it('numbers the things to do, because the corpus ranks them', () => {
    const list = find('list')[0];
    expect(list.props.style).toBe('number');
    expect((list.props.items as Array<{ text: string }>).map((i) => i.text))
      .toEqual(['Walk the caldera path', 'Eat at Metaxi Mas']);
  });

  it('never lets a hostile name reach a prop that is rendered as markup', () => {
    /*
     * The name comes from a corpus record edited by hand, so it is treated as
     * hostile. Since the call-to-action heading stopped carrying it, the name
     * reaches only the title, the summary, the map address and the button
     * label, none of which are html props: React escapes those on the way out.
     * What this pins is that it never lands in an `html` prop, which IS rendered
     * as markup and would need escaping to be safe.
     */
    const nasty = seed({
      name: '<img src=x onerror=alert(1)>',
      prose: { overview: 'A <script>alert(1)</script> place.' },
      facts: { lat: 1, lng: 1 },
    });
    for (const block of blocksOf(nasty)) {
      const html = block.props.html;
      if (typeof html !== 'string') continue;
      expect(html, `${block.type} carries raw markup`).not.toMatch(/<(img|script)\b/i);
    }
    // And the corpus prose that DOES go into html arrives inert.
    const text = blocksOf(nasty).filter((b) => b.type === 'text').map((b) => String(b.props.html)).join('');
    expect(text).toContain('&lt;script&gt;');
  });
});

describe('it matches the site it has to live on', () => {
  /*
   * The seed does not get to invent its own conventions. Coastwise was built by
   * hand in tools/coastwise-site.ts and an adopted page sits alongside those
   * pages in the same nav, so anything it does differently is the tell that it
   * was generated. These pin the conventions taken from that build rather than
   * from taste.
   */
  const item = seed(GREECE);
  const built = readFileSync(resolve(__dirname, '..', 'tools', 'coastwise-site.ts'), 'utf8');

  it('names every band, because the name is what the client sees in the editor', () => {
    /*
     * An unnamed section shows up in the editor's list as its first block's
     * summary, so a seven-band page reads as a list of half-sentences and
     * nobody can find the one they want to change. The hand-built site names
     * every one of its sections.
     */
    expect(built).toContain("name: 'Closing'");
    const names = item.sections.map((s) => (s as { name?: string }).name);
    expect(names.every((n) => typeof n === 'string' && n.length > 0), names.join(' | ')).toBe(true);
    // And no two the same, or the list is no easier to navigate than no names.
    expect(new Set(names).size).toBe(names.length);
  });

  it('reveals the bands that hold words, and not the two that are only a picture', () => {
    /*
     * A reveal on a band with no words fades in nothing, and a reveal on the
     * banner fades in the page's own title as somebody lands on it.
     */
    const still = ['Banner', 'The wide view'];
    for (const section of item.sections as Array<{ name?: string; reveal?: boolean }>) {
      expect(section.reveal, `${section.name}`).toBe(!still.includes(section.name ?? ''));
    }
  });

  it('weights a two-column row 60/40, as every such row on the site does', () => {
    const withPicture = item.sections.find((s) => s.rows[0].columns.length === 2);
    expect(withPicture, 'no two-column row was built').toBeTruthy();
    expect(withPicture!.rows[0].columns.map((c) => Math.round(c.width))).toEqual([60, 40]);
  });

  it('uses the padding token the build uses rather than a number of its own', () => {
    expect(built).toContain("paddingY: 'xl'");
    // Stored as the token; the schema resolves it. A raw number here would be a
    // second spacing vocabulary on one site.
    const raw = readFileSync(resolve(__dirname, '..', 'lib', 'content', 'adopt.ts'), 'utf8');
    expect(raw).not.toMatch(/paddingY: \d+/);
  });
});

describe('the entry header stands down for a page that opens itself', () => {
  it('recognises a banner by its h1, picture or no picture', () => {
    /*
     * The first rule here keyed off the background photograph, and Split has
     * none in the corpus: it would have kept the blog header, the stray trail
     * and the reading time on the one page least able to carry them.
     */
    const withPicture = seed(GREECE);
    const without = seed({ name: 'Split', prose: { tagline: 'A palace that became a city.' } });
    expect(carriesOwnBanner(withPicture)).toBe(true);
    expect(carriesOwnBanner(without)).toBe(true);
    // The slot is there and empty either way; the h1 is what makes it a banner.
    expect((without.sections[0] as { backgroundImage?: string }).backgroundImage).toBe('');
  });

  it('leaves an ordinary post its header', () => {
    // A blog post has no h1 in its content, so nothing takes the header's job.
    expect(carriesOwnBanner({ sections: [] })).toBe(false);
    expect(carriesOwnBanner(null)).toBe(false);
    expect(carriesOwnBanner({
      sections: [{ rows: [{ columns: [{ blocks: [{ type: 'heading', props: { style: 'h2' } }] }] }] }],
    })).toBe(false);
  });

  it('is wired into the route, not just exported', () => {
    const route = readFileSync(
      resolve(__dirname, '..', 'app', 'site', '[host]', '[[...path]]', 'page.tsx'), 'utf8');
    expect(route).toContain('carriesOwnBanner(item)');
    expect(route).toContain('{!ownBanner && (');
  });
});

describe('adoption does its slow work outside the database transaction', () => {
  const db = readFileSync(resolve(__dirname, '..', 'lib', 'db', 'reference.ts'), 'utf8');
  const fn = db.slice(db.indexOf('export async function adoptDestination'));

  it('imports the photographs between two transactions, never inside one', () => {
    /*
     * Importing makes network calls and copies files into blob storage.
     * Doing that with a transaction open holds a pooled connection for the
     * duration, and a handful of clients adopting at once is then enough to
     * exhaust the pool. The first pass answers "may this happen and what from",
     * the import runs with nothing held, and the second writes the row.
     */
    const fill = fn.indexOf('await fillPlannedPhotos(');
    expect(fill).toBeGreaterThan(-1);

    const opens = [...fn.matchAll(/withTenant\(tenantId/g)].map((m) => m.index ?? -1);
    expect(opens.length, 'expected exactly two transactions').toBe(2);
    // The import sits after the first opens and before the second does.
    expect(fill).toBeGreaterThan(opens[0]);
    expect(fill).toBeLessThan(opens[1]);
  });

  it('lifts the banner picture onto the row only once one was actually found', () => {
    // The fill is best effort, so an empty slot must not blank out the card.
    expect(fn).toContain('if (banner?.backgroundImage) seed.image = banner.backgroundImage;');
  });
});

describe('opening an adopted entry in the editor', () => {
  const db = readFileSync(resolve(__dirname, '..', 'lib', 'db', 'collections.ts'), 'utf8');

  it('qualifies the id, because getItem joins a table that has one too', () => {
    /*
     * Postgres 42702, "column reference id is ambiguous". The shared column
     * fragment opened with a bare `id` and getItem joins public.collections,
     * which has its own. Postgres refused the statement, so the editor answered
     * a 500 to anybody opening a collection entry.
     *
     * It sat there unnoticed because nothing opened an entry in the editor until
     * adopting a destination started redirecting to /editor?item=. Andy hit it
     * on the first click.
     */
    const fragment = db.slice(db.indexOf('function summary(tx: Tx)'));
    const columns = fragment.slice(fragment.indexOf('`'), fragment.indexOf('`', fragment.indexOf('`') + 1));
    expect(columns).toContain('public.collection_items.id as id');
    expect(columns).not.toMatch(/`\s*\n\s*id,/);
  });

  it('still joins the collection, which is what the entry editor needs', () => {
    const fn = db.slice(db.indexOf('export async function getItem'));
    expect(fn.slice(0, 700)).toContain('join public.collections c');
    expect(fn.slice(0, 700)).toContain('c.fields as collection_fields');
  });
});

describe('a destination card is not a blog card', () => {
  it('carries no reading time, because a guide is not an article', () => {
    /*
     * "3 min read" under a photograph of Hvar is the same blog furniture that
     * was showing above the banner until the entry header learned to stand
     * down. Somebody scanning a grid of places is not deciding how long a read
     * is; on a post they are. Same signal decides both.
     */
    const guide = seed(GREECE);
    const post = {
      ...guide,
      sections: guide.sections.slice(1), // no banner, so no h1: an ordinary post
    };
    expect(itemAsCard(guide, 'guides', 'santorini').readingMinutes).toBe(0);
    expect(itemAsCard(post as never, 'blog', 'a-post').readingMinutes).toBeGreaterThan(0);
  });

  it('still gives the card its picture, title and summary', () => {
    const card = itemAsCard(seed(GREECE), 'guides', 'santorini');
    expect(card.title).toBe('Santorini');
    expect(card.body).toBe('A flooded volcano you can have dinner on.');
  });
});

describe('the editor draws the same cards the site does', () => {
  const canvas = readFileSync(resolve(__dirname, '..', 'components', 'editor', 'Canvas.tsx'), 'utf8');
  const blocks = readFileSync(resolve(__dirname, '..', 'components', 'render', 'blocks.tsx'), 'utf8');

  it('fills a display copy, never the tree the editor saves', () => {
    /*
     * fillListings writes the cards into `props.items`. Filling the editable
     * tree would put a snapshot of today's listing into the document and the
     * next save would keep it, so the canvas fills a copy at the point it draws
     * and the document stays clean. Same arrangement the menu fill uses.
     */
    expect(canvas).toContain('const shown = useMemo(() => fillListings(page, listings');
    expect(canvas).toContain('fillNavFolders(shown, navPages)');
    // The editable state is still the unfilled page.
    expect(canvas).not.toMatch(/setPage\(\s*shown/);
  });

  it('shows the placeholder only when there is genuinely nothing', () => {
    /*
     * It used to fire for every collection grid on the canvas, so publishing a
     * destination and going to look at the page it belonged on told you nothing
     * had happened. The page was right and the editor was lying about it.
     */
    expect(blocks).toContain('if (editing && fromCollection && cards.length === 0)');
    expect(blocks).not.toContain('if (editing && fromCollection) {');
  });

  it('leaves the block itself with nothing to read', () => {
    // The same component draws the published page and the canvas. A database
    // import in there is what would end that.
    expect(blocks).not.toContain('lib/db/');
    expect(blocks).not.toContain('listPublished');
  });
});

describe('the card finishes actually do something', () => {
  const css = readFileSync(resolve(__dirname, '..', 'app', 'globals.css'), 'utf8');

  it('gives every design a rule for every finish it offers', () => {
    /*
     * Measured in a browser first: eight of the twelve combinations drew an
     * identical card, because the overlay and index designs cancelled the
     * border, the tint and the shadow outright and nothing put them back. The
     * editor still offered four choices, so the setting looked broken to
     * anybody who tried it. Andy, 26 Aug 2026: the styling options do not work
     * very well.
     */
    for (const design of ['overlay', 'index']) {
      for (const style of ['bordered', 'raised', 'tinted']) {
        expect(css, `${design}/${style}`)
          .toMatch(new RegExp(`\\[data-design='${design}'\\]\\[data-style='${style}'\\]`));
      }
    }
  });

  it('separates index rows once they each have a surface of their own', () => {
    // Touching is right for a rule-separated list and wrong for a stack of
    // boxes: three rows become one tall panel with lines through it.
    expect(css).toContain(".tgs-cards[data-design='index']:not([data-style='plain'])");
  });

  it('drops the date column when nothing has a date', () => {
    // Ten rems reserved for "14 September 2026" on a page of destinations,
    // which have none, so every row started a third of the way across.
    expect(css).toContain(".tgs-card:not(:has(.tgs-card__label)) .tgs-card__body");
  });
});

describe('following a link in the editor preview', () => {
  const canvas = readFileSync(resolve(__dirname, '..', 'components', 'editor', 'Canvas.tsx'), 'utf8');

  it('sends an internal link to the preview route, in this tab', () => {
    /*
     * A card links to "/guides/hvar", an address on the CLIENT'S site. Resolved
     * against the editor's own origin that is tg-sites-shell.vercel.app/guides/
     * hvar, which 404s, and it opened in a new tab as well. Both surfaced the
     * day collection cards started drawing on the canvas, because until then
     * preview had almost nothing clickable in it.
     */
    expect(canvas).toContain('`/preview${href}`');
    expect(canvas).toContain('window.location.assign(');
  });

  it('still sends an external link away from the editor', () => {
    expect(canvas).toContain("window.open(link.href, '_blank', 'noopener,noreferrer')");
  });
});

describe('the client brand reaches the editor, not just the canvas', () => {
  const shell = readFileSync(resolve(__dirname, '..', 'components', 'editor', 'EditorShell.tsx'), 'utf8');
  const chrome = readFileSync(resolve(__dirname, '..', 'components', 'editor', 'editor.css'), 'utf8');

  it('puts the site theme on the editor root', () => {
    /*
     * Every colour swatch is a THEME TOKEN rather than a hex: picking "Accent"
     * writes var(--tgs-accent) so the colour follows the client's brand and
     * keeps following it. Right design, and it looked broken, because the chips
     * draw themselves with the same token and the panel sits outside the canvas.
     * Outside, the token falls back to globals.css :root, which is the default
     * Travelgenix palette. An agency was shown a row of OUR colours, picked one,
     * and watched THEIR colour appear on the card.
     */
    const root = shell.slice(shell.indexOf('className="ed-root"'));
    expect(root.slice(0, 1600)).toContain('style={siteTheme}');
  });

  it('is safe there, because the chrome owns no site tokens', () => {
    // The whole reason this can sit on the root rather than be threaded through
    // every panel: the editor is --ed-* from top to bottom.
    expect(chrome).not.toContain('--tgs-');
  });

  it('offers tokens rather than hexes, so a rebrand carries', () => {
    const styles = readFileSync(resolve(__dirname, '..', 'lib', 'content', 'styles.ts'), 'utf8');
    const list = styles.slice(styles.indexOf('COLOUR_SWATCHES'), styles.indexOf('HIGHLIGHT_SWATCHES'));
    expect(list).not.toMatch(/value: '#/);
    expect(list).toContain("var(--tgs-accent)");
  });
});

describe('a cards grid puts its box on the cards', () => {
  const renderer = readFileSync(resolve(__dirname, '..', 'components', 'render', 'PageRenderer.tsx'), 'utf8');
  const css = readFileSync(resolve(__dirname, '..', 'app', 'globals.css'), 'utf8');

  it('targets the card rather than the block', () => {
    /*
     * Andy, 26 Aug 2026: a card background changed the block background, a
     * border went round the block, a shadow landed on the block. Everywhere
     * else "the block" is the thing you can see. Here it is a grid whose
     * visible parts are the cards, so a background paints behind the gaps and
     * a border draws a rectangle round the lot.
     */
    expect(renderer).toContain("data-box-target={block.type === 'cards' && boxed ? 'card' : undefined}");
    expect(css).toContain(".tgs-block[data-boxed][data-box-target='card']");
  });

  it('emits only what was actually set, so a preset is not wiped', () => {
    /*
     * boxStyle fills every unset property with transparent and 0, which is
     * right for a block painting itself and wrong here: touching any box
     * control would have blanked the finish the card already had. Verified in a
     * browser: a tinted card given a border keeps its tint.
     */
    const fn = renderer.slice(renderer.indexOf('const cardBox'), renderer.indexOf('const style: CSSProperties'));
    expect(fn).toContain('box.background ?');
    expect(fn).toContain('box.borderWidth > 0');
    expect(fn).toContain('box.radius > 0');
  });

  it('overrides the finish preset rather than losing to it', () => {
    // Same specificity, so source order decides. The override has to come after.
    const preset = css.indexOf(".tgs-cards[data-style='tinted']");
    const override = css.indexOf("[data-box-target='card'][style*='--tgs-card-bg']");
    expect(preset).toBeGreaterThan(-1);
    expect(override).toBeGreaterThan(preset);
  });

  it('leaves padding on the container, where it means space around the grid', () => {
    const fn = renderer.slice(renderer.indexOf('const cardBox'), renderer.indexOf('const style: CSSProperties'));
    expect(fn).not.toContain('padding');
  });
});
