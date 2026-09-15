/**
 * Words arriving, taking turns, and answering the pointer. The third slice of
 * the React Bits review (docs/react-bits-review.md, 15 Sep 2026), plus Andy's
 * ask from the same day: "some mouse interaction when the pointer goes over a
 * word or a sentence when it is an H1 or large text".
 *
 * WHAT IS PINNED. The split itself (tags untouched, whitespace kept, entities
 * whole, the turn token whole); that a heading is only split off the canvas and
 * never with the animated gradient (which would paint its moving words clear);
 * that the words are only hidden once the script has promised to show them, and
 * that every animation and every hover sits behind the reduced-motion guard
 * (the hovers behind the mouse guard too); that the script pulls the page only
 * for the two things that need it; and that the three dressed presets ask for
 * what they say.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blockDefinition, defaultPropsFor } from '../lib/content/blocks';
import { needsMotionScript } from '../lib/content/motion';
import { presetById } from '../lib/content/presets';
import { TURN_TOKEN, parseTurns, plainText, splitWords, turnMarkup, withTurns } from '../lib/content/words';

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

const css = read('app', 'globals.css');
const render = read('components', 'render', 'blocks.tsx');
const script = read('public', 'tg-motion.js');

/** Every block of a guard, brace matched, so a rule NEAR it cannot pass. */
function blocksOf(sheet: string, opener: string): string {
  let out = '';
  let from = 0;
  for (;;) {
    const start = sheet.indexOf(opener, from);
    if (start === -1) break;
    let depth = 1;
    let i = start + opener.length;
    for (; i < sheet.length && depth > 0; i += 1) {
      if (sheet[i] === '{') depth += 1;
      else if (sheet[i] === '}') depth -= 1;
    }
    out += `${sheet.slice(start + opener.length, i)}\n`;
    from = i;
  }
  return out;
}

const reducedGuarded = blocksOf(css, '@media (prefers-reduced-motion: no-preference) {');
const mouseGuarded = blocksOf(css, '@media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {');

function options(type: string, key: string): string[] {
  const field = blockDefinition(type)!.fields.find((f) => f.key === key) as { options?: Array<{ value: string }>; group?: string } | undefined;
  expect(field, `${type}.${key}`).toBeDefined();
  return (field!.options ?? []).map((o) => o.value);
}

// ---------------------------------------------------------------------------
// The split
// ---------------------------------------------------------------------------

describe('splitWords', () => {
  it('wraps each word and keeps the whitespace between them as it was', () => {
    const { html, count } = splitWords('Island hopping,  planned');
    expect(count).toBe(3);
    expect(html).toBe(
      '<span class="tgs-w" style="--i:0"><span class="tgs-wi">Island</span></span> '
      + '<span class="tgs-w" style="--i:1"><span class="tgs-wi">hopping,</span></span>  '
      + '<span class="tgs-w" style="--i:2"><span class="tgs-wi">planned</span></span>',
    );
  });

  it('copies tags through untouched, so a bold word or a link survives', () => {
    // The comma after the closing tag is a run of its own and counts as a
    // word: a wrap cannot cross a tag, and a comma arriving on its own beat is
    // invisible at 60ms.
    const { html, count } = splitWords('The <strong>Amalfi coast</strong>, <a href="/x">slowly</a>');
    expect(count).toBe(5);
    expect(html).toContain('<strong><span class="tgs-w" style="--i:1"><span class="tgs-wi">Amalfi</span></span> <span class="tgs-w" style="--i:2"><span class="tgs-wi">coast</span></span></strong>');
    expect(html).toContain('<a href="/x"><span class="tgs-w" style="--i:4"><span class="tgs-wi">slowly</span></span></a>');
  });

  it('never splits inside an entity', () => {
    const { html } = splitWords('Sun &amp; sea');
    expect(html).toContain('<span class="tgs-wi">&amp;</span>');
    const letters = splitWords('S&amp;s', 'letters');
    expect(letters.count).toBe(3);
    expect(letters.html).toContain('<span class="tgs-l" style="--i:1">&amp;</span>');
  });

  it('splits letters one code point at a time, inside a word wrapper that keeps the word together', () => {
    const { html, count } = splitWords('Hi 🌊', 'letters');
    expect(count).toBe(3);
    expect(html).toBe(
      '<span class="tgs-w"><span class="tgs-l" style="--i:0">H</span><span class="tgs-l" style="--i:1">i</span></span> '
      + '<span class="tgs-w"><span class="tgs-l" style="--i:2">🌊</span></span>',
    );
  });

  it('keeps the turn token whole in letters mode, so the turning word can still be put in', () => {
    const { html } = splitWords(`Holidays to ${TURN_TOKEN}`, 'letters');
    expect(html).toContain(`<span class="tgs-wi">${TURN_TOKEN}</span>`);
  });

  it('reads the plain words back for an aria-label', () => {
    expect(plainText('The <strong>Amalfi</strong>  coast')).toBe('The Amalfi coast');
  });
});

