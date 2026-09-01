/**
 * The second pass: giving every slot on a built page its own words.
 *
 * WHY IT EXISTS. The page builder writes exactly two things into each section it
 * chooses, a heading and one paragraph, and everything else keeps the copy the
 * preset ships with to show an author what goes where. Andy, on the first site
 * it produced: "it's very poor. No images. Placeholder text. Short pages."
 * Those are three descriptions of that one fault.
 *
 * What is worth testing is the same as everywhere else here: not the prompt,
 * which can only be judged by what comes back, but everything between the
 * model's answer and a client's page.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  MAX_SLOTS,
  applyFill,
  buildFillUserPrompt,
  fillFromModel,
  slotsOf,
  stripUnfilled,
  type Slot,
} from '../lib/ai/page-fill';

const ROOT = join(__dirname, '..');

/** A section of one row and one column, holding the given blocks. */
function section(blocks: Array<{ id: string; type: string; props?: Record<string, unknown> }>) {
  return { id: 's1', rows: [{ id: 'r1', layout: '100', columns: [{ id: 'c1', width: 100, blocks }] }] } as never;
}

const HERO = section([
  { id: 'b1', type: 'heading', props: { html: 'Barbados', style: 'h1' } },
  { id: 'b2', type: 'heading', props: { html: 'Tagline here', style: 'h5' } },
  { id: 'b3', type: 'text', props: { html: '<p>A line or two on what this is and why it matters.</p>' } },
  { id: 'b4', type: 'button', props: { label: 'Start an enquiry' } },
]);

describe('finding what needs words', () => {
  it('offers every heading and paragraph, in reading order', () => {
    expect(slotsOf([HERO]).map((s) => s.id)).toEqual(['b1', 'b2', 'b3']);
  });

  it('leaves anything that is not words alone', () => {
    // A button, a picture and a layout are not this pass's business: it writes
    // copy into slots that already exist and can change nothing else.
    expect(slotsOf([HERO]).some((s) => s.id === 'b4')).toBe(false);
  });

  it('carries what the slot currently says, because that is what it is FOR', () => {
    /*
     * "Tagline here" under a headline wants one line of support, not a second
     * headline. Without the current copy the model is guessing at the shape of
     * a slot it cannot see.
     */
    const tagline = slotsOf([HERO]).find((s) => s.id === 'b2');
    expect(tagline?.current).toBe('Tagline here');
    expect(tagline?.kind).toBe('heading');
  });

  it('includes slots the first pass already wrote', () => {
    // It is composing a page, not patching one, and it writes a better tagline
    // when it can see the headline above it.
    expect(slotsOf([HERO])[0].current).toBe('Barbados');
  });

  it('stops at the cap rather than sending a page of a hundred slots', () => {
    const many = section(
      Array.from({ length: MAX_SLOTS + 30 }, (_, i) => ({ id: `b${i}`, type: 'text', props: { html: `<p>${i}</p>` } })),
    );
    expect(slotsOf([many])).toHaveLength(MAX_SLOTS);
  });
});

describe('reading the copy back', () => {
  const slots: Slot[] = [
    { id: 'b1', kind: 'heading', current: 'Barbados' },
    { id: 'b3', kind: 'text', current: 'A line or two.' },
  ];

  const good = JSON.stringify({ b1: 'Where the west coast goes quiet', b3: 'Seven villas we know.' });

  it('takes an object keyed by the ids it offered', () => {
    const result = fillFromModel(good, slots);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.copy.b1).toBe('Where the west coast goes quiet');
  });

  it('survives fences round the JSON', () => {
    expect(fillFromModel('```json\n' + good + '\n```', slots).ok).toBe(true);
  });

  it('drops an id it was never offered', () => {
    /*
     * KEYED ON ID, NOT POSITION, which is what makes a shuffled or invented
     * answer harmless: copy cannot land in a slot the model made up.
     */
    const result = fillFromModel(JSON.stringify({ b1: 'Kept', nope: 'Dropped' }), slots);
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.keys(result.copy)).toEqual(['b1']);
  });

  it('refuses an array or a non-answer, since neither is a set of slots', () => {
    expect(fillFromModel('[1,2,3]', slots).ok).toBe(false);
    expect(fillFromModel('I would write something warm here.', slots).ok).toBe(false);
    expect(fillFromModel(JSON.stringify({ unknown: 'x' }), slots).ok).toBe(false);
  });

  it('strips markup and caps a heading harder than a paragraph', () => {
    const result = fillFromModel(
      JSON.stringify({ b1: '<script>x</script>' + 'H'.repeat(400), b3: 'B'.repeat(900) }),
      slots,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.copy.b1).not.toContain('<script');
    expect(result.copy.b1.length).toBeLessThanOrEqual(90);
    expect(result.copy.b3.length).toBeLessThanOrEqual(400);
  });
});

