/**
 * The image slideshow.
 *
 * Andy, 4 Aug 2026: add multiple images and the block turns into a slider, with
 * transition controls. It is PURE CSS on purpose, so it auto-plays on the
 * published page and in the editor preview alike, where a page script never
 * runs, and it pauses on hover with no script at all. The block half runs for
 * real here (the fields, the defaults, the save); the renderer and the
 * stylesheet are read from source the same way the other renderer tests are,
 * and both were driven in a browser before shipping.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blockDefinition } from '../lib/content/blocks';
import { sanitiseBlock } from '../lib/content/sanitise-page';
import type { Block } from '../lib/content/schema';

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

describe('more than one image turns the block into a slideshow', () => {
  const def = blockDefinition('image');

  it('offers a slides repeater and the transition controls', () => {
    const fields = def?.fields ?? [];
    const slides = fields.find((f) => f.key === 'slides');
    expect(slides?.kind).toBe('repeater');
    if (slides && slides.kind === 'repeater') {
      expect(slides.max).toBe(7);
      expect(slides.fields.map((f) => f.key)).toEqual(['src', 'alt']);
    }
    const kinds = fields.map((f) => `${f.key}:${f.kind}`);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'transition:select',
        'interval:number',
        'arrows:toggle',
        'dots:toggle',
      ]),
    );
  });

  it('starts empty, as a single picture, so an image is unchanged', () => {
    expect(def?.defaults).toMatchObject({
      slides: [],
      transition: 'fade',
      interval: 5,
      arrows: true,
      dots: true,
    });
  });

  it('keeps the extra pictures through the save, each address checked', () => {
    const out = sanitiseBlock({
      id: 'i1',
      type: 'image',
      props: {
        src: 'https://x/a.jpg',
        slides: [
          { src: 'https://x/b.jpg', alt: 'B' },
          { src: 'javascript:alert(1)', alt: 'bad' },
        ],
      },
    } as Block);
    const slides = out.props.slides as Array<Record<string, unknown>>;
    expect(slides[0]).toMatchObject({ src: 'https://x/b.jpg', alt: 'B' });
    // The address allowlist runs on every slide, not just the first picture.
    expect(slides[1].src).toBe('');
  });
});

describe('the slideshow renders as stacked, staggered, pure-CSS slides', () => {
  const source = read('components', 'render', 'blocks.tsx');
  const block = source.slice(source.indexOf('export function ImageBlock'));
  const body = block.slice(0, block.indexOf('\n}\n'));

  it('becomes a slideshow only when there is more than one picture', () => {
    expect(body).toContain('if (slideSrcs.length > 0)');
    // The block's own picture is the first slide, capped so the count stays in
    // the range the keyframes cover.
    expect(body).toContain('[{ src, alt }, ...slideSrcs].slice(0, 8)');
  });

  it('stacks the slides and staggers each by its share of the cycle', () => {
    expect(body).toContain('className="tgs-slideshow"');
    expect(body).toContain('data-transition={transition}');
    expect(body).toContain('data-count={count}');
    expect(body).toMatch(/animationDelay: `calc\(\$\{index\} \* var\(--tgs-ss-cycle\) \/ \$\{count\}\)`/);
    expect(body).toContain('className="tgs-slideshow__slide"');
    expect(body).toContain('className="tgs-slideshow__dot"');
    // The first picture loads at once, the rest lazily, which is what reduced
    // motion falls back to showing.
    expect(body).toContain("loading={index === 0 ? 'eager' : 'lazy'}");
  });
});

describe('the stylesheet drives it, and stops for reduced motion', () => {
  const css = read('app', 'globals.css');

  it('has the fade and slide keyframes for every supported count', () => {
    for (let n = 2; n <= 8; n += 1) {
      expect(css, `fade-${n}`).toContain(`@keyframes tgs-ss-fade-${n}`);
      expect(css, `slide-${n}`).toContain(`@keyframes tgs-ss-slide-${n}`);
    }
    expect(css).toContain("[data-transition='slide'][data-count='8'] .tgs-slideshow__slide { animation-name: tgs-ss-slide-8;");
  });

  it('pauses on hover without a script', () => {
    expect(css).toContain('.tgs-slideshow:hover .tgs-slideshow__slide');
    expect(css).toContain('animation-play-state: paused');
  });

  it('stops the cycle and shows the first picture under reduced motion', () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*?\.tgs-slideshow__slide \{ animation: none/);
    expect(css).toContain('.tgs-slideshow__slide:first-child { opacity: 1; }');
  });
});