describe('the turning word', () => {
  it('takes one word per line or comma, trimmed, escaped, six at most, forty characters each', () => {
    expect(parseTurns('Greece\n Italy , Portugal\n\n')).toEqual(['Greece', 'Italy', 'Portugal']);
    expect(parseTurns('a,b,c,d,e,f,g,h')).toHaveLength(6);
    expect(parseTurns('<b>x</b>')).toEqual(['&lt;b&gt;x&lt;/b&gt;']);
    expect(parseTurns('x'.repeat(60))[0]).toHaveLength(40);
    expect(parseTurns(7)).toEqual([]);
  });

  it('stacks the words in one grid cell, only the first one read out', () => {
    const markup = turnMarkup(['Greece', 'Italy']);
    expect(markup).toBe(
      '<span class="tgs-turn" data-count="2" style="--n:2">'
      + '<span class="tgs-turn__word" style="--i:0">Greece</span>'
      + '<span class="tgs-turn__word" style="--i:1" aria-hidden="true">Italy</span></span>',
    );
  });

  it('goes where the token is, or after the words when there is none', () => {
    expect(withTurns(`Holidays to ${TURN_TOKEN} this year`, ['Greece', 'Italy'])).toMatch(/^Holidays to <span class="tgs-turn".* this year$/);
    expect(withTurns('Holidays to', ['Greece', 'Italy'])).toMatch(/^Holidays to <span class="tgs-turn"/);
  });

  it('with one word simply stands there, and with none the token is dropped', () => {
    expect(withTurns(`Holidays to ${TURN_TOKEN}`, ['Greece'])).toBe('Holidays to Greece');
    expect(withTurns(`Holidays to ${TURN_TOKEN}`, [])).toBe('Holidays to ');
  });
});

// ---------------------------------------------------------------------------
// The fields
// ---------------------------------------------------------------------------

describe('the heading and text fields', () => {
  it('offer the arrivals, the pointer effects, the outline and the turning words', () => {
    expect(options('heading', 'arrive')).toEqual(['none', 'words', 'words-blur', 'words-mask', 'letters']);
    expect(options('heading', 'hover')).toEqual(['none', 'lift', 'focus', 'proximity']);
    expect(options('text', 'arrive')).toEqual(['none', 'scroll']);
    const turns = blockDefinition('heading')!.fields.find((f) => f.key === 'turns');
    expect(turns?.kind).toBe('textarea');
    const outlined = blockDefinition('heading')!.fields.find((f) => f.key === 'outlined');
    expect(outlined?.kind).toBe('toggle');
  });

  it('default to nothing moving, so no stored heading changes', () => {
    const heading = defaultPropsFor('heading');
    expect(heading.arrive).toBe('none');
    expect(heading.hover).toBe('none');
    expect(heading.turns).toBe('');
    expect(heading.outlined).toBe(false);
    expect(defaultPropsFor('text').arrive).toBe('none');
  });

  it('sit in the Effects group, beside the gradient and the shadow', () => {
    for (const key of ['arrive', 'hover', 'outlined']) {
      const field = blockDefinition('heading')!.fields.find((f) => f.key === key) as { group?: string };
      expect(field.group, key).toBe('effects');
    }
  });
});

// ---------------------------------------------------------------------------
// The render
// ---------------------------------------------------------------------------

/*
 * The render is pinned from its source, the way every other block suite here
 * does it (the tsx renderers cannot be imported into a test under this
 * tsconfig). What the markup actually comes out as is checked in a browser by
 * the smoke harness, through the real renderer.
 */