describe('writing it onto the page', () => {
  it('replaces the words and nothing else', () => {
    const out = applyFill([HERO], { b2: 'Seven villas, one coast' });
    const blocks = out[0].rows[0].columns[0].blocks;

    expect(blocks).toHaveLength(4);
    expect((blocks[1].props as { html: string }).html).toBe('Seven villas, one coast');
    // The style, the button and the order are untouched.
    expect((blocks[1].props as { style: string }).style).toBe('h5');
    expect(blocks[3].type).toBe('button');
  });

  it('wraps a paragraph and leaves a heading bare', () => {
    const out = applyFill([HERO], { b1: 'A headline', b3: 'A paragraph.' });
    const blocks = out[0].rows[0].columns[0].blocks;
    expect((blocks[0].props as { html: string }).html).toBe('A headline');
    expect((blocks[2].props as { html: string }).html).toBe('<p>A paragraph.</p>');
  });

  it('leaves a slot the model skipped exactly as it was', () => {
    // Which for a preset's own instruction means the stripper removes it. That
    // is the right order: a shorter page beats one saying "Tagline here".
    const out = applyFill([HERO], { b1: 'A headline' });
    expect((out[0].rows[0].columns[0].blocks[1].props as { html: string }).html).toBe('Tagline here');
  });
});

describe('what the fill costs, and what it cannot cost', () => {
  const actions = readFileSync(join(ROOT, 'app', 'actions', 'ai.ts'), 'utf8');
  const fn = actions.slice(
    actions.indexOf('async function sectionsForPage'),
    actions.indexOf('export type AiPageResult'),
  );

  it('never fails the build, because a planned page is still a page', () => {
    /*
     * The catch has to END in a page rather than a rethrow. With the single
     * tail, that means: a failed fill leaves `sections` as the built tree, the
     * catch rethrows nothing, and the one return photographs and strips
     * whatever `sections` holds.
     */
    expect(fn).toContain('catch (error)');
    const after = fn.slice(fn.indexOf('catch (error)'));
    expect(after).not.toContain('throw');
    expect(after).toContain('const kept = dropStubSections(stripPlaceholders(stripUnfilled(sections, slots)));');
  });

  it('shares the slot already claimed rather than charging twice', () => {
    // A client asked for one page and should pay for one page.
    expect(fn).toContain('ctx.claimId');
    expect(fn).not.toContain('claimRequest(');
  });

  it('does not start a call it has no time to finish', () => {
    // A fill begun with seconds left is a request that will be aborted and paid
    // for anyway; the same rule now guards the photo imports, which run inside
    // the same invocation and would otherwise walk into the platform's kill.
    expect(fn).toContain('remainingBudget(ctx.startedAt)');
    expect(fn).toContain('left >= MIN_REPAIR_MS');
    expect(fn).toContain('PHOTO_FLOOR_MS');
  });

  it('skips a page that has nothing to fill', () => {
    expect(fn).toContain('slots.length > 0');
  });
});

