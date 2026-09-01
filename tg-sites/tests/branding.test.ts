/**
 * Does a client's brand actually reach everything it should?
 *
 * Coastwise is a test rig rather than a customer, so the question these ask is
 * not "does that page look right" but "will a brand-new agency's colours reach
 * every surface, or do ours leak somewhere nobody looks". A leak of that kind
 * is invisible in review precisely because our defaults are tasteful: a navy
 * wash over a photograph reads as a decision, not as a fallback.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { themeTokens } from '../lib/theme/tokens';
import { parseTheme } from '../lib/theme/schema';
import { contrast } from '../lib/theme/colour';

const css = readFileSync(resolve(__dirname, '..', 'app', 'globals.css'), 'utf8');

/** Every --tgs- custom property the stylesheet defines on the bare :root. */
function rootTokens(): Set<string> {
  const start = css.indexOf(':root');
  const block = css.slice(start, css.indexOf('}', start));
  return new Set([...block.matchAll(/(--tgs-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
}

describe('no client-facing colour is stuck on a Travelgenix default', () => {
  it('sets every colour token the stylesheet asks for with a fallback', () => {
    /*
     * THE TEST THAT WOULD HAVE CAUGHT THE SCRIM.
     *
     * `var(--tgs-x, #0f172a)` means "a theme colour, with a default if nobody
     * sets it". If the theme never sets it, that default is permanent and it is
     * OURS. --tgs-scrim-colour was exactly that: asked for in a dozen places,
     * emitted by nothing, so every scrim on every client's site was our navy,
     * on the most prominent element of every page.
     *
     * Found by comparing what themeTokens emits against what the stylesheet
     * asks for, which is a comparison worth keeping rather than repeating by
     * hand.
     */
    const emitted = new Set(Object.keys(themeTokens(parseTheme({})).style));
    const atRoot = rootTokens();

    const asked = new Map<string, string>();
    for (const m of css.matchAll(/var\((--tgs-[a-z0-9-]+),\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))\s*\)/g)) {
      if (!asked.has(m[1])) asked.set(m[1], m[2]);
    }
    expect(asked.size, 'expected the stylesheet to ask for some themed colours').toBeGreaterThan(0);

    const orphans = [...asked].filter(([name]) => !emitted.has(name) && !atRoot.has(name));
    expect(orphans.map(([n, v]) => `${n} stuck at ${v}`)).toEqual([]);
  });

  it("builds the scrim from the client's own dark", () => {
    const coastwise = themeTokens(parseTheme({ brand: '#1b333d', surfaceDark: '#1b333d' })).style as Record<string, string>;
    expect(coastwise['--tgs-scrim-colour']).toBe('#1b333d');
    // And it is not ours.
    expect(coastwise['--tgs-scrim-colour']).not.toBe('#0f172a');
  });

  it('keeps a scrim legible whatever the brand, including awkward ones', () => {
    /*
     * A scrim exists to carry light text over a photograph, so a brand-tinted
     * one is only an improvement if it stays dark. brandDark is already deepened
     * until light text clears 7:1, which is why no new derivation was needed,
     * but a pale or near-white brand is exactly the case that would break it.
     */
    for (const brand of ['#1b333d', '#f2c9d6', '#4f8a5b', '#fafafa', '#ffffff']) {
      const style = themeTokens(parseTheme({ brand })).style as Record<string, string>;
      const scrim = style['--tgs-scrim-colour'];
      expect(contrast(scrim, '#ffffff'), `white on the scrim for ${brand}`).toBeGreaterThanOrEqual(7);
    }
  });
});

describe('the tool and the site keep their own namespaces', () => {
  it('leaves the editor chrome free of site tokens', () => {
    // The client's theme sits on the editor root so colour swatches preview the
    // client's brand. That is only safe while the chrome owns no --tgs-.
    const chrome = readFileSync(resolve(__dirname, '..', 'components', 'editor', 'editor.css'), 'utf8');
    expect(chrome).not.toContain('--tgs-');
  });

  it('keeps operate-surface components out of the site namespace', () => {
    /*
     * tgs- is the published site, which is client-branded. sv- and ed- are the
     * tool. The destination picker was written as tgs-adopt, which was harmless
     * while the two never met and stopped being harmless the moment the client's
     * theme went onto the editor root.
     */
    for (const file of [
      ['components', 'collections', 'AdoptDialog.tsx'],
      ['components', 'collections', 'CollectionsDashboard.tsx'],
      ['components', 'sites', 'SiteDashboard.tsx'],
    ]) {
      const source = readFileSync(resolve(__dirname, '..', ...file), 'utf8');
      expect(source, file.join('/')).not.toMatch(/className="tgs-/);
    }
  });
});
