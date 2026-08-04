/**
 * What sits behind a section, and what a link can point at.
 *
 * Three additions to the section, on 31 Jul 2026, and each one has a single
 * place it can go wrong quietly:
 *
 *   backgroundVideo  a URL the renderer puts in a src, so it needs the same
 *                    allowlist the picture has. Missed, it is the one string in
 *                    the model that goes to the browser unchecked.
 *   overlay          the scrim strength. It replaced a fixed value, so a
 *                    section saved before today has no number at all and must
 *                    still come back with the look it had.
 *   anchor           the id. Slugified rather than refused, and absent rather
 *                    than empty, because `id=""` is markup nobody meant.
 *
 * Whether the film actually stops for somebody who asked for less motion is
 * measured in the browser harness. Node can read a media query; only a browser
 * can tell you what it did.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { sanitisePage } from '../lib/content/sanitise-page';
import { createPage, createSection } from '../lib/content/factory';
import { anchorInput, parsePage, safeAnchor, type Section } from '../lib/content/schema';

function source(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

/** One section, through a real parse. */
function parsed(patch: Record<string, unknown>): Section {
  const page = createPage('Test', 'test');
  page.sections = [{ ...createSection('1'), ...patch } as Section];

  const result = parsePage(page);
  if (!result.ok) throw new Error(result.errors.join('; '));
  return result.page.sections[0];
}

// ---------------------------------------------------------------------------

describe('the scrim strength', () => {
  it('is 60 by default, which is the fixed value it replaced', () => {
    expect(createSection('1').overlay).toBe(60);
  });

  /*
   * THE ONE THAT MATTERS FOR EVERY EXISTING PAGE. Every section in the database
   * was written before this field existed, so it arrives with no `overlay` at
   * all. Coming back as 0 would take the scrim off every hero on the platform
   * and leave white text on photographs.
   */
  it('a section saved before it existed still comes back at 60', () => {
    const before = createSection('1') as Record<string, unknown>;
    delete before.overlay;

    const page = createPage('Test', 'test');
    page.sections = [before as unknown as Section];

    const result = parsePage(page);
    expect(result.ok, result.ok ? '' : result.errors.join('; ')).toBe(true);
    if (!result.ok) return;
    expect(result.page.sections[0].overlay).toBe(60);
  });

  it('is held between 0 and 100, whatever arrives', () => {
    expect(parsed({ overlay: -40 }).overlay).toBe(0);
    expect(parsed({ overlay: 500 }).overlay).toBe(100);
    expect(parsed({ overlay: 'quite dark' }).overlay).toBe(60);
    expect(parsed({ overlay: 42.6 }).overlay).toBe(43);
  });

  /*
   * `min` AND `max` ON A NUMBER INPUT ARE ADVICE. The browser marks the field
   * invalid and hands the typed value over regardless, so 900 in a 0-to-100 box
   * reached the canvas and the canvas showed a scrim the save would then
   * correct. The shared Measure control clamps on blur now, which fixes it for
   * every spacing and size control in the editor and not only this one.
   */
  it('the number box holds its own range rather than trusting the browser to', () => {
    const controls = source('components', 'editor', 'BoxControls.tsx');
    expect(controls).toContain('onBlur={(event) => {');
    expect(controls).toContain('Math.min(max, Math.max(min, Math.round(typed)))');
    // On blur, not on change: clamping mid-keystroke turns the "4" on the way
    // to "40" into the minimum.
    expect(controls).not.toContain('onChange={(event) => onChange(Math.min(');
  });

  it('reaches the page as a custom property rather than a class', () => {
    const renderer = source('components', 'render', 'PageRenderer.tsx');
    expect(renderer).toContain("'--tgs-scrim': section.overlay");

    const css = source('app', 'globals.css');
    expect(css).toContain('var(--tgs-scrim, 60)');
  });
});

// ---------------------------------------------------------------------------

describe('the background video', () => {
  /*
   * THE SAME ALLOWLIST AS THE PICTURE. This string is put straight into a `src`
   * by the renderer, so it is exactly as dangerous as the image URL beside it
   * and gets exactly the same treatment.
   */
  it('goes through the same allowlist the picture does', () => {
    const page = createPage('Test', 'test');
    page.sections = [
      { ...createSection('1'), backgroundVideo: 'javascript:alert(1)' } as Section,
    ];

    const result = parsePage(page);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(sanitisePage(result.page).sections[0].backgroundVideo).toBe('');
  });

  it('keeps an ordinary address', () => {
    const page = createPage('Test', 'test');
    page.sections = [
      { ...createSection('1'), backgroundVideo: 'https://cdn.example.com/hero.mp4' } as Section,
    ];

    const result = parsePage(page);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(sanitisePage(result.page).sections[0].backgroundVideo)
      .toBe('https://cdn.example.com/hero.mp4');
  });
});

