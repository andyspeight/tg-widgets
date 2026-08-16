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
import { hasSlideshow, type Tree } from '../lib/content/slideshow';
import type { Block } from '../lib/content/schema';

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

/** A one-block tree, for the slideshow-detection tests. */
function treeWith(type: string, props: Record<string, unknown>): Tree {
  return { sections: [{ rows: [{ columns: [{ blocks: [{ type, props }] }] }] }] };
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
      // The slide picture carries focus, which is what gives each slide its own
      // Edit button and its own focus point, the same as a gallery tile.
      const slideSrc = slides.fields.find((f) => f.key === 'src');
      expect(slideSrc?.kind === 'image' && slideSrc.focus).toBe(true);
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
    // the range the keyframes cover. It keeps its own focus and adjustments.
    expect(body).toContain('[{ src, alt, style: pictureAdjustStyle(props) }, ...slideSrcs].slice(0, 8)');
  });

  it('gives every slide its own focus point, not just the first', () => {
    // Each extra slide's focus and adjustments travel with it, worked out the
    // same way a gallery tile's are, and painted through the img's own style.
    expect(body).toContain('style: pictureAdjustStyle(slide)');
    expect(body).toContain('style={slide.style}');
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
    // !important, or the per-count binder's animation-name keeps it cycling.
    expect(css).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*?\.tgs-slideshow__slide \{ animation: none !important/);
    expect(css).toContain('.tgs-slideshow__slide:first-child { opacity: 1; }');
  });
});

/*
 * STAGE B: the buttons. Clickable arrows, dots and a pause control, added on the
 * published page by public/slideshow.js where a script can run. The block still
 * auto-plays in pure CSS without it, so this is all progressive enhancement.
 */

describe('the block hands the script a clean interval to run on', () => {
  const source = read('components', 'render', 'blocks.tsx');
  const block = source.slice(source.indexOf('export function ImageBlock'));

  it('writes data-interval next to data-count', () => {
    expect(block).toContain('data-interval={interval}');
  });
});

describe('a page knows whether it needs the slideshow script', () => {
  it('says yes for an image block with a real extra picture', () => {
    expect(hasSlideshow(treeWith('image', { slides: [{ src: 'https://x/b.jpg' }] }))).toBe(true);
  });

  it('says no for a single image, or blank extra slides', () => {
    expect(hasSlideshow(treeWith('image', { slides: [] }))).toBe(false);
    expect(hasSlideshow(treeWith('image', {}))).toBe(false);
    expect(hasSlideshow(treeWith('image', { slides: [{ src: '   ' }, { src: '' }] }))).toBe(false);
  });

  it('says no for another block that happens to carry slides', () => {
    expect(hasSlideshow(treeWith('gallery', { slides: [{ src: 'https://x/b.jpg' }] }))).toBe(false);
  });

  it('says no for nothing at all', () => {
    expect(hasSlideshow(null)).toBe(false);
    expect(hasSlideshow(undefined)).toBe(false);
  });
});

describe('the script is emitted once per document, never in the editor', () => {
  const component = read('components', 'render', 'SlideshowScript.tsx');

  it('renders one deferred same-origin tag, and nothing when there is none', () => {
    expect(component).toContain('src="/slideshow.js"');
    expect(component).toContain('defer');
    // No slideshow in any tree means no tag at all.
    expect(component).toContain('if (!trees.some(hasSlideshow)) return null;');
  });

  for (const [label, route] of [
    ['the public site', ['app', 'site', '[host]', '[[...path]]', 'page.tsx']],
    ['the preview', ['app', 'preview', '[[...path]]', 'page.tsx']],
  ] as const) {
    it(`${label} hands it the same three trees as the widgets`, () => {
      const text = read(...route).replace(/\s+/g, ' ');
      expect(text).toContain('<SlideshowScript');
      const call = text.slice(text.indexOf('<SlideshowScript'));
      const trees = call.slice(0, call.indexOf('/>'));
      expect(trees).toContain('found.regions.header');
      expect(trees).toContain('found.regions.footer');
      // The public site resolves page, entry or archive into one `contentTree`;
      // the preview, which has no archive, still passes the page inline.
      expect(trees).toMatch(/found\.page|contentTree/);
    });
  }
});