describe('the page gets photographs', () => {
  const build = readFileSync(join(ROOT, 'lib', 'ai', 'page-build.ts'), 'utf8');
  const actions = readFileSync(join(ROOT, 'app', 'actions', 'ai.ts'), 'utf8');

  it('asks the model what a picture on each section should SHOW', async () => {
    /*
     * The preset's own query is generic by necessity: one banner preset opens
     * every page. A Barbados page wants Barbados pictures, and the only thing
     * that knows the page is about Barbados is the model.
     */
    const { PAGE_RULES, PAGE_OUTPUT_SHAPE } = await import('../lib/ai/page-build');
    expect(PAGE_RULES).toContain('"photo"');
    expect(PAGE_OUTPUT_SHAPE).toContain('"photo"');
    // A search term wants a thing that can be photographed, not a mood.
    expect(PAGE_RULES).toContain('not a mood');
  });

  it('reads the subject back without escaping it, since it is a search term', () => {
    const fn = build.slice(build.indexOf('export function planFromModel'));
    expect(fn.slice(0, 2000)).toContain('toText(item.photo)');
    expect(fn.slice(0, 2000)).not.toContain('escapeHtml(toText(item.photo))');
  });

  it('reuses the starter wizard pipeline rather than a second one', () => {
    // fillPagePhotos has filled template pages since August: it searches,
    // copies into the tenant's own storage with the credit, and writes the url.
    expect(actions).toContain('fillPagePhotos(');
  });

  it('fills photographs whether or not the copy pass worked', () => {
    /*
     * ONE tail now: whatever the fill did, `sections` flows through the same
     * withPhotos call before the strips. A page with no copy pass still
     * deserves its pictures — budget permitting, because the imports run inside
     * the same invocation.
     */
    const fn = actions.slice(
      actions.indexOf('async function sectionsForPage'),
      actions.indexOf('const PHOTO_FLOOR_MS'),
    );
    expect(fn).toContain('sections = await withPhotos(ctx.tenantId, planned, sections);');
    // And it sits OUTSIDE the fill's try, so a photo failure cannot be
    // mistaken for a fill failure and discard paid copy.
    const catchAt = fn.indexOf('catch (error)');
    expect(fn.indexOf('await withPhotos')).toBeGreaterThan(catchAt);
  });

  it('never lets a missing picture cost the page', () => {
    const fill = readFileSync(join(ROOT, 'lib', 'media', 'photo-fill.ts'), 'utf8');
    // Best effort all the way down: a miss, a rate limit and an unconfigured
    // library are all swallowed, and the slot simply stays as it was.
    expect(fill).toContain('pexelsConfigured() || !blobConfigured()');
    expect(fill).toContain('catch');
  });
});

describe('the ask', () => {
  it('names the page and what it is for, then lists the slots', () => {
    const ask = buildFillUserPrompt('Barbados', 'For someone choosing an island.', [
      { id: 'b2', kind: 'heading', current: 'Tagline here' },
    ]);
    expect(ask).toContain('Barbados');
    expect(ask).toContain('For someone choosing an island.');
    expect(ask).toContain('b2 (heading): Tagline here');
  });

  it('marks an empty slot rather than showing a blank line', () => {
    const ask = buildFillUserPrompt('Contact', '', [{ id: 'b9', kind: 'text', current: '' }]);
    expect(ask).toContain('b9 (text): [empty]');
  });
});

// ---------------------------------------------------------------------------

/**
 * THE STRUCTURED SLOTS: cards, steps and icon items get their own words.
 *
 * The first full site showed why headings and paragraphs were not enough: a
 * Caribbean company shipped cards reading "The Amalfi coast, slowly" and
 * "Lisbon and the Algarve", because card items were never offered to the fill
 * and kept the preset's example content.
 */
describe('offering the structured blocks', () => {
  const CARDS = section([
    { id: 'blk_cards', type: 'cards', props: { items: [
      { src: '', alt: '', label: 'Greece', title: 'Island hopping', body: 'Seven nights across three islands.', linkLabel: 'See the trip', linkHref: '' },
      { src: '', alt: '', label: 'Italy', title: 'The Amalfi coast, slowly', body: 'A week between Positano and Ravello.', linkLabel: 'See the trip', linkHref: '' },
    ] } },
    { id: 'blk_icon', type: 'icon-item', props: { icon: 'phone', title: 'A person to call', body: 'One number, one office.' } },
  ]);

  it('offers every content field of every card item, under composite keys', () => {
    const ids = slotsOf([CARDS]).map((slot) => slot.id);
    expect(ids).toContain('blk_cards:item:0:title');
    expect(ids).toContain('blk_cards:item:0:body');
    expect(ids).toContain('blk_cards:item:0:label');
    expect(ids).toContain('blk_cards:item:1:linkLabel');
    expect(ids).toContain('blk_icon:prop:title');
    expect(ids).toContain('blk_icon:prop:body');
  });

  it('marks them plain, because their destination is not html', () => {
    for (const slot of slotsOf([CARDS])) {
      if (slot.id.includes(':')) expect(slot.plain, slot.id).toBe(true);
    }
  });

  it('never offers a picture, a link target or a field the item does not carry', () => {
    const ids = slotsOf([CARDS]).map((slot) => slot.id);
    expect(ids.some((id) => id.endsWith(':src'))).toBe(false);
    expect(ids.some((id) => id.endsWith(':alt'))).toBe(false);
    expect(ids.some((id) => id.endsWith(':linkHref'))).toBe(false);
    expect(ids.some((id) => id.endsWith(':icon'))).toBe(false);
  });

  it('an empty factory field is a design choice, not a slot', () => {
    const bare = section([
      { id: 'blk_b', type: 'cards', props: { items: [{ src: '', label: '', title: 'Just a title', body: '', linkLabel: '', linkHref: '' }] } },
    ]);
    const ids = slotsOf([bare]).map((slot) => slot.id);
    expect(ids).toEqual(['blk_b:item:0:title']);
  });

  it('skips a block whose own id could make the key ambiguous', () => {
    const odd = section([
      { id: 'blk:odd', type: 'cards', props: { items: [{ title: 'X', body: 'Y' }] } },
    ]);
    expect(slotsOf([odd])).toEqual([]);
  });
});

