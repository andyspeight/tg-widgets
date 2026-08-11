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
