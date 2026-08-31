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
  MOTION_ARRIVAL_RECIPES,
  MOTION_SCRIPT_RECIPES,
  MOTION_VIDEO_RECIPES,
  MOTION_BACKGROUND_RECIPES,
  MOTION_CYCLING_RECIPES,
  MOTION_LIVE_RECIPES,
  MOTION_RECIPES,
  MOTION_SEA_RECIPES,
  MOTION_TIERS,
  parsePage,
  sectionCardCount,
  sectionMotionGaps,
  SEA_TONES,
  type MotionRecipe,
} from '../lib/content/schema';
import { MOTION_CHOICES, MOTION_INTENSITIES, SEA_TONE_PRESETS } from '../lib/content/styles';
import { needsMotionScript, needsSeaScript } from '../lib/content/motion';
import { presetById } from '../lib/content/presets';
import { buildStarterPage, STARTERS, type StarterFacts } from '../lib/content/starters';

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

/*
 * The stylesheet with its COMMENTS STRIPPED, and that is not tidiness.
 *
 * "A source-text assertion must strip comments first, or it reads the prose
 * explaining a bug as the bug" is already written down in this project's decisions,
 * and it caught this file on 20 Aug 2026: the guard below looked for `position:
 * sticky` and found it in the paragraph EXPLAINING that S3 uses position sticky,
 * then reported the comment as an unguarded rule. Brace matching has the same
 * problem, since a comment is free to contain a brace and throw the depth count.
 *
 * So every structural check reads this, and only the prose-free version.
 */