describe('plain slots keep their apostrophes', () => {
  it('does not HTML-escape words bound for a plain prop', () => {
    /*
     * The apostrophe bug, third sighting prevented. Card titles are plain
     * strings React escapes at render; escaping here too shipped
     * "Halcyon Bay&#39;s" to the screen in the earlier rounds.
     */
    const slots: Slot[] = [
      { id: 'blk_c:item:0:title', kind: 'heading', plain: true, current: 'Old' },
      { id: 'blk_h', kind: 'heading', current: 'Old heading' },
    ];
    const result = fillFromModel(
      JSON.stringify({ 'blk_c:item:0:title': "Andy's picks", blk_h: "Andy's page" }),
      slots,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.copy['blk_c:item:0:title']).toBe("Andy's picks");
    // The html-bound heading is still escaped, as it always was.
    expect(result.copy.blk_h).toBe('Andy&#39;s page');
  });
});

describe('writing the structured answers back', () => {
  const CARDS = section([
    { id: 'blk_cards', type: 'cards', props: { style: 'bordered', items: [
      { src: '', alt: '', label: 'Greece', title: 'Island hopping', body: 'Seven nights.', linkLabel: 'See the trip', linkHref: '/x' },
      { src: '', alt: '', label: 'Italy', title: 'Amalfi', body: 'A week.', linkLabel: 'See the trip', linkHref: '' },
    ] } },
    { id: 'blk_icon', type: 'icon-item', props: { icon: 'phone', title: 'A person to call', body: 'One number.' } },
  ]);

  it('writes item fields and leaves everything else exactly as it was', () => {
    const out = applyFill([CARDS], {
      'blk_cards:item:0:title': 'Barbados, properly',
      'blk_cards:item:0:label': 'Barbados',
      'blk_icon:prop:body': 'One number, answered by a person who knows your booking.',
    });
    const block = out[0].rows[0].columns[0].blocks[0] as unknown as { props: { style: string; items: Array<Record<string, string>> } };
    expect(block.props.items[0].title).toBe('Barbados, properly');
    expect(block.props.items[0].label).toBe('Barbados');
    // Untouched neighbours, untouched design props, untouched links.
    expect(block.props.items[0].linkHref).toBe('/x');
    expect(block.props.items[1].title).toBe('Amalfi');
    expect(block.props.style).toBe('bordered');

    const icon = out[0].rows[0].columns[0].blocks[1] as unknown as { props: Record<string, string> };
    expect(icon.props.body).toContain('answered by a person');
    expect(icon.props.icon).toBe('phone');
  });

  it('refuses a forged key aimed at structure, wherever it came from', () => {
    /*
     * applyFill is the last gate, so it holds on its own: even a copy record
     * that somehow carries src, linkHref or an unknown field writes nothing.
     * fillFromModel already drops unoffered ids, but a gate that only works
     * when the caller upstream behaved is not a gate.
     */
    const out = applyFill([CARDS], {
      'blk_cards:item:0:src': 'https://evil.example/x.jpg',
      'blk_cards:item:0:linkHref': 'https://evil.example',
      'blk_cards:item:0:onclick': 'alert(1)',
      'blk_icon:prop:icon': 'skull',
    });
    const block = out[0].rows[0].columns[0].blocks[0] as unknown as { props: { items: Array<Record<string, string>> } };
    expect(block.props.items[0].src).toBe('');
    expect(block.props.items[0].linkHref).toBe('/x');
    expect(block.props.items[0].onclick).toBeUndefined();
    const icon = out[0].rows[0].columns[0].blocks[1] as unknown as { props: Record<string, string> };
    expect(icon.props.icon).toBe('phone');
  });

  it('drops an index past the items rather than growing the array', () => {
    const out = applyFill([CARDS], { 'blk_cards:item:9:title': 'Ghost card' });
    const block = out[0].rows[0].columns[0].blocks[0] as unknown as { props: { items: unknown[] } };
    expect(block.props.items).toHaveLength(2);
  });

  it('will not write into a field the design left empty', () => {
    const bare = section([
      { id: 'blk_b', type: 'cards', props: { items: [{ title: 'T', body: 'B', label: '', linkLabel: '' }] } },
    ]);
    const out = applyFill([bare], { 'blk_b:item:0:label': 'Sneaked in' });
    const block = out[0].rows[0].columns[0].blocks[0] as unknown as { props: { items: Array<Record<string, string>> } };
    expect(block.props.items[0].label).toBe('');
  });
});

