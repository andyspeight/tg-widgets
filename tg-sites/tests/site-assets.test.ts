/**
 * A script a published page loads by name has to survive the hostname rewrite.
 *
 * THE BUG THIS EXISTS FOR (25 Aug 2026). Everything on a client's hostname is
 * rewritten into the site renderer. `/tg-motion.js` was not excluded, so on
 * coastwise.travelgenixsites.com it resolved to
 * /site/coastwise.travelgenixsites.com/tg-motion.js, which is not a page. The
 * browser was handed a 404 HTML document with a JavaScript content type and
 * nothing errored where a client would see it: motion did not move, the theme
 * toggle did not toggle, the slideshow controls did nothing.
 *
 * The same shape as the font 404 found earlier that day. Both were a static
 * asset a client site loads by name, and both were silent.
 *
 * WHY THE LIST IS ASSERTED AGAINST public/ RATHER THAN WRITTEN OUT TWICE. The
 * middleware matcher has to repeat these paths as a literal, because Next reads
 * it at build time and cannot call a function. So there are three places that
 * can disagree: the directory, the function and the matcher. This checks all
 * three against each other, which means the next script somebody drops into
 * public/ fails here rather than on a client's live site.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { config, SITE_ASSETS } from '../middleware';

const root = resolve(__dirname, '..');

/** Every script sitting at the root of public/, which is how a page names them. */
const inPublic = readdirSync(resolve(root, 'public'), { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
  .map((entry) => `/${entry.name}`)
  .sort();

/*
 * The matcher as Next reads it, taken from the exported value rather than parsed
 * out of the source. Parsing the text hands back the escaping of the LITERAL
 * (`favicon\\.ico`) rather than the string it denotes, and a regex built from
 * that quietly matches nothing it should, which is a test that passes for the
 * wrong reason or fails for one.
 */
const matcher = new RegExp(`^${config.matcher[0]}$`);

describe('the scripts a published page loads', () => {
  it('there are some, or this test is guarding nothing', () => {
    expect(inPublic.length).toBeGreaterThan(0);
  });

  it('every script in public/ is named in SITE_ASSETS', () => {
    expect([...SITE_ASSETS].sort()).toEqual(inPublic);
  });

  it('and every one of them is excluded by the middleware matcher', () => {
    for (const path of inPublic) {
      expect(matcher.test(path), `${path} would be rewritten into the site renderer`).toBe(false);
    }
  });

  it('while an ordinary page path is still matched, so the rewrite still happens', () => {
    for (const path of ['/', '/about', '/voyages/dalmatia']) {
      expect(matcher.test(path), `${path} must still reach the site renderer`).toBe(true);
    }
  });
});

describe('what those scripts are told about caching', () => {
  const config = readFileSync(resolve(root, 'next.config.ts'), 'utf8');

  it('they carry a cache lifetime rather than Next default for public/', () => {
    expect(config).toMatch(/stale-while-revalidate/);
    expect(config).toMatch(/max-age=86400/);
  });

  it('but NOT immutable, because these urls carry no content hash', () => {
    const rule = config.slice(config.indexOf('tg-motion'), config.indexOf('/editor/:path*'));
    expect(rule, 'an unhashed url pinned for a year serves a stale script forever').not.toMatch(
      /immutable/,
    );
  });
});