describe('the enhancer is a CSP-clean vanilla script', () => {
  const js = read('public', 'slideshow.js');

  it('is a strict, guarded IIFE like the widgets', () => {
    expect(js).toContain("'use strict'");
    expect(js).toContain('window.__TG_SITES_SLIDESHOW__');
    expect(js).toContain('window.TGSitesSlideshow');
  });

  it('injects no script and runs no strings as code', () => {
    // The CSP rule for every widget in this repo. Controls are built with
    // createElement, so there is no innerHTML either.
    expect(js).not.toMatch(/\beval\s*\(/);
    expect(js).not.toMatch(/new Function\b/);
    expect(js).not.toMatch(/\.innerHTML\b/);
    expect(js).not.toMatch(/document\.write\b/);
    expect(js).toContain("document.createElement('button')");
  });

  it('takes over by adding is-live, and drives a current slide', () => {
    expect(js).toContain("root.classList.add('is-live')");
    expect(js).toContain("classList.toggle('is-current'");
    expect(js).toContain("root.setAttribute('data-dir'");
  });

  it('honours the author toggles and holds for a keyboard and a screen reader', () => {
    expect(js).toContain("root.getAttribute('data-arrows') === 'true'");
    expect(js).toContain("root.getAttribute('data-dots') === 'true'");
    expect(js).toContain("root.getAttribute('data-interval')");
    // A pause control is not optional for auto-moving content (WCAG 2.2.2).
    expect(js).toContain('tgs-slideshow__toggle');
    expect(js).toContain("setAttribute('aria-live', 'polite')");
  });

  it('does not auto-advance when the visitor prefers reduced motion', () => {
    expect(js).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
    expect(js).toMatch(/reduceMotion && reduceMotion\.matches/);
  });
});

describe('the stylesheet drives the live, script-run slideshow too', () => {
  const css = read('app', 'globals.css');

  it('switches the CSS cycle off once the script is live', () => {
    expect(css).toContain('.tgs-slideshow.is-live .tgs-slideshow__slide,');
    expect(css).toMatch(/\.tgs-slideshow\.is-live[\s\S]*?animation: none !important/);
    // The decorative dots give way by a display rule, since [hidden] loses to
    // their own display: flex.
    expect(css).toContain('.tgs-slideshow.is-live .tgs-slideshow__dots { display: none; }');
  });

  it('shows the current slide and moves the leaving one by direction', () => {
    expect(css).toContain('.tgs-slideshow.is-live .tgs-slideshow__slide.is-current');
    expect(css).toContain(".tgs-slideshow.is-live[data-transition='slide'][data-dir='next'] .tgs-slideshow__slide.is-leaving");
    expect(css).toContain(".tgs-slideshow.is-live[data-transition='slide'][data-dir='prev'] .tgs-slideshow__slide.is-leaving");
  });

  it('styles the arrows, the dot buttons and the pause toggle', () => {
    expect(css).toContain('.tgs-slideshow__arrow {');
    expect(css).toContain('.tgs-slideshow__dotbtn {');
    expect(css).toContain('.tgs-slideshow__toggle {');
    expect(css).toContain(".tgs-slideshow__dotbtn[aria-current='true']");
  });

  it('keeps the CSS-only reduced-motion fallback to the non-scripted case', () => {
    expect(css).toContain('.tgs-slideshow:not(.is-live) .tgs-slideshow__slide { animation: none');
    // In live mode, reduced motion drops the transition rather than the slide.
    expect(css).toContain('.tgs-slideshow.is-live .tgs-slideshow__slide { transition: none; }');
  });
});