// ---------------------------------------------------------------------------

/**
 * WHAT SHIPS WHEN THE FILL CALL DIES.
 *
 * Rendered, not theorised: the failure-path harness showed "The Amalfi coast,
 * slowly" back on a Caribbean page, because factory card copy lives in plain
 * props the placeholder stripper cannot see. The slots captured before the
 * call are the evidence of what was never written, and a block whose every
 * offered field is unchanged is a preset example wearing a client's page.
 */
describe('structured blocks the fill never reached do not ship', () => {
  const CARDS = section([
    { id: 'blk_h', type: 'heading', props: { html: 'Where we go' } },
    { id: 'blk_cards', type: 'cards', props: { items: [
      { src: '', label: 'Italy', title: 'The Amalfi coast, slowly', body: 'A week between Positano and Ravello.', linkLabel: 'See the trip', linkHref: '' },
    ] } },
    { id: 'blk_icon', type: 'icon-item', props: { icon: 'star', title: 'Short title', body: 'One sentence on what this is.' } },
  ]);

  it('drops a block whose every offered field still says what it said', () => {
    const slots = slotsOf([CARDS]);
    // No fill happened at all: the tree is exactly what was offered.
    const out = stripUnfilled([CARDS], slots);
    const types = out[0].rows[0].columns[0].blocks.map((block) => block.type);
    expect(types).toEqual(['heading']);
  });

  it('keeps a block the fill partly reached', () => {
    const slots = slotsOf([CARDS]);
    const filled = applyFill([CARDS], { 'blk_cards:item:0:title': 'Barbados, properly' });
    const out = stripUnfilled(filled, slots);
    const types = out[0].rows[0].columns[0].blocks.map((block) => block.type);
    // The cards were touched and stay; the icon-item was not and goes.
    expect(types).toEqual(['heading', 'cards']);
  });

  it('is a no-op on a fully filled page', () => {
    const slots = slotsOf([CARDS]);
    const filled = applyFill([CARDS], {
      'blk_cards:item:0:title': 'Barbados, properly',
      'blk_cards:item:0:body': 'Villas on the west coast.',
      'blk_cards:item:0:label': 'Barbados',
      'blk_cards:item:0:linkLabel': 'See Barbados',
      'blk_icon:prop:title': 'A person to call',
      'blk_icon:prop:body': 'One number, one office.',
    });
    const out = stripUnfilled(filled, slots);
    expect(out[0].rows[0].columns[0].blocks).toHaveLength(3);
  });

  it('leaves blocks it was never judging alone', () => {
    // Headings, text, buttons: not structured slots, not its business.
    const plain = section([
      { id: 'blk_p', type: 'text', props: { html: '<p>Tagline here</p>' } },
      { id: 'blk_btn', type: 'button', props: { label: 'Start an enquiry' } },
    ]);
    const out = stripUnfilled([plain], slotsOf([plain]));
    expect(out[0].rows[0].columns[0].blocks).toHaveLength(2);
  });

  it('runs on the one exit of the orchestrator, before the placeholder strip', () => {
    const actions = readFileSync(join(ROOT, 'app', 'actions', 'ai.ts'), 'utf8');
    const fn = actions.slice(
      actions.indexOf('async function sectionsForPage'),
      actions.indexOf('const PHOTO_FLOOR_MS'),
    );
    // One tail, not three exits: every path funnels through the same pair.
    const exits = fn.match(/stripPlaceholders\(\s*stripUnfilled\(/g) ?? [];
    expect(exits.length).toBe(1);
    expect(fn.match(/return /g)?.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------

/**
 * THE REVIEW ROUND'S FIXES, each pinned where it can fail again.
 */
describe('blocks are offered whole or not at all', () => {
  it('never ships a hybrid card: a block that does not fit is not offered', async () => {
    const { MAX_SLOTS } = await import('../lib/ai/page-fill');
    // Fill the cap to two slots short, then present a four-field card item.
    const fillers = Array.from({ length: MAX_SLOTS - 2 }, (_, i) => ({
      id: `bt${i}`, type: 'text', props: { html: `<p>${i}</p>` },
    }));
    const tree = section([
      ...fillers,
      { id: 'blk_last', type: 'cards', props: { items: [
        { src: '', label: 'Italy', title: 'The Amalfi coast, slowly', body: 'A week.', linkLabel: 'See the trip' },
      ] } },
    ]);

    const slots = slotsOf([tree]);
    // Not one slot of the card: 2 free < 4 wanted, so none — a fresh title on a
    // factory body is worse than no offer, because the strip can then act.
    expect(slots.some((slot) => slot.id.startsWith('blk_last:'))).toBe(false);

    // And the unoffered block is provably unfilled, so it does not ship.
    const out = stripUnfilled([tree], slots);
    const types = out[0].rows[0].columns[0].blocks.map((block) => block.type);
    expect(types).not.toContain('cards');
  });

  it('a collection-fed cards block with nothing to offer is not its business', () => {
    const tree = section([
      { id: 'blk_coll', type: 'cards', props: { source: 'collection', collection: 'guides', items: [] } },
    ]);
    const out = stripUnfilled([tree], slotsOf([tree]));
    // Zero offerable text, zero slots: kept, because its items arrive at render.
    expect(out[0].rows[0].columns[0].blocks.map((b) => b.type)).toContain('cards');
  });
});

describe('list entries are copy too', () => {
  const LIST = section([
    { id: 'blk_list', type: 'list', props: { style: 'tick', items: [
      { text: 'Return flights' }, { text: 'ATOL protected' },
    ] } },
  ]);

  it('offers each entry and writes it back', () => {
    const slots = slotsOf([LIST]);
    expect(slots.map((s) => s.id)).toEqual(['blk_list:item:0:text', 'blk_list:item:1:text']);
    const out = applyFill([LIST], { 'blk_list:item:1:text': 'Fully protected, and we can show you how' });
    const block = out[0].rows[0].columns[0].blocks[0] as unknown as { props: { items: Array<{ text: string }> } };
    expect(block.props.items[1].text).toBe('Fully protected, and we can show you how');
    expect(block.props.items[0].text).toBe('Return flights');
  });

  it('an unfilled list is factory copy and does not ship', () => {
    // "ATOL protected" as factory copy IS a trust claim; unwritten, it goes.
    const out = stripUnfilled([LIST], slotsOf([LIST]));
    expect(out).toHaveLength(0);
  });
});

describe('slicing cannot bisect what it caps', () => {
  it('cuts by code points, so an emoji is kept whole or dropped whole', () => {
    const slots: Slot[] = [{ id: 'blk_p:item:0:title', kind: 'heading', plain: true, current: 'Old' }];
    const long = 'A'.repeat(89) + '🏝️extra';
    const result = fillFromModel(JSON.stringify({ 'blk_p:item:0:title': long }), slots);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const words = result.copy['blk_p:item:0:title'];
    // No lone surrogate half at the cut.
    expect(words).not.toMatch(/[\uD800-\uDBFF]$/);
  });

  it('escapes after the cut, so no entity is ever bisected into "&am"', () => {
    const slots: Slot[] = [{ id: 'blk_h', kind: 'heading', current: 'Old' }];
    const long = 'B'.repeat(88) + " & sons of Bridgetown";
    const result = fillFromModel(JSON.stringify({ blk_h: long }), slots);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Either the ampersand made the cut as a full entity, or it did not make
    // the cut at all — never a fragment.
    expect(result.copy.blk_h).not.toMatch(/&a?m?$/);
  });
});

describe('an imported id cannot hijack a slot', () => {
  it('a heading whose id looks like a composite key is left out of the game', () => {
    const odd = section([
      { id: 'blk_x:item:0:title', type: 'heading', props: { html: 'Imported oddity' } },
      { id: 'blk_x', type: 'cards', props: { items: [{ title: 'Real card', body: 'Body.' }] } },
    ]);
    const slots = slotsOf([odd]);
    // The heading is not offered under its colliding id…
    expect(slots.some((slot) => slot.id === 'blk_x:item:0:title' && !slot.plain)).toBe(false);
    // …and even a copy record carrying that key writes the CARD, not the heading.
    const out = applyFill([odd], { 'blk_x:item:0:title': 'Barbados' });
    const heading = out[0].rows[0].columns[0].blocks[0] as unknown as { props: { html: string } };
    expect(heading.props.html).toBe('Imported oddity');
  });
});