// ---------------------------------------------------------------------------

describe('how the video is rendered', () => {
  const renderer = source('components', 'render', 'PageRenderer.tsx');
  const css = source('app', 'globals.css');

  /*
   * BOTH ARE DRAWN WHEN BOTH ARE SET, and that is what makes offering a video
   * safe rather than a trap. Choosing between them would mean hiding the video
   * for reduced motion left a blank band where the hero should be.
   */
  it('draws the picture and the video, rather than choosing between them', () => {
    // The img's className ends in a closing quote; the video's has a space then
    // --video, so this finds the picture alone even though both share the stem.
    const image = renderer.indexOf('className="tgs-section__bg"');
    const video = renderer.indexOf('tgs-section__bg tgs-section__bg--video');

    expect(image).toBeGreaterThan(-1);
    expect(video).toBeGreaterThan(image);
    // No `!video` on the picture: an `else` here is the bug this describes.
    expect(renderer).not.toContain('background && !video');
  });

  it('the film stops for anybody who asked for less motion', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce) {\n  .tgs-section__bg--video { display: none; }');
  });

  it('plays silently, loops, and stays out of the tab order', () => {
    const tag = /<video([\s\S]*?)\/>/.exec(renderer)?.[1] ?? '';
    for (const attribute of ['autoPlay', 'muted', 'loop', 'playsInline']) {
      expect(tag, `the video is missing ${attribute}`).toContain(attribute);
    }
    // Decorative: the words over it belong to the blocks in the section.
    expect(tag).toContain('aria-hidden="true"');
    expect(tag).toContain('tabIndex={-1}');
    // The picture doubles as the poster, so there is something to look at while
    // the file downloads.
    expect(tag).toContain('poster={background || undefined}');
  });

  /*
   * NEVER IN THE EDITOR. The canvas re-renders on every keystroke, so a video
   * there would restart and re-download as somebody typed.
   */
  it('does not play on the editor canvas', () => {
    expect(renderer).toContain('{video && !editable && (');
  });
});

// ---------------------------------------------------------------------------

describe('the anchor', () => {
  it('turns what somebody typed into something that can be an id', () => {
    expect(safeAnchor('Our prices')).toBe('our-prices');
    expect(safeAnchor('  Greece & Cyprus!  ')).toBe('greece-cyprus');
    expect(safeAnchor('ALREADY-fine')).toBe('already-fine');
  });

  /*
   * UNDEFINED, NOT AN EMPTY STRING. The renderer spreads the attribute only when
   * there is one, so an empty answer here would be the difference between no id
   * and `id=""`, which is markup nobody meant and a selector that matches.
   */
  it('answers with nothing at all when there is nothing usable left', () => {
    expect(safeAnchor('!!!')).toBeUndefined();
    expect(safeAnchor('')).toBeUndefined();
    expect(safeAnchor(undefined)).toBeUndefined();
    expect(safeAnchor(42)).toBeUndefined();
  });

  /*
   * TWO FUNCTIONS, AND THEY ARE NOT THE SAME ONE. safeAnchor trims hyphens off
   * both ends, which is right for a stored value and wrong for a box somebody is
   * still typing into: the hyphen in "our-prices" would be removed the instant
   * it appeared and the second word could never be started.
   */
  it('keeps a trailing hyphen while it is being typed, and trims it after', () => {
    expect(anchorInput('our-')).toBe('our-');
    expect(anchorInput('Our Prices')).toBe('our-prices');
    expect(safeAnchor('our-')).toBe('our');
  });

  it('is capped, so it cannot become a paragraph', () => {
    expect(safeAnchor('a'.repeat(200))!.length).toBe(60);
  });

  it('survives a parse', () => {
    expect(parsed({ anchor: 'Our Prices' }).anchor).toBe('our-prices');
    expect(parsed({ anchor: '###' }).anchor).toBeUndefined();
  });

  it('reaches the page as an id, and only when there is one', () => {
    const renderer = source('components', 'render', 'PageRenderer.tsx');
    // Reduced again at render time, not taken from the stored value. The editor
    // holds a half-typed name between keystrokes and "!!!" on its way somewhere
    // reduces to a bare hyphen, which rendered raw is id="-".
    expect(renderer).toContain('const anchor = safeAnchor(section.anchor);');
    expect(renderer).toContain('{...(anchor ? { id: anchor } : {})}');
  });

  /*
   * A STICKY HEADER WOULD OTHERWISE COVER WHAT SOMEBODY JUST JUMPED TO, which
   * reads as the link having gone to the wrong place. The scroll margin is the
   * whole fix and it is one line, which is exactly the sort of line that gets
   * tidied away.
   */
  it('leaves room for a sticky header when a link lands on it', () => {
    const css = source('app', 'globals.css');
    expect(css).toContain('.tgs-section[id] { scroll-margin-top:');
    // Smooth scrolling only for people who have not asked otherwise.
    expect(css).toContain('@media (prefers-reduced-motion: no-preference) {\n  html:has(.tgs-section[id]) { scroll-behavior: smooth; }');
  });

  /*
   * THE PREVIEW MUST NOT SHOW SOMETHING THE SAVE WILL CORRECT. The value becomes
   * an `id` on the canvas as it is typed, so "Our Prices" showed as
   * id="Our Prices" and was stored as "our-prices". Normalising only in the
   * schema is not enough when the editor renders the same field.
   */
  it('the editor normalises it too, not only the schema', () => {
    const props = source('components', 'editor', 'Properties.tsx');
    expect(props).toContain('anchorInput(event.target.value)');
    expect(props).toContain('safeAnchor(event.target.value)');
  });

  it('a button can already point at one, because safeUrl keeps a fragment', () => {
    // Nothing had to change for this: safeUrl has always passed anything
    // starting with #. It was pointless until sections had ids.
    const sanitise = source('lib', 'content', 'sanitise.ts');
    expect(sanitise).toContain('/^[/?#]/');
  });
});

