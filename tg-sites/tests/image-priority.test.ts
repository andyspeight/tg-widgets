/**
 * One picture hurries, the rest wait.
 *
 * THE MEASUREMENT THIS EXISTS FOR (25 Aug 2026). The ten get-started templates
 * ship their pictures inside frozen imported markup, and that markup carried no
 * loading attribute at all, so every image on the page was fetched at once. On
 * the perf harness, slow 4G at 1.6 Mbps, the designed profile pulled 832 KB and
 * its LCP was 4360 ms, which is 832 KB at that bandwidth almost to the
 * millisecond: the hero was not slow, it was queueing behind three pictures
 * nobody could see.
 *
 * Hero eager and high, everything else lazy, took that to 1892 ms.
 *
 * The all-lazy version measured 2916 ms, and that number is the reason these
 * tests are specific about WHICH image stays eager. Lazy-loading the LCP element
 * still saves the bytes below the fold, so it looks like a win, while delaying
 * discovery of the one image the visitor is actually waiting on. A test that
 * only asserted "the others are lazy" would pass on that worse arrangement.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { cleanImportHtml } from '../lib/import/html';
import type { ImageSizes } from '../lib/content/image-sizes';

/** One picture the tenant owns, so the cleaner has a row to match. */
const SIZES: ImageSizes = {
  'https://cdn.example.com/a.jpg': [
    { url: 'https://cdn.example.com/a-400.jpg', width: 400, height: 300, bytes: 0 },
    { url: 'https://cdn.example.com/a-800.jpg', width: 800, height: 600, bytes: 0 },
  ],
};

const three =
  '<div>' +
  '<img src="https://cdn.example.com/a.jpg" alt="one">' +
  '<img src="https://cdn.example.com/a.jpg" alt="two">' +
  '<img src="https://cdn.example.com/a.jpg" alt="three">' +
  '</div>';

const imgs = (html: string) => html.match(/<img[^>]*>/g) ?? [];

describe('a fragment that may hold the hero', () => {
  const { html, images } = cleanImportHtml(three, {
    imageSizes: SIZES,
    imagePriority: { heroFirst: true },
  });
  const found = imgs(html);

  it('leaves the FIRST picture eager and tells it to hurry', () => {
    expect(found[0]).toContain('fetchpriority="high"');
    expect(found[0], 'the largest paint must never be lazy').not.toContain('loading="lazy"');
  });

  it('defers every picture after it', () => {
    expect(found[1]).toContain('loading="lazy"');
    expect(found[2]).toContain('loading="lazy"');
  });

  it('hurries exactly one, never two', () => {
    expect(html.match(/fetchpriority="high"/g)).toHaveLength(1);
  });

  it('reports how many it drew, so the caller can thread the hero', () => {
    expect(images).toBe(3);
  });
});

describe('a fragment that may not', () => {
  it('defers all of them, the first included', () => {
    const { html } = cleanImportHtml(three, {
      imageSizes: SIZES,
      imagePriority: { heroFirst: false },
    });
    const found = imgs(html);
    expect(found).toHaveLength(3);
    for (const img of found) expect(img).toContain('loading="lazy"');
    expect(html).not.toContain('fetchpriority');
  });
});

describe('the save path, which must not change what was stored', () => {
  it('injects nothing at all when no caller asked', () => {
    const { html } = cleanImportHtml(three, { imageSizes: SIZES });
    expect(html).not.toContain('loading=');
    expect(html).not.toContain('fetchpriority');
  });
});

describe('a design that already said what it wanted', () => {
  it('keeps its own loading attribute rather than arguing', () => {
    const source =
      '<img src="https://cdn.example.com/a.jpg" alt="one" loading="eager">' +
      '<img src="https://cdn.example.com/a.jpg" alt="two">';
    const { html } = cleanImportHtml(source, {
      imageSizes: SIZES,
      imagePriority: { heroFirst: true },
    });
    const found = imgs(html);
    expect(found[0]).toContain('loading="eager"');
    expect(found[0], 'it said eager, so it is not also told to be lazy').not.toContain('lazy');
    expect(found[1]).toContain('loading="lazy"');
  });
});

describe('the native renderer', () => {
  const src = readFileSync(
    resolve(__dirname, '..', 'components', 'render', 'PageRenderer.tsx'),
    'utf8',
  );
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

  it('hurries the first section background and defers the rest', () => {
    expect(code).toMatch(/fetchPriority=\{index === 0 \? 'high' : undefined\}/);
    expect(code).toMatch(/loading=\{index === 0 \? undefined : 'lazy'\}/);
  });

  it('keys the slideshow on the SECTION, not the slide', () => {
    /*
     * It used to read `i === 0`, which is the first slide of EVERY section, so a
     * page of four photo sections eagerly fetched four heroes.
     */
    expect(code).toMatch(/loading=\{index === 0 && i === 0 \? 'eager' : 'lazy'\}/);
    expect(code).not.toMatch(/loading=\{i === 0 \? 'eager' : 'lazy'\}/);
  });
});

describe('the perf harness renders the way the site does', () => {
  it('passes heroFirst, or it measures an arrangement we do not ship', () => {
    const entry = readFileSync(resolve(__dirname, '..', 'perf', 'entry.tsx'), 'utf8');
    expect(entry).toMatch(/prepareSections\(page\.sections, sizes, \{ heroFirst: true \}\)/);
  });
});
