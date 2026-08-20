/**
 * The guardrails on the motion layer (Andy, 20 Aug 2026).
 *
 * Motion is available to EVERY tenant rather than gated to a tier, which is the
 * decision that makes these tests load-bearing rather than tidy. With three
 * designers a style guide would hold the line. With every client self-serving in
 * an editor it will not, so the rules that matter are here, where the build fails,
 * instead of in a document somebody remembers.
 *
 * The catalogue these check against is `references/motion-recipes.md` in the
 * travelgenix-taste skill. Section 12 of that skill is the law and the file is the
 * parts list.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  MOTION_BACKGROUND_RECIPES,
  MOTION_LIVE_RECIPES,
  MOTION_RECIPES,
  MOTION_TIERS,
  parsePage,
  type MotionRecipe,
} from '../lib/content/schema';

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

const css = read('app', 'globals.css');
const render = read('components', 'render', 'PageRenderer.tsx');
const schema = read('lib', 'content', 'schema.ts');
const blocks = read('lib', 'content', 'blocks.ts');

/**
 * The bodies of every `@media (prefers-reduced-motion: no-preference)` block in the
 * stylesheet, brace-matched rather than guessed at.
 *
 * A substring search would happily pass for a rule that merely sits NEAR the guard,
 * which is exactly the bug worth catching: an animation one brace outside the media
 * query runs for a visitor who asked for less motion, and nothing about the file
 * looks wrong.
 */
