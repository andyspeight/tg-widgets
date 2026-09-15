/**
 * Cards and buttons under the pointer. The fourth slice of the React Bits review
 * (docs/react-bits-review.md, 15 Sep 2026): a spotlight, a tilt and a glare on a
 * section's cards, beside the lift, the zoom and the tint; a sheen, a pull and a
 * trace on a button.
 *
 * WHAT IS PINNED. That every one of them is a setting on a section or a button
 * and never a new block; that the three card effects are gated on not editing
 * like the tint beside them, and a button's effect is dropped on the canvas;
 * that every layer lets the click through (the whole card is usually a link);
 * that everything that moves sits behind the mouse guard AND the reduced-motion
 * guard, and the two effects that only fade sit behind the mouse guard; that the
 * script pulls the page only for the three that need it (spotlight, tilt, magnet)
 * and refuses to run under reduced motion before any of it; that the editor can
 * reach the three section flags; and that the dressed presets ask for what they
 * say.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blockDefinition, defaultPropsFor } from '../lib/content/blocks';
import { needsMotionScript } from '../lib/content/motion';
import { buildPresetSection, presetById } from '../lib/content/presets';
import { SectionSchema } from '../lib/content/schema';

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

const css = read('app', 'globals.css');
const render = read('components', 'render', 'blocks.tsx');
const page = read('components', 'render', 'PageRenderer.tsx');
const dispatch = read('components', 'render', 'BlockRenderer.tsx');
const editor = read('components', 'editor', 'Properties.tsx');
const schema = read('lib', 'content', 'schema.ts');
const script = read('public', 'tg-motion.js');

/** Every block of a guard, brace matched, so a rule NEAR it cannot pass. */
function blocksOf(sheet: string, opener: string): string {
  let out = '';
  let from = 0;
  for (;;) {
    const start = sheet.indexOf(opener, from);
    if (start === -1) break;
    let depth = 1;
    let i = start + opener.length;
    for (; i < sheet.length && depth > 0; i += 1) {
      if (sheet[i] === '{') depth += 1;
      else if (sheet[i] === '}') depth -= 1;
    }
    out += `${sheet.slice(start + opener.length, i)}\n`;
    from = i;
  }
  return out;
}

const mouseOnly = blocksOf(css, '@media (hover: hover) and (pointer: fine) {');
const mouseAndMotion = blocksOf(css, '@media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {');

/** The declarations of the first rule whose selector line starts with `selector`. */
function rule(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
}

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

// ---------------------------------------------------------------------------
// The section: three more hover effects, beside lift, zoom and tint
// ---------------------------------------------------------------------------

describe('the section flags', () => {
  it('are three optional booleans, so no stored section changes shape', () => {
    expect(schema).toContain('hoverSpotlight: z.boolean().optional()');
    expect(schema).toContain('hoverTilt: z.boolean().optional()');
    expect(schema).toContain('hoverGlare: z.boolean().optional()');
    const parsed = SectionSchema.safeParse({ id: 's1', rows: [], hoverSpotlight: true, hoverTilt: true, hoverGlare: true });
    expect(parsed.success).toBe(true);
    expect(SectionSchema.safeParse({ id: 's2', rows: [] }).data?.hoverSpotlight).toBeUndefined();
  });

  it('are settings on the section, never a new block', () => {
    for (const type of ['spotlight-card', 'tilted-card', 'glare-card', 'magnet', 'star-border']) {
      expect(blockDefinition(type), type).toBeUndefined();
    }
  });

  it('are gated on not editing, like the lift, the zoom and the tint beside them', () => {
    expect(page).toContain("data-hover-spotlight={section.hoverSpotlight && !editable ? '' : undefined}");
    expect(page).toContain("data-hover-tilt={section.hoverTilt && !editable ? '' : undefined}");
    expect(page).toContain("data-hover-glare={section.hoverGlare && !editable ? '' : undefined}");
  });

  it('are reachable from the editor, or a client can never turn them on', () => {
    for (const flag of ['hoverSpotlight', 'hoverTilt', 'hoverGlare']) {
      expect(editor).toContain(`checked={section.${flag} === true}`);
      expect(editor).toContain(`${flag}: event.target.checked || undefined`);
    }
  });
});

// ---------------------------------------------------------------------------
// The button: one effect, read from a closed list, dropped on the canvas
// ---------------------------------------------------------------------------

