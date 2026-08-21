/**
 * Accordion and Tabs: panels with one open, and no JavaScript behind either.
 *
 * WHAT IS WORTH TESTING HERE. Both blocks make the same promise the Menu makes,
 * that the BROWSER does the opening and closing, and both keep it with a
 * mechanism that is easy to undo by accident:
 *
 *   Accordion  a `name` on the details elements, which is what makes them
 *              exclusive. Remove it and they all open at once, silently.
 *   Tabs       hidden radios that are SIBLINGS of the panels, paired by
 *              data-index. Reorder the markup, or reach for :nth-of-type, and
 *              every heading opens the wrong panel.
 *
 * And one number that lives in three places: the most tabs the stylesheet can
 * show, the block's own cap, and the slice in the renderer. A ninth tab would
 * draw a heading that opens nothing at all.
 *
 * Whether they actually open is measured in the browser harness. Node can read
 * a `name` attribute; only a browser can tell you the second panel shut when
 * the third was clicked.
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

const blocksSource = source('components', 'render', 'blocks.tsx');
const css = source('app', 'globals.css');

/** A block's props after a real parse and a real sanitise. */
function stored(type: string, props: Record<string, unknown>): Record<string, unknown> {
  const page = createPage('Test', 'test');
  const section = createSectionFromLayout(LAYOUTS[0]);
  section.rows[0].columns[0].blocks = [{ id: newId('b'), type, props }];
  page.sections = [section];

  const parsed = parsePage(page);
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return sanitisePage(parsed.page).sections[0].rows[0].columns[0].blocks[0].props;
}

// ---------------------------------------------------------------------------

describe('both blocks', () => {
  for (const type of ['accordion', 'tabs'] as const) {
    it(`${type} is in the library, under Text, and belongs to the client`, () => {
      expect(isKnownBlock(type)).toBe(true);
      const definition = blockDefinition(type)!;
      expect(definition.group).toBe('Show and hide');
      expect(definition.staffOnly).toBeUndefined();
    });

    it(`${type} sets a default for every field the editor offers`, () => {
      const props = defaultPropsFor(type);
      for (const field of blockDefinition(type)!.fields) {
        expect(props, `no default for "${field.key}"`).toHaveProperty(field.key);
      }
    });

    it(`${type} arrives with real content rather than empty rows`, () => {
      const items = defaultPropsFor(type).items as Array<Record<string, unknown>>;
      expect(items.length).toBeGreaterThan(1);
      expect(items.every((item) => typeof item.title === 'string' && item.title !== '')).toBe(true);
      expect(items.every((item) => typeof item.body === 'string' && item.body !== '')).toBe(true);
    });

    it(`${type} keeps its own defaults through a parse and a sanitise`, () => {
      const props = stored(type, defaultPropsFor(type));
      expect((props.items as unknown[]).length).toBe(3);
    });

    /*
     * PLAIN TEXT, NOT RICH TEXT, and that is a decision rather than a shortcut.
     * A textarea inside a repeater is escaped by React on the way out, so there
     * is nothing to strip and nothing that can carry markup. The day either of
     * these takes a `richtext` field, sanitise-page.ts has to know about it.
     */
    it(`${type} takes plain text, so nothing in it can carry markup`, () => {
      const repeater = blockDefinition(type)!.fields.find((field) => field.key === 'items');
      expect(repeater?.kind).toBe('repeater');
      if (repeater?.kind !== 'repeater') return;

      expect(repeater.fields.map((field) => field.kind).sort()).toEqual(['text', 'textarea']);

      const props = stored(type, {
        items: [{ title: '<b>Bold</b>', body: '<script>alert(1)</script>' }],
      });
      const items = props.items as Array<Record<string, unknown>>;
      // Kept as characters, exactly as typed. React turns them into text.
      expect(items[0].title).toBe('<b>Bold</b>');
      expect(items[0].body).toBe('<script>alert(1)</script>');
    });
  }

  it('a run of text becomes paragraphs on blank lines, not one wall', () => {
    // Both blocks share `paragraphs`. Without it, pressing Enter twice in the
    // properties pane produces nothing visible and reads as a bug.
    const helper = /function paragraphs\(text: string\)[\s\S]*?\n\}/.exec(blocksSource)?.[0] ?? '';
    expect(helper).toContain('split(/\\n{2,}/)');
    expect(helper).toContain('<p key={index}>');
  });
});

// ---------------------------------------------------------------------------

