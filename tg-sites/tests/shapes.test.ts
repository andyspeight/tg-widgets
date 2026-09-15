/**
 * The shapes from the React Bits review (docs/react-bits-review.md, 15 Sep
 * 2026): the first slice of it, and the literal answer to Andy's "the layouts
 * are fairly basic".
 *
 * WHAT THE REVIEW FOUND. Every grid the CMS drew was equal cells, and the equal
 * three-card row is the single most common tell that a page was assembled
 * rather than designed. React Bits' Magic Bento, Masonry, Drift Wall and Stack
 * are the shapes a visitor reads as designed. None of them is imported: the
 * published page ships no React and no animation library, so what is built
 * here is the DIRECTION on our own grid, in the stylesheet, as settings on the
 * Cards, Collection loop and Gallery blocks a client already has.
 *
 * WHAT IS PINNED. Three invariants that a browser check confirmed and a later
 * edit could quietly undo: a shape is one attribute the render writes only when
 * it is not the even grid (so nothing published moves); every shape collapses
 * on a phone to the one column it always was; and the two shapes that move (the
 * wall and the deck) hold under the pointer and stand still for anyone who asked
 * for less motion. Plus the mosaic's reason for being squares rather than a
 * masonry, because that one is a decision, not a preference.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BLOCKS, blockDefinition, defaultPropsFor } from '../lib/content/blocks';
import { sectionPhotoTargets } from '../lib/content/photo-plan';
import { buildPresetSection, presetById, presetThumb } from '../lib/content/presets';

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

const css = read('app', 'globals.css');
const render = read('components', 'render', 'blocks.tsx');
const page = read('components', 'render', 'PageRenderer.tsx');

function options(type: string, key: string): string[] {
  const field = blockDefinition(type)!.fields.find((f) => f.key === key) as
    { options?: Array<{ value: string }> } | undefined;
  expect(field, `${type}.${key}`).toBeDefined();
  return (field!.options ?? []).map((o) => o.value);
}

/** A rule's body, by the start of its selector, so a pin reads one rule and not the file. */
function rule(selector: string, from = css): string {
  const at = from.indexOf(selector);
  expect(at, selector).toBeGreaterThan(-1);
  return from.slice(at, from.indexOf('}', at));
}

// ---------------------------------------------------------------------------
// The grid's shape, on Cards and on the loop
// ---------------------------------------------------------------------------