describe('the button effect', () => {
  it('offers nothing, a sheen, a pull and a trace, on the button and on the row', () => {
    for (const type of ['button', 'button-group']) {
      const field = blockDefinition(type)!.fields.find((f) => f.key === 'effect') as { options?: Array<{ value: string }>; group?: string } | undefined;
      expect(field, type).toBeDefined();
      expect(field!.options!.map((o) => o.value)).toEqual(['none', 'sheen', 'magnetic', 'trace']);
      expect(field!.group).toBe('effects');
      expect(defaultPropsFor(type).effect).toBe('none');
    }
  });

  it('is read from a closed list and only written when it is something', () => {
    expect(render).toContain("const BUTTON_EFFECTS = ['none', 'sheen', 'magnetic', 'trace'] as const;");
    expect(render).toContain("data-effect={effect === 'none' ? undefined : effect}");
  });

  it('is dropped on the editing canvas, where a button that slides away cannot be selected', () => {
    expect(count(render, "const effect = editing ? 'none' : oneOf(props, 'effect', BUTTON_EFFECTS, 'none');")).toBe(2);
    expect(dispatch).toContain('<ButtonBlock props={props} editing={editable} />');
    expect(dispatch).toContain('<ButtonGroupBlock props={props} editing={editable} />');
  });

  it('is one effect for the whole row, applied to every button in it', () => {
    expect(render).toContain('buttons.map((button, index) => renderButton(button, index, effect))');
  });
});

// ---------------------------------------------------------------------------
// The stylesheet
// ---------------------------------------------------------------------------

describe('the card effects in the stylesheet', () => {
  /*
   * LOAD-BEARING, the same lesson the tint paid for. Every layer covers the card,
   * and the whole card is usually a link. Without this the light would swallow
   * every click on every card in the section.
   */
  it('let the click through on every layer', () => {
    expect(rule('.tgs-section[data-hover-spotlight] .tgs-card::before')).toContain('pointer-events: none;');
    expect(rule('.tgs-section[data-hover-glare] .tgs-card__frame::before')).toContain('pointer-events: none;');
  });

  it('draws the spotlight where the script says, and at the centre when it has not said', () => {
    const spot = rule('.tgs-section[data-hover-spotlight] .tgs-card::before');
    expect(spot).toContain('var(--mx, 50%) var(--my, 50%)');
    expect(spot).toContain('border-radius: inherit;');
    expect(spot).toContain('opacity: 0;');
    // Lit only for a mouse. It only fades, so it needs no motion guard, like the tint.
    expect(mouseOnly).toContain('.tgs-section[data-hover-spotlight] .tgs-card:hover::before { opacity: 1; }');
  });

  it('leans the card only for a mouse that has not asked for less motion, and keeps the lean with the lift', () => {
    expect(mouseAndMotion).toContain('.tgs-section[data-hover-tilt] .tgs-card {');
    expect(mouseAndMotion).toContain('transform: perspective(900px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg));');
    expect(mouseAndMotion).toContain('.tgs-section[data-hover-tilt][data-hover-lift] .tgs-card:hover {');
    expect(mouseAndMotion).toContain('rotateY(var(--ry, 0deg)) translateY(-4px);');
    // Never outside the guard.
    expect(count(css, '.tgs-section[data-hover-tilt]')).toBe(2);
  });

  it('parks the glare off to the left and only sweeps it behind both guards', () => {
    expect(rule('.tgs-section[data-hover-glare] .tgs-card__frame::before')).toContain('transform: translateX(-70%);');
    const hover = '.tgs-section[data-hover-glare] .tgs-card:hover .tgs-card__frame::before';
    expect(mouseAndMotion).toContain(hover);
    expect(count(css, hover)).toBe(1);
  });
});

describe('the button effects in the stylesheet', () => {
  it('clip the sheen to the button and only sweep it behind both guards', () => {
    expect(rule(".tgs-button[data-effect='sheen']")).toContain('overflow: hidden;');
    expect(rule(".tgs-button[data-effect='sheen']::after")).toContain('pointer-events: none;');
    expect(rule(".tgs-button[data-effect='sheen']::after")).toContain('transform: translateX(-70%);');
    const hover = ".tgs-button[data-effect='sheen']:hover::after { transform: translateX(70%); }";
    expect(mouseAndMotion).toContain(hover);
    expect(count(css, ".tgs-button[data-effect='sheen']:hover::after")).toBe(1);
  });

  it('move the magnet only behind both guards, from what the script wrote', () => {
    expect(mouseAndMotion).toContain("transform: translate(var(--px, 0px), var(--py, 0px));");
    expect(count(css, ".tgs-button[data-effect='magnetic']")).toBe(1);
  });

  it('draw the trace as a masked ring that turns, never a glow', () => {
    expect(css).toContain("@property --trace {\n  syntax: '<angle>';");
    const ring = rule(".tgs-button[data-effect='trace']::before");
    expect(ring).toContain('mask-composite: exclude;');
    expect(ring).toContain('pointer-events: none;');
    expect(ring).toContain('conic-gradient(');
    expect(ring).not.toContain('box-shadow');
    expect(ring).not.toContain('filter:');
    // Shown for a mouse (and the keyboard), turned only when motion is welcome.
    expect(mouseOnly).toContain(".tgs-button[data-effect='trace']:focus-visible::before { opacity: 1; }");
    expect(mouseAndMotion).toContain('animation: tgs-trace 1.6s linear infinite;');
    expect(count(css, 'animation: tgs-trace')).toBe(1);
  });

  it('add no --tgs- token of their own, so the block catalogue reads nothing as a colour', () => {
    const slice = css.slice(css.indexOf('THREE MORE UNDER THE POINTER'));
    for (const name of ['mx', 'my', 'rx', 'ry', 'px', 'py', 'trace']) {
      expect(slice).not.toContain(`--tgs-${name}`);
    }
  });
});