function reducedMotionBlocks(sheet: string): string {
  const opener = '@media (prefers-reduced-motion: no-preference) {';
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

const guarded = reducedMotionBlocks(css);

/** Build a one-section page carrying a recipe, so parse behaviour is testable. */
function pageWithMotion(motion: unknown) {
  return parsePage({
    version: 1,
    id: 'p',
    slug: 'motion',
    title: 'Motion',
    sections: [{ id: 'a', tone: 'light', width: 'contained', motion, rows: [] }],
  });
}

function motionOf(motion: unknown) {
  const parsed = pageWithMotion(motion);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error('page did not parse');
  return parsed.page.sections[0].motion;
}

describe('the reduced-motion guard, which is the one nothing may skip', () => {
  it('found some guarded blocks, so the checks below are not passing over an empty string', () => {
    expect(guarded.length).toBeGreaterThan(200);
    expect(guarded).toContain('data-motion');
  });

  /*
   * GUARDRAIL: any recipe without a reduced-motion path fails the build.
   *
   * Reduced motion is a second designed page, never an animation switched off, so
   * the shape that passes here is the animation living INSIDE the guard. A visitor
   * who asks for less then gets the picture sitting still and full-bleed, which is
   * a finished page rather than a broken one.
   */
  it.each([...MOTION_LIVE_RECIPES])('recipe %s only animates behind prefers-reduced-motion', (recipe) => {
    const selector = `[data-motion='${recipe}']`;
    expect(css).toContain(selector);

    // Every rule that actually starts an animation for this recipe must be guarded.
    const animating = css
      .split('}')
      .filter((rule) => rule.includes(selector) && /\banimation:/.test(rule));
    expect(animating.length).toBeGreaterThan(0);
    for (const rule of animating) {
      const head = rule.slice(rule.indexOf(selector));
      expect(guarded, `${recipe} animates outside the reduced-motion guard: ${head.slice(0, 80)}`)
        .toContain(head.slice(0, 40));
    }
  });

  it('every live recipe is paced by time, never by a frame counter', () => {
    // Lesson 3 in the catalogue: anything advanced by a fixed step per frame runs
    // slow on a weak GPU and the timing drifts visibly. A CSS duration cannot.
    for (const recipe of MOTION_LIVE_RECIPES) {
      const rules = css.split('}').filter((r) => r.includes(`[data-motion='${recipe}']`));
      const animation = rules.find((r) => /\banimation:/.test(r)) ?? '';
      expect(animation, `${recipe} has no animation at all`).not.toBe('');

      // The duration may be written inline or come from an intensity band, since a
      // band moves amplitude and duration together. Either way it must RESOLVE to a
      // time: an animation whose duration variable is never declared has no duration
      // and simply never runs, which is a stopped page that still looks correct here.
      const inline = /animation:[^;]*?\d+m?s/.test(animation);
      const fromVar = animation.match(/animation:[^;]*?var\((--[\w-]+)/);
      if (!inline) {
        expect(fromVar, `${recipe} has neither a literal duration nor one from a band`).toBeTruthy();
        const declared = rules.some((r) => new RegExp(`${fromVar?.[1]}:\\s*\\d+m?s`).test(r));
        expect(declared, `${recipe} takes its duration from ${fromVar?.[1]}, which is never set`)
          .toBe(true);
      }
    }
  });
});

describe('the recipe vocabulary is closed, so nothing unknown reaches the page', () => {
  it('refuses a recipe that is not in the catalogue', () => {
    expect(motionOf({ recipe: 'A9' })).toBeUndefined();
    expect(motionOf({ recipe: 'drop-tables' })).toBeUndefined();
    expect(motionOf({ recipe: '<script>' })).toBeUndefined();
  });

  it("treats 'none' and a malformed value as no motion at all, so the section keeps its shape", () => {
    expect(motionOf({ recipe: 'none' })).toBeUndefined();
    expect(motionOf(undefined)).toBeUndefined();
    expect(motionOf(null)).toBeUndefined();
    expect(motionOf('A5')).toBeUndefined();
    expect(motionOf(42)).toBeUndefined();
    expect(motionOf({})).toBeUndefined();
  });

  it('keeps a known recipe and defaults its intensity to the middle band', () => {
    expect(motionOf({ recipe: 'A5' })).toEqual({ recipe: 'A5', intensity: 2 });
    expect(motionOf({ recipe: 'A6', intensity: 3 })).toEqual({ recipe: 'A6', intensity: 3 });
  });

  it('clamps intensity into the three bands rather than refusing the recipe', () => {
    // A band, never an on and off switch: out of range lands on an end, not on nothing.
    expect(motionOf({ recipe: 'A5', intensity: 0 })).toEqual({ recipe: 'A5', intensity: 1 });
    expect(motionOf({ recipe: 'A5', intensity: 99 })).toEqual({ recipe: 'A5', intensity: 3 });
    expect(motionOf({ recipe: 'A5', intensity: 2.4 })).toEqual({ recipe: 'A5', intensity: 2 });
    expect(motionOf({ recipe: 'A5', intensity: 'loud' })).toEqual({ recipe: 'A5', intensity: 2 });
    expect(motionOf({ recipe: 'A5', intensity: '3' })).toEqual({ recipe: 'A5', intensity: 3 });
  });

  it('is optional, so a section without it round trips unchanged', () => {
    expect(schema).toContain('motion: z.unknown().transform(normaliseMotion).optional()');
    const parsed = parsePage({
      version: 1,
      id: 'p',
      slug: 'plain',
      title: 'Plain',
      sections: [{ id: 'a', tone: 'light', width: 'contained', rows: [] }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.page.sections[0].motion).toBeUndefined();
  });
});

describe('only a recipe with a render behind it reaches the DOM', () => {
  it('every live recipe is a real recipe, and there is at least one', () => {
    expect(MOTION_LIVE_RECIPES.size).toBeGreaterThan(0);
    for (const recipe of MOTION_LIVE_RECIPES) {
      expect(MOTION_RECIPES).toContain(recipe);
      expect(recipe).not.toBe('none');
    }
  });

  it('the render gates data-motion on the live set, not on the whole enum', () => {
    // Storing A2 must not put data-motion="A2" on a section the stylesheet ignores:
    // an attribute in the DOM should always mean something is really moving.
    expect(render).toContain('MOTION_LIVE_RECIPES.has(recipe)');
    expect(render).toContain('data-motion={motion}');
  });

  it('keeps motion off the editor canvas, like every other movement here', () => {
    // The canvas re-renders on every keystroke, so a drifting picture would fight
    // selecting it. Same `editable` gate the reveal, the hover and the parallax use.
    expect(render).toContain('section.motion && !editable');
  });
});

describe('one thing moves the background picture, never three', () => {
  /*
   * globals.css has said since 13 Aug 2026 that Ken Burns and the parallax must not
   * both be set, "since both move the one picture". A background recipe is a third
   * claimant for that element, so the rule is that the recipe wins and the two
   * booleans stand down.
   */
  it('names the background recipes, and A5 is not one of them', () => {
    expect(MOTION_BACKGROUND_RECIPES.has('A6')).toBe(true);
    // A5 moves the pictures INSIDE the section, so it composes with parallax and
    // Ken Burns instead of fighting them.
    expect(MOTION_BACKGROUND_RECIPES.has('A5')).toBe(false);
  });

  it('stands parallax and Ken Burns down when a recipe owns the background', () => {
    expect(render).toContain(
      'const motionOwnsBackground = Boolean(motion && MOTION_BACKGROUND_RECIPES.has(motion));',
    );
    expect(render).toContain('section.parallax && stillBackground && !motionOwnsBackground');
    expect(render).toContain('section.kenBurns && stillBackground && !motionOwnsBackground');
  });

  it('requires a still background picture for a background recipe, as the others do', () => {
    expect(render).toContain('const stillBackground = Boolean(background) && !bgShow && !video;');
    expect(render).toContain('MOTION_BACKGROUND_RECIPES.has(recipe) ? stillBackground : true');
  });

  it('leaves the Ken Burns rules exactly as they were, so nothing published changes', () => {
    expect(css).toContain('animation: tgs-ken-burns 24s ease-in-out infinite alternate;');
    expect(css).toContain('@keyframes tgs-ken-burns');
  });
});

describe('the cost of a recipe is declared, so a page budget can be held', () => {
  it('gives every recipe in the vocabulary a tier', () => {
    for (const recipe of MOTION_RECIPES) {
      expect(MOTION_TIERS[recipe], `${recipe} has no tier`).toBeTypeOf('number');
      expect([0, 1, 2]).toContain(MOTION_TIERS[recipe]);
    }
  });

  /*
   * GUARDRAIL: no more than one tier-2 (WebGL) block on a page.
   *
   * Today that cap cannot be breached from here, because no recipe a SECTION can
   * carry is tier 2: A1 ambient-terrain is deliberately outside this enum and will
   * arrive on the hero-cinematic block instead. This test holds that precondition,
   * so adding a WebGL recipe to the section vocabulary fails here and the real
   * per-page cap has to be written at the same time.
   */
  it('has no WebGL recipe in the section vocabulary, so the one-per-page cap cannot be breached yet', () => {
    const webgl = MOTION_RECIPES.filter((r) => MOTION_TIERS[r] === 2);
    expect(
      webgl,
      'a tier-2 recipe reached the section enum: write the one-per-page cap before shipping it',
    ).toEqual([]);
    expect(MOTION_RECIPES).not.toContain('A1' as MotionRecipe);
  });

  it('keeps every live recipe at tier 0, so a page using one still ships no script', () => {
    // Clause 1 of the rule in lib/content/blocks.ts: a page that asks for nothing
    // ships nothing. Both built recipes are pure CSS, so today that stays true of
    // every page, whether it moves or not.
    for (const recipe of MOTION_LIVE_RECIPES) {
      expect(MOTION_TIERS[recipe], `${recipe} is live but is not tier 0`).toBe(0);
    }
    expect(render).not.toContain('tg-motion.js');
  });
});

describe('motion never reaches a page that is not a homepage or a landing page', () => {
  /*
   * GUARDRAIL: no recipe on a search, results, checkout or account screen. Rule 3 of
   * section 12: "it belongs in the block registry and in a test that fails the build,
   * because a rule in a document gets forgotten."
   *
   * Today it holds structurally rather than by filtering. The search results page is
   * its own component and does not render stored sections at all, and this CMS has
   * no checkout or account screens to reach (PRODUCT.md, 17 Aug 2026: no billing and
   * no self-serve onboarding). So the test to write now is the one that fails if the
   * search page is ever refactored onto the page renderer.
   */
  it('builds the search results page without the section renderer, so no recipe can land on it', () => {
    const results = read('components', 'render', 'SearchResults.tsx');
    expect(results).not.toContain('PageRenderer');
    expect(results).not.toContain('data-motion');
    expect(results).not.toContain('motion');
  });

  it('carries no checkout or account template for a recipe to reach', () => {
    const templates = read('lib', 'content', 'page-templates.ts');
    for (const forbidden of ['checkout', 'basket', 'account', 'my-account']) {
      expect(templates.toLowerCase()).not.toContain(`'${forbidden}'`);
    }
  });
});

describe('the rule the whole page still keeps', () => {
  it('states the four clauses that replaced the no-JavaScript ban', () => {
    // The canonical statement. If this heading moves, PRODUCT.md points at nothing.
    expect(blocks).toContain('THE PAGE WORKS BEFORE ANY SCRIPT RUNS');
    expect(blocks).toContain('A PAGE THAT ASKS FOR NOTHING SHIPS NOTHING');
    expect(blocks).toContain('THE CONTENT NEVER DEPENDS ON A SCRIPT');
    expect(blocks).toContain('OURS, HAND-WRITTEN, NO LIBRARIES');
    expect(blocks).toContain('A NAMED COST AND A PAGE BUDGET');
  });

  it('still refuses a third-party animation player, now on clause 3 rather than the ban', () => {
    expect(blocks).toContain('STILL DECIDED AGAINST: LOTTIE');
    for (const library of ['gsap', 'lenis', 'three.js']) {
      expect(blocks.toLowerCase()).toContain(library);
    }
  });
});
