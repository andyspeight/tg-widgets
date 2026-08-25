/**
 * When the editor canvas is a true preview and when it is not.
 *
 * THE THRESHOLD IS THE CONTAINED WIDTH, not the width somebody chose in the
 * toolbar, and that distinction is the whole point of this file. A contained
 * section caps its inner at --tgs-width-contained, so from there upward every
 * desktop width lays out identically. Measured on a real published page: the
 * hero's heading box was 1068px at a 1200px viewport and 1068px at 2560px.
 *
 * Andy hit this on 25 Aug 2026, with a headline on one line live and two in the
 * editor, and the old badge could not explain it: it compared the drawn width
 * against the CHOSEN width, so 1150px warned while being perfectly faithful and
 * 1050px warned in the same words while not being.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (...p: string[]) => readFileSync(resolve(__dirname, '..', ...p), 'utf8');

describe('the canvas fidelity threshold', () => {
  const shell = read('components', 'editor', 'EditorShell.tsx');
  const css = read('app', 'globals.css');

  it('matches the stylesheet, or the badge lies about the page it is previewing', () => {
    const declared = /--tgs-width-contained:\s*(\d+)px/.exec(css);
    expect(declared, '--tgs-width-contained must exist').not.toBeNull();

    const used = /const CONTAINED_WIDTH = (\d+);/.exec(
      shell.replace(/\/\*[\s\S]*?\*\//g, ''),
    );
    expect(used, 'the editor must carry the same number').not.toBeNull();
    expect(Number(used![1])).toBe(Number(declared![1]));
  });

  it('tells the two cases apart rather than warning the same way for both', () => {
    const code = shell.replace(/\/\*[\s\S]*?\*\//g, '');
    // Above the line it is exact and should say so; below it, text wraps early.
    expect(code).toContain('actualWidth >= CONTAINED_WIDTH');
    expect(code).toContain('wraps early');
  });

  it('still says the drawn width, because the number itself is the honest part', () => {
    expect(shell).toContain('showing {actualWidth}');
  });
});
