/**
 * The Google endpoints, for real. OPT IN.
 *
 *   TG_LIVE_FONTS=1 npx vitest run tests/fonts.live.test.ts
 *
 * Skipped by default, on purpose. A suite that reaches the internet fails on a
 * train and fails in CI without egress, and a suite that fails for reasons
 * unrelated to the code stops being run at all.
 *
 * But it has to exist. tests/fonts.test.ts feeds the parser a captured response,
 * which proves the parser and proves nothing about whether Google still answers
 * in that shape. This is the test that catches Google changing, and the only one
 * that can. Run it when touching lib/fonts/google.ts, or when an import starts
 * failing for no apparent reason.
 */

import { describe, expect, it } from 'vitest';

import { GOOGLE_FONTS } from '../lib/fonts/catalogue';
import { familyExists, importGoogleFamily, sniffFontFormat } from '../lib/fonts/google';

const live = process.env.TG_LIVE_FONTS === '1';

describe.skipIf(!live)('Google, live', () => {
  it('imports a family, in woff2, at several weights', async () => {
    const imported = await importGoogleFamily('Playfair Display');

    expect(imported.family).toBe('Playfair Display');
    expect(imported.files.length).toBeGreaterThan(1);

    for (const file of imported.files) {
      // The UA matters: ask as Node and Google answers with ttf, three times the
      // size, and nothing here would notice except this assertion.
      expect(sniffFontFormat(file.bytes), `${file.weight}/${file.subset}`).toBe('woff2');
      expect(file.subset === 'latin' || file.subset === 'latin-ext').toBe(true);
      expect(file.unicodeRange).toMatch(/^U\+/);
      expect(file.bytes.byteLength).toBeGreaterThan(1000);
    }

    // More than one weight, or the weight control on the type panel does nothing.
    expect(new Set(imported.files.map((f) => f.weight)).size).toBeGreaterThan(1);
  }, 120_000);

  it('imports a single-weight display face without failing', async () => {
    // A family that does not offer all four weights must import as what it has,
    // rather than erroring on the ones it lacks.
    const imported = await importGoogleFamily('Bungee');
    expect(imported.files.length).toBeGreaterThan(0);
  }, 120_000);

  it('corrects the capitals, which Google is strict about', async () => {
    const imported = await importGoogleFamily('playfair display');
    expect(imported.family).toBe('Playfair Display');
  }, 120_000);

  it('says no to a family that does not exist', async () => {
    expect(await familyExists('Notarealfontname123')).toBe(false);
  }, 60_000);

  /**
   * The catalogue is a snapshot, so this is a soft check on how stale it is.
   * A handful of misses is normal drift; a lot means it is worth regenerating.
   */
  it('mostly agrees with Google about what exists', async () => {
    const sample = ['Inter', 'Roboto', 'Lato', 'Merriweather', 'Sora', 'Figtree'];
    const missing = sample.filter(
      (family) => !GOOGLE_FONTS.some(([name]) => name === family),
    );
    expect(missing, 'run node tools/build-font-catalogue.mjs').toEqual([]);
  });
});
