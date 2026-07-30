/**
 * The image bank, tested where the risk actually is.
 *
 * Neither the blob store nor api.pexels.com is reachable from the environment this
 * was written in, so the network half is proven by reading and confirmed by the
 * first real upload in production. That makes the pure half carry more weight than
 * usual, and there are three parts of it worth real attention:
 *
 *   assertPathnameForTenant   the only thing between a signed-in client and
 *                             another client's storage prefix
 *   parsePhotos               where a URL from somebody else's JSON becomes a URL
 *                             our server will fetch
 *   the two limits            which exist in the application AND in the database,
 *                             so they can drift
 *
 * The rest is coercion, which is worth testing because every coercion bug in this
 * project so far has been silent.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ALLOWED_MIME,
  assertPathnameForTenant,
  byteCount,
  cleanFilename,
  filenameStem,
  humanBytes,
  isAllowedMime,
  MAX_UPLOAD_BYTES,
  MEDIA_MIME,
  mimeFromFilename,
  pixelDimension,
  plainText,
  storagePathFor,
  tenantPrefix,
} from '../lib/media/limits';
import { creditLine, parsePhotos } from '../lib/media/pexels';

const TENANT = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

// ---------------------------------------------------------------------------
// Storage prefixes: the check that matters
// ---------------------------------------------------------------------------

describe('assertPathnameForTenant', () => {
  it('accepts a pathname under the tenants own prefix', () => {
    const ok = `${tenantPrefix(TENANT)}beach-at-dusk.jpg`;
    expect(assertPathnameForTenant(ok, TENANT)).toBe(ok);
  });

  it('refuses another tenants prefix', () => {
    expect(() => assertPathnameForTenant(`${tenantPrefix(OTHER)}beach.jpg`, TENANT)).toThrow(
      /does not belong to this site/,
    );
  });

  /*
   * This one passes a prefix test and still lands somewhere else, which is why
   * traversal is checked BEFORE the prefix rather than after.
   */
  it('refuses traversal that starts inside the right prefix', () => {
    const sneaky = `${tenantPrefix(TENANT)}../../${OTHER}/media/beach.jpg`;
    expect(() => assertPathnameForTenant(sneaky, TENANT)).toThrow(/not usable/);
  });

  it('refuses backslashes, which some stores treat as separators', () => {
    expect(() => assertPathnameForTenant(`sites\\${TENANT}\\media\\x.jpg`, TENANT)).toThrow();
  });

  it('refuses a doubled slash', () => {
    expect(() => assertPathnameForTenant(`${tenantPrefix(TENANT)}/x.jpg`, TENANT)).toThrow(
      /not usable/,
    );
  });

  it('refuses a control character', () => {
    expect(() => assertPathnameForTenant(`${tenantPrefix(TENANT)}x\u0000.jpg`, TENANT)).toThrow(
      /not usable/,
    );
  });

  it('refuses a nested path inside the prefix', () => {
    expect(() => assertPathnameForTenant(`${tenantPrefix(TENANT)}2026/x.jpg`, TENANT)).toThrow(
      /not usable/,
    );
  });

  it('refuses an empty leaf', () => {
    expect(() => assertPathnameForTenant(tenantPrefix(TENANT), TENANT)).toThrow(/not usable/);
  });

  it('refuses anything that is not a string, and anything absurdly long', () => {
    for (const value of [null, undefined, 42, {}, [], '']) {
      expect(() => assertPathnameForTenant(value, TENANT)).toThrow();
    }
    expect(() => assertPathnameForTenant(`${tenantPrefix(TENANT)}${'a'.repeat(600)}`, TENANT))
      .toThrow(/not usable/);
  });

  /*
   * A mutation probe. Every case above passes when the function throws, and a
   * function that threw unconditionally would pass all of them. This is the one
   * that fails if it does.
   */
  it('is not simply refusing everything', () => {
    expect(() =>
      assertPathnameForTenant(storagePathFor(TENANT, 'Beach at Dusk.JPG', 'image/jpeg'), TENANT),
    ).not.toThrow();
  });
});

describe('storagePathFor', () => {
  it('files an image under the tenant prefix with a tidy stem', () => {
    expect(storagePathFor(TENANT, 'Beach at Dusk.JPG', 'image/jpeg')).toBe(
      `sites/${TENANT}/media/beach-at-dusk.jpg`,
    );
  });

  it('gives the extension the mime type says, not the one the filename claims', () => {
    // A browser that re-encoded a PNG to WebP hands over the original name.
    expect(storagePathFor(TENANT, 'logo.png', 'image/webp')).toMatch(/logo\.webp$/);
  });
});

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