describe('the grid shape', () => {
  it('is a setting on Cards and on the Collection loop, defaulting to the even grid every site has', () => {
    expect(options('cards', 'shape')).toEqual(['even', 'bento', 'featured']);
    expect(options('loop', 'shape')).toEqual(['even', 'bento', 'featured']);
    expect(defaultPropsFor('cards').shape).toBe('even');
    expect(defaultPropsFor('loop').shape).toBe('even');
  });

  it('sits in the Layout group, beside the column count', () => {
    for (const type of ['cards', 'loop']) {
      const field = BLOCKS.find((b) => b.type === type)!.fields.find((f) => f.key === 'shape');
      expect(field?.group, type).toBe('layout');
    }
  });

  it('writes the attribute only for a shape that is not even, so nothing published changes', () => {
    // A saved page from before the field has no `shape`; it must render byte
    // for byte as it did, which means no data-shape at all rather than
    // data-shape="even".
    expect(render).toContain("data-shape={shape === 'even' ? undefined : shape}");
    expect(page).toContain("return shape === 'bento' || shape === 'featured' ? shape : undefined;");
    expect(page).toContain('data-shape={shape}');
  });

  it('bento makes the first card two cells wide and two tall, and its picture grows to fill them', () => {
    const first = rule(".tgs-cards[data-shape='bento']:not([data-design='index']) .tgs-card:first-child {");
    expect(first).toContain('grid-column: span 2;');
    expect(first).toContain('grid-row: span 2;');
    // The ratio the frame carries is an INLINE style, so it only ever sets a
    // starting size; flex-grow is what lets the picture fill the second row
    // rather than leaving a hole under the words.
    const frame = rule(".tgs-cards[data-shape='bento']:not([data-design='index']) .tgs-card:first-child .tgs-card__frame {");
    expect(frame).toContain('flex: 1 1 auto;');
  });

  it('two across, the bento card is wide and not tall, or it would be the whole grid', () => {
    expect(css).toContain(".tgs-cards[data-shape='bento'][data-columns='2'] .tgs-card:first-child { grid-row: auto; }");
  });

  it('featured runs the first card across the row and turns it sideways on the stacked design', () => {
    expect(rule(".tgs-cards[data-shape='featured']:not([data-design='index']) .tgs-card:first-child {"))
      .toContain('grid-column: 1 / -1;');
    const wide = rule(".tgs-cards[data-shape='featured'][data-design='stacked'][data-image='top'] .tgs-card:first-child {");
    expect(wide).toContain('flex-direction: row;');
    // A card beside its own words is only as tall as the words; the picture
    // needs something to be tall against.
    expect(wide).toMatch(/min-height: \d+rem;/);
  });

  it('leaves the list design alone, which is a column and has no grid to shape', () => {
    expect(css).toContain("[data-shape='bento']:not([data-design='index'])");
    expect(css).toContain("[data-shape='featured']:not([data-design='index'])");
  });

  it('puts everything back on a phone: one column, every card the same', () => {
    const phone = css.slice(css.indexOf('/* The grid\'s shape: bento and featured'));
    /*
     * THE SAME SELECTORS AS THE DESKTOP RULES. A container query does not raise
     * specificity, and a shorter reset was measured doing nothing: the first
     * bento card still spanned two tracks of a one-track grid and the second
     * card was squeezed to zero width. Pinned so nobody tidies it back.
     */
    const reset = rule(
      ".tgs-cards[data-shape='bento']:not([data-design='index']) .tgs-card:first-child,\n"
      + "  .tgs-cards[data-shape='featured']:not([data-design='index']) .tgs-card:first-child {",
      phone,
    );
    expect(reset).toContain('grid-column: auto;');
    expect(reset).toContain('grid-row: auto;');
    const sideways = rule(
      ".tgs-cards[data-shape='featured'][data-design='stacked'][data-image='top'] .tgs-card:first-child {\n    flex-direction: column;",
      phone,
    );
    expect(sideways).toContain('min-height: 0;');
    // Inside the phone container query, not loose.
    const query = phone.indexOf('@container tgs-page (max-width: 767px)');
    expect(query).toBeGreaterThan(-1);
    expect(phone.indexOf(".tgs-cards[data-shape='bento']:not([data-design='index']) .tgs-card:first-child,")).toBeGreaterThan(query);
  });

  it('gives the loop the same two shapes on the span the grid already clamps', () => {
    // --tgs-span is what .tgs-grid__cell clamps to the tracks actually there,
    // so a phone showing one across cannot be asked for two.
    expect(css).toContain(".tgs-loop[data-shape='bento'] .tgs-loop__cell:first-child { --tgs-span: 2; }");
    expect(css).toContain(".tgs-loop[data-shape='featured'] .tgs-loop__cell:first-child { grid-column: 1 / -1; }");
  });
});

// ---------------------------------------------------------------------------
// The gallery's three new shapes
// ---------------------------------------------------------------------------

describe('the mosaic', () => {
  it('is squares and doubles on the plain grid, dense, so nothing shifts as pictures load', () => {
    /*
     * A masonry of natural heights only settles once every picture has loaded
     * and the page shifts under the reader while it does, which the project's
     * CLS of zero forbids. Squares and doubles are sized before a byte arrives.
     */
    expect(css).toContain('.tgs-gallery--mosaic { grid-auto-flow: dense; }');
    expect(css).toContain('.tgs-gallery--mosaic .tgs-gallery__cell:nth-child(12n + 1) { grid-column: span 2; grid-row: span 2; }');
    /*
     * The tall cell needs three pictures after it to fill in beside its lower
     * half, or it stands alone with a hole either side; and the double repeats
     * every TWELVE, not six, because a second double at the seventh left two
     * rows of holes in an eight-picture gallery. Both measured in a browser.
     */
    expect(css).toContain('.tgs-gallery--mosaic .tgs-gallery__cell:nth-child(12n + 5):not(:nth-last-child(-n + 3)) { grid-row: span 2; }');
  });

  it('drops both spans on a phone, where the grid is two squares across', () => {
    const phone = css.slice(css.indexOf('.tgs-gallery--mosaic { grid-auto-flow: dense; }'));
    const query = phone.indexOf('@container tgs-page (max-width: 767px)');
    expect(query).toBeGreaterThan(-1);
    expect(phone.slice(query, query + 400)).toContain('{ grid-column: auto; grid-row: auto; }');
  });

  it('draws as the same grid with the mosaic class on it', () => {
    expect(render).toContain("layout === 'mosaic' ? 'tgs-gallery tgs-gallery--mosaic' : 'tgs-gallery'");
  });
});

