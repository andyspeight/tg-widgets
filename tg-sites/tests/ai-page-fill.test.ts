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
      Array.from({ length: 60 }, (_, i) => ({ id: `b${i}`, type: 'text', props: { html: `<p>${i}</p>` } })),
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
    expect(fn).toContain('catch (error)');
    expect(fn).toContain('return stripPlaceholders(built);');
  });

  it('shares the slot already claimed rather than charging twice', () => {
    // A client asked for one page and should pay for one page.
    expect(fn).toContain('ctx.claimId');
    expect(fn).not.toContain('claimRequest(');
  });

  it('does not start a call it has no time to finish', () => {
    // A fill begun with seconds left is a request that will be aborted and paid
    // for anyway.
    expect(fn).toContain('remainingBudget(ctx.startedAt)');
    expect(fn).toContain('left < MIN_REPAIR_MS');
  });

  it('skips a page that has nothing to fill', () => {
    expect(fn).toContain('slots.length === 0');
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
