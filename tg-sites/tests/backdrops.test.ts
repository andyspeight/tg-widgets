/**
 * Backdrops: an atmosphere behind a section with no photograph. The second
 * slice of the React Bits review (docs/react-bits-review.md, 15 Sep 2026).
 *
 * WHAT THE REVIEW FOUND. The library's largest category is backgrounds, and
 * the sections of ours with no picture (the call to action, the stats band, the
 * newsletter, the banner) were a flat colour or one gradient. Six atmospheres,
 * each CSS over gradients or an SVG mask in the section's own colours, no
 * canvas and no script: the shader backgrounds stay in the library because the
 * one WebGL slot a page has is the sea's.
 *
 * WHAT IS PINNED. The closed list and its normaliser; that the render emits a
 * backdrop only for a section with no picture or film and marks it still on the
 * canvas; that every animation sits inside the reduced-motion guard (brace
 * matched, the way tests/motion.test.ts does it); that the colours fall back
 * to the theme and switch to white on the coloured bands; and that the
 * pictureless presets wear one and preview it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { presetById, buildPresetSection, presetThumb } from '../lib/content/presets';
import { PAGE_PRESETS } from '../lib/content/presets-page';
import { parsePage } from '../lib/content/schema';
import { BACKDROP_CHOICES, normaliseBackdrop } from '../lib/content/styles';

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

const css = read('app', 'globals.css');
const render = read('components', 'render', 'PageRenderer.tsx');
const editor = read('components', 'editor', 'Properties.tsx');

const NAMES = ['aurora', 'rays', 'waves', 'drift', 'contours', 'grain'] as const;

/** Every no-preference block body, brace matched, so a rule NEAR the guard cannot pass. */
function guardedBlocks(sheet: string): string {
  const opener = '@media (prefers-reduced-motion: no-preference) {';
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

function sectionWith(extra: Record<string, unknown>) {
  const parsed = parsePage({
    version: 1,
    id: 'p',
    slug: 'b',
    title: 'B',
    sections: [{ id: 'a', tone: 'light', width: 'contained', rows: [], ...extra }],
  });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error('page did not parse');
  return parsed.page.sections[0];
}

describe('the list', () => {
  it('is none plus the six, and none is a real choice so a client can take one off', () => {
    expect(BACKDROP_CHOICES.map((c) => c.value)).toEqual(['none', ...NAMES]);
  });

  it('normalises to the list, with none and junk both meaning nothing', () => {
    for (const name of NAMES) expect(normaliseBackdrop(name)).toBe(name);
    expect(normaliseBackdrop('none')).toBeUndefined();
    expect(normaliseBackdrop('silk')).toBeUndefined();
    expect(normaliseBackdrop(7)).toBeUndefined();
    expect(normaliseBackdrop(undefined)).toBeUndefined();
  });

  it('is stored on the section through the schema, and a stray value is dropped', () => {
    expect(sectionWith({ backdrop: 'aurora' }).backdrop).toBe('aurora');
    expect(sectionWith({ backdrop: 'plasma' }).backdrop).toBeUndefined();
    expect(sectionWith({}).backdrop).toBeUndefined();
  });
});

describe('the render', () => {
  it('emits a backdrop only for a section with no picture and no film', () => {
    // A background recipe moves the picture; two things animating one
    // background is the bug the motion model resolves everywhere else.
    expect(render).toContain("const backdrop = !video && bgImages.length === 0 ? section.backdrop : undefined;");
    expect(render).toContain('data-backdrop={backdrop}');
    expect(render).toContain('{backdrop && <div className="tgs-section__backdrop" aria-hidden="true" />}');
  });

  it('holds still on the editing canvas, so a client can select what sits on it', () => {
    expect(render).toContain("data-backdrop-still={backdrop && editable ? '' : undefined}");
  });
});

describe('the stylesheet', () => {
  it('draws every backdrop', () => {
    for (const name of NAMES) {
      expect(css, name).toContain(`.tgs-section[data-backdrop='${name}'] .tgs-section__backdrop`);
    }
  });

  it('sits under the content and clips its own layers', () => {
    const at = css.indexOf('.tgs-section__backdrop {');
    const rule = css.slice(at, css.indexOf('}', at));
    expect(rule).toContain('position: absolute;');
    expect(rule).toContain('overflow: hidden;');
    expect(rule).toContain('z-index: 0;');
    expect(rule).toContain('pointer-events: none;');
  });

  it('moves only behind the reduced-motion guard, and never on the canvas', () => {
    const guarded = guardedBlocks(css);
    for (const name of ['aurora', 'rays', 'waves', 'drift', 'contours']) {
      expect(guarded, name).toContain(`.tgs-section[data-backdrop='${name}']:not([data-backdrop-still])`);
    }
    // No backdrop animation anywhere outside the guard.
    const outside = css.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/g, '');
    expect(outside).not.toMatch(/animation: tgs-bd-/);
  });

  it('keeps the grain still, because the grain is the atmosphere', () => {
    expect(css).not.toMatch(/data-backdrop='grain'\][^{]*\{[^}]*animation/);
  });

  it('animates transform only, never the section itself', () => {
    const names = css.match(/@keyframes tgs-bd-[\w-]+ \{[\s\S]*?\n\}/g) ?? [];
    expect(names.length).toBeGreaterThanOrEqual(8);
    for (const block of names) {
      expect(block).toMatch(/transform:/);
      expect(block).not.toMatch(/background-position|left:|top:|width:|height:/);
    }
  });

  it('draws in the section colours, and in the client light on the two coloured bands', () => {
    expect(css).toContain('--tgs-bd-a: var(--tgs-sgrad-a, var(--tgs-accent));');
    expect(css).toContain('--tgs-bd-b: var(--tgs-sgrad-b, var(--tgs-primary));');
    // The light on a dark band is the theme's own light text, not a hard white:
    // a warm dark band gets warm light, and no hex fallback the theme never sets
    // (the rule tests/branding.test.ts enforces) sneaks onto a client site.
    const dark = css.slice(css.indexOf(".tgs-section[data-backdrop][data-tone='dark'] {"));
    expect(dark.slice(0, 200)).toContain('--tgs-bd-a: var(--tgs-sgrad-a, var(--tgs-text-invert));');
    const accent = css.slice(css.indexOf(".tgs-section[data-backdrop][data-tone='accent'] {"));
    expect(accent.slice(0, 200)).toContain('--tgs-bd-a: var(--tgs-sgrad-a, var(--tgs-on-primary));');
    expect(css).not.toMatch(/--tgs-bd-[ab]: var\(--tgs-sgrad-[ab], #/);
  });

  it('loops the waves and the specks on a whole number of tiles, so no seam shows', () => {
    // Each moving layer is wider or taller than the section by exactly the
    // distance it travels, and that distance is a multiple of its tile.
    expect(css).toContain('width: calc(100% + 640px);');
    expect(css).toContain('to { transform: translate3d(-640px, 0, 0); }');
    expect(css).toContain('mask-size: 320px 100%;');
    expect(css).toContain('background-size: 300px 300px;');
    expect(css).toContain('to { transform: translate3d(0, 300px, 0); }');
  });
});

describe('the editor', () => {
  it('offers the list beside the animated gradient, with none as the way off', () => {
    expect(editor).toContain('BACKDROP_CHOICES.map((choice) => (');
    expect(editor).toContain("value={normaliseBackdrop(section.backdrop) ?? 'none'}");
    expect(editor).toContain('set({ backdrop: normaliseBackdrop(event.target.value) }, `sec:${index}:backdrop`)');
  });
});

describe('the pictureless presets wear one', () => {
  const wearing: Array<[string, (typeof NAMES)[number]]> = [
    ['cta-dark-panel', 'aurora'],
    ['stats-band', 'rays'],
    ['cta-newsletter', 'waves'],
    ['testimonials-one-big', 'drift'],
    ['banner-reassurance', 'contours'],
    ['cta-statement', 'grain'],
  ];

  it.each(wearing)('%s wears %s, and builds to a section carrying it', (id, backdrop) => {
    const preset = presetById(id);
    expect(preset?.section?.backdrop).toBe(backdrop);
    expect(buildPresetSection(preset!).backdrop).toBe(backdrop);
  });

  it('previews it in the picker, so the thumbnail is the promise the insert keeps', () => {
    expect(presetThumb(presetById('cta-dark-panel')!).backdrop).toBe('aurora');
    expect(presetThumb(presetById('text-intro')!).backdrop).toBeUndefined();
    const picker = read('components', 'editor', 'SectionPicker.tsx');
    expect(picker).toContain('<g data-tone="backdrop" data-backdrop={backdrop}>');
  });

  it('never dresses a section that has a photograph behind it', () => {
    // A backdrop on an over-photo hero would be silently dropped by the render;
    // a preset asking for one there is a mistake worth catching at the data.
    const both = PAGE_PRESETS.filter((p) => p.section?.backdrop && p.section?.backgroundQuery).map((p) => p.id);
    expect(both).toEqual([]);
  });
});
