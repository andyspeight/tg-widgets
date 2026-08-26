/**
 * Fonts: importing, storing, and turning into CSS.
 *
 * The Google endpoints are NOT called here. A test that reaches the internet
 * fails on a train, and a test suite that fails for reasons unrelated to the code
 * stops being run. The parser is fed a captured response instead, and the shape
 * of that response is asserted by tests/fonts.live.test.ts, which is opt-in.
 *
 * What is worth testing is the same three things as everywhere else: that
 * validation cannot be bypassed, that nothing a client controls reaches CSS
 * unchecked, and that the three places a font URL appears agree with each other.
 */

import { describe, expect, it } from 'vitest';

import { GOOGLE_FONTS } from '../lib/fonts/catalogue';
import {
  parsePreviewCss,
  previewCssUrl,
  previewText,
  resolvePreviewFamily,
} from '../lib/fonts/preview';
import { previewFamily, previewHref, previewStack } from '../lib/fonts/use-preview';
import {
  familySlug,
  looksLikeWoff2,
  normaliseFamilyName,
  parseGoogleCss,
  resolveFamilyName,
  sniffFontFormat,
} from '../lib/fonts/google';
import {
  familiesFromFiles,
  fontFaceCss,
  fontFileUrl,
  fontPreloads,
  resolveStack,
  typographyTokens,
  usedFontSlugs,
  type LibraryFont,
  type LibraryFontFile,
} from '../lib/theme/fonts';
import { FONTS } from '../lib/theme/schema';
import {
  DEFAULT_TYPOGRAPHY,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  parseTypography,
  TEXT_STYLES,
} from '../lib/theme/typography';

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

