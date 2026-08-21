/**
 * The 21 Aug batch: Rating, Tooltip, Tags and the Icon pulse.
 *
 * TWO REAL BUGS CAME OUT OF THE BROWSER CHECK on this batch, and both are the
 * kind that ship silently because the code reads correctly:
 *
 *   1. A rating of 4.5 drew five whole stars. The shared `clamp` helper rounds
 *      to an integer — right for every other caller and fatal for the one
 *      element built specifically to allow halves.
 *   2. The tooltip's note ran off the left edge of the page, because it centred
 *      itself on the word whatever the word's position.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blockDefinition, defaultPropsFor, isKnownBlock } from '../lib/content/blocks';

const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
const render = readFileSync(join(__dirname, '..', 'components', 'render', 'blocks.tsx'), 'utf8');
const source = (name: string) => {
  const start = render.indexOf(`export function ${name}`);
  expect(start, name).toBeGreaterThan(-1);
  return render.slice(start, render.indexOf('\nexport function ', start + 1));
};

describe('the rating', () => {
  it('is standalone, in Text, not a field on a card', () => {
    // Andy was explicit: it is dropped on a page on its own.
    expect(isKnownBlock('rating')).toBe(true);
    expect(blockDefinition('rating')!.group).toBe('Text');
  });

  it('allows halves in the field', () => {
    const field = blockDefinition('rating')!.fields.find((f) => f.key === 'rating') as
      { min: number; max: number; step: number };
    expect(field.step).toBe(0.5);
    expect(field.max).toBe(5);
    expect(defaultPropsFor('rating').rating).toBe(4.5);
  });

  /*
   * THE BUG. `clamp` ends in Math.round, so 4.5 became 5 and the element could
   * not draw the half it exists for. Changing `clamp` would have silently
   * altered every size, count and interval in the library, so the rating does
   * its own bounding instead.
   */
  it('does not bound itself through the rounding clamp helper', () => {
    const block = source('RatingBlock');
    expect(block).not.toContain('clamp(props.rating');
    expect(block).toContain('Math.round(bounded * 2) / 2');
    // And the shared helper still rounds, because everything else wants that.
    expect(render).toContain('return Math.min(max, Math.max(min, Math.round(number)));');
  });

  it('still refuses a stored value outside nought to five', () => {
    // min and max on a number input are advisory; a stored 9 would draw nine.
    expect(source('RatingBlock')).toContain('Math.min(5, Math.max(0, asNumber))');
  });

  it('says its value in words, and only once', () => {
    /*
     * A rating is information, not decoration. The stars carry the whole
     * sentence, so the visible number is hidden from a screen reader or it is
     * read twice.
     */
    const block = source('RatingBlock');
    expect(block).toContain('role="img"');
    expect(block).toContain('aria-label={spoken}');
    expect(block).toContain('const spoken = count ?');
    expect(block).toContain('<span className="tgs-rating__value" aria-hidden="true">');
  });

  it('draws the half by clipping one star rather than keeping a second shape', () => {
    // A second half-star path is a second thing to keep in step with the first.
    expect(css).toContain(".tgs-rating__star[data-fill='half']::after");
    expect(css).toContain('width: 50%;');
  });
});

describe('the tooltip', () => {
  /*
   * THE WHOLE DESIGN. A tooltip on hover alone does not exist on a phone and
   * cannot be reached from a keyboard. A real button is focusable, so one rule
   * covers a mouse, a tap and a Tab key, with no script.
   */
  it('is a button, so hover, tap and Tab all open it', () => {
    const block = source('TooltipBlock');
    expect(block).toContain('type="button"');
    expect(css).toContain('.tgs-tip__word:hover ~ .tgs-tip__note,');
    expect(css).toContain('.tgs-tip__word:focus ~ .tgs-tip__note {');
  });

  it('is type=button, so it cannot submit the form it sits in', () => {
    // The default is submit, which would post an enquiry every time somebody
    // asked what ATOL means.
    expect(source('TooltipBlock')).toContain('type="button"');
  });

  it('ties the note to the button for a screen reader', () => {
    // The part a purely visual tooltip always misses.
    const block = source('TooltipBlock');
    expect(block).toContain('aria-describedby={tip ? tipId : undefined}');
    expect(block).toContain('role="tooltip"');
  });

  it('is out of the tab order and the accessibility tree when closed', () => {
    const rule = css.slice(css.indexOf('.tgs-tip__note {'));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('visibility: hidden;');
  });

  /*
   * THE SECOND BUG. The note centred on the word whatever the word's position,
   * so a left-aligned tooltip near the page edge had its note hanging off the
   * left of the screen. Without a script there is no collision detection, so the
   * alignment the client already chose picks a safe side.
   */
  it('hangs off the side the block is aligned to', () => {
    const rule = css.slice(css.indexOf('.tgs-tip__note {'));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('left: 0;');
    expect(css).toContain(".tgs-tip[data-align='centre'] .tgs-tip__note { left: 50%; transform: translateX(-50%); }");
    expect(css).toContain(".tgs-tip[data-align='right']  .tgs-tip__note { left: auto; right: 0; }");
  });
});

