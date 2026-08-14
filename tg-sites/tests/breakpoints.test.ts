/**
 * Per-screen styling, slice one: the engine wired to a section's spacing.
 *
 * The pure engine (resolve, override, the inline vars it emits) is proved in
 * responsive.test.ts. These read the WIRING from source, the way the other
 * editor-interaction suites do: the schema carries the overrides, the renderer
 * emits them as inline custom properties, the static container queries fold them
 * in, and the editor's controls edit the size the device switcher is on. The live
 * behaviour is driven in a browser by verify-standalone.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createBlock, createPage } from '../lib/content/factory';
import { parsePage } from '../lib/content/schema';
import { sanitisePage } from '../lib/content/sanitise-page';
import { withOverride } from '../lib/content/responsive';
import {
  hasInlineTextSizing,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
  normaliseLineHeight,
} from '../lib/content/styles';
import {
  addBlock,
  updateBlockPropsAtPath,
  updateBlockResponsiveAtPath,
  updateBlockHideOnAtPath,
} from '../lib/content/tree';

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

describe('the schema carries per-screen overrides, additively', () => {
  const schema = read('lib', 'content', 'schema.ts');

  it('validates each override as its base field, and passes unknown keys through', () => {
    // paddingY validated exactly as the section field is; passthrough so a newer
    // build's override survives an older one rather than being stripped.
    expect(schema).toContain('const OverridesSchema');
    expect(schema).toMatch(/paddingY:\s*z\.unknown\(\)\.transform\(normaliseSectionPadding\)\.optional\(\)/);
    expect(schema).toContain('.passthrough()');
    expect(schema).toContain('export const ResponsiveSchema');
  });

  it('adds an optional responsive map to a section, so old pages do not change shape', () => {
    expect(schema).toContain('responsive: ResponsiveSchema.optional()');
  });
});

describe('the renderer emits the overrides as inline custom properties', () => {
  const render = read('components', 'render', 'PageRenderer.tsx');

  it('spreads a section its per-screen vars, mapping spacing to --tgs-pad', () => {
    expect(render).toContain('responsiveVars(section.responsive, SECTION_RESPONSIVE)');
    expect(render).toMatch(/property:\s*'paddingY',\s*varBase:\s*'--tgs-pad'/);
  });
});

describe('static container queries fold the size vars into the value the section reads', () => {
  const css = read('app', 'globals.css');

  it('reads the override through a fallback chain, base last, so nothing needs !important', () => {
    expect(css).toContain('var(--tgs-pad-r, var(--tgs-pad, 48px))');
  });

  it('sets --tgs-pad-r from the tablet twin at the tablet width', () => {
    expect(css).toMatch(/@container tgs-page \(max-width: 1023px\)[\s\S]*?--tgs-pad-r: var\(--tgs-pad-tablet/);
  });

  it('and from the phone twin, then tablet, then base, at the phone width', () => {
    expect(css).toMatch(
      /@container tgs-page \(max-width: 767px\)[\s\S]*?--tgs-pad-r: var\(--tgs-pad-phone, var\(--tgs-pad-tablet/,
    );
  });
});

describe('the editor edits the size the device switcher is on', () => {
  const props = read('components', 'editor', 'Properties.tsx');
  const canvas = read('components', 'editor', 'Canvas.tsx');
  const shell = read('components', 'editor', 'EditorShell.tsx');

  it('scopes the spacing control to the current screen, base on desktop, override otherwise', () => {
    expect(props).toContain('<ScreenScope');
    expect(props).toContain("resolveAt(section.paddingY, section.responsive, 'paddingY', tier)");
    expect(props).toContain("withOverride(section.responsive, 'paddingY', tier, next)");
    expect(props).toContain("clearOverride(section.responsive, 'paddingY', tier)");
    // Desktop still writes the base field, unchanged.
    expect(props).toContain("set({ paddingY: next }, `sec:${index}:pad`)");
  });

  it('makes the on-canvas foot drag write the same size', () => {
    expect(canvas).toContain('const commitPad = useCallback');
    expect(canvas).toContain("withOverride(section.responsive, 'paddingY', viewport, value)");
    // The drag starts from the value the current screen shows, not the base.
    expect(canvas).toContain("resolveAt(target?.paddingY ?? DEFAULT_SECTION_PADDING, target?.responsive, 'paddingY', viewport)");
  });

  it('threads the active tier from the shell to both the pane and the popover', () => {
    expect(shell).toContain('viewport={viewport}');
    expect(shell).toContain('tier: viewport');
  });
});

// ---------------------------------------------------------------------------
// Slice two: text size per screen, on the same engine.
// ---------------------------------------------------------------------------

describe('a block carries per-screen text size, additively', () => {
  const schema = read('lib', 'content', 'schema.ts');

  it('adds fontSize to the shared overrides, validated as a toolbar size', () => {
    expect(schema).toMatch(/fontSize:\s*z\.unknown\(\)\.transform\(normaliseTextSize\)\.optional\(\)/);
  });

  it('gives a block its own optional responsive map, a sibling of box', () => {
    // The same additive field a section has, so a page saved before this keeps
    // its shape rather than gaining a key.
    expect(schema).toMatch(/responsive:\s*ResponsiveSchema\.optional\(\)/);
  });
});

describe('the renderer emits a block its per-screen size vars', () => {
  const render = read('components', 'render', 'PageRenderer.tsx');

  it('maps fontSize to --tgs-fs and spreads the twins onto the block', () => {
    expect(render).toMatch(/property:\s*'fontSize',\s*varBase:\s*'--tgs-fs'/);
    expect(render).toContain('responsiveVars(block.responsive, BLOCK_RESPONSIVE)');
  });

  it('carries the desktop base as an inline --tgs-fs alongside the twins', () => {
    expect(render).toContain("{ '--tgs-fs': baseSize }");
  });
});

describe('the text elements read the size chain, folded by container queries', () => {
  const css = read('app', 'globals.css');

  it('.tgs-heading and .tgs-text read the override, then the base, then their own', () => {
    expect(css).toContain('font-size: var(--tgs-fs-r, var(--tgs-fs, var(--tgs-fs-base)))');
  });

  it('resets the size vars on every block, so they do not bleed into a nested one', () => {
    expect(css).toContain('.tgs-block { --tgs-fs: initial; --tgs-fs-tablet: initial; --tgs-fs-phone: initial; }');
  });

  it('folds the tablet twin at the tablet width, phone then tablet at the phone width', () => {
    expect(css).toMatch(/@container tgs-page \(max-width: 1023px\)[\s\S]*?--tgs-fs-r: var\(--tgs-fs-tablet/);
    expect(css).toMatch(
      /@container tgs-page \(max-width: 767px\)[\s\S]*?--tgs-fs-r: var\(--tgs-fs-phone, var\(--tgs-fs-tablet/,
    );
  });
});

describe('the block pane edits the text size for the current screen', () => {
  const props = read('components', 'editor', 'Properties.tsx');

  it('scopes a Text size control to the tier, base on desktop, override otherwise', () => {
    expect(props).toContain('<TextSizeField');
    expect(props).toContain("resolveAt<string | undefined>(base, block.responsive, 'fontSize', tier)");
    expect(props).toContain("withOverride(block.responsive, 'fontSize', tier, value)");
    expect(props).toContain("clearOverride(block.responsive, 'fontSize', tier)");
    // Desktop writes the block's own base prop, not an override.
    expect(props).toContain('updateBlockPropsAtPath(c, path, { fontSize: value })');
    // Only the blocks whose text the chain governs offer it.
    expect(props).toContain("block.type === 'text' || block.type === 'heading'");
  });
});

describe('a block-level text size survives the save path', () => {
  const path = { kind: 'block' as const, section: 0, row: 0, column: 0, block: 0 };

  function textBlockPage() {
    let page = createPage();
    page = addBlock(page, 0, 0, 0, createBlock('text'));
    page = updateBlockPropsAtPath(page, path, { fontSize: 'var(--tgs-h2-size)' });
    page = updateBlockResponsiveAtPath(page, path, withOverride(undefined, 'fontSize', 'phone', '20px'));
    return page;
  }

  it('keeps the desktop base and the phone override through parsePage', () => {
    // JSON round-trip first, since a real save stores plain JSON.
    const result = parsePage(JSON.parse(JSON.stringify(textBlockPage())));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const block = result.page.sections[0].rows[0].columns[0].blocks[0];
    expect(block.props.fontSize).toBe('var(--tgs-h2-size)');
    expect(block.responsive?.phone?.fontSize).toBe('20px');
  });

  it('and through sanitisePage, which cleans props but keeps the base and the map', () => {
    const block = sanitisePage(textBlockPage()).sections[0].rows[0].columns[0].blocks[0];
    expect(block.props.fontSize).toBe('var(--tgs-h2-size)');
    expect(block.responsive?.phone?.fontSize).toBe('20px');
  });

  it('drops an override the toolbar would not allow, rather than storing it', () => {
    let page = createPage();
    page = addBlock(page, 0, 0, 0, createBlock('text'));
    // 9000px is past the 200px cap, so the schema drops it, the same as an inline
    // size out of range is dropped rather than clamped.
    page = updateBlockResponsiveAtPath(page, path, withOverride(undefined, 'fontSize', 'phone', '9000px'));
    const result = parsePage(JSON.parse(JSON.stringify(page)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const block = result.page.sections[0].rows[0].columns[0].blocks[0];
    expect(block.responsive?.phone?.fontSize).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Slice three: line spacing per screen, on the same engine.
//
// Andy, 11 Aug 2026: changing a font size left the line spacing holding room for
// the original bigger text. The cause is a heading whose words are wrapped in a
// stack of oversized size spans; a unitless line-height set on the block flows
// into them and scales each line box by the size it actually is, so tightening
// one value pulls the trapped space back. This is that control, on the same
// per-screen mechanism as the size above.
// ---------------------------------------------------------------------------

describe('the line-spacing validator holds a value to a sane unitless band', () => {
  it('accepts a number or a numeric string, and returns a short unitless string', () => {
    expect(normaliseLineHeight(1.5)).toBe('1.5');
    expect(normaliseLineHeight('1.3')).toBe('1.3');
    // Two decimals, no trailing zeros, so it round-trips to the pane's own option.
    expect(normaliseLineHeight(1)).toBe('1');
    expect(normaliseLineHeight('1.150')).toBe('1.15');
  });

  it('clamps to the band at both ends rather than dropping, unlike a pixel size', () => {
    expect(normaliseLineHeight(0.2)).toBe(String(LINE_HEIGHT_MIN));
    expect(normaliseLineHeight(9)).toBe(String(LINE_HEIGHT_MAX));
  });

  it('rejects anything that is not a finite number, so a stray value drops cleanly', () => {
    expect(normaliseLineHeight('loose')).toBeUndefined();
    expect(normaliseLineHeight('')).toBeUndefined();
    expect(normaliseLineHeight(null)).toBeUndefined();
    expect(normaliseLineHeight(Number.NaN)).toBeUndefined();
    expect(normaliseLineHeight(Infinity)).toBeUndefined();
  });
});

describe('a block carries per-screen line spacing, additively', () => {
  const schema = read('lib', 'content', 'schema.ts');

  it('adds lineHeight to the shared overrides, validated as a line-spacing value', () => {
    expect(schema).toMatch(/lineHeight:\s*z\.unknown\(\)\.transform\(normaliseLineHeight\)\.optional\(\)/);
  });
});

describe('the renderer emits a block its per-screen line-spacing vars', () => {
  const render = read('components', 'render', 'PageRenderer.tsx');

  it('maps lineHeight to --tgs-lh and spreads the twins onto the block', () => {
    expect(render).toMatch(/property:\s*'lineHeight',\s*varBase:\s*'--tgs-lh'/);
    // The twins for size and spacing both ride the one BLOCK_RESPONSIVE spread.
    expect(render).toContain('responsiveVars(block.responsive, BLOCK_RESPONSIVE)');
  });

  it('carries the desktop base as an inline --tgs-lh alongside the twins', () => {
    expect(render).toContain("{ '--tgs-lh': baseLineHeight }");
  });
});

describe('the text elements read the line-spacing chain, folded by container queries', () => {
  const css = read('app', 'globals.css');

  it('.tgs-heading and .tgs-text read the override, then the base, then their own leading', () => {
    expect(css).toContain('line-height: var(--tgs-lh-r, var(--tgs-lh, var(--tgs-lh-base)))');
  });

  it('sets --tgs-lh-base per heading level and on the paragraph, so the chain has a floor', () => {
    expect(css).toContain('--tgs-lh-base: var(--tgs-h1-leading)');
    expect(css).toContain('--tgs-lh-base: var(--tgs-p-leading)');
  });

  it('resets the spacing vars on every block, so they do not bleed into a nested one', () => {
    expect(css).toContain('.tgs-block { --tgs-lh: initial; --tgs-lh-tablet: initial; --tgs-lh-phone: initial; }');
  });

  it('folds the tablet twin at the tablet width, phone then tablet at the phone width', () => {
    expect(css).toMatch(/@container tgs-page \(max-width: 1023px\)[\s\S]*?--tgs-lh-r: var\(--tgs-lh-tablet/);
    expect(css).toMatch(
      /@container tgs-page \(max-width: 767px\)[\s\S]*?--tgs-lh-r: var\(--tgs-lh-phone, var\(--tgs-lh-tablet/,
    );
  });
});

describe('the block pane edits the line spacing for the current screen', () => {
  const props = read('components', 'editor', 'Properties.tsx');

  it('scopes a Line spacing control to the tier, base on desktop, override otherwise', () => {
    expect(props).toContain('<LineSpacingField');
    expect(props).toContain("resolveAt<string | undefined>(baseLh, block.responsive, 'lineHeight', tier)");
    expect(props).toContain("withOverride(block.responsive, 'lineHeight', tier, value)");
    expect(props).toContain("clearOverride(block.responsive, 'lineHeight', tier)");
    // Desktop writes the block's own base prop, not an override.
    expect(props).toContain('updateBlockPropsAtPath(c, path, { lineHeight: value })');
  });
});

describe('a block-level line spacing survives the save path', () => {
  const path = { kind: 'block' as const, section: 0, row: 0, column: 0, block: 0 };

  function textBlockPage() {
    let page = createPage();
    page = addBlock(page, 0, 0, 0, createBlock('text'));
    page = updateBlockPropsAtPath(page, path, { lineHeight: '1.3' });
    page = updateBlockResponsiveAtPath(page, path, withOverride(undefined, 'lineHeight', 'phone', '0.9'));
    return page;
  }

  it('keeps the desktop base and the phone override through parsePage', () => {
    const result = parsePage(JSON.parse(JSON.stringify(textBlockPage())));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const block = result.page.sections[0].rows[0].columns[0].blocks[0];
    expect(block.props.lineHeight).toBe('1.3');
    expect(block.responsive?.phone?.lineHeight).toBe('0.9');
  });

  it('and through sanitisePage, which cleans props but keeps the base and the map', () => {
    const block = sanitisePage(textBlockPage()).sections[0].rows[0].columns[0].blocks[0];
    expect(block.props.lineHeight).toBe('1.3');
    expect(block.responsive?.phone?.lineHeight).toBe('0.9');
  });

  it('clamps an out-of-band value to the band rather than dropping it, unlike a size', () => {
    let page = createPage();
    page = addBlock(page, 0, 0, 0, createBlock('text'));
    // 5 is past the loosest the band allows, so it clamps to the ceiling. A size
    // out of range is dropped; a line height is pulled to the nearest edge, since
    // a number is always meaningful spacing where a stray pixel size is not.
    page = updateBlockResponsiveAtPath(page, path, withOverride(undefined, 'lineHeight', 'phone', 5));
    const result = parsePage(JSON.parse(JSON.stringify(page)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const block = result.page.sections[0].rows[0].columns[0].blocks[0];
    expect(block.responsive?.phone?.lineHeight).toBe('3');
  });
});

// ---------------------------------------------------------------------------
// Alignment per screen, on the same engine.
//
// Unlike spacing and size, alignment is not a scalar folded through one custom
// property: it is an enum that drives three things at once, the block's own
// text-align, a max-width paragraph's margin, and a button row's justify. So it
// cannot ride the --tgs-*-r chain. The block carries the override screen as a data
// attribute (data-align-tablet / data-align-phone) and container queries placed
// AFTER the base rules re-state all three, source order winning at equal
// specificity. The editor gives a text or heading block one tier-aware Alignment
// control in place of the registry's base-only field.
// ---------------------------------------------------------------------------

describe('the alignment validator holds a value to the three legal alignments', () => {
  it('accepts left, centre and right, and drops anything else to undefined', async () => {
    const { normaliseAlign } = await import('../lib/content/schema');
    expect(normaliseAlign('left')).toBe('left');
    expect(normaliseAlign('centre')).toBe('centre');
    expect(normaliseAlign('right')).toBe('right');
    // American spelling, a stray value, and non-strings all inherit rather than
    // rendering a broken attribute.
    expect(normaliseAlign('center')).toBeUndefined();
    expect(normaliseAlign('middle')).toBeUndefined();
    expect(normaliseAlign(2)).toBeUndefined();
    expect(normaliseAlign(undefined)).toBeUndefined();
  });
});

describe('a block carries per-screen alignment, additively', () => {
  const schema = read('lib', 'content', 'schema.ts');

  it('adds align to the shared overrides, validated as a legal alignment', () => {
    expect(schema).toMatch(/align:\s*z\.unknown\(\)\.transform\(normaliseAlign\)\.optional\(\)/);
  });
});

describe('the renderer emits a block its per-screen alignment as data attributes', () => {
  const render = read('components', 'render', 'PageRenderer.tsx');

  it('carries the tablet and phone override screen as data-align-tablet / -phone', () => {
    expect(render).toContain('data-align-tablet={');
    expect(render).toContain('block.responsive?.tablet?.align');
    expect(render).toContain('data-align-phone={');
    expect(render).toContain('block.responsive?.phone?.align');
  });

  it('keeps the desktop base as the plain data-align, unchanged', () => {
    expect(render).toContain(
      "data-align={typeof block.props?.align === 'string' ? block.props.align : undefined}",
    );
  });
});

describe('container queries re-state the alignment at the width each screen owns', () => {
  const css = read('app', 'globals.css');

  it('leaves the base .tgs-block[data-align] rules untouched, so an ordinary block is unchanged', () => {
    expect(css).toContain(".tgs-block[data-align='centre'] { text-align: center; }");
    expect(css).toContain(".tgs-block[data-align='centre'] .tgs-text { margin-inline: auto; }");
    expect(css).toContain(".tgs-block[data-align='centre'] .tgs-buttons { justify-content: center; }");
  });

  it('re-states all three of an override, left included, so an override to left undoes the base', () => {
    for (const screen of ['tablet', 'phone']) {
      expect(css).toContain(`.tgs-block[data-align-${screen}='left']   { text-align: left; }`);
      expect(css).toContain(`.tgs-block[data-align-${screen}='centre'] { text-align: center; }`);
      expect(css).toContain(`.tgs-block[data-align-${screen}='right']  { text-align: right; }`);
      expect(css).toContain(`.tgs-block[data-align-${screen}='left']   .tgs-text { margin-inline: 0; }`);
      expect(css).toContain(`.tgs-block[data-align-${screen}='left']   .tgs-buttons { justify-content: flex-start; }`);
    }
  });

  it('places the override rules AFTER the base, so source order wins at equal specificity', () => {
    // The base buttons rule is the last .tgs-block[data-align] rule; the tablet
    // override must come after it, or the base would win the cascade.
    expect(css).toMatch(
      /\.tgs-block\[data-align='right'\]\s+\.tgs-buttons \{ justify-content: flex-end; \}[\s\S]*?@container tgs-page \(max-width: 1023px\)[\s\S]*?\[data-align-tablet='centre'\]/,
    );
  });

  it('places the phone block after the tablet block, so a phone width takes phone', () => {
    expect(css).toMatch(
      /\[data-align-tablet='centre'\][\s\S]*?@container tgs-page \(max-width: 767px\)[\s\S]*?\[data-align-phone='centre'\]/,
    );
  });
});

describe('the block pane edits the alignment for the current screen', () => {
  const props = read('components', 'editor', 'Properties.tsx');

  it('scopes an Alignment control to the tier, base on desktop, override otherwise', () => {
    expect(props).toContain('<Segmented label="Alignment"');
    expect(props).toContain("resolveAt<string>(alignBase, block.responsive, 'align', tier)");
    expect(props).toContain("withOverride(block.responsive, 'align', tier, value)");
    expect(props).toContain("clearOverride(block.responsive, 'align', tier)");
    // Desktop writes the block's own base prop, not an override.
    expect(props).toContain('updateBlockPropsAtPath(c, path, { align: value })');
  });

  it('drops the registry base-only align field for text and heading, so there is one control', () => {
    expect(props).toContain(
      "field.key === 'align' && (block.type === 'text' || block.type === 'heading')",
    );
  });
});

describe('a block-level alignment survives the save path', () => {
  const path = { kind: 'block' as const, section: 0, row: 0, column: 0, block: 0 };

  function alignBlockPage() {
    let page = createPage();
    page = addBlock(page, 0, 0, 0, createBlock('text'));
    page = updateBlockPropsAtPath(page, path, { align: 'centre' });
    page = updateBlockResponsiveAtPath(page, path, withOverride(undefined, 'align', 'phone', 'left'));
    return page;
  }

  it('keeps the desktop base and the phone override through parsePage', () => {
    const result = parsePage(JSON.parse(JSON.stringify(alignBlockPage())));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const block = result.page.sections[0].rows[0].columns[0].blocks[0];
    expect(block.props.align).toBe('centre');
    expect(block.responsive?.phone?.align).toBe('left');
  });

  it('and through sanitisePage, which cleans props but keeps the base and the map', () => {
    const block = sanitisePage(alignBlockPage()).sections[0].rows[0].columns[0].blocks[0];
    expect(block.props.align).toBe('centre');
    expect(block.responsive?.phone?.align).toBe('left');
  });

  it('drops an override that is not a legal alignment rather than storing it', () => {
    let page = createPage();
    page = addBlock(page, 0, 0, 0, createBlock('text'));
    // 'middle' is not one of the three, so the schema drops it, the same as a
    // stray text size is dropped rather than kept.
    page = updateBlockResponsiveAtPath(page, path, withOverride(undefined, 'align', 'phone', 'middle'));
    const result = parsePage(JSON.parse(JSON.stringify(page)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const block = result.page.sections[0].rows[0].columns[0].blocks[0];
    expect(block.responsive?.phone?.align).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Show / hide per screen, slice four.
//
// Not a style override on the responsive map but a list of the screens a block is
// hidden on, all three treated alike (desktop included, which the responsive map
// cannot carry). Each screen is an independent, non-overlapping container query, so
// there is no cascade order and no inheritance. The attribute is emitted only on the
// published page and in preview, never while editing, so a hidden block stays
// selectable on the canvas.
// ---------------------------------------------------------------------------

describe('the hide-on validator keeps a clean list of legal screens', () => {
  it('drops unknown screens, collapses duplicates, and empties to nothing', async () => {
    const { HideOnSchema } = await import('../lib/content/schema');
    const parse = (v: unknown) => HideOnSchema.parse(v);
    expect(parse(['phone', 'desktop'])).toEqual(['phone', 'desktop']);
    expect(parse(['phone', 'phone', 'tablet'])).toEqual(['phone', 'tablet']);
    expect(parse(['phone', 'nonsense', 2])).toEqual(['phone']);
    // Empty, a non-array, and absent all become nothing, so a block that hides
    // nowhere keeps its shape rather than gaining a key.
    expect(parse([])).toBeUndefined();
    expect(parse('phone')).toBeUndefined();
    expect(parse(undefined)).toBeUndefined();
  });
});

describe('a block carries the screens it is hidden on, additively', () => {
  const schema = read('lib', 'content', 'schema.ts');

  it('adds an optional hideOn list, separate from the responsive map', () => {
    expect(schema).toContain('export const HideOnSchema');
    expect(schema).toContain('hideOn: HideOnSchema');
  });
});

describe('the renderer hides a block on its screens, published only', () => {
  const render = read('components', 'render', 'PageRenderer.tsx');

  it('emits data-hide-<screen> from the list, but never while editing', () => {
    expect(render).toContain(
      "data-hide-desktop={!editable && block.hideOn?.includes('desktop') ? '' : undefined}",
    );
    expect(render).toContain(
      "data-hide-tablet={!editable && block.hideOn?.includes('tablet') ? '' : undefined}",
    );
    expect(render).toContain(
      "data-hide-phone={!editable && block.hideOn?.includes('phone') ? '' : undefined}",
    );
  });
});

describe('container queries take a hidden block out of the layout, one screen each', () => {
  const css = read('app', 'globals.css');

  it('hides on each screen at its own non-overlapping width', () => {
    // The block selector shares its rule with the section one, so it is followed by
    // the section selector before the declaration; match up to display: none.
    expect(css).toMatch(
      /@container tgs-page \(min-width: 1024px\)[\s\S]*?\.tgs-block\[data-hide-desktop\][\s\S]*?display: none;/,
    );
    expect(css).toMatch(
      /@container tgs-page \(min-width: 768px\) and \(max-width: 1023px\)[\s\S]*?\.tgs-block\[data-hide-tablet\][\s\S]*?display: none;/,
    );
    expect(css).toMatch(
      /@container tgs-page \(max-width: 767px\)[\s\S]*?\.tgs-block\[data-hide-phone\][\s\S]*?display: none;/,
    );
  });
});

describe('the block pane hides a block on the current screen', () => {
  const props = read('components', 'editor', 'Properties.tsx');

  it('offers a tier-aware Hide toggle that edits the hideOn list', () => {
    expect(props).toContain('<HideOnField');
    expect(props).toContain('hideOn.includes(tier)');
    expect(props).toContain('updateBlockHideOnAtPath(c, path, next.length ? next : undefined)');
  });
});

describe('a block hidden on a screen survives the save path', () => {
  const path = { kind: 'block' as const, section: 0, row: 0, column: 0, block: 0 };

  function hiddenBlockPage() {
    let page = createPage();
    page = addBlock(page, 0, 0, 0, createBlock('text'));
    page = updateBlockHideOnAtPath(page, path, ['phone', 'desktop']);
    return page;
  }

  it('keeps the list through parsePage and sanitisePage', () => {
    const result = parsePage(JSON.parse(JSON.stringify(hiddenBlockPage())));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const block = result.page.sections[0].rows[0].columns[0].blocks[0];
    expect(block.hideOn).toEqual(['phone', 'desktop']);

    const cleaned = sanitisePage(hiddenBlockPage()).sections[0].rows[0].columns[0].blocks[0];
    expect(cleaned.hideOn).toEqual(['phone', 'desktop']);
  });
});

// ---------------------------------------------------------------------------
// Show / hide WHOLE SECTIONS, on the same list and the same queries as a block.
// Andy, 13 Aug 2026, after the block version shipped: extend it to sections so a
// decorative band or a whole strip can be dropped on a phone. The section carries
// the same hideOn list, the render emits data-hide-* on the section under the same
// !editable gate, and the three container queries gain the .tgs-section selector.
// ---------------------------------------------------------------------------

describe('a section carries the screens it is hidden on, additively', () => {
  const schema = read('lib', 'content', 'schema.ts');

  it('adds hideOn to the section, the same list a block has', () => {
    // Two occurrences now, the block and the section, both on HideOnSchema.
    expect(schema.match(/hideOn: HideOnSchema/g)?.length).toBe(2);
  });

  it('keeps a section hideOn through parsePage, absent on a section that set none', () => {
    const parsed = parsePage({
      version: 1,
      id: 'p',
      slug: 'sec-hide',
      title: 'Hide',
      sections: [
        { id: 'a', tone: 'light', width: 'contained', hideOn: ['phone', 'desktop'], rows: [] },
        { id: 'b', tone: 'light', width: 'contained', rows: [] },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.page.sections[0].hideOn).toEqual(['phone', 'desktop']);
    expect(parsed.page.sections[1].hideOn).toBeUndefined();
  });
});

describe('the renderer hides a whole section on its screens, published only', () => {
  const render = read('components', 'render', 'PageRenderer.tsx');

  it('emits data-hide-<screen> on the section from its list, but never while editing', () => {
    expect(render).toContain(
      "data-hide-desktop={!editable && section.hideOn?.includes('desktop') ? '' : undefined}",
    );
    expect(render).toContain(
      "data-hide-phone={!editable && section.hideOn?.includes('phone') ? '' : undefined}",
    );
  });
});

describe('the hide container queries take a section out too, on the same rule as a block', () => {
  const css = read('app', 'globals.css');

  it('matches .tgs-section alongside .tgs-block at each width', () => {
    expect(css).toContain('.tgs-section[data-hide-desktop] { display: none; }');
    expect(css).toContain('.tgs-section[data-hide-tablet] { display: none; }');
    expect(css).toContain('.tgs-section[data-hide-phone] { display: none; }');
  });
});

describe('the section pane hides a whole section on the current screen', () => {
  const props = read('components', 'editor', 'Properties.tsx');

  it('offers a tier-aware Hide toggle on the section that edits its hideOn list', () => {
    expect(props).toContain('noun="section"');
    expect(props).toContain('set({ hideOn: next.length ? next : undefined }, `sec:${index}:hideOn:${tier}`)');
  });
});

// ---------------------------------------------------------------------------
// Auto-resize: fluid text that scales with the screen.
//
// Andy, 11 Aug 2026: "an option so that it auto-resizes based on screen size."
// Not a per-screen value but a single flag: the block is marked data-fluid and a
// static rule swaps its font-size for a clamp that reads the .tgs-page container,
// wrapping the size chain so the set size is the ceiling and the middle scales.
// ---------------------------------------------------------------------------

describe('a block can be marked to auto-resize with the screen', () => {
  const render = read('components', 'render', 'PageRenderer.tsx');
  const css = read('app', 'globals.css');
  const props = read('components', 'editor', 'Properties.tsx');

  it('marks the text block data-fluid when the flag is set, and only text or heading', () => {
    expect(render).toContain("(block.type === 'text' || block.type === 'heading') && props?.fluid === true");
    expect(render).toContain("data-fluid={fluid ? '' : undefined}");
  });

  it('swaps the font-size for a clamp that wraps the size chain, scaling with the container', () => {
    expect(css).toContain('.tgs-block[data-fluid] .tgs-heading');
    expect(css).toContain('.tgs-block[data-fluid] .tgs-text');
    // The ceiling is the same chain a fixed size reads, so a manual or per-screen
    // size stays the ceiling; a container unit (cqi) is the scaling middle.
    expect(css).toMatch(/font-size:\s*clamp\([\s\S]*?var\(--tgs-fs-r, var\(--tgs-fs, var\(--tgs-fs-base\)\)\)[\s\S]*?9cqi/);
  });

  it('offers an auto-resize toggle in the block pane that writes the flag', () => {
    expect(props).toContain('<FluidField');
    expect(props).toContain('updateBlockPropsAtPath(c, path, { fluid: value || undefined })');
  });
});

describe('the auto-resize flag survives the save path', () => {
  const path = { kind: 'block' as const, section: 0, row: 0, column: 0, block: 0 };

  function fluidBlockPage() {
    let page = createPage();
    page = addBlock(page, 0, 0, 0, createBlock('heading'));
    page = updateBlockPropsAtPath(page, path, { fluid: true });
    return page;
  }

  it('keeps the flag through parsePage and sanitisePage', () => {
    const parsed = parsePage(JSON.parse(JSON.stringify(fluidBlockPage())));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.page.sections[0].rows[0].columns[0].blocks[0].props.fluid).toBe(true);

    const cleaned = sanitisePage(fluidBlockPage()).sections[0].rows[0].columns[0].blocks[0];
    expect(cleaned.props.fluid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Clear text sizing: the one-click clean for a heading built from size spans.
// ---------------------------------------------------------------------------

describe('clear text sizing detects and offers to remove fixed sizes on the words', () => {
  it('spots inline font sizing, so the control only appears when there is something to clear', () => {
    expect(hasInlineTextSizing('<span style="font-size: 100px">big</span>')).toBe(true);
    expect(hasInlineTextSizing('<span style="color: red">red</span>')).toBe(false);
    expect(hasInlineTextSizing('plain words')).toBe(false);
    expect(hasInlineTextSizing(undefined)).toBe(false);
  });

  it('offers a Clear text sizing button that rewrites the block html, gated on there being sizing', () => {
    const props = read('components', 'editor', 'Properties.tsx');
    expect(props).toContain('hasInlineTextSizing(block.props.html)');
    expect(props).toContain('Clear text sizing');
    expect(props).toContain('html: clearTextSizing(');
    // The strip itself runs against a real DOM, so its behaviour is proved in the
    // browser by verify-standalone rather than here: these suites run without one.
  });
});

// ---------------------------------------------------------------------------
// Reveal on scroll: a section's content rises into view as it is scrolled to.
// ---------------------------------------------------------------------------

describe('reveal on scroll animates a sections content in, degrading gracefully', () => {
  const render = read('components', 'render', 'PageRenderer.tsx');
  const css = read('app', 'globals.css');
  const props = read('components', 'editor', 'Properties.tsx');
  const schema = read('lib', 'content', 'schema.ts');

  it('carries an optional reveal flag on a section, so no stored page changes shape', () => {
    expect(schema).toContain('reveal: z.boolean().optional()');
    const parsed = parsePage({
      version: 1,
      id: 'p',
      slug: 'reveal-page',
      title: 'Reveal',
      sections: [{ id: 's', tone: 'light', width: 'contained', reveal: true, rows: [] }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.page.sections[0].reveal).toBe(true);
  });

  it('emits data-reveal on the published section but never while editing', () => {
    expect(render).toContain(
      'data-reveal={section.reveal && !editable ? normaliseRevealStyle(section.revealStyle) : undefined}',
    );
  });

  it('animates each block on a scroll timeline, guarded so it falls back to visible', () => {
    expect(css).toContain('@supports (animation-timeline: view())');
    expect(css).toContain('prefers-reduced-motion: no-preference');
    expect(css).toContain('.tgs-section[data-reveal] .tgs-block');
    expect(css).toContain('animation-timeline: view()');
    expect(css).toContain('@keyframes tgs-reveal-rise');
  });

  it('offers a Reveal on scroll toggle on the section', () => {
    expect(props).toContain('Reveal on scroll');
    expect(props).toContain('set({ reveal: event.target.checked || undefined }');
  });

  it('stores an optional reveal style, normalised to the closed list', () => {
    expect(schema).toContain('revealStyle: z.unknown().transform(normaliseRevealStyle).optional()');
    // A stored style survives, junk is pulled back to the rise default, and a
    // section that never set one keeps its shape: the key stays absent.
    const parsed = parsePage({
      version: 1,
      id: 'p',
      slug: 'reveal-style',
      title: 'Reveal',
      sections: [
        { id: 'a', tone: 'light', width: 'contained', reveal: true, revealStyle: 'fade', rows: [] },
        { id: 'b', tone: 'light', width: 'contained', reveal: true, revealStyle: 'nonsense', rows: [] },
        { id: 'c', tone: 'light', width: 'contained', reveal: true, rows: [] },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.page.sections[0].revealStyle).toBe('fade');
    expect(parsed.page.sections[1].revealStyle).toBe('rise');
    expect(parsed.page.sections[2].revealStyle).toBeUndefined();
  });

  it('renders the chosen style into data-reveal, defaulting to rise', () => {
    expect(render).toContain('normaliseRevealStyle(section.revealStyle)');
  });

  it('gives each style but the rise default its own keyframe', () => {
    for (const name of [
      'tgs-reveal-rise',
      'tgs-reveal-fade',
      'tgs-reveal-slide-left',
      'tgs-reveal-slide-right',
      'tgs-reveal-zoom',
      'tgs-reveal-blur',
    ]) {
      expect(css).toContain(`@keyframes ${name}`);
    }
    // The variants swap animation-name and share the base rule's specificity, so
    // they must sit after it for source order to resolve in their favour.
    expect(css).toContain(
      ".tgs-section[data-reveal='fade'] .tgs-block { animation-name: tgs-reveal-fade; }",
    );
    expect(css).toContain(
      ".tgs-section[data-reveal='blur'] .tgs-block { animation-name: tgs-reveal-blur; }",
    );
  });

  it('offers a Reveal style dropdown when reveal is on', () => {
    expect(props).toContain('Reveal style');
    expect(props).toContain('revealStyle: normaliseRevealStyle(event.target.value)');
    expect(props).toContain('REVEAL_STYLES.map');
  });

  it('carries an optional stagger flag, kept even without reveal, but meaningless then', () => {
    expect(schema).toContain('revealStagger: z.boolean().optional()');
    const parsed = parsePage({
      version: 1,
      id: 'p',
      slug: 'stagger',
      title: 'Stagger',
      sections: [
        { id: 'a', tone: 'light', width: 'contained', reveal: true, revealStagger: true, rows: [] },
        { id: 'b', tone: 'light', width: 'contained', reveal: true, rows: [] },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.page.sections[0].revealStagger).toBe(true);
    expect(parsed.page.sections[1].revealStagger).toBeUndefined();
  });

  it('emits data-reveal-stagger only alongside reveal, and never while editing', () => {
    expect(render).toContain(
      "data-reveal-stagger={section.reveal && section.revealStagger && !editable ? '' : undefined}",
    );
  });

  it('cascades the items on their own timelines, a grid-holding column stepping aside', () => {
    expect(css).toContain(
      '.tgs-section[data-reveal][data-reveal-stagger] .tgs-block { animation: none; }',
    );
    // A column that holds a grid is excluded, so the grid's items cascade, not the column.
    expect(css).toContain('.tgs-row > .tgs-col:not(:has(.tgs-cards, .tgs-gallery, .tgs-logos))');
    expect(css).toContain('.tgs-cards > .tgs-card');
    // The cascade is the per-item range offset, later items reaching further in.
    expect(css).toContain(':nth-child(2) { animation-range: entry 27% cover 25%; }');
  });

  it('offers a Stagger toggle when reveal is on', () => {
    expect(props).toContain('Stagger the items');
    expect(props).toContain('revealStagger: event.target.checked || undefined');
  });

  it('keeps the page wrapper on overflow-x: clip so the scroll timelines are not frozen', () => {
    // hidden makes .tgs-page a scroll container, and a view() timeline binds to the
    // nearest scroll-container ancestor. Bound to a wrapper that never scrolls, every
    // reveal froze at fully-in-view and nothing moved on the real site. clip stops the
    // sideways scroll without becoming a scroll container. Do NOT revert this to hidden.
    // Motion is proven for real in tools/verify-motion.mjs; this only guards the value.
    expect(css).toContain('overflow-x: clip');
    expect(css).not.toMatch(/\.tgs-page\s*\{[^}]*overflow-x:\s*hidden/);
  });

  it('clips the editor canvas frame in preview, so previewed reveals are not frozen', () => {
    // The same trap one level up, only in PREVIEW: the editor's .ed-canvas-frame is a
    // scroll container (overflow: hidden) that froze a previewed reveal even after
    // .tgs-page was fixed. Scoped to preview with clip, because editing keeps the frame
    // as it was. Proven live in the standalone preview-motion check.
    const editorCss = read('components', 'editor', 'editor.css');
    expect(editorCss).toContain(".ed-root[data-preview='true'] .ed-canvas-frame { overflow: clip; }");
  });
});

// ---------------------------------------------------------------------------

describe('hover lift raises a sections cards and buttons under the pointer', () => {
  const render = read('components', 'render', 'PageRenderer.tsx');
  const css = read('app', 'globals.css');
  const props = read('components', 'editor', 'Properties.tsx');
  const schema = read('lib', 'content', 'schema.ts');

  it('carries an optional hover-lift flag, so no stored page changes shape', () => {
    expect(schema).toContain('hoverLift: z.boolean().optional()');
    const parsed = parsePage({
      version: 1,
      id: 'p',
      slug: 'hover-lift',
      title: 'Hover lift',
      sections: [
        { id: 'a', tone: 'light', width: 'contained', hoverLift: true, rows: [] },
        { id: 'b', tone: 'light', width: 'contained', rows: [] },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.page.sections[0].hoverLift).toBe(true);
    expect(parsed.page.sections[1].hoverLift).toBeUndefined();
  });

  it('emits data-hover-lift on the published section but never while editing', () => {
    expect(render).toContain("data-hover-lift={section.hoverLift && !editable ? '' : undefined}");
  });

  it('lifts cards and buttons on hover, holding the movement back under reduced motion', () => {
    // The shadow deepens for everyone; only the translate sits behind the guard.
    expect(css).toContain('.tgs-section[data-hover-lift] .tgs-card:hover');
    expect(css).toContain('.tgs-section[data-hover-lift] .tgs-button:hover');
    expect(css).toContain('box-shadow: 0 10px 30px rgba(15, 23, 42, 0.14)');
    expect(css).toContain('prefers-reduced-motion: no-preference');
    expect(css).toContain('transform: translateY(-4px)');
  });

  it('offers a Hover lift toggle on the section', () => {
    expect(props).toContain('Hover lift');
    expect(props).toContain('set({ hoverLift: event.target.checked || undefined }');
  });
});

// ---------------------------------------------------------------------------

describe('image zoom on hover leans a sections card pictures in under the pointer', () => {
  const render = read('components', 'render', 'PageRenderer.tsx');
  const css = read('app', 'globals.css');
  const props = read('components', 'editor', 'Properties.tsx');
  const schema = read('lib', 'content', 'schema.ts');

  it('carries an optional image-zoom flag, so no stored page changes shape', () => {
    expect(schema).toContain('hoverZoom: z.boolean().optional()');
    const parsed = parsePage({
      version: 1,
      id: 'p',
      slug: 'image-zoom',
      title: 'Image zoom',
      sections: [
        { id: 'a', tone: 'light', width: 'contained', hoverZoom: true, rows: [] },
        { id: 'b', tone: 'light', width: 'contained', rows: [] },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.page.sections[0].hoverZoom).toBe(true);
    expect(parsed.page.sections[1].hoverZoom).toBeUndefined();
  });

  it('emits data-hover-zoom on the published section but never while editing', () => {
    expect(render).toContain("data-hover-zoom={section.hoverZoom && !editable ? '' : undefined}");
  });

  it('scales a card picture on hover, held behind reduced motion', () => {
    expect(css).toContain('.tgs-section[data-hover-zoom] .tgs-card__frame img');
    expect(css).toContain('.tgs-section[data-hover-zoom] .tgs-card:hover .tgs-card__frame img');
    expect(css).toContain('transform: scale(1.06)');
    expect(css).toContain('prefers-reduced-motion: no-preference');
  });

  it('offers an Image zoom toggle on the section', () => {
    expect(props).toContain('Image zoom');
    expect(props).toContain('set({ hoverZoom: event.target.checked || undefined }');
  });
});

// ---------------------------------------------------------------------------

describe('count up on scroll ticks a key-numbers figure from zero', () => {
  const render = read('components', 'render', 'blocks.tsx');
  const css = read('app', 'globals.css');
  const blocks = read('lib', 'content', 'blocks.ts');

  it('offers a Count up toggle on the key-numbers block', () => {
    expect(blocks).toContain("key: 'countUp'");
    expect(blocks).toContain('Count up on scroll');
  });

  it('counts only a plain whole number, leaving commas and decimals as written', () => {
    expect(render).toContain('/^\\d{1,9}$/.test(value)');
  });

  it('wraps a counting figure so the real number stands where unsupported', () => {
    expect(render).toContain('className="tgs-stats__value"');
    expect(render).toContain('data-count=""');
    expect(render).toContain("'--tgs-count-to': String(item.count)");
    expect(render).toContain('className="tgs-stats__num"');
  });

  it('animates a registered integer through a counter on a scroll timeline', () => {
    expect(css).toContain('@property --tgs-count');
    expect(css).toContain("syntax: '<integer>'");
    expect(css).toContain('@keyframes tgs-count-up');
    expect(css).toContain('content: counter(tgs-count)');
    expect(css).toContain('animation-timeline: view()');
    expect(css).toContain('prefers-reduced-motion: no-preference');
  });
});

// ---------------------------------------------------------------------------

describe('parallax drifts a sections background picture as the page scrolls', () => {
  const render = read('components', 'render', 'PageRenderer.tsx');
  const css = read('app', 'globals.css');
  const props = read('components', 'editor', 'Properties.tsx');
  const schema = read('lib', 'content', 'schema.ts');

  it('carries an optional parallax flag, so no stored page changes shape', () => {
    expect(schema).toContain('parallax: z.boolean().optional()');
    const parsed = parsePage({
      version: 1,
      id: 'p',
      slug: 'parallax',
      title: 'Parallax',
      sections: [
        {
          id: 'a',
          tone: 'dark',
          width: 'contained',
          parallax: true,
          backgroundImage: 'https://example.com/a.jpg',
          rows: [],
        },
        { id: 'b', tone: 'light', width: 'contained', rows: [] },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.page.sections[0].parallax).toBe(true);
    expect(parsed.page.sections[1].parallax).toBeUndefined();
  });

  it('emits data-parallax only for a still background, never a slideshow, a video or editing', () => {
    expect(render).toContain('data-parallax={');
    expect(render).toContain(
      'section.parallax && Boolean(background) && !bgShow && !video && !editable',
    );
  });

  it('grows the background and slides it on a scroll timeline, clipping the overspill', () => {
    // clip, not hidden: hidden would make the section a scroll container and freeze its
    // own parallax view() timeline, the same bug that stopped the reveals (12 Aug 2026).
    expect(css).toContain('.tgs-section[data-parallax] { overflow: clip; }');
    expect(css).toContain('.tgs-section[data-parallax] .tgs-section__bg');
    expect(css).toContain('@keyframes tgs-parallax');
    expect(css).toContain('animation-timeline: view()');
    expect(css).toContain('prefers-reduced-motion: no-preference');
  });

  it('offers a Parallax background toggle on the section, clearing Ken Burns when set', () => {
    expect(props).toContain('Parallax background');
    // The two background motions are mutually exclusive: turning parallax on clears
    // Ken Burns, since both move the one background picture.
    expect(props).toContain('{ parallax: true, kenBurns: undefined }');
  });
});

// ---------------------------------------------------------------------------
// Ken Burns: a section's background photo drifts and zooms slowly on its own.
// Andy, 13 Aug 2026, the fun list. Unlike parallax it is time-based, not tied to
// the scroll, and the two are mutually exclusive since both move the one picture.
// ---------------------------------------------------------------------------

describe('Ken Burns drifts and zooms a sections background picture on its own', () => {
  const render = read('components', 'render', 'PageRenderer.tsx');
  const css = read('app', 'globals.css');
  const props = read('components', 'editor', 'Properties.tsx');
  const schema = read('lib', 'content', 'schema.ts');

  it('carries an optional kenBurns flag, so no stored page changes shape', () => {
    expect(schema).toContain('kenBurns: z.boolean().optional()');
    const parsed = parsePage({
      version: 1,
      id: 'p',
      slug: 'ken-burns',
      title: 'Ken Burns',
      sections: [
        {
          id: 'a',
          tone: 'dark',
          width: 'contained',
          kenBurns: true,
          backgroundImage: 'https://example.com/a.jpg',
          rows: [],
        },
        { id: 'b', tone: 'light', width: 'contained', rows: [] },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.page.sections[0].kenBurns).toBe(true);
    expect(parsed.page.sections[1].kenBurns).toBeUndefined();
  });

  it('emits data-ken-burns only for a still background, never alongside parallax, a slideshow, a video or editing', () => {
    expect(render).toContain('data-ken-burns={');
    expect(render).toContain(
      'section.kenBurns && Boolean(background) && !bgShow && !video && !section.parallax && !editable',
    );
  });

  it('runs a slow time-based drift and zoom, clipping the overspill, behind reduced motion', () => {
    // Time-based, NOT a view() timeline, so it plays on its own rather than on scroll.
    expect(css).toContain('.tgs-section[data-ken-burns] { overflow: clip; }');
    expect(css).toContain('.tgs-section[data-ken-burns] .tgs-section__bg');
    expect(css).toContain('animation: tgs-ken-burns');
    expect(css).toContain('infinite alternate');
    expect(css).toContain('@keyframes tgs-ken-burns');
    expect(css).toContain('prefers-reduced-motion: no-preference');
    // A pure scroll timeline would be the wrong mechanism for a self-running drift.
    expect(css).toMatch(/@keyframes tgs-ken-burns[\s\S]*?scale\(1\.16\)/);
  });

  it('offers a Ken Burns toggle on the section, clearing parallax when set', () => {
    expect(props).toContain('Slow zoom (Ken Burns)');
    expect(props).toContain('{ kenBurns: true, parallax: undefined }');
  });
});

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Animated gradient heading (Andy, 13 Aug 2026, the fun list). A heading's letters
// are filled with the brand colours as a gradient that slides slowly along the text.
// ---------------------------------------------------------------------------

describe('an animated gradient fills a heading with the brand colours', () => {
  const render = read('components', 'render', 'PageRenderer.tsx');
  const css = read('app', 'globals.css');
  const blocks = read('lib', 'content', 'blocks.ts');
  const props = read('components', 'editor', 'Properties.tsx');

  it('offers an Animated gradient toggle on the heading block, grouped with the shadow effect', () => {
    expect(blocks).toContain("key: 'gradient'");
    expect(blocks).toContain('Animated gradient');
    expect(props).toContain("if (key === 'shadow' || key === 'gradient') return 'effects'");
  });

  it('keeps the flag through parse and sanitise, now that gradient is a registered field', () => {
    const path = { kind: 'block' as const, section: 0, row: 0, column: 0, block: 0 };
    let page = createPage();
    page = addBlock(page, 0, 0, 0, createBlock('heading'));
    page = updateBlockPropsAtPath(page, path, { gradient: true });
    const parsed = parsePage(JSON.parse(JSON.stringify(page)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.page.sections[0].rows[0].columns[0].blocks[0].props.gradient).toBe(true);
    const cleaned = sanitisePage(page).sections[0].rows[0].columns[0].blocks[0];
    expect(cleaned.props.gradient).toBe(true);
  });

  it('emits data-gradient only for a heading, and never while editing', () => {
    expect(render).toContain("const gradient = block.type === 'heading' && props?.gradient === true");
    expect(render).toContain("data-gradient={gradient && !editable ? '' : undefined}");
  });

  it('fills the letters with a moving brand gradient, held still under reduced motion', () => {
    expect(css).toContain('.tgs-block[data-gradient] .tgs-heading');
    expect(css).toContain('background-clip: text');
    expect(css).toContain('var(--tgs-accent)');
    expect(css).toContain('var(--tgs-primary)');
    expect(css).toContain('@keyframes tgs-gradient-text');
    expect(css).toContain('prefers-reduced-motion: no-preference');
  });

  it('lets the client set the two gradient colours, each falling back to a brand colour', () => {
    // Two colour fields beside the toggle, in the effects group.
    expect(blocks).toContain("key: 'gradientFrom'");
    expect(blocks).toContain("key: 'gradientTo'");
    expect(blocks).toContain("group: 'effects'");

    // The CSS reads them with a brand colour as the fallback, so a gradient
    // heading with no colours set is unchanged, and the first colour repeats at
    // both ends so at 200% width the slide still tiles seamlessly.
    expect(css).toContain('var(--tgs-grad-a, var(--tgs-accent))');
    expect(css).toContain('var(--tgs-grad-b, var(--tgs-primary))');

    // The render validates each colour and emits it only as a custom property,
    // so nothing unvalidated can reach the gradient.
    expect(render).toContain('safeColour(props?.gradientFrom)');
    expect(render).toContain('safeColour(props?.gradientTo)');
    expect(render).toContain("'--tgs-grad-a': gradFrom");
    expect(render).toContain("'--tgs-grad-b': gradTo");
  });

  it('keeps the two chosen colours through parse and sanitise', () => {
    const path = { kind: 'block' as const, section: 0, row: 0, column: 0, block: 0 };
    let page = createPage();
    page = addBlock(page, 0, 0, 0, createBlock('heading'));
    page = updateBlockPropsAtPath(page, path, {
      gradient: true,
      gradientFrom: '#112233',
      gradientTo: '#445566',
    });
    const parsed = parsePage(JSON.parse(JSON.stringify(page)));
    expect(parsed.ok).toBe(true);
    const cleaned = sanitisePage(page).sections[0].rows[0].columns[0].blocks[0];
    // If the sanitiser dropped these, a client would set a colour, save, and find
    // it gone, which is the exact failure the gradient flag test guards against.
    expect(cleaned.props.gradientFrom).toBe('#112233');
    expect(cleaned.props.gradientTo).toBe('#445566');
  });
});

describe('an auto-scrolling logo strip that pauses on hover', () => {
  const render = read('components', 'render', 'blocks.tsx');
  const routing = read('components', 'render', 'BlockRenderer.tsx');
  const blocks = read('lib', 'content', 'blocks.ts');
  const css = read('app', 'globals.css');

  it('offers a Scroll toggle on the logo strip block', () => {
    expect(blocks).toContain("key: 'scroll'");
    expect(blocks).toContain('Scroll the logos');
  });

  it('scrolls only on the published page and in preview, never while editing', () => {
    // The logo strip is told whether it is editing, and only builds the moving
    // track when it is not, so the editing canvas keeps the plain strip.
    expect(routing).toContain('<LogosBlock props={props} editing={editable} />');
    expect(render).toContain('if (scroll && !editing && items.length >= 2)');
  });

  it('renders the strip twice inside a clipped track so the loop has no seam', () => {
    expect(render).toContain('tgs-logos-marquee');
    expect(render).toContain('tgs-logos--track');
    // The second copy is aria-hidden so a screen reader meets the logos once.
    expect(render).toContain('renderItem(item, index + items.length, true)');
  });

  it('slides on its own, pauses on hover, and holds still under reduced motion', () => {
    expect(css).toContain('.tgs-logos-marquee { overflow: hidden; }');
    expect(css).toContain('@keyframes tgs-logos-scroll');
    expect(css).toContain('translateX(-50%)');
    expect(css).toContain('.tgs-logos--track { animation: tgs-logos-scroll 40s linear infinite; }');
    expect(css).toContain('.tgs-logos-marquee:hover .tgs-logos--track { animation-play-state: paused; }');
    // The trailing margin, not a flex gap, is what makes the two copies tile.
    expect(css).toContain('.tgs-logos--track .tgs-logos__item { margin-inline-end: var(--tgs-space-xl); }');
    // Under reduced motion it wraps to a plain strip and drops the second copy.
    expect(css).toContain(".tgs-logos--track > [aria-hidden='true'] { display: none; }");
  });
});

describe('a card link underline sweeps in on hover rather than snapping', () => {
  const css = read('app', 'globals.css');

  it('draws the underline as a gradient so its width can animate', () => {
    expect(css).toContain('.tgs-card__link:hover { background-size: 100% 2px; }');
    expect(css).toContain('background-image: linear-gradient(currentColor, currentColor)');
    expect(css).toContain('background-size: 0% 2px');
  });

  it('makes the sweep the motion, holding it back under reduced motion', () => {
    expect(css).toContain('transition: background-size 0.3s ease');
    expect(css).toContain('prefers-reduced-motion: no-preference');
  });

  it('no longer snaps a plain underline on', () => {
    expect(css).not.toContain('.tgs-card__link:hover { text-decoration: underline; }');
  });
});
