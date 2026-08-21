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
  MOTION_TIERS,
  parsePage,
  type MotionRecipe,
} from '../lib/content/schema';
import { MOTION_CHOICES, MOTION_INTENSITIES } from '../lib/content/styles';
import { needsMotionScript } from '../lib/content/motion';
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
      if (rules.some((r) => /animation-timeline:\s*view\(\)/.test(r))) {
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

  it('only a recipe that really needs a script is rated above tier 0', () => {
    /*
     * Clause 1 of the rule in lib/content/blocks.ts: a page that asks for nothing
     * ships nothing. This is where that promise is kept or quietly lost, so the two
     * lists have to agree exactly. A recipe rated tier 1 that is not in the script set
     * would be paying a cost nothing collects; one in the script set rated tier 0
     * would be putting a script on a page while claiming to be free.
     */
    for (const recipe of MOTION_LIVE_RECIPES) {
      const needsScript = MOTION_SCRIPT_RECIPES.has(recipe);
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
    expect(emitter).toContain('if (!anyNeedsMotionScript(trees)) return null;');
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
