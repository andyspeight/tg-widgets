/**
 * The theme designer, tested the way the page builder is: the pure halves run
 * for real, the server halves are asserted from the source.
 *
 * WHAT IS ACTUALLY AT RISK:
 *
 * 1. A PAIRING THAT DOES NOT EXIST. Every family in the pairing catalogue is
 *    imported from Google by name at plan time; a typo means a site quietly
 *    keeps its fallback face forever. The catalogue is checked against the
 *    generated Google Fonts list, so a renamed family fails here rather than
 *    in production, silently.
 *
 * 2. THE MODEL'S COLOURS BECOMING CSS. Every colour lands in a custom property
 *    on a published page, so anything that is not a six-digit hex must die at
 *    the parse. And a palette can be valid hex and still break the page: a
 *    mid-tone "background" under sections designed for paper, or pale grey
 *    "text". Those are corrected, not fatal, because the palette around them
 *    is still the client's.
 *
 * 3. THE THEME OVERWRITING A DECISION. A designed theme must only ever land on
 *    a site that still wears the platform default. Asserted from the action's
 *    source, since the guard is one line and losing it repaints somebody's
 *    committed brand on their next "Plan my site".
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  FONT_PAIRINGS,
  pairingById,
  pairingCatalogue,
  themeFromModel,
  typographyFor,
} from '../lib/ai/theme-design';
import { GOOGLE_FONTS } from '../lib/fonts/catalogue';
import { familySlug } from '../lib/fonts/google';
import { DEFAULT_THEME, parseTheme, themeIsDefault } from '../lib/theme/schema';

const ROOT = join(__dirname, '..');

const ANSWER = JSON.stringify({
  pair: 'playfair-manrope',
  brand: '#1B333D',
  accent: '#C8452C',
  pageBackground: '#F7F4EE',
  text: '#16181A',
  corners: 'sharp',
});

describe('the pairing catalogue', () => {
  it('names only families Google actually publishes', () => {
    /*
     * The import path checks a typed name against Google itself, so a family
     * missing from the generated list would still import - but nothing TYPES
     * these names, they are data, so a family Google renamed or dropped would
     * fail on every site forever. The generated list is the cheapest tripwire.
     */
    const known = new Set(GOOGLE_FONTS.map(([name]) => name));
    for (const pairing of FONT_PAIRINGS) {
      expect(known.has(pairing.display), `${pairing.display} is not on Google Fonts`).toBe(true);
      expect(known.has(pairing.body), `${pairing.body} is not on Google Fonts`).toBe(true);
    }
  });

  it('has unique ids, every one offered to the model', () => {
    const ids = FONT_PAIRINGS.map((pairing) => pairing.id);
    expect(new Set(ids).size).toBe(ids.length);
    const catalogue = pairingCatalogue();
    for (const id of ids) expect(catalogue).toContain(`- ${id}:`);
  });

  it('is wide enough that two briefs are not funnelled to one look', () => {
    expect(FONT_PAIRINGS.length).toBeGreaterThanOrEqual(12);
  });
});

describe('reading the model answer', () => {
  it('turns a good answer into a theme the schema accepts unchanged', () => {
    const design = themeFromModel(ANSWER);
    if (!design.ok) throw new Error(design.error);

    const theme = parseTheme(design.theme);
    expect(theme.brand).toBe('#1b333d');
    expect(theme.accent).toBe('#c8452c');
    expect(theme.pageBackground).toBe('#f7f4ee');
    expect(theme.text).toBe('#16181a');
    expect(theme.corners).toBe('sharp');
    // The whole point: this is no longer the default look.
    expect(themeIsDefault(theme)).toBe(false);
  });

  it('accepts an answer in markdown fences, because models do that', () => {
    const design = themeFromModel('```json\n' + ANSWER + '\n```');
    expect(design.ok).toBe(true);
  });

  it('refuses a pairing that is not in the catalogue', () => {
    const design = themeFromModel(ANSWER.replace('playfair-manrope', 'comic-sans-forever'));
    expect(design.ok).toBe(false);
  });

  it('refuses a colour that is not a six-digit hex', () => {
    // 'red;}' is the CSS-escape shape; a named colour is refused the same way.
    const design = themeFromModel(ANSWER.replace('#C8452C', 'red;}'));
    expect(design.ok).toBe(false);
  });

  it('corrects a mid-tone paper and pale ink instead of failing the design', () => {
    const design = themeFromModel(
      JSON.stringify({
        pair: 'fraunces-archivo',
        brand: '#1b333d',
        accent: '#c8452c',
        pageBackground: '#7a6f5f',
        text: '#c0c0c0',
        corners: 'soft',
      }),
    );
    if (!design.ok) throw new Error(design.error);
    // The palette survives; the two structural colours fall back to safe.
    expect(design.theme.pageBackground).toBe(DEFAULT_THEME.pageBackground);
    expect(design.theme.text).toBe(DEFAULT_THEME.text);
    expect(design.theme.brand).toBe('#1b333d');
  });

  it('falls back to soft corners on anything that is not a corner', () => {
    const design = themeFromModel(ANSWER.replace('"sharp"', '"7px"'));
    if (!design.ok) throw new Error(design.error);
    expect(design.theme.corners).toBe('soft');
  });
});