describe('cleanFilename', () => {
  it('keeps the leaf of a path', () => {
    expect(cleanFilename('../../etc/passwd')).toBe('passwd');
    expect(cleanFilename('C:\\Users\\andy\\Pictures\\hero.jpg')).toBe('hero.jpg');
  });

  it('keeps spaces and hyphens, because they are ordinary in a filename', () => {
    expect(cleanFilename('Crete - day three.jpg')).toBe('Crete - day three.jpg');
  });

  it('strips control characters and the overrides used to disguise an extension', () => {
    expect(cleanFilename('photo\u0000.jpg')).toBe('photo.jpg');
    expect(cleanFilename('photo\u202Egpj.exe')).toBe('photogpj.exe');
  });

  it('falls back rather than returning nothing', () => {
    expect(cleanFilename('')).toBe('image');
    expect(cleanFilename('.')).toBe('image');
    expect(cleanFilename(null)).toBe('image');
    expect(cleanFilename('/')).toBe('image');
  });

  it('caps the length', () => {
    expect(cleanFilename('a'.repeat(500)).length).toBe(120);
  });
});

describe('filenameStem', () => {
  it('lowercases, hyphenates and drops the extension', () => {
    expect(filenameStem('Beach at Dusk.JPEG')).toBe('beach-at-dusk');
  });

  it('folds accents rather than dropping the word', () => {
    expect(filenameStem('Crète.jpg')).toBe('crete');
  });

  it('never returns an empty stem or a trailing hyphen', () => {
    expect(filenameStem('!!!.jpg')).toBe('image');
    expect(filenameStem('....')).toBe('image');
    // Truncation must not leave the hyphen it cut a word at.
    expect(filenameStem(`${'ab '.repeat(30)}.jpg`).endsWith('-')).toBe(false);
  });
});

/*
 * plainText had three copies, one of which lost its escape sequences and became a
 * class of "space or hyphen". It parsed, it left nothing illegal in the file for
 * the source-hygiene check to find, and it stripped the spaces out of every
 * photographer's name it touched. Both halves are asserted here for that reason:
 * that the control character goes, and that the punctuation stays.
 */
describe('plainText', () => {
  it('removes control characters', () => {
    expect(plainText('Lukas\u0000 Rodriguez', 100)).toBe('Lukas Rodriguez');
    expect(plainText('a\u001Fb', 100)).toBe('ab');
    expect(plainText('a\u007Fb', 100)).toBe('ab');
  });

  it('keeps spaces and hyphens, which is the half that broke', () => {
    expect(plainText('Jean-Luc Le Roux', 100)).toBe('Jean-Luc Le Roux');
    expect(plainText('Brown Rocks - Golden Hour', 100)).toBe('Brown Rocks - Golden Hour');
  });

  it('trims and caps', () => {
    expect(plainText('  hello  ', 100)).toBe('hello');
    expect(plainText('abcdef', 3)).toBe('abc');
  });

  it('is total', () => {
    for (const value of [null, undefined, 42, {}, []]) {
      expect(plainText(value, 10)).toBe('');
    }
  });
});

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