describe('the heading render', () => {
  const heading = render.slice(render.indexOf('export function HeadingBlock'), render.indexOf('export function TextBlock'));
  const text = render.slice(render.indexOf('export function TextBlock'), render.indexOf('export function QuoteBlock'));

  it('splits the words only off the canvas and never with the animated gradient', () => {
    expect(heading).toContain("const wordsOn = !editing && !gradient && (arrive !== 'none' || hover !== 'none');");
    expect(heading).toContain("let body = wordsOn ? splitWords(html || 'Heading', mode).html : html || 'Heading';");
  });

  it('reads the closed lists and says which arrival and which pointer effect it drew', () => {
    expect(heading).toContain("oneOf(props, 'arrive', ['none', 'words', 'words-blur', 'words-mask', 'letters'] as const, 'none')");
    expect(heading).toContain("oneOf(props, 'hover', ['none', 'lift', 'focus', 'proximity'] as const, 'none')");
    expect(heading).toContain('data-arrive={arriving}');
    expect(heading).toContain("data-hover={wordsOn && hover !== 'none' ? hover : undefined}");
    expect(heading).toContain("data-outlined={outlined ? '' : undefined}");
  });

  it('falls back from letters to words past the cap, and keeps the plain words for a reader', () => {
    expect(heading).toContain("const mode = arrive === 'letters' && words.length <= LETTERS_CAP ? 'letters' : 'words';");
    expect(heading).toContain("aria-label={arriving === 'letters' ? words : undefined}");
    expect(heading).toContain('if (arriving === \'letters\') body = `<span aria-hidden="true">${body}</span>`;');
  });

  it('puts the turning word in always, still on the canvas and with the gradient', () => {
    expect(heading).toContain('body = withTurns(body, turns);');
    expect(heading).toContain("data-turn-still={turning && (editing || gradient) ? '' : undefined}");
  });

  it('gives a statement its word count for the scroll reveal, and nothing on the canvas', () => {
    expect(text).toContain("const split = !editing && arrive === 'scroll' ? splitWords(html) : null;");
    expect(text).toContain("data-arrive={split ? 'scroll' : undefined}");
    expect(text).toContain("style={split ? ({ '--n': String(split.count) } as CSSProperties) : undefined}");
  });

  it('is told by the renderer whether it is on the canvas', () => {
    const renderer = read('components', 'render', 'BlockRenderer.tsx');
    expect(renderer).toContain('<HeadingBlock props={props} editingHost={editingHost} editing={editable} />');
    expect(renderer).toContain('<TextBlock props={props} editingHost={editingHost} editing={editable} />');
  });
});

// ---------------------------------------------------------------------------
// The stylesheet
// ---------------------------------------------------------------------------

describe('the stylesheet', () => {
  it('hides the words only once the script has marked the heading, and runs them only once seen', () => {
    expect(reducedGuarded).toContain('[data-arrive][data-arrive-fb] .tgs-w {');
    expect(reducedGuarded).toContain('[data-arrive][data-arrive-fb][data-seen] .tgs-w,');
    // Never a rule that hides on data-arrive alone: with no script the words stand.
    expect(css).not.toMatch(/\[data-arrive\](?!\[data-arrive-fb\])[^{]*\{[^}]*opacity: 0/);
  });

  it('fills backwards, so an arrived word is free to move under the pointer', () => {
    expect(reducedGuarded).toContain('animation: tgs-arrive-rise 0.7s cubic-bezier(0.2, 0.7, 0.2, 1) backwards paused;');
    expect(css).not.toMatch(/tgs-arrive-[a-z]+ [\d.]+s [^;]*\bboth\b/);
  });

  it('pads the mask so descenders survive, the lesson already paid for', () => {
    const mask = reducedGuarded.slice(reducedGuarded.indexOf("[data-arrive='words-mask'][data-arrive-fb] .tgs-w {"));
    expect(mask.slice(0, 200)).toContain('overflow: hidden;');
    expect(mask.slice(0, 200)).toContain('padding-bottom: 0.14em;');
    expect(mask.slice(0, 200)).toContain('margin-bottom: -0.14em;');
  });

  it('keeps every arrival and every turn behind the reduced-motion guard', () => {
    const outside = css.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/g, '');
    expect(outside).not.toMatch(/animation: tgs-arrive-(rise|blur|mask)/);
    expect(outside).not.toMatch(/animation: tgs-turn-/);
    for (let n = 2; n <= 6; n += 1) expect(css).toContain(`@keyframes tgs-turn-${n} {`);
  });

  it('turns hold on the first word when still, and the canvas says still', () => {
    expect(css).toContain('.tgs-turn__word:first-child { opacity: 1; }');
    expect(reducedGuarded).toContain('.tgs-heading:not([data-turn-still]) .tgs-turn__word {');
  });

  it('puts the pointer effects behind the mouse guard and the reduced-motion guard together', () => {
    expect(mouseGuarded).toContain(".tgs-heading[data-hover='lift'] .tgs-w:hover {");
    expect(mouseGuarded).toContain(".tgs-heading[data-hover='focus'] .tgs-w:hover {");
    expect(mouseGuarded).toContain(".tgs-heading[data-hover='proximity'] .tgs-w {");
    expect(mouseGuarded).toContain('var(--near, 0)');
  });

  it('reads the scroll reveal off the view timeline, only where there is one', () => {
    const supports = blocksOf(css, '@supports (animation-timeline: view()) {');
    expect(supports).toContain(".tgs-text[data-arrive='scroll'] .tgs-w {");
    expect(supports).toContain('animation-timeline: --words;');
    // The base rule never hides a word, so a browser without the timeline shows the paragraph.
    expect(css).not.toMatch(/\.tgs-text\[data-arrive='scroll'\] \.tgs-w \{[^}]*opacity: 0/);
  });

  it('outlines through the fill colour so currentColor keeps the theme colour', () => {
    const rule = css.slice(css.indexOf('.tgs-heading[data-outlined] {'));
    expect(rule.slice(0, 200)).toContain('-webkit-text-fill-color: transparent;');
    expect(rule.slice(0, 200)).toContain('-webkit-text-stroke: 0.035em currentColor;');
  });

  it('adds no --tgs- token of its own, so the block catalogue reads nothing as a colour', () => {
    expect(css).not.toMatch(/var\(--tgs-(near|i|n|p|words)[,)]/);
    expect(css).not.toContain('view-timeline-name: --tgs-');
  });
});

