/**
 * Importing a font from Google, by fetching it once and keeping it.
 *
 * WHY SELF-HOST RATHER THAN LINK
 *
 * The usual way to use a Google font is a <link> to fonts.googleapis.com, and
 * it is the wrong way here for three reasons.
 *
 * Every visitor to a client's travel site would make a request to Google. That
 * is somebody else's server learning who reads a Travelgenix client's pages,
 * and it is not our decision to make on their behalf. A German court has
 * already found linked Google Fonts to be a GDPR problem.
 *
 * It is slower. A linked font costs a DNS lookup and a TLS handshake to
 * fonts.googleapis.com, then ANOTHER pair to fonts.gstatic.com where the actual
 * file lives, before a single byte of the font arrives. Self-hosted, the font
 * comes down the connection that is already open.
 *
 * And preload only really works on your own origin. Andy asked for the font to
 * be preloaded once chosen, and a cross-origin preload needs the crossorigin
 * attribute, a matching CORS response, and still pays for the extra connection.
 *
 * So: fetch once, at the moment somebody picks the font, and store the bytes.
 * After that Google is never contacted again, by us or by anybody's visitor.
 *
 * WHAT THIS FILE DOES NOT DO
 *
 * It does not touch the database. It fetches and parses and hands back plain
 * data, so it can be tested against the real Google endpoints without a
 * database, and so the storage decision stays in lib/db/fonts.ts.
 */

import { GOOGLE_FONTS } from './catalogue';

/** Subsets worth having. */
export const SUBSETS = ['latin', 'latin-ext'] as const;
export type Subset = (typeof SUBSETS)[number];

/**
 * Weights imported for a family, when it has them.
 *
 * Not all of them. A family can offer nine weights in two styles, and fetching
 * the lot is 18 files nobody asked for. These four cover body text, a slightly
 * heavier body, a semibold heading and a bold one, which is the range a site
 * actually uses. Italics are skipped for now and are a real gap, noted in the
 * README rather than quietly missing.
 */
export const WEIGHTS = [400, 500, 600, 700] as const;
export type Weight = (typeof WEIGHTS)[number];

/**
 * A browser User-Agent, sent on purpose.
 *
 * fonts.googleapis.com serves DIFFERENT CSS depending on what it thinks the
 * client is. Ask as Node and it returns ttf, which is three times the size and
 * which no browser needs any more. Ask as a recent Chrome and it returns woff2.
 * This is not a trick, it is the documented behaviour of the endpoint, and
 * getting it wrong is a silent three-times-bigger download.
 */
export const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/120.0.0.0 Safari/537.36';

/**
 * One file of a family: a weight, in a format, optionally limited to a subset.
 *
 * Shared by both ways a font arrives. A Google import fills in every field: the
 * format is always woff2, and the subset and unicode-range come from Google's
 * stylesheet so a browser fetches only the file it needs. An upload has no
 * subset, because a file somebody hands over covers whatever it covers and
 * there is nothing to split it on.
 *
 * One shape rather than two, so saveFontFamily has one path. The first draft
 * had format missing here and cast it in at the database layer, which is how a
 * woff upload would have been stored as woff2 and served with the wrong type.
 */
export interface FontFile {
  /** The lightest weight this file covers. */
  weight: number;
  /**
   * The heaviest weight it covers, or null when it is a single weight.
   *
   * A VARIABLE FONT IS ONE FILE FOR A WHOLE RANGE, and Google says so by
   * pointing every weight's @font-face at the same url. Recording the range
   * rather than storing the file once per weight is what lets the browser
   * download it once and interpolate the weights in between.
   */
  weightMax: number | null;
  format: FontFormat;
  bytes: Uint8Array;
  /** Which Latin subset, or null when the file is not split by subset. */
  subset: Subset | null;
  /** Which characters this file covers, or null for no restriction. */
  unicodeRange: string | null;
}

