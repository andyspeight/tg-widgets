/**
 * The Cards block.
 *
 * WHAT IS WORTH TESTING, given the block itself is data and its component is
 * JSX this runner cannot import (see vitest.config.ts):
 *
 *   1. The DEFAULTS. This is the one block whose defaults are a small piece of
 *      content rather than an empty shell, so an agent dropping it on a page
 *      sees a real grid straight away. That only works if the keys the renderer
 *      reads and the keys the defaults set are the same set, and nothing else
 *      checks that.
 *   2. The choices that are deliberately NARROWER than the shared option lists.
 *      Each one is a decision with a reason, and a decision expressed only as a
 *      `.filter()` is a decision somebody will helpfully undo.
 *   3. The two CSS constructions that are load-bearing rather than cosmetic:
 *      the covering pseudo-element that makes a card clickable with one link,
 *      and the @supports pairing that stops a keyboard user losing focus.
 *
 * The grid's appearance is checked in the browser harness. Node cannot tell you
 * whether four cards became two on a tablet.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blockDefinition, defaultPropsFor, isKnownBlock } from '../lib/content/blocks';
import { sanitisePage } from '../lib/content/sanitise-page';
import { createPage, createSectionFromLayout, newId } from '../lib/content/factory';
import { LAYOUTS } from '../lib/content/layouts';
import { parsePage } from '../lib/content/schema';

function source(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

// ---------------------------------------------------------------------------

describe('the Cards block', () => {
  const definition = blockDefinition('cards')!;

  it('is in the library, under Cards and lists, and belongs to the client', () => {
    expect(isKnownBlock('cards')).toBe(true);
    expect(definition.group).toBe('Cards and lists');
    // Nothing an agent types here becomes code, so there is nothing to gate.
    expect(definition.staffOnly).toBeUndefined();
  });

  /*
   * THE KEYS HAVE TO LINE UP THREE WAYS: what the defaults set, what the editor
   * offers, and what the renderer reads. This checks the first two against each
   * other and names the third, which the browser harness covers by actually
   * drawing one.
   */
  it('sets a default for every field the editor offers', () => {
    const props = defaultPropsFor('cards');
    for (const field of definition.fields) {
      expect(props, `no default for "${field.key}"`).toHaveProperty(field.key);
    }
  });

  it('every card in the defaults carries every field a card has', () => {
    const repeater = definition.fields.find((field) => field.key === 'items');
    expect(repeater?.kind).toBe('repeater');
    if (repeater?.kind !== 'repeater') return;

    const items = defaultPropsFor('cards').items as Array<Record<string, unknown>>;
    expect(items.length).toBeGreaterThan(1);

    for (const item of items) {
      for (const field of repeater.fields) {
        expect(item, `a default card has no "${field.key}"`).toHaveProperty(field.key);
      }
    }
  });

  it('arrives with real content rather than an empty shell', () => {
    // The point of a grid is seeing the grid. A block that drew three blank
    // rectangles would leave an agent guessing what it is for.
    const items = defaultPropsFor('cards').items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(3);
    expect(items.every((item) => typeof item.title === 'string' && item.title !== '')).toBe(true);
  });

  /*
   * NO "ORIGINAL" SHAPE, and this is the block's central decision rather than an
   * oversight. Pictures of three different heights in one row is exactly the mess
   * a grid exists to prevent, and it is what happens the moment one card's
   * photograph is a portrait.
   */
  it('refuses to offer an original picture shape, which a single image does offer', () => {
    const ratio = definition.fields.find((field) => field.key === 'ratio');
    expect(ratio?.kind).toBe('select');
    if (ratio?.kind !== 'select') return;

    expect(ratio.options.map((option) => option.value)).not.toContain('auto');
    expect(ratio.options.length).toBeGreaterThan(2);

    // The single Image block still offers it, which is the contrast that makes
    // the line above a decision rather than a missing option.
    const image = blockDefinition('image')!.fields.find((field) => field.key === 'ratio');
    expect(image?.kind === 'select' && image.options.some((o) => o.value === 'auto')).toBe(true);
  });

  it('offers left and centre alignment but not right', () => {
    const align = definition.fields.find((field) => field.key === 'align');
    expect(align?.kind).toBe('select');
    if (align?.kind !== 'select') return;

    // Right-aligned card text reads as a mistake in every design anybody wants.
    expect(align.options.map((option) => option.value)).toEqual(['left', 'centre']);
  });

  it('makes the whole card clickable by default, since that is what a card is', () => {
    expect(defaultPropsFor('cards').wholeCardLinks).toBe(true);
  });

  it('summarises itself by how many cards there are', () => {
    expect(definition.summarise?.({ items: [{}, {}, {}] })).toBe('Cards (3)');
    expect(definition.summarise?.({})).toBe('Cards (0)');
  });

  it('its own defaults survive a parse and a sanitise unchanged', () => {
    const page = createPage('Test', 'test');
    const section = createSectionFromLayout(LAYOUTS[0]);
    section.rows[0].columns[0].blocks = [
      { id: newId('b'), type: 'cards', props: defaultPropsFor('cards') },
    ];
    page.sections = [section];

    const parsed = parsePage(page);
    expect(parsed.ok, parsed.ok ? '' : parsed.errors.join('; ')).toBe(true);
    if (!parsed.ok) return;

    const items = sanitisePage(parsed.page).sections[0].rows[0].columns[0].blocks[0].props
      .items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(3);
    expect(items[0].title).toBe('Island hopping, planned properly');
  });
});

