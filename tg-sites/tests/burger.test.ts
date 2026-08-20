/**
 * The Menu's burger: never, on phones, or at every width.
 *
 * WHAT IS WORTH TESTING HERE, and it is mostly one thing. Andy asked on 20 Aug
 * 2026 for a burger that can be on at every width, which the old boolean
 * `collapse` could not express. Turning a saved field from a toggle into a
 * choice of three is the sort of change that works perfectly on a fresh block
 * and silently breaks every menu a client already has, so:
 *
 *   1. The old values still read correctly, in BOTH directions. `false` was a
 *      real choice — every footer preset makes it — and reading it as anything
 *      but 'never' would put a burger in a footer.
 *   2. Our own presets moved to the new spelling, because two spellings in
 *      source we control is drift.
 *   3. The markup and the stylesheet agree about which mode draws what.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BURGER_MODES, burgerMode, hasBurger, showsRow } from '../lib/content/burger';
import { blockDefinition, defaultPropsFor } from '../lib/content/blocks';
import { REGION_PRESETS } from '../lib/content/presets-region';
import type { SectionPreset } from '../lib/content/preset-types';

const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
const nav = readFileSync(join(__dirname, '..', 'components', 'render', 'blocks.tsx'), 'utf8');

// ---------------------------------------------------------------------------
// Reading the field
// ---------------------------------------------------------------------------

describe('burgerMode', () => {
  it('reads each of the three answers', () => {
    expect(burgerMode('never')).toBe('never');
    expect(burgerMode('phone')).toBe('phone');
    expect(burgerMode('always')).toBe('always');
  });

  /*
   * THE ONE THAT MATTERS. Every menu saved before 20 Aug 2026 holds a boolean,
   * and there is no migration by design (see the header of lib/content/burger.ts
   * for why). If either of these two lines goes, a client's header changes
   * without anybody touching it.
   */
  it('reads a menu saved before the field became a choice', () => {
    expect(burgerMode(true)).toBe('phone');
    expect(burgerMode(false)).toBe('never');
  });

  it('treats a missing value as the default rather than as off', () => {
    // Not 'never'. An absent field is a block that has never been touched, and
    // a header with no phone menu at all is the worse of the two guesses.
    expect(burgerMode(undefined)).toBe('phone');
    expect(burgerMode(null)).toBe('phone');
  });

  it('degrades an unknown value to a working menu', () => {
    // A value written by a later release this one has not heard of. A menu is
    // better than no menu.
    expect(burgerMode('overlay')).toBe('phone');
    expect(burgerMode(42)).toBe('phone');
    expect(burgerMode({})).toBe('phone');
  });

  it('does not read a truthy string as the old true', () => {
    // '' and 'true' are not the boolean, and coercing them would be how a typo
    // in stored data quietly becomes a mode.
    expect(burgerMode('true')).toBe('phone');
    expect(burgerMode('')).toBe('phone');
  });
});

