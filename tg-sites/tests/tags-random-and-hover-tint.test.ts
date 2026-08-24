/**
 * The 21 Aug batch, second half: "random" tag colours and Duda's Fancy Grid.
 *
 * BOTH ARE SETTINGS, NOT ELEMENTS. Random is a third style on Tags. Fancy Grid
 * is a hover tint on a section, because the grid in Andy's screenshot (icon,
 * heading, body, Learn More, three across) is the Cards block already and the
 * tint was the only part missing.
 *
 * THE BROWSER FOUND TWO BUGS HERE that reading the code did not:
 *   1. Pill text failed contrast at 2.46:1, in the plain style already shipped.
 *      Random would have multiplied that across eight hues.
 *   2. The lightness bounds sat on .tgs-tags, so the dark-mode override on
 *      .tgs-page was only inherited and lost. Dark pills would have shipped
 *      unreadable. The tell was the dark measurement coming back IDENTICAL to
 *      the light one.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blockDefinition, defaultPropsFor } from '../lib/content/blocks';
import { SectionSchema } from '../lib/content/schema';

const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
const render = readFileSync(join(__dirname, '..', 'components', 'render', 'blocks.tsx'), 'utf8');
const page = readFileSync(join(__dirname, '..', 'components', 'render', 'PageRenderer.tsx'), 'utf8');
const props = readFileSync(join(__dirname, '..', 'components', 'editor', 'Properties.tsx'), 'utf8');

/* Strip comments before asserting on source. This repo has been caught twice by
   a grep matching the comment that promises not to do the thing. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('a different colour each', () => {
  it('is a third style on Tags, not a third tags element', () => {
    const style = blockDefinition('tags')!.fields.find((f) => f.key === 'style') as
      { options: Array<{ value: string }> };
    expect(style.options.map((o) => o.value)).toEqual(['bullets', 'pills', 'random']);
  });

  /*
   * THE WHOLE POINT. Math.random() would be a bug wearing the right name: these
   * pages render on the server, so colours would change on every load, and the
   * editor re-renders a block on EVERY KEYSTROKE, so they would strobe while a
   * client typed a tag. Andy asked for variety, which is not the same as churn.
   */
  it('never actually calls random', () => {
    expect(code(render)).not.toContain('Math.random');
  });

  it('derives the colour from the tag\'s own words, so it is stable', () => {
    const block = code(render);
    expect(block).toContain('hash = (hash * 31 + label.charCodeAt(i))');
    expect(block).toContain('const start = hash % TAG_HUES.length;');
  });

  /*
   * Hashing alone lets two neighbours collide, which reads as a bug rather than
   * a scatter. The walk past used hues is what makes "a different colour EACH"
   * true rather than merely likely.
   */
  it('walks past a hue already used in the row, so no two tags match', () => {
    const block = code(render);
    expect(block).toContain('if (!used.has(at))');
    expect(block).toContain('used.add(at)');
    // More tags than hues: start the cycle again rather than pile them on one.
    expect(block).toContain('if (used.size >= TAG_HUES.length) used.clear();');
  });

  /*
   * The colours are ROTATIONS from whatever the client set, never a fixed
   * palette of brights. A luxury house gets variations of its own world. A
   * hard-coded rainbow would fight every brand on the platform.
   */
  it('rotates the client\'s own colour rather than naming colours of its own', () => {
    const block = code(render);
    expect(block).toContain('const TAG_HUES = [0, 150, 60, -100, 200, 35, -55, 110];');
    // No hex literals anywhere in the tag colour path.
    expect(block.slice(block.indexOf('const TAG_HUES'), block.indexOf('export function TagsBlock')))
      .not.toMatch(/#[0-9a-fA-F]{3,6}/);
    expect(css).toContain('calc(h + var(--tgs-tag-rot, 0))');
  });

  it('insists on some chroma, but only for this style', () => {
    /* A grey brand would otherwise give eight identical grey pills from the one
       option whose whole point is that they differ. Plain pills get no floor,
       because a deliberately monochrome brand should stay monochrome. */
    // Anchor past the shared pills+random rule to the @supports block.
    const random = css.slice(css.lastIndexOf(".tgs-tags[data-style='random'] .tgs-tags__item {"));
    expect(random.slice(0, random.indexOf('\n  }'))).toContain('max(c, 0.11)');
    const plain = css.slice(css.indexOf(".tgs-tags[data-style='pills'] .tgs-tags__item {"));
    expect(plain.slice(0, plain.indexOf('\n}'))).not.toContain('max(c,');
  });
});