// ---------------------------------------------------------------------------
// The script
// ---------------------------------------------------------------------------

describe('tg-motion.js', () => {
  it('tells a card where the pointer is, only for a mouse, and clears it on leave', () => {
    expect(script).toContain('function setUpCardPointer()');
    expect(script).toContain("'[data-hover-spotlight] .tgs-card, [data-hover-tilt] .tgs-card'");
    const fn = script.slice(script.indexOf('function setUpCardPointer()'), script.indexOf('function bindCardPointer('));
    expect(fn).toContain("'(hover: hover) and (pointer: fine)'");
    const bind = script.slice(script.indexOf('function bindCardPointer('), script.indexOf('function setUpMagnets()'));
    for (const name of ['mx', 'my', 'rx', 'ry']) {
      expect(bind).toContain(`card.style.setProperty('--${name}'`);
      expect(bind).toContain(`card.style.removeProperty('--${name}')`);
    }
    // Measured once on entry and again after a scroll, never per move: a tilted card's box moves under every read.
    expect(bind).toContain("card.addEventListener('pointerenter', measure);");
    expect(bind).toContain("window.addEventListener('scroll', function () { box = null; }, { passive: true });");
  });

  it('pulls a magnetic button a few pixels toward the pointer, only for a mouse, and lets it go', () => {
    expect(script).toContain('function setUpMagnets()');
    expect(script).toContain('".tgs-button[data-effect=\'magnetic\']"');
    expect(script).toContain('var MAGNET_REACH = 8;');
    const bind = script.slice(script.indexOf('function bindMagnet('), script.indexOf('function init()'));
    expect(bind).toContain("button.style.setProperty('--px'");
    expect(bind).toContain("button.style.removeProperty('--px'");
  });

  it('runs both from init, after the words, and never at all under reduced motion', () => {
    const init = script.slice(script.indexOf('function init()'));
    expect(init).toContain('setUpCardPointer();');
    expect(init).toContain('setUpMagnets();');
    expect(script.indexOf('if (REDUCED && REDUCED.matches) return;')).toBeLessThan(script.indexOf('function setUpCardPointer()'));
    expect(script).toContain("var VERSION = '1.3.0';");
  });

  it('is pulled onto a page by a spotlight, a tilt or a magnet, and by nothing else new', () => {
    const withSection = (extra: Record<string, unknown>) => ({ sections: [{ id: 'a', rows: [], ...extra }] });
    expect(needsMotionScript(withSection({ hoverSpotlight: true }))).toBe(true);
    expect(needsMotionScript(withSection({ hoverTilt: true }))).toBe(true);
    // The glare is pure CSS.
    expect(needsMotionScript(withSection({ hoverGlare: true }))).toBe(false);
    expect(needsMotionScript(withSection({ hoverLift: true, hoverTint: true }))).toBe(false);

    const withButton = (effect: string, type = 'button') => ({
      sections: [{ id: 'a', rows: [{ columns: [{ blocks: [{ type, props: { effect } }] }] }] }],
    });
    expect(needsMotionScript(withButton('magnetic'))).toBe(true);
    expect(needsMotionScript(withButton('magnetic', 'button-group'))).toBe(true);
    expect(needsMotionScript(withButton('sheen'))).toBe(false);
    expect(needsMotionScript(withButton('trace'))).toBe(false);
    expect(needsMotionScript(withButton('none'))).toBe(false);
    // A magnetic word on some other block type means nothing.
    expect(needsMotionScript(withButton('magnetic', 'heading'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The presets
// ---------------------------------------------------------------------------

describe('the dressed presets', () => {
  it('light the bento, sweep the featured trips, and put a sheen on the turning-word buttons', () => {
    const bento = presetById('features-bento-destinations')!;
    expect(bento.section?.hoverSpotlight).toBe(true);
    expect(buildPresetSection(bento).hoverSpotlight).toBe(true);
    const below = presetById('hero-cards-below')!;
    expect(below.section?.hoverGlare).toBe(true);
    expect(buildPresetSection(below).hoverGlare).toBe(true);
    const turning = presetById('hero-turning-word')!;
    const row = turning.rows[0].columns[0].find((b) => b.type === 'button-group')!;
    expect(row.props?.effect).toBe('sheen');
  });

  it('never build a flag a preset did not ask for', () => {
    const plain = buildPresetSection(presetById('hero-big-title')!);
    expect(plain.hoverSpotlight).toBeUndefined();
    expect(plain.hoverTilt).toBeUndefined();
    expect(plain.hoverGlare).toBeUndefined();
  });
});