describe('the wall', () => {
  it('is rows of the rail, so it inherits the pause and the reduced-motion fallback', () => {
    // Each row carries the rail class; the rail's rules do the rest.
    expect(render).toContain('className="tgs-gallery tgs-gallery--rail tgs-gallery__row"');
    expect(css).toContain('.tgs-gallery-marquee:hover .tgs-gallery--rail,');
    expect(css).toContain(".tgs-gallery--rail > [aria-hidden='true'] { display: none; }");
  });

  it('drifts alternate rows the other way, each on its own period', () => {
    expect(render).toContain("data-dir={at % 2 === 1 ? 'back' : undefined}");
    expect(css).toContain(".tgs-gallery--wall .tgs-gallery__row[data-dir='back'] { animation-direction: reverse; }");
    // No period a multiple of another, or the rows fall into step.
    const match = /const WALL_DURATIONS = \[([\d, ]+)\] as const;/.exec(render);
    expect(match).not.toBeNull();
    const durations = match![1].split(',').map((n) => Number(n.trim()));
    expect(durations).toHaveLength(3);
    for (const a of durations) for (const b of durations) {
      if (a !== b) expect(a % b, `${a} is a multiple of ${b}`).not.toBe(0);
    }
  });

  it('gives a short row four copies rather than two, so a three-picture row shows no seam', () => {
    expect(render).toContain("const extra = row.length < 5 ? ['b', 'c', 'd'] : ['b'];");
  });

  it('keeps every picture its own lightbox id across the rows', () => {
    // The ids are by position in the whole list, so the second row starts
    // where the first ended rather than at zero again.
    expect(render).toContain('strip(false, row, start)');
    expect(render).toContain('const index = offset + at;');
  });

  it('splits into one, two or three rows by how many pictures there are', () => {
    // Ten, the preset's count, is two rows of five: measured as three rows of
    // four, four and two on the first cut, and a two-picture row is not a wall.
    expect(render).toContain('const count = items.length < 4 ? 1 : items.length <= 10 ? 2 : 3;');
  });
});

describe('the deck', () => {
  it('deals up to eight postcards and holds each on top for a few seconds', () => {
    expect(render).toContain('const MAX_DECK = 8;');
    expect(render).toContain('const DECK_HOLD = 3.5;');
    expect(render).toContain("data-count={dealt.length}");
  });

  it('has a keyframe set for every count it can deal', () => {
    for (let count = 2; count <= 8; count += 1) {
      expect(css, `tgs-deck-${count}`).toContain(`@keyframes tgs-deck-${count} {`);
    }
    // Three is the default name, the rest are switched by count.
    for (const count of [2, 4, 5, 6, 7, 8]) {
      expect(css).toContain(`.tgs-gallery--deck[data-count='${count}'] .tgs-gallery__cell { animation-name: tgs-deck-${count}; }`);
    }
  });

  it('starts each card in its own place with a negative delay, the first on top', () => {
    expect(render).toContain('animationDelay: `calc(-1 * ${subset.length - at} * var(--tgs-deck-cycle) / ${subset.length})`');
  });

  it('every walk starts and ends on top, and the top place is the same in every set', () => {
    const top = 'transform: translate(0, 0) rotate(0deg) scale(1); z-index: 9;';
    for (let count = 2; count <= 8; count += 1) {
      const set = rule(`@keyframes tgs-deck-${count} {`);
      const body = css.slice(css.indexOf(`@keyframes tgs-deck-${count} {`));
      const block = body.slice(0, body.indexOf('\n}'));
      expect(set).toContain(`0%, `);
      expect(block.startsWith(`@keyframes tgs-deck-${count} {\n  0%,`)).toBe(true);
      expect(block).toContain(`100% { ${top} }`);
    }
  });

  it('holds still and fanned on the canvas, with one picture, and under reduced motion', () => {
    expect(render).toContain("data-still={editing || dealt.length < 2 ? 'true' : undefined}");
    expect(css).toContain(".tgs-gallery--deck[data-still='true'] .tgs-gallery__cell { animation: none; }");
    // The fan at rest is the same places the walk visits.
    const still = rule(".tgs-gallery--deck[data-still='true'] .tgs-gallery__cell:nth-child(2) {");
    expect(still).toContain('translate(-5%, 3%) rotate(-5deg) scale(0.96)');
    const reduced = css.slice(css.indexOf('/* ---- The deck ---- */'));
    const query = reduced.indexOf('@media (prefers-reduced-motion: reduce)');
    // Three selectors deep, to match the per-count rule that picks the walk: a
    // two-deep `animation: none` lost to it and the deck kept dealing.
    expect(reduced.slice(query, query + 600)).toContain('.tgs-gallery--deck[data-count] .tgs-gallery__cell { animation: none; }');
  });

  it('pauses under the pointer and under keyboard focus', () => {
    expect(css).toContain('.tgs-gallery--deck:hover .tgs-gallery__cell,');
    expect(css).toContain('.tgs-gallery--deck:focus-within .tgs-gallery__cell { animation-play-state: paused; }');
  });

  it('is the editor that says the canvas is editing, the same way the shifting collage is told', () => {
    const renderer = read('components', 'render', 'BlockRenderer.tsx');
    expect(renderer).toContain('<GalleryBlock props={props} blockId={block.id} editing={editable} />');
  });
});