// ---------------------------------------------------------------------------

describe('one link per card, never two', () => {
  const blocks = source('components', 'render', 'blocks.tsx');
  const card = /function renderCard\(([\s\S]*?)\nexport function CardsBlock/.exec(blocks)?.[1] ?? '';

  it('there is a renderCard to read at all', () => {
    // If this file is ever restructured, everything below is reading an empty
    // string and passing for the wrong reason.
    expect(card.length).toBeGreaterThan(200);
  });

  it('the card is an article, not an anchor wrapped round everything', () => {
    /*
     * The obvious markup wraps the card in an <a> so all of it is clickable, and
     * then the "See the trip" link inside it is an anchor inside an anchor. That
     * is invalid, browsers repair it by hoisting one out, and it puts every card
     * in the tab order twice.
     */
    expect(card).toContain('<article className="tgs-card"');
    expect(card).not.toContain('<a className="tgs-card"');
  });

  it('the card holds exactly one anchor, and only when there is somewhere to go', () => {
    const anchors = card.match(/<a\s/g) ?? [];
    expect(anchors).toHaveLength(1);
    // Both an address AND a label. A bare arrow with no words is not a link
    // anybody can read out.
    expect(card).toContain('{href && linkLabel && (');
  });

  it('a card with nothing in it is not drawn', () => {
    // Facts count as something to say: a tour card can be a price and a
    // number of nights with no summary typed under it yet.
    expect(card).toContain(
      'if (!title && !body && !label && !src && !icon && facts.length === 0) return null;',
    );
  });
});

// ---------------------------------------------------------------------------

describe('the card stylesheet', () => {
  const css = source('app', 'globals.css');

  /*
   * THE CONSTRUCTION THAT MAKES THE WHOLE CARD CLICKABLE. Without the covering
   * pseudo-element the toggle in the editor does nothing at all, silently, and
   * the only symptom is that clicking a card does not work.
   */
  it('covers the card with the link rather than wrapping it', () => {
    const rule = /\.tgs-cards\[data-whole='true'\] \.tgs-card__link::after \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toContain('position: absolute');
    expect(rule).toContain('inset: 0');
  });

  /*
   * THE ONE THAT WOULD BE AN ACCESSIBILITY BUG IF IT DRIFTED. Moving the focus
   * ring onto the card needs :has(). Taking it off the link does not. Split
   * apart, a browser without :has() applies only the second and a keyboard user
   * gets no visible focus at all. They have to stay in one @supports together.
   */
  it('moves the focus ring to the card and removes it from the link together', () => {
    // There is more than one @supports selector(:has(*)) block in the stylesheet
    // now (the collection loop's whole-card link has its own), so pick the card's
    // by the selector it contains rather than assuming it is the first.
    const supports =
      [...css.matchAll(/@supports selector\(:has\(\*\)\) \{([\s\S]*?)\n\}/g)]
        .map((match) => match[1])
        .find((body) => body.includes('.tgs-card__link')) ?? '';

    expect(supports, 'the @supports block has gone').not.toBe('');
    expect(supports).toContain(':has(.tgs-card__link:focus-visible)');
    expect(supports).toContain('outline: 3px solid var(--tgs-accent)');
    expect(supports).toContain(".tgs-cards[data-whole='true'] .tgs-card__link:focus-visible { outline: none; }");

    // And nothing removes the link's outline from outside the guard. Strip every
    // @supports(:has()) block, not just the first: the loop's whole-card link
    // added another, and the card's must not be the one left behind.
    const outside = css.replace(/@supports selector\(:has\(\*\)\) \{[\s\S]*?\n\}/g, '');
    expect(outside).not.toContain('.tgs-card__link:focus-visible');
  });

  it('stops a long word forcing the grid wider, the guard a column already has', () => {
    const rule = /\n\.tgs-card \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toContain('min-width: 0');
    expect(rule).toContain('position: relative');
  });

  it('clips the picture to the frame, so one portrait photograph cannot stretch a row', () => {
    const frame = /\.tgs-card__frame \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(frame).toContain('overflow: hidden');

    // Anchored to the line start so it lands on the base rule, not a nested
    // selector that ends in the same words (e.g. the hover-zoom motion rule).
    const img = /\n\.tgs-card__frame img \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(img).toContain('object-fit: cover');
    // The guard against the open bug where an image renders wider than the
    // thing holding it (task #61). A card must not be able to join in.
    expect(img).toContain('max-width: 100%');
  });

  /*
   * THE PHONE RULE HAS TO NAME EVERY COLUMN COUNT, and this is the check for a
   * bug that shipped past a reading of the file. A container query does not
   * change specificity, so `.tgs-cards[data-columns='3']` at (0,2,0) beats a
   * plain `.tgs-cards` at (0,1,0) wherever it sits. Written the short and
   * obvious way the rule did nothing at all and cards stayed three abreast on a
   * phone. The browser suite caught it by measuring; this catches it by reading,
   * which is the cheaper of the two.
   */
  it('goes to one across on a phone, at a specificity that can win', () => {
    const phone = /@container tgs-page \(max-width: 767px\) \{\s*\/\*\s*\n?\s*\* One across([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';

    expect(phone, 'the phone block has moved or gone').not.toBe('');
    for (const count of ['2', '3', '4']) {
      expect(phone, `data-columns='${count}' is not brought down to one`)
        .toContain(`.tgs-cards[data-columns='${count}']`);
    }
    expect(phone).toContain('grid-template-columns: 1fr;');
    expect(phone).toContain("data-image='left'] .tgs-card { flex-direction: column; }");
  });

  it('takes the card title from the theme, all five properties of it', () => {
    const title = /\.tgs-card__title \{([^}]*)\}/.exec(css)?.[1] ?? '';
    for (const token of ['font', 'weight', 'size', 'leading', 'tracking']) {
      expect(title, `the card title picks its own ${token}`).toContain(`--tgs-h4-${token}`);
    }
  });
});

// ---------------------------------------------------------------------------

/**
 * EVERY BOX CONTROL REACHES THE CARD, not the container behind it.
 *
 * Andy, twice: "the styling appears to be attached to the block, not the
 * individual card", then a fortnight later "the padding of the cards is also
 * applying to the block not the cards". The second one is the interesting one,
 * because the first was supposedly fixed and had a test. That test asserted the
 * lines I had written were present, so it passed while padding still went to the
 * wrong element: it could only ever confirm the fix I had already made.
 *
 * So this checks the CONTRACT instead: whatever set of controls the panel
 * offers, each one has to be emitted for the card and consumed by a rule that
 * paints a card. A control added to BoxPanel and not wired for cards fails here
 * with the name of the control, which is the failure the last round needed and
 * did not have.
 */
describe('the box controls target the card, not the block', () => {
  const css = source('app', 'globals.css');
  const controls = source('components', 'editor', 'BoxControls.tsx');
  const renderer = source('components', 'render', 'PageRenderer.tsx');

  /**
   * What BoxPanel actually lets a client change, read off the panel itself.
   *
   * SLICED TO THE NEXT EXPORT rather than matched with a lazy brace. The first
   * version of this used /export function BoxPanel\(\{[\s\S]*?\n\}/, which ends
   * at the closing brace of the DESTRUCTURED PARAMETERS, four lines in. It
   * returned a non-empty string, passed the guard below, and yielded no controls
   * at all, so both loops ran zero times and reported green. Caught by reverting
   * the fix and finding only one of three tests failed.
   */
  function offered(): string[] {
    const start = controls.indexOf('export function BoxPanel(');
    expect(start, 'BoxPanel has moved or been renamed').toBeGreaterThan(-1);
    const rest = controls.slice(start + 1);
    const end = rest.indexOf('\nexport ');
    const panel = end === -1 ? rest : rest.slice(0, end);
    const found = [...new Set([...panel.matchAll(/patch\(\{\s*(\w+)/g)].map((m) => m[1]))];
    /*
     * The guard that makes the rest of this block mean something. Every test
     * here loops over this list, so an extraction that quietly returns nothing
     * passes all of them. Naming padding specifically because padding is the
     * control that was broken when this was written.
     */
    expect(found, 'the controls could not be read out of BoxPanel').toContain('padding');
    expect(found.length, 'BoxPanel offers fewer controls than it used to').toBeGreaterThanOrEqual(5);
    return found;
  }

  /*
   * The card-side property each control has to end up as. Kept as a map rather
   * than derived, because the point is to notice a control that has NO answer:
   * an unlisted key fails the last test in this block by name.
   */
  const CARD_PROPERTY: Record<string, string> = {
    padding: '--tgs-card-pt',
    background: '--tgs-card-bg',
    radius: '--tgs-card-radius',
    borderWidth: '--tgs-card-bw',
    borderColour: '--tgs-card-bc',
    // Not a custom property: the shadow rides the same data-shadow attribute the
    // block uses, re-pointed at the card. Checked separately below.
    shadow: 'data-shadow',
  };

  it('offers the controls this block knows how to answer, and no others', () => {
    for (const control of offered()) {
      expect(
        CARD_PROPERTY[control],
        `BoxPanel offers "${control}" and nothing here says how a CARD gets it. ` +
          'Wire it in cardBox in PageRenderer and add a rule that paints .tgs-card, ' +
          'then add it to CARD_PROPERTY.',
      ).toBeTruthy();
    }
  });

  it('emits each one as a card property rather than only a block one', () => {
    for (const control of offered()) {
      const property = CARD_PROPERTY[control];
      if (!property || property === 'data-shadow') continue;
      expect(renderer, `cardBox never emits ${property} for "${control}"`).toContain(property);
    }
  });

  it('has a rule painting a card for each one, not just the block', () => {
    for (const control of offered()) {
      const property = CARD_PROPERTY[control];
      if (!property || property === 'data-shadow') continue;
      // borderColour rides the border rule rather than carrying its own.
      const key = control === 'borderColour' ? '--tgs-card-bw' : property;
      const rule = new RegExp(
        `\\[data-box-target='card'\\][^{]*${key.replace(/[-]/g, '-')}[^{]*\\{[^}]*\\}`,
      ).exec(css)?.[0];
      expect(rule, `no CSS applies ${property} to a card`).toBeTruthy();
      expect(rule, `the ${control} rule does not paint a card`).toMatch(/\.tgs-card/);
    }
  });

  it('paints the shadow on the card and takes it off the block', () => {
    for (const strength of ['soft', 'medium', 'strong']) {
      expect(css, `a ${strength} shadow never reaches the card`)
        .toContain(`[data-box-target='card'][data-shadow='${strength}'] .tgs-card`);
    }
    const container = /\.tgs-block\[data-boxed\]\[data-box-target='card'\] \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(container, 'the container rule has moved').not.toBe('');
    // The four the container must stop drawing itself, or they land twice.
    expect(container).toContain('box-shadow: none');
    expect(container).toContain('border: 0');
    expect(container).toContain('background-image: none');
    expect(container).toContain('padding: 0');
  });
});
