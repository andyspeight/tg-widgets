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
import { addBlock, updateBlockPropsAtPath, updateBlockResponsiveAtPath } from '../lib/content/tree';

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
