/**
 * Where a section's content sits when the section is taller than the content.
 *
 * minHeight could always make a section taller than what was in it, and the
 * leftover height had nowhere to go but underneath, because a section is a plain
 * block. Found on a live client site on 25 Aug 2026 by fetching the served HTML
 * and rendering it: a 1200px hero holding 249px of words, so 950px of empty
 * ground below the buttons. It read as a broken page rather than a tall one.
 *
 * The column's own align does not cover it. That centres a column against its
 * ROW, and a row is only as tall as its content, so on a tall section it has
 * nothing to centre against and silently does nothing. That was tried first.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { normaliseAlignY, parsePage, CONTENT_VERSION } from '../lib/content/schema';

const read = (...p: string[]) => readFileSync(resolve(__dirname, '..', ...p), 'utf8');

describe('normaliseAlignY', () => {
  it('takes the two values that mean something', () => {
    expect(normaliseAlignY('centre')).toBe('centre');
    expect(normaliseAlignY('bottom')).toBe('bottom');
  });

  it('treats top as absent, so the default costs no attribute', () => {
    expect(normaliseAlignY('top')).toBeUndefined();
    expect(normaliseAlignY(undefined)).toBeUndefined();
  });

  it('refuses anything else rather than passing it through', () => {
    for (const bad of ['middle', 'CENTRE', 'end', 42, null, {}, []]) {
      expect(normaliseAlignY(bad)).toBeUndefined();
    }
  });
});

describe('a stored section', () => {
  const page = (alignY: unknown) =>
    parsePage({
      version: CONTENT_VERSION,
      id: 'p',
      title: 'T',
      slug: '',
      sections: [{ id: 's', tone: 'light', width: 'contained', paddingY: 0, minHeight: 1200, overlay: 0, alignY, rows: [] }],
    });

  it('keeps a real value through a save', () => {
    const r = page('centre');
    expect(r.ok && r.page.sections[0].alignY).toBe('centre');
  });

  it('drops a value it does not know, rather than storing it', () => {
    const r = page('sideways');
    expect(r.ok && r.page.sections[0].alignY).toBeUndefined();
  });
});

describe('what actually draws it', () => {
  const css = read('app', 'globals.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const render = read('components', 'render', 'PageRenderer.tsx').replace(/\/\*[\s\S]*?\*\//g, '');

  it('only changes the layout of a section that asked', () => {
    /*
     * The attribute gate is the whole safety argument: no attribute, no flex, so
     * not one stored page moves. Switching display is only safe because every
     * other child of a section is out of flow.
     */
    expect(css).toContain('.tgs-section[data-align-y] {');
    expect(css).toMatch(/\.tgs-section\[data-align-y\]\s*\{[^}]*display:\s*flex/);
    expect(css).toContain(".tgs-section[data-align-y='centre'] { justify-content: center; }");
    expect(css).toContain(".tgs-section[data-align-y='bottom'] { justify-content: flex-end; }");
  });

  it('emits nothing at all when the section did not ask', () => {
    expect(render).toContain('data-align-y={section.alignY}');
  });

  it('leaves every other section child out of flow, or the flex would reach them', () => {
    for (const sel of ['.tgs-section__bg', '.tgs-section__scrim', '.tgs-section__divider']) {
      const block = css.slice(css.indexOf(`${sel} {`));
      expect(block.slice(0, 200), `${sel} must stay absolute`).toContain('position: absolute');
    }
  });
});