describe('the mime whitelist', () => {
  it('has exactly the five types and no SVG', () => {
    expect(ALLOWED_MIME.sort()).toEqual([
      'image/avif',
      'image/gif',
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
    expect(isAllowedMime('image/svg+xml')).toBe(false);
  });

  it('narrows rather than just answering', () => {
    expect(isAllowedMime('image/jpeg')).toBe(true);
    expect(isAllowedMime('text/html')).toBe(false);
    expect(isAllowedMime(null)).toBe(false);
    expect(isAllowedMime('IMAGE/JPEG')).toBe(false);
  });

  it('reads a type off a filename, treating jpg and jpeg alike', () => {
    expect(mimeFromFilename('a.jpg')).toBe('image/jpeg');
    expect(mimeFromFilename('a.JPEG')).toBe('image/jpeg');
    expect(mimeFromFilename('a.webp')).toBe('image/webp');
    expect(mimeFromFilename('a.svg')).toBe(null);
    expect(mimeFromFilename('noextension')).toBe(null);
    expect(mimeFromFilename(null)).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

describe('coercion', () => {
  /*
   * Number(null), Number('') and Number([]) are all 0, and 0 is finite. That trap
   * turned a missing heading size into body text once already in this codebase, so
   * every numeric coercion here is checked against it explicitly.
   */
  it('does not let null become zero', () => {
    expect(pixelDimension(null)).toBe(null);
    expect(pixelDimension('')).toBe(null);
    expect(pixelDimension([])).toBe(null);
    expect(pixelDimension(0)).toBe(null);
    expect(pixelDimension(-5)).toBe(null);
    expect(pixelDimension(NaN)).toBe(null);
    expect(pixelDimension(Infinity)).toBe(null);
  });

  it('rounds and clamps a dimension to what the database will take', () => {
    expect(pixelDimension(2400.6)).toBe(2401);
    expect(pixelDimension('1920')).toBe(1920);
    expect(pixelDimension(99999)).toBe(20000);
  });

  it('refuses a byte count the database would refuse', () => {
    expect(byteCount(0)).toBe(null);
    expect(byteCount(-1)).toBe(null);
    expect(byteCount(MAX_UPLOAD_BYTES + 1)).toBe(null);
    expect(byteCount(MAX_UPLOAD_BYTES)).toBe(MAX_UPLOAD_BYTES);
    expect(byteCount('4096')).toBe(4096);
  });

  it('describes a size the way a person reads one', () => {
    expect(humanBytes(0)).toBe('0 KB');
    expect(humanBytes(900)).toBe('900 B');
    expect(humanBytes(240_000)).toBe('234 KB');
    expect(humanBytes(2_400_000)).toBe('2.3 MB');
  });
});

// ---------------------------------------------------------------------------
// The limits exist twice, so they can drift
// ---------------------------------------------------------------------------

describe('the application and the database agree', () => {
  const migration = readFileSync(
    join(__dirname, '..', 'db', 'migrations', '0011_media.sql'),
    'utf8',
  );

  /*
   * The drift here fails in the worse direction. If the application's ceiling is
   * higher than the database's, the upload succeeds, the row is refused, and the
   * result is an object in the store that nothing points at and nobody can see.
   */
  it('caps uploads at the same number the check constraint does', () => {
    expect(migration).toContain(String(MAX_UPLOAD_BYTES));
  });

  it('allows the same image types the check constraint does', () => {
    const constraint = migration.match(/mime in \(([^)]+)\)/);
    expect(constraint, 'the mime check constraint moved or was renamed').toBeTruthy();

    const inSql = [...constraint![1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect(inSql).toEqual([...ALLOWED_MIME].sort());
  });

  it('never lets SVG into either one', () => {
    expect(migration).not.toContain('svg');
    expect(Object.keys(MEDIA_MIME)).not.toContain('image/svg+xml');
  });
});

// ---------------------------------------------------------------------------
// Pexels
// ---------------------------------------------------------------------------

/**
 * A captured response, trimmed to two photos.
 *
 * Shaped from the documented response rather than from a live call, because
 * api.pexels.com is denied by this session's egress policy. tests/fonts.live.test.ts
 * is the pattern for confirming a fixture against the real service once one can be
 * reached; the same is owed here and is noted in the handover.
 */
const RESPONSE = {
  total_results: 8000,
  page: 1,
  per_page: 2,
  photos: [
    {
      id: 3573351,
      width: 3066,
      height: 3968,
      url: 'https://www.pexels.com/photo/trees-during-day-3573351/',
      photographer: 'Lukas Rodriguez',
      photographer_url: 'https://www.pexels.com/@lukas-rodriguez-1845331',
      photographer_id: 1845331,
      avg_color: '#374824',
      src: {
        original: 'https://images.pexels.com/photos/3573351/pexels-photo-3573351.png',
        large2x: 'https://images.pexels.com/photos/3573351/a.jpeg?w=940&dpr=2',
        large: 'https://images.pexels.com/photos/3573351/b.jpeg',
        medium: 'https://images.pexels.com/photos/3573351/c.jpeg?h=350',
        small: 'https://images.pexels.com/photos/3573351/d.jpeg?h=130',
      },
      alt: 'Brown Rocks During Golden Hour',
    },
    {
      id: 1004014,
      width: 4000,
      height: 6000,
      url: 'https://www.pexels.com/photo/1004014/',
      photographer: 'Jean-Luc Le Roux',
      photographer_url: 'https://www.pexels.com/@jean-luc',
      avg_color: '#8B7B6B',
      src: {
        original: 'https://images.pexels.com/photos/1004014/orig.jpeg',
        large2x: 'https://images.pexels.com/photos/1004014/large2x.jpeg',
        medium: 'https://images.pexels.com/photos/1004014/medium.jpeg',
      },
      alt: 'Santorini at sunset',
    },
  ],
  next_page: 'https://api.pexels.com/v1/search/?page=2&per_page=2&query=greece',
};

describe('parsePhotos', () => {
  it('reads a normal response', () => {
    const results = parsePhotos(RESPONSE);

    expect(results.photos).toHaveLength(2);
    expect(results.total).toBe(8000);
    expect(results.page).toBe(1);
    expect(results.hasMore).toBe(true);

    const [first] = results.photos;
    expect(first.id).toBe('3573351');
    expect(first.fullUrl).toBe('https://images.pexels.com/photos/3573351/a.jpeg?w=940&dpr=2');
    expect(first.thumbUrl).toBe('https://images.pexels.com/photos/3573351/c.jpeg?h=350');
    expect(first.width).toBe(3066);
    expect(first.description).toBe('Brown Rocks During Golden Hour');
    expect(first.averageColour).toBe('#374824');
    expect(first.credit).toEqual({
      providerId: '3573351',
      photographer: 'Lukas Rodriguez',
      photographerUrl: 'https://www.pexels.com/@lukas-rodriguez-1845331',
      providerUrl: 'https://www.pexels.com/photo/trees-during-day-3573351/',
    });
  });

  it('keeps a photographers name intact, spaces, hyphens and all', () => {
    const [, second] = parsePhotos(RESPONSE).photos;
    expect(second.credit.photographer).toBe('Jean-Luc Le Roux');
    expect(creditLine(second.credit)).toBe('Jean-Luc Le Roux on Pexels');
  });

  /*
   * THE SSRF CASE. importStockAction hands fullUrl to a server-side fetch, so a
   * response that names some other host must produce no photo at all rather than a
   * photo whose URL our server will dutifully retrieve.
   */
  it('drops a photo whose image is not on the providers own host', () => {
    const tampered = {
      photos: [
        {
          ...RESPONSE.photos[0],
          src: {
            original: 'https://169.254.169.254/latest/meta-data/',
            large2x: 'https://evil.test/pexels-photo.jpeg',
            medium: 'https://evil.test/thumb.jpeg',
          },
        },
      ],
    };
    expect(parsePhotos(tampered).photos).toEqual([]);
  });

  it('is not fooled by a host that merely starts with the right text', () => {
    const tampered = {
      photos: [
        {
          ...RESPONSE.photos[0],
          src: { large2x: 'https://images.pexels.com.evil.test/a.jpeg', medium: 'https://images.pexels.com.evil.test/b.jpeg' },
        },
      ],
    };
    expect(parsePhotos(tampered).photos).toEqual([]);
  });

  it('drops a credit link that is not on the providers site, but keeps the photo', () => {
    const tampered = {
      photos: [
        {
          ...RESPONSE.photos[0],
          url: 'javascript:alert(1)',
          photographer_url: 'https://evil.test/@someone',
        },
      ],
    };
    const [photo] = parsePhotos(tampered).photos;
    expect(photo.credit.providerUrl).toBeUndefined();
    expect(photo.credit.photographerUrl).toBeUndefined();
    expect(photo.credit.photographer).toBe('Lukas Rodriguez');
  });

  it('refuses a colour that is not a plain hex triplet', () => {
    for (const avg_color of ['red', 'url(x)', '#12345', '#1234567', 'rgb(1,2,3)', 12, null]) {
      const [photo] = parsePhotos({ photos: [{ ...RESPONSE.photos[0], avg_color }] }).photos;
      expect(photo.averageColour).toBe(null);
    }
  });

  it('takes hasMore from the presence of next_page, not from arithmetic', () => {
    const { next_page: _drop, ...lastPage } = RESPONSE;
    expect(parsePhotos(lastPage).hasMore).toBe(false);
    expect(parsePhotos({ ...RESPONSE, next_page: '' }).hasMore).toBe(false);
  });

  it('is total', () => {
    for (const body of [null, undefined, 42, 'nonsense', [], {}, { photos: null }]) {
      expect(parsePhotos(body)).toEqual({ photos: [], page: 1, hasMore: false, total: 0 });
    }
    expect(parsePhotos({ photos: [null, 42, {}, { id: 'abc' }] }).photos).toEqual([]);
  });

  it('falls back through the sizes rather than dropping a photo', () => {
    const onlyOriginal = {
      photos: [
        {
          id: 7,
          src: { original: 'https://images.pexels.com/photos/7/o.jpeg' },
        },
      ],
    };
    const [photo] = parsePhotos(onlyOriginal).photos;
    expect(photo.fullUrl).toBe('https://images.pexels.com/photos/7/o.jpeg');
    // With nothing smaller on offer, the grid shows the full one rather than
    // nothing at all.
    expect(photo.thumbUrl).toBe(photo.fullUrl);
  });

  it('credits Pexels when there is no photographer name', () => {
    expect(creditLine({})).toBe('Pexels');
  });
});
