/**
 * What counts as an image here, how big it may be, and where it is filed.
 *
 * Pure, and deliberately so. Everything in this file is a decision about a
 * string or a number, with no network and no database, which is what lets the
 * security-critical part be tested properly: assertPathnameForTenant is the
 * single check standing between a signed-in client and another client's storage
 * prefix, and a check like that has no business living inside a route handler
 * where it can only be exercised by a real upload.
 *
 * The blob store, api.pexels.com and blob.vercel-storage.com are all unreachable
 * from the environment this was written in. That is the reason the shape of this
 * module matters: the more of the logic that is pure, the less of it rests on a
 * network call nobody could run.
 */

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

/**
 * The five types allowed, and the extension each one gets.
 *
 * SVG IS NOT HERE AND MUST NOT BE ADDED. An SVG is an XML document that can
 * carry script and fetch external references, so serving one from an origin that
 * also serves the editor would hand anybody who can upload a file a way to run
 * code in a signed-in session. The database refuses it too, in
 * db/migrations/0011_media.sql, because a whitelist enforced in one place is a
 * whitelist that gets edited by someone in a hurry. Vector logos, if they are
 * ever wanted, need their own sanitising path.
 *
 * AVIF and WebP are in because they are what a browser produces when it
 * re-encodes, and refusing the output of our own downscaling step would be an
 * odd way to fail.
 */
export const MEDIA_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
} as const;

export type MediaMime = keyof typeof MEDIA_MIME;

export const ALLOWED_MIME = Object.keys(MEDIA_MIME) as MediaMime[];

/** Whether a value is one of the five, narrowing as it goes. */
export function isAllowedMime(value: unknown): value is MediaMime {
  return typeof value === 'string' && value in MEDIA_MIME;
}

/**
 * A mime type from a filename, for the rare case where the browser gives none.
 *
 * Only ever a fallback. The content type reported by the store is what gets
 * recorded, because a filename is a claim and a stored object has a fact.
 */