describe('the tags', () => {
  it('covers both of Duda\'s, as two styles of one element', () => {
    // Bullet Delimited and Coloured Delimited differ by a border-radius.
    const style = blockDefinition('tags')!.fields.find((f) => f.key === 'style') as
      { options: Array<{ value: string }> };
    expect(style.options.map((o) => o.value)).toEqual(['bullets', 'pills']);
  });

  it('is a list, and the bullet is drawn between rather than typed in', () => {
    /*
     * So a screen reader hears four tags rather than one sentence full of
     * punctuation, and a tag can be a link without the dot joining the link
     * text.
     */
    const block = source('TagsBlock');
    expect(block).toContain('<ul');
    expect(block).toContain('<li className="tgs-tags__item"');
    expect(block).not.toContain("'•'");
    expect(css).toContain(".tgs-tags[data-style='bullets'] .tgs-tags__item + .tgs-tags__item::before");
  });

  it('lets a tag be a link, through the same sanitiser as every other href', () => {
    expect(source('TagsBlock')).toContain("safeUrl(str(item, 'href'), CONTACT_OK)");
  });

  /*
   * Andy confirmed on 21 Aug that the truncated "Coloured Delimited..." is the
   * pair to "Bullet Delimited". Both readings of that name are covered by one
   * colour field: it tints the PILL, and it also tints the BULLET, so a client
   * who wants a coloured separator rather than coloured chips gets one without a
   * second element. The bullet's colour is the half that looks like a detail and
   * would be the half quietly flattened to grey.
   */
  it('colours the delimiter as well as the pill, from the one colour field', () => {
    expect(source('TagsBlock')).toContain("{ '--tgs-tag': colour }");
    const bullet = css.slice(css.indexOf(".tgs-tags[data-style='bullets'] .tgs-tags__item + .tgs-tags__item::before"));
    expect(bullet.slice(0, bullet.indexOf('}'))).toContain('color: var(--tgs-tag);');
    const pill = css.slice(css.indexOf(".tgs-tags[data-style='pills'] .tgs-tags__item"));
    expect(pill.slice(0, pill.indexOf('}'))).toContain('var(--tgs-tag)');
  });
});

describe('the icon pulse', () => {
  it('is a setting on the Icon, not a second icon element', () => {
    const field = blockDefinition('icon')!.fields.find((f) => f.key === 'pulse') as
      { options: Array<{ value: string }> };
    expect(field.options.map((o) => o.value)).toEqual(['none', 'ring', 'glow']);
    expect(defaultPropsFor('icon').pulse).toBe('none');
    expect(isKnownBlock('icon-pulse')).toBe(false);
  });

  it('adds no element at all when it is off', () => {
    expect(source('IconBlock')).toContain("pulse === 'none' ? (");
  });

  /*
   * `.tgs-icon` is the ALIGNMENT box. Turning it into an inline-flex to hang a
   * ring off it would break centring and right alignment for every icon on every
   * site, so the pulse gets its own wrapper.
   */
  it('never touches the alignment box', () => {
    expect(css).not.toContain('.tgs-icon[data-pulse');
    expect(css).toContain('.tgs-icon__pulse[data-pulse]');
  });

  it('moves a ring behind the glyph rather than the glyph itself', () => {
    // An icon that grew and shrank would shove the text beside it about.
    expect(css).toContain('.tgs-icon__pulse[data-pulse]::before');
    expect(css).toContain('@keyframes tgs-icon-ring');
  });

  it('stops for anybody who asked for less motion', () => {
    expect(css).toContain('.tgs-icon__pulse[data-pulse]::before { animation: none; opacity: 0; }');
  });
});