// ---------------------------------------------------------------------------
// The presets that put the shapes in the picker
// ---------------------------------------------------------------------------

describe('the four designed sections', () => {
  it('exist, one per shape, in the category a client would look in', () => {
    expect(presetById('features-bento-destinations')?.category).toBe('features');
    expect(presetById('gallery-mosaic')?.category).toBe('gallery');
    expect(presetById('hero-photo-wall')?.category).toBe('hero');
    expect(presetById('gallery-deck-beside-words')?.category).toBe('gallery');
  });

  it('build to sections carrying the shape they promise', () => {
    const bento = buildPresetSection(presetById('features-bento-destinations')!);
    const cards = bento.rows[1].columns[0].blocks[0];
    expect(cards.type).toBe('cards');
    expect(cards.props.shape).toBe('bento');
    expect(cards.props.design).toBe('overlay');
    // Six, so the bento closes on a full row: one big, two beside, three below.
    // Five was measured a card short on the last row.
    expect((cards.props.items as unknown[]).length).toBe(6);

    const mosaic = buildPresetSection(presetById('gallery-mosaic')!);
    expect(mosaic.rows[1].columns[0].blocks[0].props.layout).toBe('mosaic');

    const wall = buildPresetSection(presetById('hero-photo-wall')!);
    expect(wall.rows[1].columns[0].blocks[0].props.layout).toBe('wall');

    const deck = buildPresetSection(presetById('gallery-deck-beside-words')!);
    expect(deck.rows[0].columns[1].blocks[0].props.layout).toBe('deck');
  });

  it('photograph on insert with the frame count each shape needs', () => {
    // A wall is two rows of five, a mosaic fills its rows at eight, a deck is
    // four postcards. One Pexels search returns twenty-four, so each is one query.
    const frames = (id: string) =>
      sectionPhotoTargets(presetById(id)!, 0).filter((t) => t.place.kind === 'gallery').length;
    expect(frames('hero-photo-wall')).toBe(10);
    expect(frames('gallery-mosaic')).toBe(8);
    expect(frames('gallery-deck-beside-words')).toBe(4);
    // And the bento's six cards each get their own picture.
    expect(sectionPhotoTargets(presetById('features-bento-destinations')!, 0)
      .filter((t) => t.place.kind === 'card')).toHaveLength(6);
  });

  it('preview with a photograph in the picker, not a grey frame', () => {
    for (const id of ['gallery-mosaic', 'hero-photo-wall', 'gallery-deck-beside-words']) {
      expect(presetThumb(presetById(id)!).bars.some((bar) => bar.query), id).toBe(true);
    }
    // The deck previews as one postcard-sized frame, the wall as rows of small
    // ones, so the three thumbnails read as three shapes.
    const deckBars = presetThumb(presetById('gallery-deck-beside-words')!).bars.filter((b) => b.tone === 'frame');
    expect(deckBars).toHaveLength(1);
    const wallBars = presetThumb(presetById('hero-photo-wall')!).bars.filter((b) => b.tone === 'frame');
    expect(wallBars).toHaveLength(2);
  });
});