export function mimeFromFilename(filename: unknown): MediaMime | null {
  if (typeof filename !== 'string') return null;
  const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (!ext) return null;
  if (ext === 'jpeg' || ext === 'jpg') return 'image/jpeg';
  for (const [mime, extension] of Object.entries(MEDIA_MIME)) {
    if (extension === ext) return mime as MediaMime;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sizes
// ---------------------------------------------------------------------------

/**
 * 15MB, the same number as the check constraint on public.media.
 *
 * Generous on purpose, because it is not the real limit: the browser downscales
 * before uploading, so an ordinary photograph arrives at a few hundred kilobytes
 * and this ceiling is only met by something that skipped that path. It exists to
 * stop the store filling up, not to police quality.
 *
 * tests/media.test.ts reads the migration and asserts this number still matches
 * it. Two copies of a limit drift, and the failure mode is the worse direction:
 * the application accepts a file the database then refuses, so the upload
 * succeeds, the row does not, and the blob is orphaned with nothing pointing at
 * it.
 */
export const MAX_UPLOAD_BYTES = 15_728_640;

/**
 * The longest edge the browser reduces to before uploading.
 *
 * 2400 is chosen against the layout rather than plucked: the widest a section
 * ever renders is the page maximum, and doubling that covers a retina screen at
 * full bleed. Anything beyond it is pixels no visitor will ever see, paid for by
 * every visitor who loads the page.
 */
export const MAX_IMAGE_EDGE = 2400;

/** The quality the browser re-encodes at. High enough that nobody notices. */
export const REENCODE_QUALITY = 0.82;

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/**
 * A filename fit to store and to show.
 *
 * A filename off a file input is attacker-controlled text: it can hold path
 * separators, control characters, right-to-left overrides that make "photo.jpg"
 * out of "gpj.exe", and a few thousand characters. This keeps the part a person
 * would recognise and throws the rest away.
 *
 * Note it does NOT have to be unique and is not used to address anything. The
 * storage key is what addresses the object. This is a label.
 */
export function cleanFilename(value: unknown, fallback = 'image'): string {
  if (typeof value !== 'string') return fallback;

  const stripped = value
    // Control characters, and the bidirectional overrides used to disguise an
    // extension. Escape sequences rather than literal bytes: a raw control byte
    // in a source file survives Node and gets mangled by a bundler.
    .replace(/[\u0000-\u001F\u007F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    // Everything up to the last separator, so "../../etc/passwd" keeps "passwd"
    // and a Windows path keeps its leaf.
    .replace(/^.*[/\\]/, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!stripped || stripped === '.' || stripped === '..') return fallback;
  return stripped.slice(0, 120);
}

/** The filename without its extension, lowercased and hyphenated. For a key. */
export function filenameStem(filename: string): string {
  const withoutExtension = filename.replace(/\.[a-z0-9]+$/i, '');
  const slug = withoutExtension
    .toLowerCase()
    .normalize('NFKD')
    /*
     * The combining marks NFKD just separated, removed rather than replaced.
     *
     * NFKD turns "Crete" with a grave into "e" plus a combining accent. Leaving
     * that to the next line means the accent becomes a hyphen and the word comes
     * out as "cre-te", which is how a French resort name ends up looking like two
     * words in every storage key. Caught by the test, not by reading.
     */
    .replace(/[\u0300-\u036F]/g, '')
    // Anything left that is not a letter, digit or hyphen becomes a hyphen, and
    // runs collapse.
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return slug || 'image';
}

// ---------------------------------------------------------------------------
// Where an object is filed
// ---------------------------------------------------------------------------

/**
 * The prefix every one of a tenant's objects sits under.
 *
 * One tenant, one prefix, no exceptions. This is what makes the check below
 * possible at all.
 */
export function tenantPrefix(tenantId: string): string {
  return `sites/${tenantId}/media/`;
}

/**
 * The pathname to ask the store for.
 *
 * The store appends its own random suffix, so this does not need to be unique
 * and two uploads of hero.jpg will not collide. Whatever comes BACK from the
 * store is what gets recorded: the returned pathname is the only string that
 * addresses the object, and storing the requested one instead would produce a
 * library whose delete button silently misses.
 */
export function storagePathFor(tenantId: string, filename: string, mime: MediaMime): string {
  return `${tenantPrefix(tenantId)}${filenameStem(filename)}.${MEDIA_MIME[mime]}`;
}

/**
 * Refuse a pathname that is not this tenant's, loudly.
 *
 * THIS IS THE ONE CHECK THAT MATTERS IN THIS FILE.
 *
 * The upload is a direct browser-to-store transfer, and the pathname is chosen
 * by the browser: the server mints a token for it and never sees the bytes. The
 * blob SDK gives no way to rewrite the pathname during token minting, so the only
 * defence is to refuse to mint a token for a pathname outside the caller's own
 * prefix. Without it, a signed-in client of one travel agency could upload into
 * another agency's prefix, and every later listing would show it as theirs.
 *
 * Throws rather than returning false, because the only correct response is to
 * abandon the request, and a boolean is something a caller can forget to check.
 */
export function assertPathnameForTenant(pathname: unknown, tenantId: string): string {
  if (typeof pathname !== 'string' || pathname.length === 0 || pathname.length > 512) {
    throw new Error('That upload path is not usable.');
  }

  /*
   * Traversal is checked before the prefix, not after.
   *
   * "sites/<mine>/media/../../<theirs>/media/x.jpg" starts with the right prefix
   * and ends up somewhere else entirely, so a prefix test on its own passes it.
   * Backslashes go too: some stores normalise them to forward slashes, and a
   * check that disagrees with the store about what a separator is is not a check.
   */
  if (pathname.includes('..') || pathname.includes('\\') || pathname.includes('//')) {
    throw new Error('That upload path is not usable.');
  }
  if (/[\u0000-\u001F\u007F]/.test(pathname)) {
    throw new Error('That upload path is not usable.');
  }

  const prefix = tenantPrefix(tenantId);
  if (!pathname.startsWith(prefix)) {
    throw new Error('That upload path does not belong to this site.');
  }

  // Something has to come after the prefix, and it has to be a single segment.
  // A nested path would still be inside the prefix, but it would also be a way
  // to build a structure nothing in the product can list or clean up.
  const leaf = pathname.slice(prefix.length);
  if (!leaf || leaf.includes('/')) {
    throw new Error('That upload path is not usable.');
  }

  return pathname;
}

// ---------------------------------------------------------------------------
// Numbers off the wire
// ---------------------------------------------------------------------------

/**
 * A pixel dimension, or null.
 *
 * Client-supplied, and only ever used to give the picker grid the right shape,
 * so a wrong value is a cosmetic problem rather than a security one. It still
 * gets clamped, because the database constraint would otherwise reject the whole
 * row over a decorative field.
 *
 * Number() on its own is not usable: Number(null), Number('') and Number([]) are
 * all 0, and 0 passes a finite check. That trap cost a heading its size once in
 * this codebase already.
 */
export function pixelDimension(value: unknown): number | null {
  let n: number;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && value.trim() !== '') n = Number(value);
  else return null;

  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < 1) return null;
  return Math.min(20000, rounded);
}

/** A byte count that the database will accept, or null if it will not. */
export function byteCount(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < 1 || rounded > MAX_UPLOAD_BYTES) return null;
  return rounded;
}

/**
 * Plain text off the wire: control characters gone, trimmed, length capped.
 *
 * ONE COPY, DELIBERATELY, and the reason is a bug this file already caused.
 *
 * There were three of these, one in each module that reads a string off the
 * network. In one of them the escape sequences did not survive being written, and
 * the character class collapsed from a range of control characters into a class of
 * "space or hyphen". It parsed. It passed the source-hygiene check, because
 * nothing illegal was left in the file. And it stripped the spaces and hyphens out
 * of every photographer's name it touched, so "Lukas Rodriguez" would have been
 * filed as "LukasRodriguez" with no error anywhere.
 *
 * Three copies of a rule is three chances for one of them to be quietly wrong. One
 * copy can be tested, and tests/media.test.ts asserts both halves: that a control
 * character is removed, and that ordinary punctuation is not.
 */
export function plainText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
}

/** A size in something a person reads, for the library listing. */
export function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1) return '0 KB';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