describe('the typography a pairing carries', () => {
  it('puts the display face on the openers and the body face on the rest', () => {
    const pairing = pairingById('playfair-manrope');
    if (!pairing) throw new Error('pairing missing');
    const typography = typographyFor(pairing);

    expect(typography.h1.family).toBe(familySlug('Playfair Display'));
    expect(typography.h2.family).toBe(familySlug('Playfair Display'));
    expect(typography.h3.family).toBe(familySlug('Playfair Display'));
    expect(typography.h4.family).toBe(familySlug('Manrope'));
    expect(typography.p.family).toBe(familySlug('Manrope'));
  });

  it('carries the pairing treatment, not the platform default squeeze', () => {
    const pairing = pairingById('playfair-manrope');
    if (!pairing) throw new Error('pairing missing');
    const typography = typographyFor(pairing);
    // A didone at the default 700/-3 is the almost-right that reads as template.
    expect(typography.h1.weight).toBe(500);
    expect(typography.h1.tracking).toBe(0);
    // 'grand' opens with display-sized type.
    expect(typography.h1.size).toBe(56);
  });

  it('respects a single-weight display face', () => {
    // Young Serif ships one weight. Asking for 700 would fake-bold it.
    const pairing = pairingById('young-serif-hanken');
    if (!pairing) throw new Error('pairing missing');
    expect(typographyFor(pairing).h1.weight).toBe(400);
  });

  it('survives the schema round trip with its families intact', () => {
    const design = themeFromModel(ANSWER);
    if (!design.ok) throw new Error(design.error);
    const theme = parseTheme(design.theme);
    expect(theme.typography.h1.family).toBe(familySlug('Playfair Display'));
    expect(theme.typography.p.family).toBe(familySlug('Manrope'));
  });
});

describe('where the design lands', () => {
  const actions = readFileSync(join(ROOT, 'app', 'actions', 'ai.ts'), 'utf8');
  const fn = actions.slice(
    actions.indexOf('async function designSiteTheme'),
    actions.indexOf('export async function planSiteAction'),
  );

  it('never overwrites a theme somebody has set', () => {
    // The one-line guard this whole feature hangs off.
    expect(fn).toContain('if (!themeIsDefault(await getTheme(tenantId))) return null;');
  });

  it('is applied only when the plan itself succeeded, and awaited on every exit', () => {
    /*
     * Three review findings pinned at once: the design is RETURNED, not
     * applied (a failed plan must leave the site exactly as found, and an
     * applied theme would stop the retry from designing one); the apply is
     * gated on plan success in the action; and the in-flight call is awaited
     * in a finally so no exit path abandons a write to be killed by the
     * platform freeze.
     */
    const action = actions.slice(
      actions.indexOf('export async function planSiteAction'),
      actions.indexOf('export async function describePagesAction'),
    );
    expect(fn).toContain('return design;');
    expect(fn).not.toContain('applyDesignedTheme');
    expect(action).toContain('design = await themePromise;');
    expect(action.indexOf('applyDesignedTheme')).toBeGreaterThan(action.indexOf('if (!plan.ok)'));
    // And only for a caller who could change the theme by hand.
    expect(action).toContain("requireCapability('theme')");
  });

  it('is best effort: a failed design cannot fail the plan', () => {
    expect(fn).toContain('catch (error)');
    expect(fn.slice(fn.indexOf('catch (error)'))).not.toContain('throw');
  });

  it('pays into the same claimed slot as the plan', () => {
    expect(fn).toContain('recordTokens(tenantId, claimId,');
    expect(fn).not.toContain('claimRequest(');
  });

  it('treats the profile as description, never instruction', () => {
    // The same profileBlock wrapper every other prompt uses carries that rule.
    expect(fn).toContain('profileBlock(settings)');
  });
});