// ---------------------------------------------------------------------------
// The script, and when a page carries it
// ---------------------------------------------------------------------------

describe('tg-motion.js', () => {
  it('marks arriving headings only behind an observer, and never the scroll reveal', () => {
    expect(script).toContain('function setUpArrive() {');
    expect(script).toContain("if (!('IntersectionObserver' in window)) return;");
    expect(script).toContain("heads[h].setAttribute('data-arrive-fb', '1');");
    expect(script).toContain("if (heads[h].getAttribute('data-arrive') === 'scroll') continue;");
  });

  it('runs the proximity only for a mouse, rAF-throttled, and writes --near', () => {
    expect(script).toContain("window.matchMedia('(hover: hover) and (pointer: fine)').matches");
    expect(script).toContain("boxes[i].el.style.setProperty('--near'");
    expect(script).toContain('if (!raf) raf = window.requestAnimationFrame(apply);');
    expect(script).toContain("words[i].style.removeProperty('--near');");
  });

  it('still refuses to run at all under reduced motion, before any of this', () => {
    const reduced = script.indexOf('if (REDUCED && REDUCED.matches) return;');
    expect(reduced).toBeGreaterThan(-1);
    expect(reduced).toBeLessThan(script.indexOf('function setUpArrive'));
    expect(script).toContain("var VERSION = '1.3.0';");
  });

  it('is pulled onto a page by an arriving heading or a proximity heading, and by nothing else new', () => {
    const page = (props: Record<string, unknown>, type = 'heading') => ({
      sections: [{ id: 'a', rows: [{ columns: [{ blocks: [{ type, props }] }] }] }],
    });
    expect(needsMotionScript(page({ arrive: 'words' }))).toBe(true);
    expect(needsMotionScript(page({ hover: 'proximity' }))).toBe(true);
    expect(needsMotionScript(page({ hover: 'lift' }))).toBe(false);
    expect(needsMotionScript(page({ arrive: 'none' }))).toBe(false);
    expect(needsMotionScript(page({ arrive: 'scroll' }, 'text'))).toBe(false);
    // Nested inside a container's columns counts too.
    const nested = {
      sections: [{ id: 'a', rows: [{ columns: [{ blocks: [{ type: 'container', props: { columns: [{ blocks: [{ type: 'heading', props: { arrive: 'letters' } }] }] } }] }] }] }],
    };
    expect(needsMotionScript(nested)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The presets
// ---------------------------------------------------------------------------

describe('the dressed presets', () => {
  it('give the loud title letters and a swell, the statement a scroll reveal, and add the turning word', () => {
    const big = presetById('hero-big-title')!.rows[0].columns[0][0].props!;
    expect(big.arrive).toBe('letters');
    expect(big.hover).toBe('proximity');
    const statement = presetById('text-statement')!.rows[0].columns[0][0].props!;
    expect(statement.arrive).toBe('scroll');
    const turning = presetById('hero-turning-word')!;
    expect(turning.category).toBe('hero');
    const title = turning.rows[0].columns[0][0].props!;
    expect(String(title.html)).toContain(TURN_TOKEN);
    expect(parseTurns(title.turns)).toEqual(['Greece', 'Italy', 'Portugal', 'Croatia']);
  });
});