describe('pill text clears the contrast line', () => {
  /*
   * Measured 21 Aug: the brand colour on its own 14% tint was 2.46:1. Two fixes
   * were tried and rejected, and both would look reasonable to a later reader:
   * mixing a fixed proportion into --tgs-text (a near-white brand lands near
   * 3.6:1 at any ratio) and clamping HSL lightness (HSL lightness is not
   * perceptual, so pale yellow still failed at 2.21:1). OKLCH lightness is.
   */
  it('clamps perceptual lightness, not HSL lightness', () => {
    expect(css).toContain('clamp(var(--tgs-tag-lmin), l, var(--tgs-tag-lmax))');
    expect(css).not.toContain("hsl(from var(--tgs-tag)");
  });

  /*
   * THE BUG THAT NEARLY SHIPPED. These bounds must sit with the other light-mode
   * tokens, because the dark-mode swap sets them on .tgs-page. A value set on
   * .tgs-tags itself beats an inherited one every time, and !important does not
   * carry across elements, so dark mode silently kept the light clamp.
   */
  it('sets the bounds where the dark-mode swap can win', () => {
    expect(css).not.toMatch(/\.tgs-tags\s*\{[^}]*--tgs-tag-lmax/);
    const light = css.slice(0, css.indexOf('@media'));
    expect(light).toContain('--tgs-tag-lmax: 0.44;');
    expect(css).toContain('--tgs-tag-lmin: 0.72 !important;');
    expect(css).toContain('--tgs-tag-lmax: 1 !important;');
  });

  it('leaves a readable fallback where relative colour syntax is missing', () => {
    /* Not the measured clamp, but far better than the raw brand colour it
       replaces, and it degrades to ordinary pills rather than to broken ones. */
    expect(css).toContain('color: color-mix(in srgb, var(--tgs-tag) 45%, var(--tgs-text));');
    expect(css).toContain('@supports (color: oklch(from red l c h))');
  });
});

describe('the hover tint (Duda\'s Fancy Grid)', () => {
  it('is a section setting, not a second grid element', () => {
    const parsed = SectionSchema.safeParse({ id: 's1', rows: [], hoverTint: true });
    expect(parsed.success).toBe(true);
    expect(blockDefinition('fancy-grid')).toBeUndefined();
  });

  it('is gated on not editing, like the lift and the zoom beside it', () => {
    expect(code(page)).toContain("data-hover-tint={section.hoverTint && !editable ? '' : undefined}");
  });

  /*
   * LOAD-BEARING. The wash covers the card, and the whole card is usually a link
   * (.tgs-card__link::after covers it to catch the click). Without this the tint
   * would swallow every click on every card in the section. Verified in a
   * browser: the element under the pointer mid-card is still the link.
   */
  it('lets the click through', () => {
    const rule = css.slice(css.indexOf('.tgs-section[data-hover-tint] .tgs-card::after {'));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('pointer-events: none;');
  });

  it('follows the card\'s own corners rather than assuming square', () => {
    const rule = css.slice(css.indexOf('.tgs-section[data-hover-tint] .tgs-card::after {'));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('border-radius: inherit;');
  });

  it('answers the keyboard too, not only the pointer', () => {
    expect(css).toContain('.tgs-section[data-hover-tint] .tgs-card:focus-within::after');
  });

  it('is reachable from the editor, or a client can never turn it on', () => {
    expect(props).toContain('checked={section.hoverTint === true}');
    expect(props).toContain('hoverTint: event.target.checked || undefined');
  });
});

