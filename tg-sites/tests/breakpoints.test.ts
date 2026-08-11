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
