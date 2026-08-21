/**
 * A slideshow slide can be a film.
 *
 * Andy, 21 Aug 2026: Duda's Media Slider offers video as well as image, and his
 * call on the awkward part — the clips are MUTED AND LOOPING, trimmed by the
 * slide's own interval, rather than the slideshow waiting for each film to
 * finish. A slider that pauses unpredictably on one slide reads as broken.
 *
 * NOT A NEW ELEMENT. It is a field on the Image block's existing slideshow, for
 * the same reason the scrolling gallery and the tilted carousel are settings:
 * the library already carries three things that cycle, and a fourth that differed
 * only in what a slide contains would be a choice a client has to make before
 * they know what they want.
 *
 * The play/pause behaviour was checked in a browser by spying on the calls, not
 * by trusting a codec — the first attempt used a 216-byte fake webm and both
 * films stayed paused because the file had nothing to decode, which looked
 * exactly like a bug in the code.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blockDefinition } from '../lib/content/blocks';
import { hasSlideshow } from '../lib/content/slideshow';
import { safeUrl } from '../lib/content/sanitise';

const render = readFileSync(join(__dirname, '..', 'components', 'render', 'blocks.tsx'), 'utf8');
const script = readFileSync(join(__dirname, '..', 'public', 'slideshow.js'), 'utf8');
/** The script without its prose. This repo's own rule; see tests/no-right-click.ts. */
const code = script.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const imageBlock = render.slice(
  render.indexOf('export function ImageBlock'),
  render.indexOf('\nexport function ', render.indexOf('export function ImageBlock') + 1),
);

function treeWith(props: Record<string, unknown>) {
  return {
    sections: [
      { id: 's', rows: [{ id: 'r', columns: [{ id: 'c', blocks: [{ id: 'b', type: 'image', props }] }] }] },
    ],
  } as never;
}

describe('the field', () => {
  it('sits on the existing slideshow rather than being a fourth slider', () => {
    const slides = blockDefinition('image')!.fields.find((f) => f.key === 'slides') as
      { fields: Array<{ key: string; kind: string }> };
    const video = slides.fields.find((f) => f.key === 'video')!;
    expect(video.kind).toBe('url');
  });

  it('asks for a file address, not a YouTube link', () => {
    /*
     * A YouTube slide is an iframe, and an iframe cannot be muted, looped and
     * trimmed to the slide's length without loading their player and asking it
     * politely. The Video element is still the right home for a link to watch.
     */
    const slides = blockDefinition('image')!.fields.find((f) => f.key === 'slides') as
      { fields: Array<{ key: string; help?: string; placeholder?: string }> };
    const video = slides.fields.find((f) => f.key === 'video')!;
    expect(video.placeholder).toContain('.mp4');
    expect(video.help).toContain('YouTube link belongs in the Video element');
  });

  it('warns that a long clip is cut off', () => {
    // Andy's choice, and the one thing a client will otherwise be surprised by.
    const slides = blockDefinition('image')!.fields.find((f) => f.key === 'slides') as
      { fields: Array<{ key: string; help?: string }> };
    expect(slides.fields.find((f) => f.key === 'video')!.help).toContain('shorter than the seconds per slide');
  });
});

describe('a film slide', () => {
  it('is muted, looping and plays itself', () => {
    // Muted is not a style choice: a browser refuses to autoplay anything else.
    expect(imageBlock).toContain('muted');
    expect(imageBlock).toContain('loop');
    expect(imageBlock).toContain('playsInline');
  });

  it('does not autoplay on the editor canvas', () => {
    /*
     * The canvas re-renders on every keystroke and a film moving under the
     * pointer fights the person trying to select it, the same reason the section
     * background video does not play there. Paused it still shows its first
     * frame, so the slide is not a hole.
     */
    expect(imageBlock).toContain('autoPlay={!editing}');
  });

  it('counts as a slide even with no picture', () => {
    // The filter tested `src` alone for a month. Left alone it would drop a
    // film-only slide on the floor.
    expect(imageBlock).toContain('!!slide.src || !!slide.video');
  });

  it('keeps its alt as an accessible name, since a video takes no alt', () => {
    expect(imageBlock).toContain('aria-label={slide.alt || undefined}');
  });

  it('goes through the same sanitiser every other address does', () => {
    expect(imageBlock).toContain("video: safeUrl(str(slide, 'video'))");
    expect(safeUrl('https://cdn.example.com/clip.mp4')).toBe('https://cdn.example.com/clip.mp4');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    // Protocol-relative is refused, which is the trap absoluteUrl was caught by.
    expect(safeUrl('//evil.test/x.mp4')).toBeNull();
  });
});

describe('the page asks for the slideshow script', () => {
  it('for a slideshow made of films with no pictures at all', () => {
    expect(hasSlideshow(treeWith({ slides: [{ video: 'a.mp4' }, { video: 'b.mp4' }] }))).toBe(true);
  });

  it('and still for the ordinary picture case', () => {
    expect(hasSlideshow(treeWith({ slides: [{ src: 'a.jpg' }] }))).toBe(true);
  });

  it('but not for empty rows', () => {
    expect(hasSlideshow(treeWith({ slides: [{ src: '' }, { video: '  ' }] }))).toBe(false);
  });
});

describe('only the slide on show keeps its film running', () => {
  /*
   * The slides are stacked with opacity rather than display, so a browser will
   * decode five clips at once while four are invisible. That is four videos'
   * worth of work and battery for nothing.
   */
  it('pauses the films that are not showing', () => {
    expect(code).toContain('function films(slide, playing)');
    expect(code).toContain('films(s, i === to);');
  });

  it('settles the films at the moment the script takes over', () => {
    // Until then the CSS cycle was showing slide 0 and every film was running.
    expect(code).toContain('for (var f = 0; f < slides.length; f += 1) films(slides[f], f === 0);');
  });

  it('swallows a refused play rather than throwing', () => {
    // A browser is allowed to refuse, and a refusal is not an error worth
    // anybody's console.
    expect(code).toContain('if (started && started.catch) started.catch(function () {});');
  });

  it('is an enhancement, not a requirement', () => {
    /*
     * Without the script every clip plays, muted and looping, which is correct
     * and merely wasteful. That is clause 2 of the no-JavaScript rule: the
     * content never depends on a script.
     */
    expect(imageBlock).toContain('autoPlay={!editing}');
    expect(code).not.toContain('autoplay');
  });
});