describe('the accordion opens without a script', () => {
  const render = /export function AccordionBlock\(([\s\S]*?)\nexport const MAX_TABS/.exec(blocksSource)?.[1] ?? '';

  it('there is an AccordionBlock to read at all', () => {
    expect(render.length).toBeGreaterThan(400);
  });

  it('uses details and summary rather than a div and a handler', () => {
    expect(render).toContain('<details');
    expect(render).toContain('<summary className="tgs-accordion__head">');
    // Nothing in the render tree may carry a handler: it is server components
    // all the way down and there is no bundle to attach one from.
    expect(render).not.toMatch(/onClick|onChange|onToggle/);
  });

  /*
   * THE `name` IS WHAT MAKES THEM EXCLUSIVE, and it is the browser doing it.
   * Take it away and every panel can be open at once, with no error anywhere.
   */
  it('makes them exclusive with a name, gated on the setting', () => {
    expect(render).toContain('name: `tgs-acc-${blockId}`');
    expect(render).toContain('...(single ? {');
  });

  it('takes that name from the block rather than making one up', () => {
    // Generated here it would change on every render, so the server and the
    // client would disagree and React would complain about the mismatch.
    expect(render).not.toMatch(/Math\.random|useId|Date\.now/);
    expect(blocksSource).toContain('blockId: string;');
  });

  it('the browser marker is hidden, so there is one control and not two', () => {
    expect(css).toContain('.tgs-accordion__head::-webkit-details-marker { display: none; }');
    const head = /\.tgs-accordion__head \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(head).toContain('list-style: none');
  });

  it('one open at a time is the default, because that is what an accordion is', () => {
    expect(defaultPropsFor('accordion').single).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('the tabs open without a script', () => {
  const render = /export function TabsBlock\(([\s\S]*?)\n\/\/ ---/.exec(blocksSource)?.[1] ?? '';

  it('there is a TabsBlock to read at all', () => {
    expect(render.length).toBeGreaterThan(400);
  });

  it('is radio buttons and labels, not a scripted tablist', () => {
    expect(render).toContain('type="radio"');
    expect(render).toContain('<label');
    expect(render).not.toMatch(/onClick|onChange/);
    /*
     * AND IT DOES NOT CLAIM TO BE A TABLIST. role="tablist" without the
     * behaviour behind it, roving focus and aria-selected, is worse for a screen
     * reader than plain radios that work. See the note on the block.
     */
    expect(render).not.toContain('role="tablist"');
    expect(render).not.toContain('role="tab"');
  });

  it('leaves the browser in charge of which one is open', () => {
    // `checked` would be controlled, and the editor canvas re-renders on every
    // keystroke, so the panel would snap back to the first one as somebody typed.
    expect(render).toContain('defaultChecked={index === 0}');
    expect(render).not.toMatch(/\bchecked=\{/);
  });

  /*
   * THE ORDER OF THE MARKUP IS THE MECHANISM. `~` only looks forward, so every
   * radio has to come before the panels it reveals and before the list of
   * headings it lights. Move the panels above the radios and every tab stops
   * working, with nothing to see in any console.
   */
  it('puts the radios before the headings and the panels, which is what makes it work', () => {
    // The className attributes, not the class names, or the doc comment above
    // this component counts as an occurrence and the order reads as broken.
    const radios = render.indexOf('type="radio"');
    const list = render.indexOf('className="tgs-tabs__list"');
    const panel = render.indexOf('className="tgs-tabs__panel"');

    expect(radios).toBeGreaterThan(-1);
    expect(radios).toBeLessThan(list);
    expect(list).toBeLessThan(panel);
  });

  /*
   * data-index, NOT :nth-of-type. The first version of this stylesheet used
   * :nth-of-type, which counts by ELEMENT type: the headings list is a div as
   * well, so every panel sat one place further along than the rule expected and
   * tab one opened nothing.
   */
  it('pairs a radio with its panel by a written-down position', () => {
    expect(render).toContain('data-index={index}');

    const tabRules = css.split('\n').filter((line) => line.includes('.tgs-tabs__'));
    expect(tabRules.some((line) => line.includes(':nth-of-type'))).toBe(false);
    expect(tabRules.some((line) => line.includes("data-index='0'"))).toBe(true);
  });

  it('gives the focus ring to the heading, since the radio cannot be seen', () => {
    expect(css).toContain(":focus-visible ~ .tgs-tabs__list .tgs-tabs__tab[data-index='0']");
    const ring = css.slice(css.indexOf(':focus-visible ~ .tgs-tabs__list'));
    expect(ring).toContain('outline: 3px solid var(--tgs-accent)');
  });

  /*
   * ONE NUMBER, THREE PLACES. CSS cannot count to "however many tabs there
   * are", so a panel is revealed by one rule per position. If the block's cap
   * ever exceeds the number of rules, the extra tabs render headings that open
   * nothing, and nothing anywhere would say so.
   */
  it('caps the tabs at the number of rules the stylesheet actually has', () => {
    const declared = /export const MAX_TABS = (\d+);/.exec(blocksSource)?.[1];
    expect(declared, 'MAX_TABS has gone').toBeTruthy();
    const max = Number(declared);

    const repeater = blockDefinition('tabs')!.fields.find((field) => field.key === 'items');
    expect(repeater?.kind === 'repeater' && repeater.max).toBe(max);

    expect(render).toContain('.slice(0, MAX_TABS)');

    // One selector per position in the rule that shows a panel, and the highest
    // position is max - 1.
    const showPanels = /(\.tgs-tabs__radio\[data-index='\d'\]:checked ~ \.tgs-tabs__panel[\s\S]*?)\{/.exec(css)?.[1] ?? '';
    const positions = [...showPanels.matchAll(/\.tgs-tabs__panel\[data-index='(\d)'\]/g)]
      .map((match) => Number(match[1]));

    expect(positions).toHaveLength(max);
    expect(Math.max(...positions)).toBe(max - 1);
  });
});