export interface ImportedFamily {
  /** As the foundry spells it, which is what the CSS has to say. */
  family: string;
  files: FontFile[];
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/**
 * A family name that is safe to put in a URL and in a CSS font-family.
 *
 * Google family names are letters, digits and spaces. Anything else is either
 * a typo or an attempt to break out of the quoted string in a @font-face rule,
 * and there is no third possibility worth supporting.
 */
export function normaliseFamilyName(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 60) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9 ]*$/.test(name)) return null;

  return name;
}

/** The id a family is stored and served under. Lowercase, hyphenated. */
export function familySlug(family: string): string {
  return family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * A typed name, matched to how Google actually spells it.
 *
 * GOOGLE'S ENDPOINT IS CASE SENSITIVE, which is the single most likely thing to
 * make this feature look broken. "Playfair Display" returns a stylesheet;
 * "playfair display" returns 400. Somebody typing a font name from memory gets
 * the capitals wrong most of the time, and without this they would be told
 * Google does not have a font that Google obviously has.
 *
 * Title-casing the input is not enough either, because Google's own names are
 * not consistently title case: "PT Sans", "IBM Plex Sans" and "DM Serif Text"
 * would all become wrong. So the catalogue is the lookup, matched on a form
 * with case and punctuation removed.
 *
 * Returns null for a name not in the catalogue, which is NOT the same as "does
 * not exist": the caller then tries the name as typed, so a family published
 * since the catalogue was generated still works.
 */
export function resolveFamilyName(
  typed: string,
  catalogue: ReadonlyArray<readonly [string, string]>,
): string | null {
  const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const wanted = key(typed);
  if (!wanted) return null;

  for (const [family] of catalogue) {
    if (key(family) === wanted) return family;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/**
 * One @font-face block, as parsed out of Google's stylesheet.
 *
 * Parsed with a regex rather than a CSS parser, and that is a deliberate limit
 * rather than laziness: the input is one machine-generated stylesheet in a
 * shape that has not changed in years, and a dependency to read it would be a
 * dependency in the deploy for the rest of time. The shape is asserted by a
 * test that runs against the real endpoint.
 */
interface ParsedFace {
  family: string;
  weight: number;
  url: string;
  unicodeRange: string;
  /** The comment Google puts above each block: latin, latin-ext, cyrillic. */
  subset: string;
}

export function parseGoogleCss(css: string): ParsedFace[] {
  const faces: ParsedFace[] = [];

  /*
   * Google labels each block with a comment naming the subset, and that comment
   * is the only place the subset appears. The alternative is matching on the
   * unicode-range, which means hardcoding Unicode blocks and re-deriving them
   * whenever Google adjusts a range.
   */
  const blocks = css.split(/\/\*\s*([a-z-]+)\s*\*\//i).slice(1);

  for (let i = 0; i + 1 < blocks.length; i += 2) {
    const subset = blocks[i].trim();
    const body = blocks[i + 1];

    const family = /font-family:\s*'([^']+)'/.exec(body)?.[1];
    const weight = /font-weight:\s*(\d+)/.exec(body)?.[1];
    const url = /src:\s*url\(([^)]+)\)/.exec(body)?.[1];
    const unicodeRange = /unicode-range:\s*([^;]+);/.exec(body)?.[1];

    if (!family || !weight || !url || !unicodeRange) continue;
    // Only ever fetch from Google's own font host. The URL comes out of a
    // response, so it is input, and input that becomes a fetch is a request
    // somebody else could aim.
    if (!url.startsWith(GSTATIC_ORIGIN)) continue;

    faces.push({
      family,
      weight: Number(weight),
      url,
      unicodeRange: unicodeRange.trim(),
      subset,
    });
  }

  return faces;
}

/**
 * Whether Google has a family by this name.
 *
 * THIS IS WHAT MAKES "ANY GOOGLE FONT" WORK without an API key. The family
 * list endpoint needs a key and the metadata endpoint is not public, but the
 * stylesheet endpoint answers 200 for a family that exists and 400 for one that
 * does not. So a name typed by a person is checked against Google itself
 * rather than against a list we would have to keep up to date.
 */
/**
 * The host every font file must come from.
 *
 * Exported because the preview route fetches a file whose URL came out of
 * Google's own CSS, and that check has to be the same one the importer makes.
 * Two spellings of the same whitelist is one spelling too many.
 */
export const GSTATIC_ORIGIN = 'https://fonts.gstatic.com/';

export async function familyExists(
  family: string,
  fetchImpl: typeof fetch = fetch,
  catalogue: ReadonlyArray<readonly [string, string]> = GOOGLE_FONTS,
): Promise<boolean> {
  const typed = normaliseFamilyName(family);
  if (!typed) return false;

  const name = resolveFamilyName(typed, catalogue) ?? typed;
  const response = await fetchImpl(cssUrl(name, [400]), {
    headers: { 'user-agent': BROWSER_UA },
  });
  return response.ok;
}

function cssUrl(family: string, weights: readonly number[]): string {
  const spec = `${family.replace(/ /g, '+')}:wght@${weights.join(';')}`;
  return `https://fonts.googleapis.com/css2?family=${spec}&display=swap`;
}

/** A cap, so one import cannot pull down an unbounded amount. */
const MAX_FILE_BYTES = 1_500_000;
const MAX_TOTAL_BYTES = 6_000_000;

/**
 * Fetch a family from Google: its stylesheet, then every file worth keeping.
 *
 * Asks for four weights and takes whatever the family actually has. Google
 * silently returns fewer faces for a family that does not offer all four rather
 * than failing, which is the behaviour we want: a single-weight display face
 * imports as one weight instead of erroring.
 */
export async function importGoogleFamily(
  rawFamily: string,
  fetchImpl: typeof fetch = fetch,
  catalogue: ReadonlyArray<readonly [string, string]> = GOOGLE_FONTS,
): Promise<ImportedFamily> {
  const typed = normaliseFamilyName(rawFamily);
  if (!typed) throw new Error(`"${rawFamily}" is not a font name.`);

  /*
   * The catalogue's spelling first, the typed one as a fallback.
   *
   * The fallback is what keeps "any Google font" true rather than "any font in
   * our list": a family published since the catalogue was generated is not in
   * it, and asking Google directly still works as long as the capitals happen
   * to be right.
   */
  const family = resolveFamilyName(typed, catalogue) ?? typed;

  const response = await fetchImpl(cssUrl(family, WEIGHTS), {
    headers: { 'user-agent': BROWSER_UA },
  });

  if (!response.ok) {
    throw new Error(
      `Google does not have a font called "${typed}". Search for it on ` +
        'fonts.google.com and copy the name exactly.',
    );
  }

  const faces = parseGoogleCss(await response.text()).filter(
    (face) =>
      (SUBSETS as readonly string[]).includes(face.subset) &&
      (WEIGHTS as readonly number[]).includes(face.weight),
  );

  if (faces.length === 0) {
    throw new Error(
      `"${family}" has no Latin characters, so it cannot be used for a site in ` +
        'English. Pick another font.',
    );
  }

  /*
   * ONE DOWNLOAD PER FILE, NOT PER WEIGHT.
   *
   * Google returns a variable family as one file per SUBSET, referenced by one
   * @font-face per weight, all pointing at the same url. Fetching per face
   * therefore downloaded the identical file four times and stored it four
   * times, and because each stored row got its own id it also got its own
   * /fonts/<tenant>/<id>.woff2 url, so a browser could not tell they were the
   * same file either and downloaded it again per weight. Coastwise was
   * preloading 102,384 bytes across three requests for 34,928 bytes of font.
   *
   * Grouping on the url is exactly the signal Google is giving us. A static
   * family answers with a different url per weight and groups of one, so it
   * behaves as it always did.
   */
  const byUrl = new Map<string, { weights: number[]; subset: string; unicodeRange: string | null }>();
  for (const face of faces) {
    const group = byUrl.get(face.url);
    if (group) group.weights.push(face.weight);
    else byUrl.set(face.url, {
      weights: [face.weight],
      subset: face.subset,
      unicodeRange: face.unicodeRange,
    });
  }

  const files: FontFile[] = [];
  let total = 0;

  for (const [url, group] of byUrl) {
    const weights = [...group.weights].sort((a, b) => a - b);
    const face = { url, weight: weights[0], subset: group.subset, unicodeRange: group.unicodeRange };
    const file = await fetchImpl(face.url);
    if (!file.ok) throw new Error(`Could not download ${family} ${face.weight}.`);

    const bytes = new Uint8Array(await file.arrayBuffer());

    if (bytes.byteLength > MAX_FILE_BYTES) {
      throw new Error(`${family} ${face.weight} is unexpectedly large. Not imported.`);
    }
    total += bytes.byteLength;
    if (total > MAX_TOTAL_BYTES) {
      throw new Error(`${family} is too large to import in one go.`);
    }

    if (!looksLikeWoff2(bytes)) {
      throw new Error(`What Google sent for ${family} is not a woff2 file.`);
    }

    files.push({
      weight: weights[0],
      // Null for a static face, so nothing downstream has to special-case the
      // ordinary one-weight-one-file family.
      weightMax: weights.length > 1 ? weights[weights.length - 1] : null,
      format: 'woff2',
      bytes,
      subset: face.subset as Subset,
      unicodeRange: face.unicodeRange,
    });
  }

  // Google's spelling, not the caller's, so "playfair display" imports as
  // "Playfair Display" and the @font-face name matches what Google published.
  return { family: faces[0].family, files };
}

// ---------------------------------------------------------------------------
// What a font file is
// ---------------------------------------------------------------------------

/**
 * The magic number at the front of a woff2 file: "wOF2".
 *
 * Checked because these bytes are served back to every visitor of a client's
 * site. Font parsers live in the browser's C++ and have a long history of
 * memory-safety bugs, so "this is at least the format it claims to be" is the
 * cheapest possible gate and there is no reason to skip it.
 */
export function looksLikeWoff2(bytes: Uint8Array): boolean {
  return (
    bytes.length > 4 &&
    bytes[0] === 0x77 && // w
    bytes[1] === 0x4f && // O
    bytes[2] === 0x46 && // F
    bytes[3] === 0x32 //   2
  );
}

/** woff (the older one), for an upload from somebody's brand pack. */
export function looksLikeWoff(bytes: Uint8Array): boolean {
  return (
    bytes.length > 4 &&
    bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46 && bytes[3] === 0x46
  );
}

/** TrueType and OpenType, which brand packs are usually delivered as. */
export function looksLikeTrueType(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const tag = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
  return (
    tag === 0x00010000 || // TrueType
    tag === 0x74727565 || // 'true'
    tag === 0x4f54544f //   'OTTO', OpenType with CFF outlines
  );
}

export type FontFormat = 'woff2' | 'woff' | 'truetype' | 'opentype';

/**
 * What format some bytes are, or null if they are not a font at all.
 *
 * Sniffed from the bytes rather than trusted from the filename. An upload's
 * name is whatever the person typed, and the thing that gets served is the
 * bytes.
 */
export function sniffFontFormat(bytes: Uint8Array): FontFormat | null {
  if (looksLikeWoff2(bytes)) return 'woff2';
  if (looksLikeWoff(bytes)) return 'woff';
  if (!looksLikeTrueType(bytes)) return null;
  // OTTO means CFF outlines, which CSS calls opentype. Everything else is
  // truetype. Getting this wrong only costs a warning in the console, but a
  // correct format() lets the browser skip a file it cannot use.
  return bytes[0] === 0x4f ? 'opentype' : 'truetype';
}

/** The MIME type to serve a format as. */
export const FONT_MIME: Record<FontFormat, string> = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  truetype: 'font/ttf',
  opentype: 'font/otf',
};