describe('a card that leads with an icon', () => {
  /*
   * THE TINT WAS NOT THE ONLY GAP. Andy's Fancy Grid screenshot leads each card
   * with an ICON, and Cards only ever led with a photograph. The icon-and-text
   * block that does have an icon is a single item with no link and no grid, so
   * reaching that screenshot through it meant hand-building a grid and giving up
   * the Learn More link. Hence a lead setting here, still not a new block.
   */
  it('is a setting on Cards, not a fifth grid block', () => {
    const lead = blockDefinition('cards')!.fields.find((f) => f.key === 'lead') as
      { options: Array<{ value: string }> };
    expect(lead.options.map((o) => o.value)).toEqual(['image', 'icon']);
    expect(defaultPropsFor('cards').lead).toBe('image');
    expect(blockDefinition('icon-cards')).toBeUndefined();
  });

  it('draws the icon INSTEAD of the picture, not above an empty frame', () => {
    const card = code(render).slice(code(render).indexOf('function renderCard'));
    expect(card).toContain("options.lead === 'icon' && icon");
    expect(card).toContain("options.lead === 'image' && (");
  });

  /*
   * The title carries the meaning, so a screen reader is not made to read
   * "shield" before every heading in a six-card grid.
   */
  it('is decorative', () => {
    const card = code(render).slice(code(render).indexOf('function renderCard'));
    const icon = card.slice(card.indexOf('tgs-card__icon'));
    expect(icon.slice(0, icon.indexOf('</span>'))).toContain('aria-hidden="true"');
  });

  /*
   * Same name-or-character rule as the icon-and-text block. Every icon on a page
   * built before the icon library is a character somebody typed, and those pages
   * have to keep drawing what they drew.
   */
  it('keeps the name-or-character rule, so no page needs migrating', () => {
    const card = code(render).slice(code(render).indexOf('function renderCard'));
    expect(card).toContain("data-kind={isIconName(icon) ? 'icon' : 'character'}");
    expect(card).toContain('isIconName(icon) ? <ContentIcon name={icon}');
  });

  /*
   * renderCard drops a card with nothing to say. Before the icon was counted,
   * an icon-only card was silently dropped from the grid.
   */
  it('counts as something to say', () => {
    expect(code(render)).toContain(
      'if (!title && !body && !label && !src && !icon && facts.length === 0) return null;',
    );
  });

  it('leaves the slider leading with its picture', () => {
    // The slider reuses renderCard. A slide is a photograph, not an icon, and
    // a slide is always the stacked shape: the card designs are the grid's.
    expect(code(render)).toContain("{ showImage: true, ratio, radius, lead: 'image', design: 'stacked' }");
  });

  /*
   * Andy's reference centres the shield over LEFT-ALIGNED words. Neither a fully
   * left card nor a fully centred one draws that, so the icon aligns on its own
   * rather than the whole card being centred to get the icon centred.
   */
  it('aligns on its own, so a centred icon can sit over left-aligned words', () => {
    const align = blockDefinition('cards')!.fields.find((f) => f.key === 'iconAlign') as
      { options: Array<{ value: string }> };
    expect(align.options.map((o) => o.value)).toEqual(['left', 'centre']);
    expect(defaultPropsFor('cards').iconAlign).toBe('left');
    expect(code(render)).toContain("data-align={options.iconAlign ?? 'left'}");
    expect(css).toContain(".tgs-card__icon[data-align='centre'] { text-align: center; }");
  });

  it('still follows a centred card when it was left to its default', () => {
    // Otherwise centring a whole card would leave its icon stranded on the left.
    expect(css).toContain(".tgs-cards[data-align='centre'] .tgs-card__icon[data-align='left'] { text-align: center; }");
  });

  it('colours every icon in the grid together, not one at a time', () => {
    // Andy's reference has six identical shields. A per-card colour would invite
    // a client to make each one different, which is the look nobody asked for.
    expect(blockDefinition('cards')!.fields.some((f) => f.key === 'iconColour')).toBe(true);
    const items = blockDefinition('cards')!.fields.find((f) => f.key === 'items') as
      { fields: Array<{ key: string }> };
    expect(items.fields.map((f) => f.key)).toContain('icon');
    expect(items.fields.map((f) => f.key)).not.toContain('iconColour');
  });
});