describe('font names', () => {
  it.each([
    ['Playfair Display', 'Playfair Display'],
    ['  Inter  ', 'Inter'],
    ['Noto  Sans   JP', 'Noto Sans JP'],
    // A newline collapses to a space rather than being refused. It is almost
    // always a paste artefact, and the result carries no newline, so there is
    // nothing left to inject with.
    ['Inter\nBold', 'Inter Bold'],
    ['Roboto2', 'Roboto2'],
  ])('accepts %j', (input, expected) => {
    expect(normaliseFamilyName(input)).toBe(expected);
  });

  /*
   * Each of these would end up inside a quoted string in a @font-face rule and
   * inside a font-family declaration. An apostrophe closes the quote; a
   * semicolon or brace ends the declaration. There is no legitimate Google
   * family name containing any of them.
   */
  it.each([
    ['an apostrophe', "Inter'"],
    ['a semicolon', 'Inter; color: red'],
    ['a brace', 'Inter } body {'],
    ['a comma, which would add a second family', 'Inter, monospace'],
    ['a backslash', 'Inter\\'],
    ['angle brackets', '<script>'],
    ['a url', 'url(https://evil.example)'],
    ['empty', ''],
    ['only spaces', '   '],
    ['not a string', 42],
    ['null', null],
    ['far too long', 'a'.repeat(80)],
  ])('refuses %s', (_label, input) => {
    expect(normaliseFamilyName(input)).toBeNull();
  });

  it('makes a url-safe slug', () => {
    expect(familySlug('Playfair Display')).toBe('playfair-display');
    expect(familySlug('PT Sans')).toBe('pt-sans');
    expect(familySlug('Roboto')).toBe('roboto');
  });

  /*
   * Google's stylesheet endpoint is CASE SENSITIVE, which is the single most
   * likely thing to make importing look broken. Title-casing is not enough
   * either, hence the catalogue lookup.
   */
  it.each([
    ['playfair display', 'Playfair Display'],
    ['PLAYFAIR DISPLAY', 'Playfair Display'],
    ['pt sans', 'PT Sans'],
    ['ibm plex sans', 'IBM Plex Sans'],
    ['dm serif text', 'DM Serif Text'],
    ['eb garamond', 'EB Garamond'],
    ['  Inter  ', 'Inter'],
  ])('resolves %j to Google spelling', (typed, expected) => {
    expect(resolveFamilyName(typed, GOOGLE_FONTS)).toBe(expected);
  });

  it('returns null for a name not in the catalogue, so the caller can still try', () => {
    // Not "does not exist": a family published after the catalogue was generated
    // is not in it and still imports. Distinguishing the two is the point.
    expect(resolveFamilyName('Somefontfromnextyear', GOOGLE_FONTS)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Sniffing a file
// ---------------------------------------------------------------------------

describe('what a font file is', () => {
  const bytes = (...values: number[]) => new Uint8Array([...values, ...new Array(64).fill(0)]);

  it('knows the four formats by their signature', () => {
    expect(sniffFontFormat(bytes(0x77, 0x4f, 0x46, 0x32))).toBe('woff2');
    expect(sniffFontFormat(bytes(0x77, 0x4f, 0x46, 0x46))).toBe('woff');
    expect(sniffFontFormat(bytes(0x00, 0x01, 0x00, 0x00))).toBe('truetype');
    expect(sniffFontFormat(bytes(0x74, 0x72, 0x75, 0x65))).toBe('truetype');
    expect(sniffFontFormat(bytes(0x4f, 0x54, 0x54, 0x4f))).toBe('opentype');
  });

  /*
   * The bytes are what gets served to every visitor, with a font MIME type, into
   * a browser font parser. The filename is whatever somebody typed, so the
   * signature is the only thing worth believing.
   */
  it.each([
    ['a PNG', [0x89, 0x50, 0x4e, 0x47]],
    ['a ZIP, which is what an unextracted brand pack is', [0x50, 0x4b, 0x03, 0x04]],
    ['a PDF', [0x25, 0x50, 0x44, 0x46]],
    ['an ELF binary', [0x7f, 0x45, 0x4c, 0x46]],
    ['HTML', [0x3c, 0x21, 0x44, 0x4f]],
    ['nothing recognisable', [0x00, 0x00, 0x00, 0x00]],
  ])('refuses %s', (_label, signature) => {
    expect(sniffFontFormat(bytes(...signature))).toBeNull();
  });

  it('refuses a file too short to have a signature', () => {
    expect(sniffFontFormat(new Uint8Array([0x77, 0x4f]))).toBeNull();
    expect(looksLikeWoff2(new Uint8Array([]))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Parsing Google's stylesheet
// ---------------------------------------------------------------------------

/** A captured css2 response, trimmed to three faces across two subsets. */
const GOOGLE_CSS = `
/* cyrillic */
@font-face {
  font-family: 'Playfair Display';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/playfairdisplay/v40/cyr.woff2) format('woff2');
  unicode-range: U+0301, U+0400-045F;
}
/* latin-ext */
@font-face {
  font-family: 'Playfair Display';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/playfairdisplay/v40/latinext.woff2) format('woff2');
  unicode-range: U+0100-02BA, U+1E00-1E9F;
}
/* latin */
@font-face {
  font-family: 'Playfair Display';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/playfairdisplay/v40/latin.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131;
}
`;

describe('parsing the Google stylesheet', () => {
  it('reads family, weight, subset, url and range from every block', () => {
    const faces = parseGoogleCss(GOOGLE_CSS);

    expect(faces).toHaveLength(3);
    expect(faces[0]).toEqual({
      family: 'Playfair Display',
      weight: 400,
      subset: 'cyrillic',
      url: 'https://fonts.gstatic.com/s/playfairdisplay/v40/cyr.woff2',
      unicodeRange: 'U+0301, U+0400-045F',
    });
    expect(faces[2].weight).toBe(700);
    expect(faces[2].subset).toBe('latin');
  });

  /*
   * The URL in the response becomes a fetch, so it is input. A stylesheet that
   * pointed somewhere else would make this a request somebody else could aim.
   */
  it('refuses a src pointing anywhere but Google', () => {
    const hostile = GOOGLE_CSS.replace(
      'https://fonts.gstatic.com/s/playfairdisplay/v40/cyr.woff2',
      'https://evil.example/payload.woff2',
    );
    const faces = parseGoogleCss(hostile);
    expect(faces).toHaveLength(2);
    expect(faces.every((f) => f.url.startsWith('https://fonts.gstatic.com/'))).toBe(true);
  });

  it('skips a block missing anything it needs', () => {
    expect(parseGoogleCss('/* latin */ @font-face { font-family: X; }')).toEqual([]);
    expect(parseGoogleCss('')).toEqual([]);
    expect(parseGoogleCss('not css at all')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Resolving a stack
// ---------------------------------------------------------------------------

const LIBRARY: LibraryFont[] = [
  { slug: 'playfair-display', family: 'Playfair Display', fallback: 'serif', weights: [400, 700] },
  { slug: 'founders', family: 'Founders Grotesk', fallback: 'sans', weights: [400] },
];

describe('resolving a font stack', () => {
  it('quotes a custom family and appends a matching fallback', () => {
    const stack = resolveStack('playfair-display', LIBRARY);
    expect(stack.startsWith("'Playfair Display', ")).toBe(true);
    // A serif falls back to a serif. Falling back to the system sans would
    // reflow the page into a different shape while the woff2 loads.
    expect(stack).toContain('Georgia');
  });

  it('uses a built-in stack by id', () => {
    expect(resolveStack('serif', LIBRARY)).toBe(FONTS.serif.stack);
  });

  it('falls back to the paragraph reference when a style has none', () => {
    expect(resolveStack(null, LIBRARY, 'playfair-display')).toContain('Playfair Display');
  });

  it('falls back to the system stack for a family that is gone', () => {
    // Normal: deleting a font from the library leaves the theme still naming it,
    // deliberately, so re-importing puts it back everywhere it was.
    expect(resolveStack('deleted-font', LIBRARY)).toBe(FONTS.system.stack);
    expect(resolveStack(null, LIBRARY, null)).toBe(FONTS.system.stack);
  });
});

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

describe('typography tokens', () => {
  it('emits five tokens for every one of the seven styles', () => {
    const tokens = typographyTokens(DEFAULT_TYPOGRAPHY, []);
    for (const id of TEXT_STYLES) {
      for (const part of ['font', 'weight', 'size', 'leading', 'tracking']) {
        expect(tokens[`--tgs-${id}-${part}`], `--tgs-${id}-${part}`).toBeDefined();
      }
    }
  });

  it('turns hundredths of an em into em', () => {
    const tokens = typographyTokens(parseTypography({ h1: { tracking: -3 } }), []);
    expect(tokens['--tgs-h1-tracking']).toBe('-0.030em');
  });

  it('keeps the two old aliases pointing somewhere sensible', () => {
    const tokens = typographyTokens(parseTypography({ p: { family: 'serif' } }), []);
    // Referenced throughout globals.css by the page shell, the quote and the
    // button. Anything that reaches for the old name still gets an answer.
    expect(tokens['--tgs-font-body']).toBe(tokens['--tgs-p-font']);
    expect(tokens['--tgs-font-display']).toBe(tokens['--tgs-h2-font']);
  });

  it('cannot emit anything that would close a declaration', () => {
    const tokens = typographyTokens(
      parseTypography({
        h1: { family: "'; } body {", weight: 'x', size: 'y', lineHeight: 'z', tracking: 'w' },
      }),
      LIBRARY,
    );

    for (const [name, value] of Object.entries(tokens)) {
      expect(String(value), `${name} has a semicolon`).not.toContain(';');
      expect(String(value), `${name} has a brace`).not.toContain('}');
      expect(String(value), `${name} has a bracket`).not.toContain('<');
    }
  });
});

describe('typography limits', () => {
  it.each([
    ['far too small', 4, MIN_FONT_SIZE],
    ['far too large', 400, MAX_FONT_SIZE],
  ])('clamps a size that is %s', (_label, input, expected) => {
    expect(parseTypography({ h1: { size: input } }).h1.size).toBe(expected);
  });

  /*
   * A value that is not a number at all falls back to THAT STYLE's default, not
   * to the floor and not to a shared one.
   *
   * The first version of the schema named a single fallback size for all seven
   * styles, so a garbled h1 became 17px: a heading silently shrinking to body
   * size because one field was unreadable. A bad field should cost that field
   * and nothing else.
   */
  it.each([
    ['not a number', 'huge'],
    ['infinite', Infinity],
    ['null', null],
    ['an object', {}],
  ])('falls back to the style default for a size that is %s', (_label, input) => {
    expect(parseTypography({ h1: { size: input } }).h1.size)
      .toBe(DEFAULT_TYPOGRAPHY.h1.size);
    expect(parseTypography({ p: { size: input } }).p.size)
      .toBe(DEFAULT_TYPOGRAPHY.p.size);
  });

  it('refuses a weight the importer does not fetch', () => {
    // Back to the h1 default of 700, not to a shared 400.
    expect(parseTypography({ h1: { weight: 250 } }).h1.weight)
      .toBe(DEFAULT_TYPOGRAPHY.h1.weight);
    expect(parseTypography({ h1: { weight: 500 } }).h1.weight).toBe(500);
  });

  it('never lets any style drop below the 15px floor', () => {
    const typography = parseTypography(
      Object.fromEntries(TEXT_STYLES.map((id) => [id, { size: 1 }])),
    );
    for (const id of TEXT_STYLES) {
      expect(typography[id].size, id).toBeGreaterThanOrEqual(MIN_FONT_SIZE);
    }
  });

  it('refuses a family reference that is not a slug', () => {
    expect(parseTypography({ h1: { family: "'; }" } }).h1.family).toBeNull();
    expect(parseTypography({ h1: { family: 'Playfair Display' } }).h1.family).toBeNull();
    expect(parseTypography({ h1: { family: 'playfair-display' } }).h1.family)
      .toBe('playfair-display');
  });
});

// ---------------------------------------------------------------------------
// @font-face, preloads, and the URL they must agree on
// ---------------------------------------------------------------------------

const FILES: LibraryFontFile[] = [
  { id: 'aaaaaaaa-0000-0000-0000-000000000001', slug: 'playfair-display', family: 'Playfair Display', fallback: 'serif', weight: 400, style: 'normal', format: 'woff2', unicodeRange: 'U+0000-00FF' },
  { id: 'aaaaaaaa-0000-0000-0000-000000000002', slug: 'playfair-display', family: 'Playfair Display', fallback: 'serif', weight: 400, style: 'normal', format: 'woff2', unicodeRange: 'U+0100-02BA' },
  { id: 'aaaaaaaa-0000-0000-0000-000000000003', slug: 'playfair-display', family: 'Playfair Display', fallback: 'serif', weight: 700, style: 'normal', format: 'woff2', unicodeRange: 'U+0000-00FF' },
  { id: 'bbbbbbbb-0000-0000-0000-000000000001', slug: 'founders', family: 'Founders Grotesk', fallback: 'sans', weight: 400, style: 'normal', format: 'woff', unicodeRange: null },
];

describe('font faces and preloads', () => {
  it('derives the family list from the files, so a page needs one query', () => {
    const families = familiesFromFiles(FILES);
    expect(families).toHaveLength(2);
    expect(families[0]).toEqual({
      slug: 'playfair-display',
      family: 'Playfair Display',
      fallback: 'serif',
      weights: [400, 700],
    });
  });

  it('writes a rule only for families the theme uses', () => {
    const css = fontFaceCss(FILES, 'demo', new Set(['playfair-display']));
    expect(css).toContain("font-family:'Playfair Display'");
    expect(css).not.toContain('Founders');
    // Three files for that family, so three rules.
    expect(css.match(/@font-face/g)).toHaveLength(3);
  });

  it('always swaps rather than blocking', () => {
    // font-display: block hides text for up to three seconds. Late text beats
    // invisible text, which is why the fallback stacks are shape-matched.
    const css = fontFaceCss(FILES, 'demo', new Set(['playfair-display']));
    expect(css.match(/font-display:swap/g)).toHaveLength(3);
  });

  it('emits no newlines, because this goes in every page', () => {
    const css = fontFaceCss(FILES, 'demo', new Set(['playfair-display', 'founders']));
    expect(css).not.toContain('\n');
  });

  /*
   * THE ONE THAT MATTERS MOST.
   *
   * A preload href that differs from the src in the @font-face by even a
   * character means the browser fetches the file twice and warns that the
   * preload went unused. Both come from fontFileUrl for exactly this reason, and
   * this asserts they still do.
   */
  it('preloads exactly the URL the @font-face asks for', () => {
    const typography = parseTypography({ p: { family: 'playfair-display', weight: 400 } });
    const css = fontFaceCss(FILES, 'demo', usedFontSlugs(typography));
    const preloads = fontPreloads(FILES, 'demo', typography);

    expect(preloads.length).toBeGreaterThan(0);
    for (const preload of preloads) {
      expect(css, `${preload.href} is preloaded but not referenced`).toContain(
        `url(${preload.href})`,
      );
    }
  });

  it('preloads one file per family and weight, not all eight', () => {
    const typography = parseTypography({
      p: { family: 'playfair-display', weight: 400 },
      h1: { family: 'playfair-display', weight: 700 },
    });
    const preloads = fontPreloads(FILES, 'demo', typography);

    // 400 and 700, one each. Not the latin-ext copy of 400: most pages have no
    // accented characters, and the browser fetches it if one does.
    expect(preloads).toHaveLength(2);
    expect(preloads[0].href).toContain('000000000001');
    expect(preloads[1].href).toContain('000000000003');
  });

  /*
   * A heading with no font of its own inherits the paragraph's, AT ITS OWN
   * WEIGHT. So setting one family on the paragraph makes the whole page use it
   * and pulls in every weight the seven styles between them ask for.
   *
   * Here that is 400 from the paragraph and 700 from h1, h2 and h3. The 600 that
   * h4 to h6 default to is not preloaded because this family was not imported at
   * that weight, which is the narrowing working rather than a gap.
   */
  it('preloads the weights the whole scale needs, and no others', () => {
    const typography = parseTypography({ p: { family: 'playfair-display', weight: 400 } });
    const preloads = fontPreloads(FILES, 'demo', typography);

    expect(preloads).toHaveLength(2);
    expect(preloads.map((p) => p.href)).toEqual([
      '/fonts/demo/aaaaaaaa-0000-0000-0000-000000000001.woff2',
      '/fonts/demo/aaaaaaaa-0000-0000-0000-000000000003.woff2',
    ]);
  });

  it('preloads one weight when only one style names a font', () => {
    // h1 alone, so the paragraph and the rest stay on a system stack.
    const typography = parseTypography({ h1: { family: 'playfair-display', weight: 700 } });
    expect(fontPreloads(FILES, 'demo', typography)).toHaveLength(1);
  });

  it('preloads only woff2, never a format the browser will not choose', () => {
    const typography = parseTypography({ p: { family: 'founders', weight: 400 } });
    // Founders is stored as woff. Preloading it would spend the whole download
    // on a file a modern browser skips in favour of nothing.
    expect(fontPreloads(FILES, 'demo', typography)).toEqual([]);
  });

  it('preloads nothing when every style is on a system stack', () => {
    expect(fontPreloads(FILES, 'demo', DEFAULT_TYPOGRAPHY)).toEqual([]);
    expect(usedFontSlugs(DEFAULT_TYPOGRAPHY).size).toBe(0);
  });

  it('builds an immutable URL from the file id', () => {
    // Keyed on the row id, which never changes for a given set of bytes, which
    // is what makes the one-year immutable cache header true rather than hopeful.
    expect(fontFileUrl('demo', 'abc-123', 'woff2')).toBe('/fonts/demo/abc-123.woff2');
    expect(fontFileUrl('demo', 'abc-123', 'opentype')).toBe('/fonts/demo/abc-123.otf');
    expect(fontFileUrl('demo', 'abc-123', 'truetype')).toBe('/fonts/demo/abc-123.ttf');
  });
});

// ---------------------------------------------------------------------------
// Previewing a font nobody has downloaded
// ---------------------------------------------------------------------------

describe('preview URLs', () => {
  /*
   * Deduplicated AND sorted, and the sort is the part that matters.
   *
   * `text` is a set of characters, not a string to typeset, so repeats only make the
   * URL longer. Sorting makes the URL deterministic, and a deterministic URL is what
   * lets the response be cached for a year. Without it, iteration order changes could
   * mint a new URL for the same font and the cache would never be hit.
   */
  it('asks for each character of the name once, in a stable order', () => {
    // R, o, b, t: four distinct characters out of six, capital first because the
    // sort is by code point.
    expect(previewText('Roboto')).toBe('Rbot');
    expect(previewText('aaa')).toBe('a');
    // The same characters in a different order must give the same request.
    expect(previewText('Open Sans')).toBe(previewText('Sans Open'));
  });

  it('builds a css2 URL with one weight and the name as its text', () => {
    const url = new URL(previewCssUrl('Playfair Display'));
    expect(url.origin + url.pathname).toBe('https://fonts.googleapis.com/css2');
    expect(url.searchParams.get('family')).toBe('Playfair Display:wght@400');
    expect(url.searchParams.get('text')).toBe(previewText('Playfair Display'));
    expect(url.searchParams.get('display')).toBe('swap');
  });

  /*
   * THE SSRF CASE. The URL this returns is handed to a server-side fetch, so a
   * response naming any other host has to produce nothing rather than a fetch.
   */
  it('takes a file URL only from Googles own file host', () => {
    expect(parsePreviewCss("src: url(https://fonts.gstatic.com/s/a/b.woff2) format('woff2')"))
      .toBe('https://fonts.gstatic.com/s/a/b.woff2');

    for (const hostile of [
      'src: url(https://evil.test/a.woff2)',
      // Starts with the right text and is a different host entirely.
      'src: url(https://fonts.gstatic.com.evil.test/a.woff2)',
      'src: url(http://fonts.gstatic.com/a.woff2)',
      'src: url(//fonts.gstatic.com/a.woff2)',
      'font-family: nothing here',
      '',
    ]) {
      expect(parsePreviewCss(hostile), hostile).toBeNull();
    }
  });
});

describe('resolvePreviewFamily', () => {
  it('finds a real family however it was capitalised', () => {
    expect(resolvePreviewFamily('playfair display')).toBe('Playfair Display');
    expect(resolvePreviewFamily('PLAYFAIR DISPLAY')).toBe('Playfair Display');
    // The names that broke the importer, because css2 is case sensitive and
    // title-casing gets all three wrong.
    expect(resolvePreviewFamily('pt sans')).toBe('PT Sans');
    expect(resolvePreviewFamily('dm serif text')).toBe('DM Serif Text');
    expect(resolvePreviewFamily('ibm plex sans')).toBe('IBM Plex Sans');
  });

  /*
   * Deliberately stricter than the importer, which falls back to the typed spelling
   * so that "any Google font" stays true for a family published since the snapshot.
   * This is reached by a URL and forwards to a third party, so an unknown name gets
   * nothing rather than being passed along.
   */
  it('refuses anything not in the catalogue, unlike the importer', () => {
    expect(resolvePreviewFamily('Not A Real Font At All')).toBeNull();
    expect(resolvePreviewFamily('')).toBeNull();
    expect(resolvePreviewFamily(null)).toBeNull();
    expect(resolvePreviewFamily(42)).toBeNull();
    expect(resolvePreviewFamily("Roboto'); }")).toBeNull();
    expect(resolvePreviewFamily('../../etc/passwd')).toBeNull();
  });
});

describe('preview families in the browser', () => {
  /*
   * The prefix is not cosmetic. A preview file contains only the letters of the
   * family's own name. Registered under the REAL family name it would compete with
   * the imported font for the same family, weight and style, and the browser picks
   * one face per weight rather than composing them, so every character outside the
   * name could vanish from the specimen.
   */
  it('never uses the real family name', () => {
    expect(previewFamily('Playfair Display')).toBe('TGP Playfair Display');
    expect(previewFamily('Playfair Display')).not.toBe('Playfair Display');
  });

  it('serves previews from our own origin, escaped', () => {
    expect(previewHref('Playfair Display')).toBe('/api/font-preview/Playfair%20Display');
    // A name is matched against the catalogue on the way in, but escaping is still
    // this function's job: an unescaped space would be a different request.
    expect(previewHref('PT Sans')).toBe('/api/font-preview/PT%20Sans');
  });

  it('uses the fallback until the file has landed, then the font', () => {
    expect(previewStack('Lato', false, 'sans-serif')).toBe('sans-serif');
    expect(previewStack('Lato', true, 'sans-serif')).toBe("'TGP Lato', sans-serif");
  });
});

// ---------------------------------------------------------------------------

/**
 * A VARIABLE FONT IS ONE FILE FOR A RANGE OF WEIGHTS.
 *
 * Found on 26 Aug 2026 by looking at what Coastwise had actually stored rather
 * than at the code. Archivo was eight rows holding two distinct files: the same
 * md5 at 400, 500, 600 and 700 for latin, and again for latin-ext. Google says
 * so plainly, and we were throwing it away: asking for four weights returns
 * three urls, each repeated four times, and the latin file's md5 was
 * byte-for-byte the one already in our table.
 *
 * Two faults came out of it, and both are measured rather than argued:
 *
 *   BYTES. Each stored row got its own id and therefore its own url, so a
 *   browser could not tell they were one file. The published page preloaded
 *   102,384 bytes across three requests for 34,928 bytes of font.
 *
 *   WEIGHTS. A face pinned to one weight says the file IS that weight, so a
 *   style asking for 650 snaps to the nearest pinned face instead of
 *   interpolating. In Chromium, Coastwise's h2 at 650 rendered at exactly the
 *   width of 700 (396.11px both). With the range declared, the same file
 *   renders 650 at 389.09px, between 400 and 700 where it was asked for.
 */
describe('a variable font is one file across a range', () => {
  const VARIABLE = [
    {
      id: 'v-latin', slug: 'archivo', family: 'Archivo', fallback: 'sans' as const,
      weight: 400, weightMax: 700, style: 'normal' as const, format: 'woff2',
      unicodeRange: 'U+0000-00FF',
    },
    {
      id: 'v-latin-ext', slug: 'archivo', family: 'Archivo', fallback: 'sans' as const,
      weight: 400, weightMax: 700, style: 'normal' as const, format: 'woff2',
      unicodeRange: 'U+0100-02BA',
    },
  ];

  const typography = {
    p:  { size: 17, family: 'archivo', weight: 400, tracking: 0, lineHeight: 1.6 },
    h1: { size: 56, family: 'archivo', weight: 700, tracking: 0, lineHeight: 1.05 },
    h2: { size: 38, family: 'archivo', weight: 650, tracking: 0, lineHeight: 1.1 },
    h3: { size: 28, family: 'archivo', weight: 600, tracking: 0, lineHeight: 1.2 },
    h4: { size: 22, family: 'archivo', weight: 600, tracking: 0, lineHeight: 1.25 },
    h5: { size: 18, family: 'archivo', weight: 600, tracking: 0, lineHeight: 1.3 },
    h6: { size: 16, family: 'archivo', weight: 600, tracking: 0, lineHeight: 1.35 },
  } as never;

  it('declares the range, so the weights in between can be rendered', () => {
    const css = fontFaceCss(VARIABLE, 'coastwise', new Set(['archivo']));
    expect(css).toContain('font-weight:400 700');
    // And not the pinned form, which is what snapped 650 to 700.
    expect(css).not.toContain('font-weight:400;');
  });

  it('preloads the file ONCE however many weights the page uses', () => {
    // This page asks for 400, 600, 650 and 700 of the one family.
    const preloads = fontPreloads(VARIABLE, 'coastwise', typography);
    expect(preloads).toHaveLength(1);
    expect(preloads[0].href).toBe('/fonts/coastwise/v-latin.woff2');
  });

  it('preloads it even when no style names its lightest weight', () => {
    /*
     * The regression this guards. Matching on the single weight a file is filed
     * under meant a page whose body was 600 and whose headings were 700 matched
     * nothing at all, because the file is filed at 400.
     */
    const heavy = { ...(typography as Record<string, { weight: number }>) };
    for (const id of ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']) heavy[id] = { ...heavy[id], weight: 600 };
    expect(fontPreloads(VARIABLE, 'coastwise', heavy as never)).toHaveLength(1);
  });

  it('reports every weight it can render, not just the one it is filed under', () => {
    const [family] = familiesFromFiles(VARIABLE);
    // Or the type panel offers a client one weight for a family that has four.
    expect(family.weights).toEqual([400, 500, 600, 700]);
  });

  it('leaves a static family exactly as it was', () => {
    /*
     * The other half of the bargain. A static family is a different file per
     * weight, so it must still get a rule and a preload for each: the fix must
     * not quietly collapse two real files into one.
     */
    const STATIC = [
      { id: 's4', slug: 'plex', family: 'IBM Plex Mono', fallback: 'mono' as const,
        weight: 400, weightMax: null, style: 'normal' as const, format: 'woff2', unicodeRange: null },
      { id: 's5', slug: 'plex', family: 'IBM Plex Mono', fallback: 'mono' as const,
        weight: 500, weightMax: null, style: 'normal' as const, format: 'woff2', unicodeRange: null },
    ];
    const css = fontFaceCss(STATIC, 'demo', new Set(['plex']));
    expect(css.match(/@font-face/g)).toHaveLength(2);
    expect(css).toContain('font-weight:400;');
    expect(css).toContain('font-weight:500;');

    const mono = {
      ...(typography as Record<string, { weight: number; family: string }>),
    };
    for (const id of ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
      mono[id] = { ...mono[id], family: 'plex', weight: id === 'p' ? 400 : 500 };
    }
    expect(fontPreloads(STATIC, 'demo', mono as never)).toHaveLength(2);
  });

  it('treats a file with no range as the single weight it always was', () => {
    const [family] = familiesFromFiles([
      { id: 'x', slug: 'one', family: 'One', fallback: 'sans' as const,
        weight: 600, weightMax: null, style: 'normal' as const, format: 'woff2', unicodeRange: null },
    ]);
    expect(family.weights).toEqual([600]);
  });
});