describe('what each mode draws', () => {
  it('has a burger unless it is set to never', () => {
    expect(hasBurger('never')).toBe(false);
    expect(hasBurger('phone')).toBe(true);
    expect(hasBurger('always')).toBe(true);
  });

  it('shows the row of links unless the burger is always on', () => {
    expect(showsRow('never')).toBe(true);
    expect(showsRow('phone')).toBe(true);
    // The whole point of 'always': the links are behind the button by choice.
    expect(showsRow('always')).toBe(false);
  });

  it('covers every mode between the two of them, with no dead combination', () => {
    for (const mode of BURGER_MODES) {
      // Something is always drawn: a row, a burger, or both. A mode that drew
      // neither would be a menu that renders nothing.
      expect(hasBurger(mode) || showsRow(mode)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The field, and our own data
// ---------------------------------------------------------------------------

describe('the field', () => {
  it('offers exactly the three modes, spelled as burgerMode reads them', () => {
    const field = blockDefinition('nav')!.fields.find((f) => f.key === 'collapse') as
      { kind: string; options: Array<{ value: string }> };

    expect(field.kind).toBe('select');
    expect(field.options.map((option) => option.value)).toEqual([...BURGER_MODES]);
  });

  it('still defaults to a phone menu', () => {
    expect(burgerMode(defaultPropsFor('nav').collapse)).toBe('phone');
  });

  /*
   * OUR SOURCE USES THE NEW SPELLING. burgerMode would read the old booleans
   * perfectly well, which is exactly why this is asserted rather than left to
   * notice: a codebase carrying two spellings for one field is how the second
   * one gets forgotten.
   */
  it('every preset menu is written in the new spelling', () => {
    const source = readFileSync(
      join(__dirname, '..', 'lib', 'content', 'presets-region.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/collapse:\s*(true|false)/);
  });

  /*
   * THE FOOTER RULE IS TESTED IN tests/presets.test.ts, not here, beside the
   * other footer preset checks and the reason it exists. Repeating it would be
   * two places to update the next time the field changes shape, which is exactly
   * the trap that made this change more work than it looked.
   */
  it('and every header preset that has a menu still has a working one', () => {
    const headers = REGION_PRESETS.filter((preset) => preset.category === 'header');
    expect(headers.length).toBeGreaterThan(0);

    let checked = 0;
    for (const preset of headers) {
      for (const block of navBlocksIn(preset)) {
        checked += 1;
        // Any of the three is a legitimate design choice for a header. What
        // must not happen is a preset landing on a mode by accident because its
        // value stopped being read.
        expect(BURGER_MODES).toContain(burgerMode(block.props?.collapse));
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

/** Every Menu block in a preset, including any nested inside a container. */
function navBlocksIn(preset: SectionPreset): Array<{ props?: Record<string, unknown> }> {
  const out: Array<{ props?: Record<string, unknown> }> = [];

  const walk = (blocks: unknown) => {
    if (!Array.isArray(blocks)) return;
    for (const raw of blocks) {
      const block = raw as { type?: string; props?: Record<string, unknown> };
      if (block?.type === 'nav') out.push(block);
      const inner = block?.props?.columns;
      if (Array.isArray(inner)) for (const column of inner) walk(column);
    }
  };

  for (const row of preset.rows) {
    for (const column of row.columns ?? []) walk(column);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The markup and the stylesheet, which have to agree
// ---------------------------------------------------------------------------

describe('the always-on burger', () => {
  it('names the mode on the nav, so the stylesheet can see it', () => {
    expect(nav).toContain('data-burger={burger}');
    expect(css).toContain(".tgs-nav[data-burger='always'] .tgs-nav__disclosure { display: block; }");
  });

  it('does not render the row at all rather than hiding it', () => {
    // Hidden markup is still markup a screen reader may reach. The row is a
    // conditional in the component, and the `phone` mode is the only one that
    // still marks its row for the stylesheet to hide at a breakpoint.
    expect(nav).toContain('{showsRow(burger) && (');
    expect(nav).toContain("data-collapse={burger === 'phone' ? 'true' : undefined}");
  });

  /*
   * BOTH OF THE NEXT TWO ARE BUGS THAT WERE IN THIS FEATURE AND WERE FOUND BY
   * OPENING IT IN A BROWSER, not by reading the CSS. They are written down here
   * because both look correct on the page and neither is obvious from the rule.
   */
  it('clears the header padding rather than stopping where the content stops', () => {
    const panel = css.slice(
      css.indexOf(".tgs-nav[data-burger='always'] .tgs-nav__disclosure[open] .tgs-nav__list--stacked {"),
    );
    const rule = panel.slice(0, panel.indexOf('}'));

    expect(rule).toContain('position: absolute');
    expect(rule).toContain('left: 0');
    expect(rule).toContain('right: 0');

    /*
     * NOT a plain `top: 100%`, which is what this said first and which came out
     * 48px too high, overlapping the bottom of the bar. The containing block is
     * `.tgs-section__inner`, the content wrapper, and the section's padding sits
     * below it. The expression has to be the section's own, so a client changing
     * the header padding moves both together.
     */
    expect(rule).toContain('top: calc(100% + var(--tgs-pad-r, var(--tgs-pad, 48px)) + var(--tgs-pb, 0px))');
    expect(rule).not.toMatch(/top:\s*100%\s*;/);
  });

  it('lifts the header above the page while the panel is open', () => {
    /*
     * WITHOUT THIS THE PANEL IS INVISIBLE FROM HALFWAY DOWN, and the numbers all
     * say it is fine. The header is `position: relative; z-index: 2`, so it is a
     * stacking context and the panel's own z-index is sealed inside a box worth
     * 2. The page below is a sibling whose `.tgs-section__inner` is also z-index
     * 2 and comes later in the document, so the page painted over the bottom two
     * thirds of the panel while every measurement of the panel read correctly.
     */
    expect(css).toContain(
      ".tgs-region[data-region='header']:has(.tgs-nav[data-burger='always'] .tgs-nav__disclosure[open]) {",
    );

    const lift = css.slice(css.indexOf(".tgs-region[data-region='header']:has("));
    expect(lift.slice(0, lift.indexOf('}'))).toContain('z-index: 40');
  });

  it('raises the header only while it is open, not permanently', () => {
    // A header that always outranked the page would change how every overlapping
    // hero and sticky bar stacks, for one menu's sake. The :has() is what keeps
    // the change to the moment it is needed.
    const lift = css.slice(css.indexOf(".tgs-region[data-region='header']:has("));
    expect(lift.slice(0, lift.indexOf('{'))).toContain('[open]');

    // And the ordinary header keeps its own value.
    expect(css).toContain(".tgs-region[data-region='header'] { z-index: 2; }");
  });

  /*
   * NOT position: fixed, and this is the assertion that stops somebody
   * "improving" it into a full-screen overlay six months from now. It cannot
   * work: .tgs-page carries container-type, which brings layout containment,
   * which makes the header itself the containing block for a fixed child. The
   * reasoning is in the stylesheet; this keeps it honest.
   */
  it('never tries to escape to the viewport with position: fixed', () => {
    const panel = css.slice(
      css.indexOf(".tgs-nav[data-burger='always'] .tgs-nav__disclosure[open]"),
    );
    expect(panel.slice(0, panel.indexOf('}'))).not.toContain('position: fixed');
  });

  it('scrolls a long menu inside the panel rather than off the screen', () => {
    expect(css).toContain('max-height: min(70vh, 32rem)');
  });

  it('follows the alignment its menu was given', () => {
    expect(css).toContain(".tgs-nav[data-burger='always'][data-align='centre'] .tgs-nav__list--stacked { text-align: center; }");
    expect(css).toContain(".tgs-nav[data-burger='always'][data-align='right'] .tgs-nav__list--stacked { text-align: right; }");
  });
});

describe('the close control', () => {
  /*
   * A panel over the page with no visible way out is a trap, and the browser
   * does not give Escape to a `details` the way it does to a dialog. So the
   * button that opened it has to look like the button that closes it.
   */
  it('swaps the burger for a cross while the menu is open', () => {
    expect(css).toContain('.tgs-nav__burger-close { display: none; }');
    expect(css).toContain('.tgs-nav__disclosure[open] .tgs-nav__burger-open { display: none; }');
    expect(css).toContain('.tgs-nav__disclosure[open] .tgs-nav__burger-close { display: block; }');
  });

  it('applies to the phone menu too, not only the always-on one', () => {
    // The selectors above are not scoped to [data-burger='always'], which is
    // deliberate: a burger that stays a burger while open reads as "not open".
    expect(css).toContain('.tgs-nav__disclosure[open] .tgs-nav__burger-open');
    expect(css).not.toContain("[data-burger='always'] .tgs-nav__disclosure[open] .tgs-nav__burger");
  });

  it('keeps both icons out of the accessibility tree', () => {
    // The summary carries the label and its own expanded state. Two icons
    // announcing themselves would be two controls where there is one.
    const burgerMarkup = nav.slice(nav.indexOf('className="tgs-nav__burger"'));
    const summary = burgerMarkup.slice(0, burgerMarkup.indexOf('</summary>'));
    expect(summary.match(/aria-hidden="true"/g)).toHaveLength(2);
    expect(summary).toContain('tgs-nav__burger-open');
    expect(summary).toContain('tgs-nav__burger-close');
  });
});

describe('the panel arrives rather than appearing', () => {
  it('has one authored entrance', () => {
    expect(css).toContain('@keyframes tgs-nav-panel-in');
    expect(css).toContain('animation: tgs-nav-panel-in');
  });

  it('and the reduced-motion rule already covers it', () => {
    // Not its own media query: the sweeping rule at the bottom of the stylesheet
    // clamps every animation inside .tgs-page, so a new one is covered the day
    // it is written rather than the day somebody remembers.
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('animation-duration: 0.01ms !important;');
  });
});