// ---------------------------------------------------------------------------

/*
 * THE BACKGROUND PICTURE'S FOCUS POINT AND ADJUSTMENTS, added 4 Aug 2026.
 *
 * Andy had the image editor but found it reached only a standalone image block,
 * not a section background, which is where a hero needs it most. Five numbers on
 * the section carry it: a focus point that becomes object-position, and three
 * adjustments that become a filter on the background img. The single place each
 * can go wrong quietly is the same as every other stored number: an unclamped
 * value reaching the CSS, or a default appearing on a section that set nothing.
 */
describe('the background picture, its focus point and its look', () => {
  it('keeps a focus point and adjustments a client dragged in', () => {
    const section = parsed({
      backgroundImage: 'https://cdn.example.com/hero.jpg',
      backgroundFocusX: 20,
      backgroundFocusY: 80,
      backgroundBrightness: 120,
      backgroundContrast: 90,
      backgroundSaturation: 140,
    });
    expect(section.backgroundFocusX).toBe(20);
    expect(section.backgroundFocusY).toBe(80);
    expect(section.backgroundBrightness).toBe(120);
    expect(section.backgroundContrast).toBe(90);
    expect(section.backgroundSaturation).toBe(140);
  });

  it('pins the focus to a percentage and the adjustments to their range', () => {
    expect(parsed({ backgroundFocusX: -30 }).backgroundFocusX).toBe(0);
    expect(parsed({ backgroundFocusY: 400 }).backgroundFocusY).toBe(100);
    expect(parsed({ backgroundBrightness: 999 }).backgroundBrightness).toBe(200);
    expect(parsed({ backgroundSaturation: 33.6 }).backgroundSaturation).toBe(34);
  });

  /*
   * ABSENT, NOT ZERO. A section with no background carries none of these, so the
   * stored page stays lean and the render falls back to the middle and no
   * filter. Every section written before today has no such keys, and they must
   * come back exactly as they were rather than sprouting a focus point.
   */
  it('is absent on a section that never set one, rather than a default', () => {
    const section = parsed({});
    expect(section.backgroundFocusX).toBeUndefined();
    expect(section.backgroundBrightness).toBeUndefined();
  });

  it('will not take a value that is not a number', () => {
    expect(parsed({ backgroundFocusX: 'left a bit' }).backgroundFocusX).toBeUndefined();
  });

  it('drives object-position and a filter on the background img, under the scrim', () => {
    const renderer = source('components', 'render', 'PageRenderer.tsx');
    // Built from clamped numbers, never a stored string.
    expect(renderer).toContain('bgPercent(section.backgroundFocusX, 100, 50)');
    expect(renderer).toContain('bgPercent(section.backgroundBrightness, 200, 100)');
    expect(renderer).toMatch(/objectPosition: `\$\{focusX\}% \$\{focusY\}%`/);
    // A filter only for an adjustment that is off its default.
    expect(renderer).toContain('if (brightness !== 100) adjustments.push(`brightness(${brightness}%)`)');
    // Put on the background img, which sits under the scrim, so darkening the
    // picture never dims the words on top of it.
    expect(renderer).toContain('style={backgroundStyle(section)}');
  });

  it('offers the Edit button on the background field, mapping the five numbers', () => {
    const props = source('components', 'editor', 'Properties.tsx');
    // The generic keys the editor saves are remapped onto the section's own.
    expect(props).toMatch(/backgroundFocusX: patch\.focusX/);
    expect(props).toMatch(/focusX: section\.backgroundFocusX \?\? 50/);
    expect(props).toMatch(/brightness: section\.backgroundBrightness \?\? 100/);
  });
});