const css = read('app', 'globals.css').replace(/\/\*[\s\S]*?\*\//g, '');
const render = read('components', 'render', 'PageRenderer.tsx');
const schema = read('lib', 'content', 'schema.ts');
const blocks = read('lib', 'content', 'blocks.ts');
const motionScript = read('public', 'tg-motion.js');
const seaScript = read('public', 'tg-sea.js');

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
  it.each([...MOTION_LIVE_RECIPES])('recipe %s only moves behind prefers-reduced-motion', (recipe) => {
    /*
     * A VIDEO RECIPE'S MOVEMENT IS THE FILM, so it has neither a keyframe nor a
     * script to guard, and no rule of its own in the stylesheet either: it works
     * through the render and the generic background-video rule. Two things have to
     * hold for it instead. The stylesheet hides it, and the render never even
     * fetches it. Hidden is not the same as not fetched, and the second is the one
     * worth having.
     */
    if (MOTION_VIDEO_RECIPES.has(recipe)) {
      expect(
        css.includes('.tgs-section__bg--video { display: none; }'),
        `${recipe} plays a film that reduced motion does not hide`,
      ).toBe(true);
      expect(
        render.includes('media="(prefers-reduced-motion: no-preference)"'),
        `${recipe} still downloads its film for a visitor who asked for less motion`,
      ).toBe(true);
      return;
    }

    /* Everything else styles itself, so it must have a rule keyed on the recipe. */
    const selector = `[data-motion='${recipe}']`;
    expect(css).toContain(selector);

    /*
     * MOVEMENT IS NOT ALWAYS AN ANIMATION. This test only looked for `animation:`
     * until S3 sticky-stack arrived, which moves nothing and animates nothing: it
     * pins cards with `position: sticky` and lets the scroll do the work. A guard
     * that only knows about keyframes would have waved it straight through with no
     * reduced-motion path at all, so it asks about every way this stylesheet has of
     * making a section move.
     */
    const moving = css
      .split('}')
      .filter((rule) => rule.includes(selector) && /\banimation:|position:\s*sticky/.test(rule));

    /*
     * A SCRIPT-DRIVEN RECIPE KEEPS ITS GUARD IN THE SCRIPT. A3 moves nothing from the
     * stylesheet at all: its CSS is a plain scroll-snap carousel that is welcome under
     * reduced motion, and the drift that is not welcome lives in tg-motion.js, which
     * has to refuse to start. Looking only in the stylesheet would have passed it
     * while the drift ran for everybody.
     */
    if (MOTION_SCRIPT_RECIPES.has(recipe)) {
      expect(
        /prefers-reduced-motion:\s*reduce/.test(motionScript),
        `${recipe} is script-driven but tg-motion.js never asks about reduced motion`,
      ).toBe(true);
      expect(
        /matches\)\s*return/.test(motionScript),
        `${recipe}'s script checks reduced motion but does not bail on it`,
      ).toBe(true);
      return;
    }

    /*
     * THE WEBGL SEA KEEPS ITS GUARD IN ITS OWN SCRIPT. A1 draws from a shader, not the
     * stylesheet, so like A3 there is no keyframe to sit inside the media query; tg-sea.js
     * must refuse to create a canvas at all under reduced motion, which is a stronger
     * guarantee than hiding one (no GPU work happens either).
     */
    if (MOTION_SEA_RECIPES.has(recipe)) {
      expect(
        /prefers-reduced-motion:\s*reduce/.test(seaScript),
        `${recipe} is the WebGL sea but tg-sea.js never asks about reduced motion`,
      ).toBe(true);
      expect(
        /matches\)\s*return/.test(seaScript),
        `${recipe}'s script checks reduced motion but does not bail on it`,
      ).toBe(true);
      return;
    }

    expect(moving.length, `${recipe} has no rule that makes anything move`).toBeGreaterThan(0);
    for (const rule of moving) {
      const head = rule.slice(rule.indexOf(selector));
      expect(guarded, `${recipe} moves outside the reduced-motion guard: ${head.slice(0, 80)}`)
        .toContain(head.slice(0, 40));
    }
  });

  it('no live recipe is paced by a frame counter', () => {
    /*
     * Lesson 3 in the catalogue: anything advanced by a fixed step per frame runs slow
     * on a weak GPU and the timing drifts visibly where you can see it.
     *
     * There are three honest ways to pace a recipe here and none of them can drift: a
     * CSS duration in seconds, a view() timeline driven by scroll position, or nothing
     * at all because the recipe is `position: sticky` and the browser is doing the
     * work. What this rules out is a fourth way, a script counting frames, which is
     * why it also checks no live recipe has brought a script with it.
     */
    for (const recipe of MOTION_LIVE_RECIPES) {
      const rules = css.split('}').filter((r) => r.includes(`[data-motion='${recipe}']`));
      const animation = rules.find((r) => /\banimation:/.test(r)) ?? '';
      const sticky = rules.some((r) => /position:\s*sticky/.test(r));

      if (MOTION_VIDEO_RECIPES.has(recipe)) {
        // Paced by the file. There is no counter here to drift.
        continue;
      }

      if (MOTION_SCRIPT_RECIPES.has(recipe)) {
        // The script's own pacing. A phase read from the frame timestamp cannot drift
        // on a slow machine; one advanced by a fixed step per frame is lesson 3.
        expect(
          /requestAnimationFrame/.test(motionScript),
          `${recipe} is script-driven but runs no frame loop`,
        ).toBe(true);
        expect(
          /now - start/.test(motionScript),
          `${recipe}'s script does not derive its phase from elapsed time`,
        ).toBe(true);
        continue;
      }

      if (MOTION_SEA_RECIPES.has(recipe)) {
        // The sea's wave phase is read from the frame timestamp (now - t0), not a
        // per-frame step, so a slow GPU shows a coarser sea at the right speed.
        expect(/requestAnimationFrame/.test(seaScript), `${recipe} runs no frame loop`).toBe(true);
        expect(
          /now - t0/.test(seaScript),
          `${recipe}'s script does not derive its phase from elapsed time`,
        ).toBe(true);
        continue;
      }

      if (!animation) {
        expect(sticky, `${recipe} neither animates nor sticks, so nothing moves`).toBe(true);
        continue;
      }

      /*
       * Scroll-steered: paced by where the section sits, so it needs no duration and
       * must not pretend to have one. A seconds value on a view() timeline is simply
       * ignored, so leaving one in the shorthand tells the next reader the animation
       * lasts a time it does not.
       *
       * It is NOT required to name a range. The default is the section's whole travel
       * across the viewport, which is right for a continuous offset and is exactly
       * what the parallax has done since 11 Aug 2026. An earlier version of this test
       * demanded a range and failed A4 for matching the house pattern.
       */
      // Scroll-steered off a view timeline, anonymous view() or a named one (S2 pins the
      // section and drives its cards off the section's own --tgs-s2 view-timeline). Either
      // way it is paced by scroll, so a duration in the shorthand is ignored and misleads.
      if (rules.some((r) => /animation-timeline:\s*(view\(\)|--[\w-]+)/.test(r))) {
        expect(
          /animation:[^;]*?\d+m?s/.test(animation),
          `${recipe} is scroll-steered but carries a duration, which is ignored and misleads`,
        ).toBe(false);
        continue;
      }

      // Time-based: the duration may be inline or come from an intensity band, since a
      // band moves amplitude and duration together. Either way it must RESOLVE to a
      // time. An animation whose duration variable is never declared computes to 0s
      // and simply never runs, which is a stopped page that still looks right here.
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
    expect(render).toContain('if (MOTION_BACKGROUND_RECIPES.has(r)) return stillBackground;');
  });

  it('asks the opposite of A2, which is a sequence and is inert on one picture', () => {
    // Same shape of guard, opposite condition: A6 and S5 drive the one still
    // picture, A2 IS the cycling set and has nothing to do without it.
    expect(MOTION_CYCLING_RECIPES.has('A2')).toBe(true);
    expect(render).toContain('if (MOTION_CYCLING_RECIPES.has(r)) return bgShow;');
  });

  it('keeps every cycling recipe inside the background set, so the two rules agree', () => {
    for (const recipe of MOTION_CYCLING_RECIPES) {
      expect(
        MOTION_BACKGROUND_RECIPES.has(recipe),
        `${recipe} wants the cycling background but is not a background recipe`,
      ).toBe(true);
    }
  });

  it('runs Ken Burns fast enough to be seen, retuned 30 Aug 2026', () => {
    // Was 24s, at which the drift was below the eye's threshold and read as a
    // still. 18s is still the calmest ambient move but visibly drifting on load.
    expect(css).toContain('animation: tgs-ken-burns 18s ease-in-out infinite alternate;');
    expect(css).toContain('@keyframes tgs-ken-burns');
  });

  it('the always-on ambient recipes move perceptibly, not at the old sub-threshold rate', () => {
    // A6 measured 0.075% of movement over 1.5s at 26s; now 16s at the medium band
    // with a wider pan. A5's frames likewise run at 16s, not 26s.
    expect(css).toContain('--tgs-motion-duration: 16s;');
    expect(css).toContain('animation: tgs-motion-slow-frame 16s ease-in-out infinite alternate;');
    // The drift actually pans across the scene now, not a near-still zoom.
    expect(css).toContain('transform: scale(var(--tgs-motion-to)) translate(-6%, -4%);');
  });

  it('the editor tells the client motion is paused while editing, so it is not "broken"', () => {
    const props = readFileSync(join(__dirname, '..', 'components', 'editor', 'Properties.tsx'), 'utf8');
    expect(props).toContain('Movement is paused while you edit');
    expect(props).toContain('Press the eye');
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
   * GUARDRAIL: no more than one tier-2 (WebGL) canvas on a page.
   *
   * A1 the cinematic sea is the one tier-2 section recipe (31 Aug 2026). The cap that
   * used to be kept by holding A1 out of the enum entirely is now kept by the script:
   * tg-sea.js animates the FIRST [data-motion='A1'] section on a page and leaves any
   * other on its still photograph. So this checks two things: A1 is the ONLY tier-2
   * recipe, and the script really takes just the first rather than looping every match.
   */
  it('caps the one WebGL recipe at a single canvas per page, in the script', () => {
    const webgl = MOTION_RECIPES.filter((r) => MOTION_TIERS[r] === 2);
    expect(webgl, 'a second tier-2 recipe would need its own per-page accounting').toEqual(['A1']);
    expect(seaScript).toContain("data-motion='A1'");
    expect(seaScript).toContain('querySelector(');
    expect(seaScript, 'the cap must take the first A1 section only, never loop all of them')
      .not.toContain('querySelectorAll');
  });

  it('only a recipe that really needs a script is rated above tier 0', () => {
    /*
     * Clause 1 of the rule in lib/content/blocks.ts: a page that asks for nothing
     * ships nothing. This is where that promise is kept or quietly lost, so the two
     * lists have to agree exactly. A recipe rated tier 1 that is not in the script set
     * would be paying a cost nothing collects; one in the script set rated tier 0
     * would be putting a script on a page while claiming to be free.
     */
    for (const recipe of MOTION_LIVE_RECIPES) {
      // Either script counts: the DOM-nudging tg-motion.js (A3) or the WebGL tg-sea.js
      // (A1). A recipe that pulls either is not free and must be rated above tier 0.
      const needsScript = MOTION_SCRIPT_RECIPES.has(recipe) || MOTION_SEA_RECIPES.has(recipe);
      expect(
        MOTION_TIERS[recipe] > 0,
        needsScript
          ? `${recipe} ships a script but is rated tier 0`
          : `${recipe} is rated above tier 0 but needs no script`,
      ).toBe(needsScript);
    }
  });

  it('keeps the script set as small as it can be', () => {
    // Four recipes were expected to need a script and turned out not to. The list is
    // meant to stay short, so this notices if it starts growing.
    expect(MOTION_SCRIPT_RECIPES.size).toBeLessThanOrEqual(2);
    for (const recipe of MOTION_SCRIPT_RECIPES) {
      expect(MOTION_LIVE_RECIPES.has(recipe), `${recipe} needs a script but renders nothing`).toBe(true);
    }
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

describe('the client can change what the default gave them', () => {
  const properties = read('components', 'editor', 'Properties.tsx');

  it('offers every live recipe and nothing that does not render', () => {
    // A picker offering A2 would be promising motion the stylesheet does not have.
    const offered = MOTION_CHOICES.map((c) => c.value).filter((v) => v !== 'none');
    expect([...offered].sort()).toEqual([...MOTION_LIVE_RECIPES].sort());
  });

  it('offers all three intensity bands, and none of them is off', () => {
    expect(MOTION_INTENSITIES.map((b) => b.value)).toEqual([1, 2, 3]);
    for (const band of MOTION_INTENSITIES) {
      expect(band.label.toLowerCase()).not.toBe('none');
      expect(band.label.toLowerCase()).not.toBe('off');
    }
  });

  it('names recipes in plain words, never by their catalogue code', () => {
    // A travel agent should not have to know that A6 is ambient-drift.
    for (const choice of MOTION_CHOICES) {
      expect(choice.label).not.toMatch(/^[AS]\d$/);
      expect(choice.label).not.toContain('A5');
      expect(choice.label).not.toContain('A6');
    }
  });

  it('lets a recipe be cleared back to nothing', () => {
    expect(properties).toContain("if (!recipe || recipe === 'none')");
    expect(properties).toContain('set({ motion: undefined }');
  });

  it('clears parallax and Ken Burns when a background recipe is picked', () => {
    // The editor's state has to agree with the render's resolution rule, or a client
    // sees two background motions ticked and only one of them doing anything.
    expect(properties).toContain('MOTION_BACKGROUND_RECIPES.has(recipe satisfies MotionRecipe)');
    expect(properties).toContain('ownsBackground ? { parallax: undefined, kenBurns: undefined } : {}');
    // And the same for the blocks arriving, which S1 takes over from the reveal.
    expect(properties).toContain('MOTION_ARRIVAL_RECIPES.has(recipe satisfies MotionRecipe)');
    expect(properties).toContain('ownsArrival ? { reveal: undefined, revealStagger: undefined } : {}');
  });

  it('narrows the picked value against its own list rather than casting it', () => {
    expect(properties).toContain("MOTION_CHOICES.find((c) => c.value === event.target.value)?.value");
    expect(properties).toContain(
      'MOTION_INTENSITIES.find((b) => String(b.value) === event.target.value)?.value',
    );
  });
});

describe('a new site moves out of the box', () => {
  const EMPTY: StarterFacts = { company: '', town: '', about: '' };

  /** Every section of every page a starter builds, with its recipe if it has one. */
  async function sectionsOf(starterId: string) {
    const starter = STARTERS.find((s) => s.id === starterId);
    expect(starter, `no starter ${starterId}`).toBeTruthy();
    const pages = await Promise.all((starter?.pages ?? []).map((p) => buildStarterPage(p, EMPTY)));
    return pages.flatMap((page) => page.sections);
  }

  it.each(['agency', 'onepage'])('starter %s builds a site that moves', async (id) => {
    const moving = (await sectionsOf(id)).filter((s) => s.motion);
    expect(moving.length, 'a starter site that never moves is the old default').toBeGreaterThan(0);
  });

  it('only ever defaults a background recipe onto a section that gets a picture', () => {
    /*
     * A6 drives the section background, so on a section with no picture it is inert.
     * The URL is not there to check at this point on purpose: a starter names a photo
     * QUERY and photo-plan.ts resolves it into the client's own media in a later pass,
     * so the guarantee worth holding is that the section will be given one, which is
     * the preset's backgroundQuery or the starter's own photo override.
     */
    for (const starter of STARTERS) {
      for (const page of starter.pages) {
        for (const spec of page.sections) {
          if (!spec.motion || !MOTION_BACKGROUND_RECIPES.has(spec.motion.recipe)) continue;
          const preset = presetById(spec.preset);
          const getsAPicture = Boolean(spec.photo?.trim() || preset?.section?.backgroundQuery);
          expect(
            getsAPicture,
            `${starter.id}/${page.slug || 'home'} puts ${spec.motion.recipe} on `
            + `${spec.preset}, which never gets a background picture, so nothing would move`,
          ).toBe(true);
        }
      }
    }
  });

  it('opens both base starters on a drifting hero', () => {
    for (const id of ['agency', 'onepage']) {
      const starter = STARTERS.find((s) => s.id === id);
      const home = starter?.pages.find((p) => p.slug === '');
      const hero = home?.sections[0];
      expect(hero?.motion?.recipe, `${id} does not open on a drifting picture`).toBe('A6');
    }
  });

  it('never defaults a recipe that has no render behind it', async () => {
    for (const id of ['agency', 'onepage']) {
      for (const section of await sectionsOf(id)) {
        if (!section.motion) continue;
        expect(
          MOTION_LIVE_RECIPES.has(section.motion.recipe),
          `${id} defaults ${section.motion.recipe}, which draws nothing`,
        ).toBe(true);
      }
    }
  });

  it('keeps every default at tier 0, so a starter site still ships no script', async () => {
    for (const id of ['agency', 'onepage']) {
      for (const section of await sectionsOf(id)) {
        if (!section.motion) continue;
        expect(MOTION_TIERS[section.motion.recipe]).toBe(0);
      }
    }
  });

  it('never puts two background recipes on one page, or a recipe beside Ken Burns', async () => {
    for (const starter of STARTERS) {
      for (const spec of starter.pages) {
        const page = await buildStarterPage(spec, EMPTY);
        const backgrounds = page.sections.filter(
          (s) => s.motion && MOTION_BACKGROUND_RECIPES.has(s.motion.recipe),
        );
        expect(
          backgrounds.length,
          `${starter.id}/${spec.slug || 'home'} has ${backgrounds.length} background recipes`,
        ).toBeLessThanOrEqual(1);

        for (const section of page.sections) {
          if (!section.motion || !MOTION_BACKGROUND_RECIPES.has(section.motion.recipe)) continue;
          expect(section.parallax, 'a recipe and parallax both claim the background').toBeFalsy();
          expect(section.kenBurns, 'a recipe and Ken Burns both claim the background').toBeFalsy();
        }
      }
    }
  });

  it('leaves the designed homes alone, because each is a look somebody chose', async () => {
    const designed = STARTERS.filter((s) => s.id.startsWith('design-'));
    expect(designed.length).toBeGreaterThan(0);
    for (const starter of designed) {
      const home = starter.pages.find((p) => p.slug === '');
      expect(home, `${starter.id} has no home`).toBeTruthy();
      const page = await buildStarterPage(home!, EMPTY);
      const moved = page.sections.filter((s) => s.motion);
      expect(moved, `${starter.id}'s designed home was given motion it did not ask for`).toEqual([]);
    }
  });
});

describe('one thing animates the blocks arriving, never two', () => {
  /*
   * The second resolution rule. The reveal has animated blocks into view since
   * 11 Aug 2026 and S1 tide-reveal wants the same elements, so the recipe takes them
   * and the reveal stands down. Exactly the shape of the background rule, because it
   * is exactly the same kind of collision.
   */
  it('names S1 as an arrival recipe and keeps the background ones out of it', () => {
    expect(MOTION_ARRIVAL_RECIPES.has('S1')).toBe(true);
    for (const recipe of MOTION_ARRIVAL_RECIPES) {
      expect(
        MOTION_BACKGROUND_RECIPES.has(recipe),
        `${recipe} claims both the background and the blocks, so the two rules disagree`,
      ).toBe(false);
    }
  });

  it('stands the reveal and its stagger down when a recipe owns the arrival', () => {
    expect(render).toContain(
      'const motionOwnsArrival = Boolean(motion && MOTION_ARRIVAL_RECIPES.has(motion));',
    );
    expect(render).toContain('section.reveal && !motionOwnsArrival && !editable');
    expect(render).toContain('section.revealStagger && !motionOwnsArrival && !editable');
  });

  it('every arrival recipe is a live one, so the reveal is never stood down for nothing', () => {
    // Standing the reveal down for a recipe that draws nothing would leave the
    // section with no arrival at all, which is worse than either option.
    for (const recipe of MOTION_ARRIVAL_RECIPES) {
      expect(MOTION_LIVE_RECIPES.has(recipe), `${recipe} owns arrival but renders nothing`).toBe(true);
    }
  });
});

describe('the scroll-steered recipes are cheaper here than the catalogue expects', () => {
  it('rates S1 and S5 tier 0, because this stylesheet steers on scroll in pure CSS', () => {
    expect(MOTION_TIERS.S1).toBe(0);
    expect(MOTION_TIERS.S5).toBe(0);
    expect(MOTION_TIERS.S3).toBe(0);
  });

  it('drives them from a view() timeline rather than a scroll listener', () => {
    for (const recipe of ['S1', 'S5'] as const) {
      const rules = css.split('}').filter((r) => r.includes(`[data-motion='${recipe}']`));
      expect(
        rules.some((r) => /animation-timeline:\s*view\(\)/.test(r)),
        `${recipe} is rated tier 0 but does not use a view() timeline`,
      ).toBe(true);
    }
  });

  it('pads S1 against the descender trap and takes the padding back out of the layout', () => {
    // Lesson 2 in the catalogue: a mask plus tight display type eats the tails of
    // g, q and y. Verified for real in tools/verify-motion-recipes.mjs; this holds
    // the shape of the fix so it cannot be tidied away.
    const rules = css.split('}').filter((r) => r.includes("[data-motion='S1']"));
    const padded = rules.find((r) => /padding-bottom:/.test(r)) ?? '';
    expect(padded, 'S1 has no descender padding').not.toBe('');
    expect(padded).toMatch(/margin-bottom:\s*-/);
  });

  it('keeps S3 free of any clip, since a clipped ancestor stops sticky working', () => {
    const rules = css.split('}').filter((r) => r.includes("[data-motion='S3']"));
    for (const rule of rules) {
      expect(rule, 'S3 clips something, which would break the pinning').not.toMatch(
        /overflow:\s*(hidden|clip|auto|scroll)/,
      );
    }
  });
});

describe('the script only reaches a page that actually needs it', () => {
  const emitter = read('components', 'render', 'MotionScript.tsx');

  /** A one-section page carrying a recipe, in the shape the routes hand the walker. */
  const pageWith = (recipe: string) => ({
    sections: [{ id: 'a', motion: { recipe, intensity: 2 } }],
  });

  it('asks for the script for a script-driven recipe', () => {
    for (const recipe of MOTION_SCRIPT_RECIPES) {
      expect(needsMotionScript(pageWith(recipe)), `${recipe} needs a script but asks for none`).toBe(true);
    }
  });

  it('asks for nothing for every CSS recipe, which is most of them', () => {
    // The whole no-script promise for the common case. A drifting background, a
    // breathing picture, a wiping heading and a stacking card all ship zero bytes.
    for (const recipe of MOTION_LIVE_RECIPES) {
      if (MOTION_SCRIPT_RECIPES.has(recipe)) continue;
      expect(
        needsMotionScript(pageWith(recipe)),
        `${recipe} is pure CSS but drags tg-motion.js onto the page`,
      ).toBe(false);
    }
  });

  it('asks for nothing for a page with no motion at all', () => {
    expect(needsMotionScript({ sections: [{ id: 'a' }] })).toBe(false);
    expect(needsMotionScript({ sections: [] })).toBe(false);
    expect(needsMotionScript(null)).toBe(false);
    expect(needsMotionScript(undefined)).toBe(false);
    // Stored JSON is not always the shape we hope for.
    expect(needsMotionScript({ sections: 'nonsense' as unknown as [] })).toBe(false);
    expect(needsMotionScript({ sections: [null, 7, { motion: 'A3' }] as unknown as [] })).toBe(false);
  });

  it('renders nothing at all rather than an empty tag when no tree needs it', () => {
    // Neither the DOM script nor the sea: the component is null, not an empty fragment.
    expect(emitter).toContain('if (!motion && !sea) return null;');
  });

  it('is emitted once per document, from the routes that assemble one', () => {
    // Same reason as the widgets and the slideshow: three trees each emitting their
    // own tag would fetch the one file three times.
    const site = read('app', 'site', '[host]', '[[...path]]', 'page.tsx');
    const preview = read('app', 'preview', '[[...path]]', 'page.tsx');
    expect(site).toContain('<MotionScript');
    expect(preview).toContain('<MotionScript');
  });

  it('never reaches the editor canvas, which runs no page script', () => {
    const editorCanvas = read('components', 'editor', 'Canvas.tsx');
    expect(editorCanvas).not.toContain('MotionScript');
  });
});

describe('the rail works before the script does', () => {
  it('is a native scroll-snap carousel in CSS, so a blocked script costs only the drift', () => {
    // Clause 2: the content never depends on a script. A track that needed
    // tg-motion.js to be reachable would hide cards from anyone it failed for.
    const rules = css.split('}').filter((r) => r.includes("[data-motion='A3']"));
    const track = rules.find((r) => /overflow-x:\s*auto/.test(r)) ?? '';
    expect(track, 'the A3 rail is not scrollable on its own').not.toBe('');
    expect(rules.some((r) => /scroll-snap-type/.test(r))).toBe(true);
    expect(rules.some((r) => /scroll-snap-align/.test(r))).toBe(true);
  });

  it('drives the real scroll position rather than transforming the track away', () => {
    // A transform would slide the cards under a viewport nobody can steer, so the
    // script would have to reimplement dragging, snapping and keyboard access.
    expect(motionScript).toContain('scrollLeft');
    expect(motionScript).not.toMatch(/style\.transform\s*=/);
  });

  it('stops for a pointer, for focus, and for a hidden tab', () => {
    // Auto-moving content needs a way to stop it (WCAG 2.2.2), and hovering is not
    // reachable from a keyboard, which is why focus counts.
    expect(motionScript).toContain('pointerenter');
    expect(motionScript).toContain('focusin');
    expect(motionScript).toContain('document.hidden');
  });

  it('oscillates inside the track rather than wrapping like a marquee', () => {
    // The catalogue: a wrapping track needs duplicated content or a seven-card rail
    // wraps to a visible gap. Clamped to the real travel, an end cannot be exposed.
    expect(motionScript).toContain('scrollWidth - track.clientWidth');
    expect(motionScript).toMatch(/clamp\(/);
  });

  it('carries a double-init guard, like every other script here', () => {
    expect(motionScript).toContain('data-motion-live');
  });

  it('hands snapping back the moment the visitor steers', () => {
    /*
     * Snapping and drifting cannot both own the scroll position, and snapping wins:
     * a snap container drags any small programmatic scroll back to the nearest card,
     * which held the rail at zero until this handover existed. Measured in
     * tools/verify-motion-rail.mjs; this holds the shape so it cannot be undone.
     */
    expect(css).toContain(".tgs-cards[data-motion-live='1'] { scroll-snap-type: none; }");
    expect(css).toContain("[data-motion-live='1'][data-motion-steer='1']");
    expect(motionScript).toContain("track.setAttribute('data-motion-steer', '1')");
    expect(motionScript).toContain("track.removeAttribute('data-motion-steer')");
  });

  it('tells its own scrolling apart from the visitors', () => {
    // Every nudge stamps a window first, so the scroll event it causes is recognised
    // and ignored. Without it the rail would read its own drift as somebody steering
    // and stop itself on the first frame.
    expect(motionScript).toContain('selfScrollUntil');
  });
});

describe('the video hero is not downloaded by people who will not see it', () => {
  it('gates the film on a media query rather than only hiding it', () => {
    /*
     * Measured in a real browser both ways: a plain src fetches the file even when
     * the stylesheet has set display: none on it, and a <source> whose media query
     * does not match is never selected so nothing is requested. One request against
     * none, for a visitor who asked for less motion and would never see a frame.
     *
     * This is also the cheapest available answer to what a video hero costs in
     * egress, which is an open question on the project.
     */
    expect(render).toContain('media="(prefers-reduced-motion: no-preference)"');
    expect(render).toContain("src={motion === 'A7' ? undefined : video}");
  });

  it('leaves every video already published exactly as it was', () => {
    // The conditional is on the recipe, so a section that never asked for A7 keeps
    // the src it has and behaves identically.
    expect(render).toContain("motion === 'A7' ? (");
  });

  it('needs a film before it will do anything, as A2 needs a sequence', () => {
    expect(MOTION_VIDEO_RECIPES.has('A7')).toBe(true);
    expect(render).toContain('if (MOTION_VIDEO_RECIPES.has(r)) return Boolean(video);');
  });

  it('costs no script, so a video hero keeps the no-script promise', () => {
    for (const recipe of MOTION_VIDEO_RECIPES) {
      expect(MOTION_SCRIPT_RECIPES.has(recipe), `${recipe} should not need a script`).toBe(false);
      expect(MOTION_TIERS[recipe]).toBe(0);
    }
  });
});

describe('a scroll-driven recipe on the first section', () => {
  /*
   * A view() timeline measures an element ENTERING the scrollport, and the first
   * section never enters: it is on screen when the page loads. Measured on
   * 25 Aug 2026 with a 1200px hero in a 900px viewport, S5's range was already
   * about 43% spent before the visitor touched anything, so the animation sat at
   * its end state at every scroll position. The recipe was offered in the editor,
   * stored on the page, attached by the browser, and did nothing whatsoever.
   *
   * The fix drives that one case off the document's own scroll instead. These
   * assertions exist because the failure is invisible: nothing errors, the
   * attribute is present, and the only symptom is a hero that does not move.
   */
  const render = read('components', 'render', 'PageRenderer.tsx');
  const sheet = read('app', 'globals.css');
  const code = render.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('marks the first section, and only when a recipe is actually on', () => {
    expect(code).toContain("data-motion-lead={motion && index === 0 ? '' : undefined}");
  });

  it('drives the lead section off the document scroll rather than its own entry', () => {
    const css = sheet.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toContain("[data-motion='S5'][data-motion-lead] .tgs-section__bg");
    expect(css).toMatch(/\[data-motion-lead\][\s\S]{0,160}animation-timeline:\s*scroll\(\)/);
  });

  it('settles over the hero own height, so a taller hero simply takes longer', () => {
    const css = sheet.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/animation-range:\s*0\s+calc\(var\(--tgs-min-h/);
  });

  it('stays inside the reduced-motion and feature guards the rest of S5 sits in', () => {
    /*
     * The lead rule only overrides the timeline; it must not become a second way
     * to start an animation for somebody who asked for less motion, or in a
     * browser with no scroll timelines at all.
     */
    const guarded = sheet.slice(sheet.indexOf('@supports (animation-timeline: view())'));
    const leadAt = guarded.indexOf("[data-motion='S5'][data-motion-lead]");
    expect(leadAt).toBeGreaterThan(-1);
  });
});

// ---------------------------------------------------------------------------
// The editor says why a recipe will not move (31 Aug 2026). A background recipe
// or a background toggle set on a section with nothing behind it is inert, and
// the pane warns what to add rather than leave the client thinking it is broken.
// ---------------------------------------------------------------------------
describe('the editor knows when a motion setting has nothing to move', () => {
  const motion = (recipe: MotionRecipe) => ({ recipe, intensity: 2 as const });

  it('a still-background recipe with no background is a gap, and none once one is set', () => {
    for (const recipe of ['A4', 'A6', 'S5'] as const) {
      expect(sectionMotionGaps({ motion: motion(recipe) })).toContain('recipe-still');
      expect(
        sectionMotionGaps({ motion: motion(recipe), backgroundImage: 'https://x/y.jpg' }),
      ).toEqual([]);
    }
  });

  it('a still-background recipe is still inert on a slideshow or a video', () => {
    // A single still picture is what A6/S5 need; a slideshow (2+) or a video is not it.
    expect(
      sectionMotionGaps({
        motion: motion('A6'),
        backgroundImage: 'https://x/1.jpg',
        backgroundSlides: [{ src: 'https://x/2.jpg' }],
      }),
    ).toContain('recipe-still');
    expect(
      sectionMotionGaps({ motion: motion('A6'), backgroundVideo: 'https://x/v.mp4' }),
    ).toContain('recipe-still');
  });

  it('the cycling recipe wants two or more pictures', () => {
    expect(sectionMotionGaps({ motion: motion('A2') })).toContain('recipe-pictures');
    expect(
      sectionMotionGaps({ motion: motion('A2'), backgroundImage: 'https://x/1.jpg' }),
    ).toContain('recipe-pictures');
    expect(
      sectionMotionGaps({
        motion: motion('A2'),
        backgroundImage: 'https://x/1.jpg',
        backgroundSlides: [{ src: 'https://x/2.jpg' }],
      }),
    ).toEqual([]);
  });

  it('the video recipe wants a video', () => {
    expect(sectionMotionGaps({ motion: motion('A7') })).toContain('recipe-video');
    // A picture is not a video, so the gap stands.
    expect(
      sectionMotionGaps({ motion: motion('A7'), backgroundImage: 'https://x/1.jpg' }),
    ).toContain('recipe-video');
    expect(
      sectionMotionGaps({ motion: motion('A7'), backgroundVideo: 'https://x/v.mp4' }),
    ).toEqual([]);
  });

  it('the recipes that need no background never raise a gap', () => {
    for (const recipe of ['A3', 'A5', 'S1', 'S3'] as const) {
      expect(sectionMotionGaps({ motion: motion(recipe) })).toEqual([]);
    }
  });

  it('parallax and Ken Burns flag a missing still picture, and clear once it is set', () => {
    expect(sectionMotionGaps({ parallax: true })).toContain('parallax-still');
    expect(sectionMotionGaps({ kenBurns: true })).toContain('ken-burns-still');
    expect(sectionMotionGaps({ parallax: true, backgroundImage: 'https://x/1.jpg' })).toEqual([]);
    // Ken Burns stands down under parallax, exactly as the render gates it, so only
    // the parallax gap shows when both are on with nothing behind them.
    const both = sectionMotionGaps({ parallax: true, kenBurns: true });
    expect(both).toContain('parallax-still');
    expect(both).not.toContain('ken-burns-still');
  });

  it('a background recipe takes the background, so parallax and Ken Burns are not also flagged', () => {
    // A6 owns the background; the two toggles are moot, so the only gap is the recipe's.
    const gaps = sectionMotionGaps({ motion: motion('A6'), parallax: true, kenBurns: true });
    expect(gaps).toEqual(['recipe-still']);
  });

  it('the editor wires the gaps into the Motion pane as warnings', () => {
    const props = read('components', 'editor', 'Properties.tsx');
    expect(props).toContain('sectionMotionGaps(section)');
    expect(props).toContain("motionGaps.includes('recipe-still')");
    expect(props).toContain("motionGaps.includes('recipe-pictures')");
    expect(props).toContain("motionGaps.includes('recipe-video')");
    expect(props).toContain("motionGaps.includes('parallax-still')");
    expect(props).toContain("motionGaps.includes('ken-burns-still')");
  });

  it('mirrors the render guard it stands in for, so the two cannot drift apart', () => {
    // If this rule changes in PageRenderer, sectionMotionGaps must change too.
    const render = read('components', 'render', 'PageRenderer.tsx');
    expect(render).toContain('if (MOTION_VIDEO_RECIPES.has(r)) return Boolean(video);');
    expect(render).toContain('if (MOTION_CYCLING_RECIPES.has(r)) return bgShow;');
    expect(render).toContain('if (MOTION_BACKGROUND_RECIPES.has(r)) return stillBackground;');
  });
});

// ---------------------------------------------------------------------------
// Reveal and parallax reach Safari and Firefox too (31 Aug 2026). They are pure
// CSS on a view() scroll timeline, which only Chromium ships, so tg-motion.js
// carries a fallback that runs ONLY where the timeline is missing.
// ---------------------------------------------------------------------------
describe('reveal and parallax fall back for browsers with no scroll timeline', () => {
  const withReveal = { sections: [{ id: 'a', reveal: true }] };
  const withParallax = { sections: [{ id: 'a', parallax: true }] };

  it('pulls the script for a reveal or a parallax, not just for A3', () => {
    expect(needsMotionScript(withReveal)).toBe(true);
    expect(needsMotionScript(withParallax)).toBe(true);
    // A reveal that is off, or any other section, still asks for nothing.
    expect(needsMotionScript({ sections: [{ id: 'a', reveal: false }] })).toBe(false);
    expect(needsMotionScript({ sections: [{ id: 'a' }] })).toBe(false);
  });

  it('runs the fallback only where the browser lacks its own scroll timeline', () => {
    // The whole point: on Chromium the CSS does it and the script must not fight it.
    expect(motionScript).toContain("CSS.supports('animation-timeline: view()')");
    expect(motionScript).toContain('if (!HAS_SCROLL_TL) {');
    expect(motionScript).toContain('setUpRevealFallback();');
    expect(motionScript).toContain('setUpParallaxFallback();');
  });

  it('never hides a reveal without an observer to bring it back', () => {
    // Clause 2 again: the content cannot depend on the script. The marker that hides a
    // block (data-reveal-fb) is only set after an IntersectionObserver is confirmed, so
    // no observer, blocked JS or reduced motion all leave the content fully in view.
    expect(motionScript).toContain("if (!('IntersectionObserver' in window)) return;");
    expect(motionScript).toContain("setAttribute('data-reveal-fb', '1')");
    expect(motionScript).toContain("setAttribute('data-seen', '1')");
    // The renderer must NEVER write the hide marker itself, or a no-JS page would blank.
    const render = read('components', 'render', 'PageRenderer.tsx');
    expect(render).not.toContain('data-reveal-fb');
    expect(render).not.toContain('data-parallax-fb');
  });

  it('reduced motion gets neither the fallback nor a hidden start', () => {
    // The script returns before any fallback when reduced motion is set, so the markers
    // are never added; and the CSS holds the fallback behind no-preference besides.
    // (css here has its comments stripped, so anchor on selectors, not prose.)
    expect(motionScript).toContain("window.matchMedia('(prefers-reduced-motion: reduce)')");
    const fbSel = css.indexOf('.tgs-section[data-reveal][data-reveal-fb]');
    const block = css.slice(css.lastIndexOf('@media', fbSel), css.indexOf('@keyframes tgs-reveal-rise'));
    expect(block).toContain('@media (prefers-reduced-motion: no-preference)');
    expect(block).toContain('[data-reveal-fb]');
    // OUTSIDE the @supports (animation-timeline) guard, or it would never run on the
    // very browsers it is for.
    expect(block).not.toContain('@supports');
  });

  it('reuses the real keyframes rather than a second set, held paused until seen', () => {
    // The fallback plays the same tgs-reveal-* keyframes on a clock, paused at frame one
    // (the hidden state) until data-seen runs them. One set of keyframes, one look.
    const fbSel = css.indexOf('.tgs-section[data-reveal][data-reveal-fb]');
    const block = css.slice(fbSel, css.indexOf('@keyframes tgs-reveal-rise'));
    expect(block).toContain('animation: tgs-reveal-rise');
    expect(block).toContain('paused');
    expect(block).toContain('.tgs-block[data-seen]');
    expect(block).toContain('animation-play-state: running');
  });

  it('the parallax fallback drives a CSS variable, never a scroll timeline or a raw transform', () => {
    // Same discipline as the rail: no style.transform reassignment (tested elsewhere).
    // The script sets --tgs-parallax-y; the CSS reads it into a translate.
    expect(motionScript).toContain("setProperty('--tgs-parallax-y'");
    const paraSel = css.indexOf('.tgs-section[data-parallax][data-parallax-fb]');
    const block = css.slice(css.lastIndexOf('@media', paraSel), css.indexOf('[data-ken-burns]', paraSel));
    expect(block).toContain('[data-parallax-fb]');
    expect(block).toContain('translateY(var(--tgs-parallax-y');
    expect(block).not.toContain('@supports');
  });
});

// ---------------------------------------------------------------------------
// The cinematic sea (A1), the one WebGL recipe (31 Aug 2026). Tier 2, its own
// script, capped at one canvas per page, no canvas at all under reduced motion.
// ---------------------------------------------------------------------------
describe('the cinematic sea is a first-class recipe with tier-2 discipline', () => {
  const seaPage = { sections: [{ id: 'a', motion: { recipe: 'A1', intensity: 2 } }] };

  it('is in the vocabulary, live, tier 2, a background recipe, and its own script kind', () => {
    expect(MOTION_RECIPES).toContain('A1');
    expect(MOTION_LIVE_RECIPES.has('A1')).toBe(true);
    expect(MOTION_TIERS.A1).toBe(2);
    expect(MOTION_SEA_RECIPES.has('A1')).toBe(true);
    // It owns the background, so the editor and render stand parallax and Ken Burns down.
    expect(MOTION_BACKGROUND_RECIPES.has('A1')).toBe(true);
    // It loads tg-sea.js, NOT tg-motion.js: the two script sets are disjoint.
    expect(MOTION_SCRIPT_RECIPES.has('A1' as MotionRecipe)).toBe(false);
  });

  it('the editor offers it in plain words, not its catalogue code', () => {
    const choice = MOTION_CHOICES.find((c) => c.value === 'A1');
    expect(choice, 'A1 is live but the editor does not offer it').toBeTruthy();
    expect(choice?.label).toBe('Cinematic sea');
  });

  it('pulls tg-sea.js only for a page that carries it, and never tg-motion.js by mistake', () => {
    expect(needsSeaScript(seaPage)).toBe(true);
    expect(needsSeaScript({ sections: [{ id: 'a', motion: { recipe: 'A6', intensity: 2 } }] })).toBe(false);
    expect(needsSeaScript({ sections: [{ id: 'a' }] })).toBe(false);
    // A6 is a pure-CSS background recipe: no script at all, sea or otherwise.
    expect(needsMotionScript(seaPage)).toBe(false);
  });

  it('emits the sea tag separately from the motion tag', () => {
    const emitter = read('components', 'render', 'MotionScript.tsx');
    expect(emitter).toContain('anyNeedsSeaScript(trees)');
    expect(emitter).toContain('src="/tg-sea.js"');
  });

  it('is registered as a site asset in both the allowlist and the matcher', () => {
    const mw = read('middleware.ts');
    expect(mw).toContain("'/tg-sea.js'");
    // The matcher escapes the dot, so the source carries a doubled backslash.
    expect(mw).toContain('tg-sea\\\\.js');
  });

  it('reads its swell from the section intensity, in the render', () => {
    expect(render).toContain("motion === 'A1'");
    expect(render).toContain('data-sea-swell');
  });

  it('the stylesheet only places and clips the canvas; the movement is the shader', () => {
    expect(css).toContain("[data-motion='A1']");
    // No keyframe named for the sea: it is drawn on the GPU, not animated in CSS.
    expect(css).not.toContain('@keyframes tgs-sea');
  });

  it('the sea script is hand-written WebGL with no library import', () => {
    // Clause: ours, hand-written, no libraries. A shader engine that pulled three.js
    // would be exactly the dependency weight the whole motion layer refuses.
    expect(seaScript).toContain('getContext');
    expect(seaScript).not.toContain('require(');
    expect(seaScript).not.toContain("from '");
  });
});

// ---------------------------------------------------------------------------
// The cinematic sea wears a named tone per client (31 Aug 2026), so a Caribbean
// site is turquoise and a Nordic one is steel, picked by name not by colour dial.
// ---------------------------------------------------------------------------
describe('the cinematic sea wears a named tone', () => {
  const rawPage = (seaTone: unknown) => ({
    version: 1,
    id: 'p',
    title: 'T',
    slug: '',
    sections: [{ id: 's', rows: [], motion: { recipe: 'A1', intensity: 2 }, seaTone }],
  });

  it('keeps a valid tone through parsePage and drops nonsense to the default', () => {
    const parsed = parsePage(rawPage('caribbean'));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.page.sections[0].seaTone).toBe('caribbean');
    const junk = parsePage(rawPage('lime-green'));
    expect(junk.ok).toBe(true);
    if (junk.ok) expect(junk.page.sections[0].seaTone).toBeUndefined();
  });

  it('the preset table covers exactly the schema tone list, so the two cannot drift', () => {
    expect(SEA_TONE_PRESETS.map((t) => t.value).sort()).toEqual([...SEA_TONES].sort());
  });

  it('every tone is a real water colour set and a plain-word name', () => {
    for (const tone of SEA_TONE_PRESETS) {
      for (const key of ['deep', 'shallow', 'horizon'] as const) {
        expect(tone[key], `${tone.value} ${key} is not a hex colour`).toMatch(/^#[0-9a-f]{6}$/i);
      }
      expect(typeof tone.sun).toBe('number');
      // Named for a travel agent, never by a catalogue code.
      expect(tone.label).not.toMatch(/^[AS]\d$/);
    }
  });

  it('the render emits the tone colours, and only for the sea recipe', () => {
    expect(render).toContain("motion === 'A1' ? seaTonePreset(section.seaTone) : undefined");
    expect(render).toContain('data-sea-deep={seaTone?.deep}');
    expect(render).toContain('data-sea-shallow={seaTone?.shallow}');
    expect(render).toContain('data-sea-horizon={seaTone?.horizon}');
  });

  it('the editor offers the tone picker for the sea and nowhere else', () => {
    const props = read('components', 'editor', 'Properties.tsx');
    expect(props).toContain("section.motion?.recipe === 'A1'");
    expect(props).toContain('Sea tone');
    expect(props).toContain('SEA_TONE_PRESETS.map');
  });

  it('the sea script validates each colour again, so a bad tone cannot reach the shader', () => {
    // Defence in depth: the render only emits known-good hex, but tg-sea.js re-parses
    // data-sea-deep/shallow/horizon and falls back to its defaults on anything invalid.
    expect(seaScript).toContain("rgb(section.getAttribute('data-sea-deep')");
    expect(seaScript).toContain('/^#?([0-9a-f]{6})$/i');
  });
});

// ---------------------------------------------------------------------------
// The pinned itinerary (S2), the catalogue's "strongest" recipe (31 Aug 2026).
// A section pins and travels its cards sideways; the fallback is a swipeable
// carousel on non-Chromium and reduced motion. Pure CSS, no script.
// ---------------------------------------------------------------------------
describe('the pinned itinerary travels a row of cards', () => {
  const cardsBlock = (n: number) => ({
    type: 'cards',
    props: { items: Array.from({ length: n }, (_, i) => ({ text: `Day ${i + 1}` })) },
  });
  const sectionWith = (n: number, recipe = 'S2') => ({
    id: 's',
    motion: { recipe, intensity: 2 },
    rows: [{ columns: [{ blocks: n > 0 ? [cardsBlock(n)] : [] }] }],
  });

  it('is in the vocabulary, live, tier 0, and no kind of script recipe', () => {
    expect(MOTION_RECIPES).toContain('S2');
    expect(MOTION_LIVE_RECIPES.has('S2')).toBe(true);
    expect(MOTION_TIERS.S2).toBe(0);
    expect(MOTION_SCRIPT_RECIPES.has('S2' as MotionRecipe)).toBe(false);
    expect(MOTION_SEA_RECIPES.has('S2' as MotionRecipe)).toBe(false);
    // It travels the cards, it does not own the section background.
    expect(MOTION_BACKGROUND_RECIPES.has('S2' as MotionRecipe)).toBe(false);
  });

  it('the editor offers it in plain words', () => {
    const choice = MOTION_CHOICES.find((c) => c.value === 'S2');
    expect(choice?.label).toBe('Cards travel sideways');
  });

  it('counts the first cards block, and gaps flag a pinned itinerary with none', () => {
    expect(sectionCardCount(sectionWith(5))).toBe(5);
    expect(sectionCardCount(sectionWith(0))).toBe(0);
    // The editor hint: S2 with no cards has nothing to travel.
    expect(sectionMotionGaps(sectionWith(0))).toContain('recipe-cards');
    expect(sectionMotionGaps(sectionWith(4))).toEqual([]);
    // A different recipe with no cards is not a cards gap.
    expect(sectionMotionGaps(sectionWith(0, 'A5'))).not.toContain('recipe-cards');
  });

  it('the render gates it on having cards and sizes the pinned section by their number', () => {
    expect(render).toContain("if (r === 'S2') return cardCount > 0;");
    expect(render).toContain("motion === 'S2' ? { '--tgs-s2-len': String(cardCount) }");
  });

  it('the editor warns when the itinerary has no cards to travel', () => {
    const props = read('components', 'editor', 'Properties.tsx');
    expect(props).toContain("motionGaps.includes('recipe-cards')");
    expect(props).toContain('Add a Cards block');
  });

  it('falls back to a swipeable carousel, and pins only behind the scroll-timeline guard', () => {
    // Base, everywhere: an overflow-x carousel with scroll snap (the non-Chromium and
    // reduced-motion fallback). It is the FIRST S2 cards rule, before the pinned one.
    const baseIdx = css.indexOf("[data-motion='S2'] .tgs-cards {");
    const baseRule = css.slice(baseIdx, css.indexOf('}', baseIdx));
    expect(baseRule).toContain('overflow-x: auto');
    expect(baseRule).toContain('scroll-snap-type: x proximity');
    // The pin (a named view timeline) comes after the base carousel, inside the guard.
    const pinIdx = css.indexOf('view-timeline: --tgs-s2');
    expect(pinIdx).toBeGreaterThan(baseIdx);
    expect(css).toContain('animation-timeline: --tgs-s2');
    expect(css).toContain('@keyframes tgs-s2');
    expect(css).toContain('translateX(calc(-100% + 100vw))');
  });
});
