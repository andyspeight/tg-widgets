/**
 * The page builder's engine, tested the way the section builder's is: the pure
 * halves run for real, the impure line in the action is asserted by reading the
 * source.
 *
 * WHAT IS ACTUALLY AT RISK, and it is not whether the model picks good sections.
 *
 * 1. THE MODEL'S WORDS BECOMING MARKUP. A heading and a body are written into a
 *    block, and the model's answer is a prompt with a client's own writing in it,
 *    which is exactly where an injection would ride in. So every heading and body
 *    is escaped to plain text here, and this file proves a script tag in either
 *    lands as inert words, not as a tag.
 *
 * 2. THE MODEL NAMING SOMETHING OUTSIDE THE CATALOGUE. A made-up id, a renamed
 *    preset, or a header or footer dropped into the middle of a page. Only ids in
 *    the page catalogue survive, and the built page is one the schema accepts and
 *    the sanitiser does not change.
 *
 * 3. THE MONEY AND THE MEMBERSHIP. The action must check the login and take a
 *    daily slot BEFORE it calls the model, and count tokens after, the same order
 *    every other AI action follows. Asserted from the source, since the model
 *    call itself has no logic to test.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createPage as blankPage } from '../lib/content/factory';
import { REGION_PRESETS } from '../lib/content/presets-region';
import { parsePage, type Block, type Section } from '../lib/content/schema';
import { sanitisePage } from '../lib/content/sanitise-page';
import {
  buildPageUserPrompt,
  dressPage,
  featurePageImage,
  MAX_PLAN_SECTIONS,
  pageCatalogue,
  PAGE_RULES,
  planFromModel,
  sectionsFromPlan,
  shapeNote,
  wireButtons,
} from '../lib/ai/page-build';
import { PAGE_PRESETS } from '../lib/content/presets-page';

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

/** A handful of real page presets to write plans against. */
const HERO = 'blank-opener';
const FEATURES = 'features-three-icons';
const CTA = 'cta-centred';

function blocks(sections: readonly Section[]): Block[] {
  const found: Block[] = [];
  for (const section of sections) {
    for (const row of section.rows) {
      for (const column of row.columns) found.push(...column.blocks);
    }
  }
  return found;
}

/** Wrap plan-built sections in a blank page the way createAiPageAction does. */
function seed(sections: Section[]) {
  return parsePage({ ...blankPage('An AI page', 'ai-page'), sections });
}

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

describe('the catalogue the model chooses from', () => {
  const catalogue = pageCatalogue();

  it('lists the page presets', () => {
    expect(catalogue).toContain(HERO);
    expect(catalogue).toContain(CTA);
    // Built from the live registry, so a preset added tomorrow is offered without
    // touching this file.
    expect(catalogue.length).toBeGreaterThan(200);
  });

  it('never offers site chrome for the middle of a page', () => {
    // A header or footer preset in the catalogue would let the model drop the
    // site chrome into a page section. PAGE_PRESETS is page scope, so none is.
    for (const region of REGION_PRESETS) {
      expect(catalogue, `${region.id} is site chrome`).not.toContain(region.id);
    }
  });
});

// ---------------------------------------------------------------------------
// The plan the model returns
// ---------------------------------------------------------------------------

describe('turning a model answer into a plan', () => {
  it('keeps the sections it named, in order, with their copy', () => {
    const answer = JSON.stringify([
      { preset: HERO, heading: 'Walking in the Dolomites', body: 'Guided and self-guided trips.' },
      { preset: FEATURES, heading: 'Why walk with us' },
      { preset: CTA, heading: 'Get in touch', body: 'Tell us where you fancy.' },
    ]);

    const result = planFromModel(answer);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.map((spec) => spec.preset)).toEqual([HERO, FEATURES, CTA]);
    expect(result.plan[0].heading).toBe('Walking in the Dolomites');
    expect(result.plan[1].body).toBeUndefined();
  });

  it('reads a wrapped array as readily as a bare one', () => {
    const bare = planFromModel(JSON.stringify([{ preset: HERO }]));
    const wrapped = planFromModel(JSON.stringify({ sections: [{ preset: HERO }] }));
    expect(bare.ok && wrapped.ok).toBe(true);
  });

  it('drops an id that is not a page preset', () => {
    const answer = JSON.stringify([
      { preset: HERO, heading: 'Kept' },
      { preset: 'totally-made-up', heading: 'Dropped' },
      { preset: REGION_PRESETS[0].id, heading: 'Also dropped, this is site chrome' },
      { preset: CTA, heading: 'Kept too' },
    ]);

    const result = planFromModel(answer);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.map((spec) => spec.preset)).toEqual([HERO, CTA]);
  });

  it('caps the number of sections so a runaway plan cannot land', () => {
    const many = Array.from({ length: 30 }, () => ({ preset: HERO }));
    const result = planFromModel(JSON.stringify(many));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.length).toBe(MAX_PLAN_SECTIONS);
  });

  it('fails honestly on nothing usable', () => {
    expect(planFromModel('not json at all').ok).toBe(false);
    expect(planFromModel(JSON.stringify([])).ok).toBe(false);
    expect(planFromModel(JSON.stringify([{ preset: 'nope' }])).ok).toBe(false);
  });

  /*
   * THE ONE THIS FILE EXISTS FOR. A script tag in a heading or a body lands as
   * inert words, never as a tag, because the copy is escaped to plain text before
   * it is ever written into a block.
   */
  it('escapes a script tag in the copy rather than keeping it', () => {
    const answer = JSON.stringify([
      {
        preset: HERO,
        heading: 'Book now <script>alert(document.cookie)</script>',
        body: '<img src=x onerror="alert(1)"> trips from a real person',
      },
    ]);

    const result = planFromModel(answer);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const spec = result.plan[0];
    expect(spec.heading ?? '').not.toContain('<script');
    expect(spec.heading ?? '').not.toContain('<');
    expect(spec.body ?? '').not.toContain('onerror');
    expect(spec.body ?? '').not.toContain('<');
  });

  it('escapes a bare angle bracket rather than leaving it raw', () => {
    // "under 5 < 10 people" has no closing tag, so it is not stripped, only
    // escaped. Proves escapeHtml runs, not just tag stripping.
    const result = planFromModel(JSON.stringify([{ preset: HERO, heading: 'Groups under 5 < 10 people' }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan[0].heading).toContain('&lt;');
  });
});

// ---------------------------------------------------------------------------
// Building the sections
// ---------------------------------------------------------------------------

describe('the sections a plan builds', () => {
  it('seeds a page the schema accepts and the sanitiser leaves alone', async () => {
    const result = planFromModel(
      JSON.stringify([
        { preset: HERO, heading: 'A real opener', body: 'A short line under it.' },
        { preset: FEATURES, heading: 'Three points' },
        { preset: CTA, heading: 'Talk to us', body: 'A prompt to enquire.' },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const sections = await sectionsFromPlan(result.plan);
    expect(sections.length).toBe(3);

    const parsed = seed(sections);
    expect(parsed.ok, parsed.ok ? '' : parsed.errors.join('; ')).toBe(true);
    if (!parsed.ok) return;
    expect(sanitisePage(parsed.page)).toEqual(parsed.page);
  });

  it('writes the heading it was given into the opener', async () => {
    const result = planFromModel(JSON.stringify([{ preset: HERO, heading: 'The words I asked for' }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const sections = await sectionsFromPlan(result.plan);
    const headings = blocks(sections).filter((block) => block.type === 'heading');
    expect(headings.some((block) => String(block.props.html) === 'The words I asked for')).toBe(true);
  });

  it('mints fresh ids each build, so two pages never share a section', async () => {
    const result = planFromModel(JSON.stringify([{ preset: HERO }]));
    if (!result.ok) throw new Error('plan did not build');
    const a = await sectionsFromPlan(result.plan);
    const b = await sectionsFromPlan(result.plan);
    expect(a[0].id).not.toBe(b[0].id);
  });

  /*
   * A SCRIPT TAG END TO END. The strongest claim: even if escaping were undone,
   * the built and sanitised page carries no live script or handler.
   */
  it('carries no script or handler through to the built page', async () => {
    const result = planFromModel(
      JSON.stringify([{ preset: HERO, heading: '<script>alert(1)</script>', body: '<b onmouseover=alert(1)>x</b>' }]),
    );
    if (!result.ok) throw new Error('plan did not build');
    const parsed = seed(await sectionsFromPlan(result.plan));
    if (!parsed.ok) throw new Error('page did not parse');
    const json = JSON.stringify(sanitisePage(parsed.page));
    expect(json).not.toContain('<script');
    expect(json.toLowerCase()).not.toContain('onmouseover');
  });
});

// ---------------------------------------------------------------------------
// The uploaded picture (slice 2)
// ---------------------------------------------------------------------------

const BLOB = 'https://store123.public.blob.vercel-storage.com/sites/t/media/hero-abc123.jpg';

describe('featuring an uploaded picture', () => {
  const plan = [
    { preset: HERO, heading: 'An opener' },
    { preset: CTA, heading: 'Talk to us' },
  ];

  it('places the picture behind the opening section and darkens it', async () => {
    const sections = featurePageImage(await sectionsFromPlan(plan), BLOB);
    expect(sections[0].backgroundImage).toBe(BLOB);
    expect(sections[0].tone).toBe('dark');
    expect(Number(sections[0].overlay)).toBeGreaterThanOrEqual(45);
  });

  it('touches only the first section', async () => {
    const featured = featurePageImage(await sectionsFromPlan(plan), BLOB);
    expect(featured[1].backgroundImage ?? '').not.toBe(BLOB);
  });

  it('does nothing with no sections or no url', async () => {
    expect(featurePageImage([], BLOB)).toEqual([]);
    const built = await sectionsFromPlan(plan);
    expect(featurePageImage(built, '')).toBe(built);
  });

  it('leaves a page the schema accepts and the sanitiser keeps, picture and all', async () => {
    const sections = featurePageImage(await sectionsFromPlan(plan), BLOB);
    const parsed = seed(sections);
    expect(parsed.ok, parsed.ok ? '' : parsed.errors.join('; ')).toBe(true);
    if (!parsed.ok) return;
    expect(sanitisePage(parsed.page)).toEqual(parsed.page);
    // The blob URL survives sanitising, so the picture is actually on the page.
    expect(JSON.stringify(sanitisePage(parsed.page))).toContain(BLOB);
  });
});

describe('the brief prompt with a picture', () => {
  it('tells the model to read the photo and open with a hero', () => {
    const withImage = buildPageUserPrompt('A page about Crete', true);
    expect(withImage).toMatch(/photograph has been provided/i);
    expect(withImage).toMatch(/behind the opening section/i);
  });

  it('says nothing about a photo when there is none', () => {
    const plain = buildPageUserPrompt('A page about Crete', false);
    expect(plain).not.toMatch(/photograph/i);
    expect(plain).toContain('A page about Crete');
  });

  it('works from the picture alone when the brief is empty', () => {
    expect(buildPageUserPrompt('', true)).toMatch(/photograph/i);
  });
});

// ---------------------------------------------------------------------------
// The action around it, read as source
// ---------------------------------------------------------------------------

describe('the page builder action', () => {
  const source = read('app', 'actions', 'ai.ts');
  const action = source.slice(source.indexOf('export async function createAiPageAction'));
  const at = (needle: string) => action.indexOf(needle);

  it('checks membership and takes a slot before it spends anything', () => {
    expect(at('requireSite()')).toBeGreaterThan(-1);
    expect(at('requireSite()')).toBeLessThan(at('await ask('));
    expect(at('claimRequest(')).toBeLessThan(at('await ask('));
  });

  it('counts the tokens after the call, not before', () => {
    expect(at('recordTokens(')).toBeGreaterThan(at('await ask('));
  });

  it('never takes a tenant from the caller', () => {
    expect(action).toContain('site.tenantId');
    expect(action).not.toMatch(/tenantId[:,]\s*(input|fields|raw|arg)/);
  });

  it('builds the sections through the closed engine, not from the request', () => {
    // planFromModel keeps only catalogue ids and escapes the copy; createPage
    // parses and sanitises before a byte is stored.
    expect(action).toContain('planFromModel(');
    // Through the orchestrator, which builds, fills and strips in that order.
    expect(action).toContain('sectionsForPage(');
    expect(action).toContain('createPage(');
  });

  it('resolves the picture against the tenant bank and only sends an https url', () => {
    // The browser sends a media id; the URL is looked up here, tenant-scoped, and
    // only an https one is handed to the model, the same rule the alt text uses.
    expect(action).toContain('getMediaItem(site.tenantId, imageId)');
    expect(action).toContain('/^https:\\/\\//i.test(item.url)');
    // Featured INSIDE the pipeline now, before the dress, so the uploaded
    // hero gets its drift and the tone banding counts it dark.
    expect(action).toContain('featureImageUrl: imageUrl');
  });

  it('never names the model endpoint or key where an error could echo it', () => {
    expect(action).not.toContain('api.anthropic.com');
    expect(action).not.toContain('ANTHROPIC_API_KEY');
  });
});

// ---------------------------------------------------------------------------

/**
 * NO PRESET INSTRUCTIONS ON A PAGE THE BUILDER JUST HANDED OVER.
 *
 * Andy, 26 Aug 2026, on the first full site it produced: "it's very poor. No
 * images. Placeholder text. Short pages." Nine of the twelve pages carried at
 * least one placeholder, most often "Tagline here" or "This is a short title".
 *
 * One cause behind all three complaints: buildSection writes exactly two things,
 * the heading into the section title and the body into the first paragraph.
 * Everything else a preset holds keeps its factory copy, so a real headline sits
 * on top of instructions written for whoever was meant to fill the preset in.
 *
 * This is the safety net rather than the fix. The fix is for the builder to
 * fill every slot it chooses, and that is the next piece of work.
 */
describe('stripping the copy the builder never filled', () => {
  const row = (blocks: Array<{ type: string; props?: Record<string, unknown> }>) => ({
    id: 'r1',
    layout: '100',
    columns: [{ id: 'c1', width: 100, blocks }],
  });

  const section = (blocks: Array<{ type: string; props?: Record<string, unknown> }>) =>
    ({ id: 's1', rows: [row(blocks)] }) as never;

  it('takes out a block whose whole text is a placeholder', async () => {
    const { stripPlaceholders } = await import('../lib/ai/page-build');
    const out = stripPlaceholders([
      section([
        { type: 'heading', props: { html: 'Barbados' } },
        { type: 'heading', props: { html: 'This is a short title' } },
        { type: 'text', props: { html: '<p>Another one. Three or four of these is usually enough.</p>' } },
      ]),
    ]);

    const blocks = out[0].rows[0].columns[0].blocks;
    expect(blocks).toHaveLength(1);
    expect((blocks[0].props as { html: string }).html).toBe('Barbados');
  });

  it('leaves real copy that merely echoes a placeholder', async () => {
    /*
     * Conservative on purpose: the whole visible text has to BE a placeholder.
     * A sentence that happens to contain one of these phrases is somebody's
     * writing and removing it would be worse than leaving the placeholder.
     */
    const { stripPlaceholders } = await import('../lib/ai/page-build');
    const out = stripPlaceholders([
      section([
        { type: 'text', props: { html: '<p>This is a short title we chose deliberately.</p>' } },
      ]),
    ]);
    expect(out[0].rows[0].columns[0].blocks).toHaveLength(1);
  });

  it('drops a section left with nothing, rather than leaving an empty band', async () => {
    const { stripPlaceholders } = await import('../lib/ai/page-build');
    const out = stripPlaceholders([
      section([{ type: 'heading', props: { html: 'Tagline here' } }]),
    ]);
    expect(out).toHaveLength(0);
  });

  it('ignores markup and case, since the copy arrives wrapped', async () => {
    const { stripPlaceholders } = await import('../lib/ai/page-build');
    const out = stripPlaceholders([
      section([{ type: 'text', props: { html: '<p>  TAGLINE HERE  </p>' } }]),
    ]);
    expect(out).toHaveLength(0);
  });

  it('runs LAST, after the fill, which is the order that matters', () => {
    /*
     * THE ORDER IS THE WHOLE THING and getting it wrong is silent. Stripping
     * before filling deletes the very slots the fill exists to write, and the
     * page comes out as thin as it was before any of it was built. That is
     * exactly what the first version of this did.
     */
    const actions = read('app', 'actions', 'ai.ts');
    const fn = actions.slice(
      actions.indexOf('async function sectionsForPage'),
      actions.indexOf('export type AiPageResult'),
    );

    const build = fn.indexOf('sectionsFromPlan(plan)');
    const fill = fn.indexOf('applyFill(built');
    /*
     * BUILD, FILL, PHOTOS, STRIP — and the middle two both matter. Photos read
     * the FILLED sections (a card rewritten to Barbados must search for
     * Barbados) and run BEFORE the strip, because the plan's numeric addresses
     * were computed against the unstripped tree: stripping first shifted them
     * and pictures landed on the wrong blocks.
     */
    const photographed = fn.indexOf('sections = await withPhotos(ctx.tenantId, planned, sections);');
    const stripped = fn.indexOf('const kept = stripPlaceholders(stripUnfilled(sections, slots));');
    // And the finishing passes run on what SURVIVED: tones and motion are
    // positional, and a wired button on a stripped section is a wasted write.
    // The uploaded hero is featured before the dress for the same reason.
    const dressed = fn.indexOf('return dressPage(ctx.featureImageUrl ? featurePageImage(wired, ctx.featureImageUrl) : wired);');

    expect(build, 'the build step has moved').toBeGreaterThan(-1);
    expect(fill, 'the fill step has moved').toBeGreaterThan(build);
    expect(photographed, 'photos no longer see the filled sections').toBeGreaterThan(fill);
    expect(stripped, 'the strip no longer runs after the finishing passes').toBeGreaterThan(photographed);
    expect(dressed, 'the dress pass no longer runs last').toBeGreaterThan(stripped);
  });

  it('the list still matches what the presets actually contain', async () => {
    /*
     * THE GUARD AGAINST ROT. This list is a copy of strings that live in
     * presets-page.ts, so it goes stale the moment somebody rewords a preset,
     * and it goes stale silently: the placeholder simply starts shipping again.
     * Every entry has to still be found in the presets.
     */
    const presets = read('lib', 'content', 'presets-page.ts').toLowerCase();
    const text = read('lib', 'ai', 'page-build.ts');
    const list = /const PLACEHOLDER_COPY: readonly string\[] = \[([\s\S]*?)\];/.exec(text)?.[1] ?? '';
    const entries = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);

    expect(entries.length).toBeGreaterThan(5);
    for (const entry of entries) {
      expect(presets, `"${entry}" is no longer in any preset`).toContain(entry);
    }
  });
});

// ---------------------------------------------------------------------------

/**
 * WHAT A MACHINE MAY NOT ASSERT ON A CLIENT'S BEHALF.
 *
 * The first full AI-built site shipped a quote block reading "We have used them
 * four times now and I would not go anywhere else" — a fabricated customer
 * review, attributed to "A customer", on a real company's website. The scan
 * that followed found worse waiting: stats presets carrying "4.9/5 across 300
 * reviews", "12,000 holidays booked" and "100% ATOL protected" — that last an
 * invented PROTECTION claim — and logo strips that render "Add your badges"
 * under "Your money is protected. Here is who by."
 *
 * None of it was strippable, because the stripper only read heading/text html,
 * and all of it was actively offered: the catalogue advertised every one of
 * those presets to a model whose rules say "trust is the currency".
 */
describe('fabrication presets are not offered and their blocks cannot ship', () => {
  it('the catalogue no longer offers testimonials, stats or logo strips', async () => {
    const { pageCatalogue } = await import('../lib/ai/page-build');
    const catalogue = pageCatalogue();

    for (const id of [
      'testimonials-one-big',
      'testimonials-three',
      'testimonials-rail',
      'testimonials-with-stats',
      'hero-with-stats',
      'hero-with-badges',
      'stats-three',
      'logos-row',
      'features-badges',
      /*
       * The review round's additions. pricing-three-panels ships "From £549 /
       * £699 / £899" with invented inclusions; banner-line ships "Book by 31
       * August and the deposit is half price" — a fabricated dated offer. A
       * machine has no prices and no announcements.
       */
      'pricing-three-panels',
      'banner-line',
      'banner-centred',
    ]) {
      expect(catalogue, `${id} is still offered to the model`).not.toContain(`- ${id}:`);
    }

    // And the ordinary library is untouched: plenty left to build with.
    expect(catalogue).toContain('- hero-page-banner:');
    expect(catalogue).toContain('- features-cards-with-pictures:');
  });

  it('a plan naming an excluded preset loses that section, like any unknown id', () => {
    const result = planFromModel(
      JSON.stringify([
        { preset: 'hero-page-banner', heading: 'Kept' },
        { preset: 'testimonials-one-big', heading: 'Dropped' },
        { preset: 'cta-centred', heading: 'Kept too' },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.map((spec) => spec.preset)).toEqual(['hero-page-banner', 'cta-centred']);
  });

  it('the presets themselves still exist, for a client to fill by hand', async () => {
    /*
     * Nothing is removed from the product. A client with real reviews and real
     * memberships adds these sections from the drawer and fills them with the
     * truth; they are only gone from what a machine asserts unprompted.
     */
    const { PAGE_PRESETS } = await import('../lib/content/presets-page');
    expect(PAGE_PRESETS.some((preset) => preset.id === 'testimonials-one-big')).toBe(true);
    expect(PAGE_PRESETS.some((preset) => preset.id === 'stats-three')).toBe(true);
  });

  it('the block backstop strips a quote, stats or logos block that arrives anyway', async () => {
    const { stripPlaceholders } = await import('../lib/ai/page-build');
    const sections = [
      {
        id: 's1',
        rows: [
          {
            id: 'r1',
            layout: '100',
            columns: [
              {
                id: 'c1',
                width: 100,
                blocks: [
                  { id: 'b1', type: 'heading', props: { html: 'Real heading' } },
                  { id: 'b2', type: 'quote', props: { text: 'We have used them four times now.', attribution: 'A customer' } },
                  { id: 'b3', type: 'stats', props: { items: [{ value: '4.9/5', label: 'Average review score' }] } },
                  { id: 'b4', type: 'logos', props: { items: [] } },
                ],
              },
            ],
          },
        ],
      },
    ] as never;

    const out = stripPlaceholders(sections);
    const kept = out[0].rows[0].columns[0].blocks.map((block) => block.type);
    expect(kept).toEqual(['heading']);
  });

  it('no buildable preset contains a fabrication block, checked against the library', async () => {
    /*
     * The exclusion is a SCAN, not a list, so this holds for presets written
     * next month too: if it is in the catalogue, it contains no quote, stats or
     * logos block anywhere in its rows.
     */
    /*
     * On the EXPORTED buildable set, not a regex over the rendered catalogue:
     * the review showed the regex could quietly match nothing and pass. The
     * catalogue draws from this same array, so scanning it scans what is
     * offered.
     */
    const { BUILDABLE_PRESETS, pageCatalogue } = await import('../lib/ai/page-build');
    expect(BUILDABLE_PRESETS.length).toBeGreaterThan(20);
    // The catalogue really is fed from it.
    for (const preset of BUILDABLE_PRESETS.slice(0, 5)) {
      expect(pageCatalogue()).toContain(`- ${preset.id}:`);
    }

    for (const preset of BUILDABLE_PRESETS) {
      expect(
        ['testimonials', 'stats', 'logos', 'pricing', 'banner'].includes(preset.category),
        `${preset.id} is offered from a fabrication category`,
      ).toBe(false);
      for (const row of preset.rows) {
        for (const column of row.columns) {
          for (const block of column) {
            expect(
              ['quote', 'stats', 'logos', 'table'].includes(block.type),
              `${preset.id} is offered but contains a ${block.type} block`,
            ).toBe(false);
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------

/**
 * THE CLIENT-GRADE ROUND (26 Aug). Andy on the first correct build: "AI
 * standard fare, not something I could give to a client." The faults were not
 * in the words but in the design: every page a wall of white centred stacks,
 * every heading wearing a kicker, every button dead. Each fix is pinned here.
 */

describe('the model can see shape', () => {
  it('every catalogue line ends with what the section is, visually', () => {
    for (const line of pageCatalogue().split('\n')) {
      if (!line.startsWith('- ')) continue;
      expect(line, line).toMatch(/\[[^\]]+\]$/);
    }
  });

  it('describes the shapes it claims', () => {
    const byId = new Map(PAGE_PRESETS.map((preset) => [preset.id, preset]));
    const note = (id: string) => shapeNote(byId.get(id)!);
    expect(note('hero-background')).toContain('full-bleed photograph');
    expect(note('hero-split-right')).toContain('split, picture right');
    expect(note('features-three-icons')).toContain('grid');
    expect(note('cta-centred')).toContain('accent-colour band');
  });

  it('and is told to use it', () => {
    expect(PAGE_RULES).toContain('RHYTHM');
    expect(PAGE_RULES).toContain('Vary the shape');
  });
});

describe('no eyebrow ships from the AI path', () => {
  it('strips the kicker at build, so the fill never even sees it', async () => {
    /*
     * hero-eyebrow is literally the pattern: an h6 tagline over the h1. The
     * craft floor bans it outright, and stripping it STRUCTURALLY at build is
     * the only strip that works - filled with fresh words, an eyebrow is
     * invisible to the placeholder pass.
     */
    const [section] = await sectionsFromPlan([{ preset: 'hero-eyebrow', heading: 'Real heading' }]);
    const styles = section.rows
      .flatMap((row) => row.columns)
      .flatMap((column) => column.blocks)
      .filter((block) => block.type === 'heading')
      .map((block) => (block.props as { style?: string }).style);
    expect(styles).not.toContain('h6');
    expect(styles.length).toBeGreaterThan(0);
  });

  it('across the whole buildable catalogue, not just the named preset', async () => {
    /*
     * 17 presets carried one. Build EVERY buildable preset and assert no
     * section opens with a small heading before its biggest one - the same
     * derivation presetRoles uses, applied to what actually shipped.
     */
    /*
     * The ban is the label stacked ABOVE the title - so the check is per
     * COLUMN, matching stripEyebrows. A margin label BESIDE the title (the
     * left column of an editorial [1,2] row, e.g. text-title-and-bullets) is
     * a layout, and it stays.
     */
    const { BUILDABLE_PRESETS } = await import('../lib/ai/page-build');
    const rank: Record<string, number> = { h1: 6, h2: 5, h3: 4, h4: 3, h5: 2, h6: 1 };
    for (const preset of BUILDABLE_PRESETS) {
      const [section] = await sectionsFromPlan([{ preset: preset.id }]);
      const all = section.rows
        .flatMap((row) => row.columns)
        .flatMap((column) => column.blocks)
        .filter((block) => block.type === 'heading')
        .map((block) => rank[(block.props as { style?: string }).style ?? ''] ?? 0);
      const biggest = Math.max(0, ...all);
      for (const row of section.rows) {
        for (const column of row.columns) {
          const headings = column.blocks
            .filter((block) => block.type === 'heading')
            .map((block) => rank[(block.props as { style?: string }).style ?? ''] ?? 0);
          if (!headings.includes(biggest)) continue;
          const beforeTitle = headings.slice(0, headings.indexOf(biggest));
          expect(
            beforeTitle.every((size) => size >= biggest),
            `${preset.id} still opens with a kicker above its title`,
          ).toBe(true);
        }
      }
    }
  });

  it('leaves a preset with no eyebrow exactly alone', async () => {
    const preset = PAGE_PRESETS.find((entry) => entry.id === HERO)!;
    const [section] = await sectionsFromPlan([{ preset: HERO }]);
    const built = section.rows.flatMap((row) => row.columns).flatMap((column) => column.blocks);
    expect(built.length).toBe(preset.rows.flatMap((row) => row.columns).flat().length);
  });
});

describe('the page is dressed, not just written', () => {
  const bare = (tone: string, blocks: Block[] = []): Section =>
    ({
      id: `sec_${Math.random().toString(36).slice(2, 8)}`,
      tone,
      rows: [{ columns: [{ blocks }] }],
    }) as unknown as Section;
  const image = { type: 'image', props: { src: '', alt: '' } } as unknown as Block;

  it('bands the tones and leaves the designed bands alone', () => {
    const dressed = dressPage([bare('light'), bare('light'), bare('accent'), bare('light'), bare('light')]);
    expect(dressed.map((section) => section.tone)).toEqual(['light', 'subtle', 'accent', 'light', 'subtle']);
  });

  it('gives the photograph hero its drift and one picture section its motion', () => {
    const hero = { ...bare('dark'), backgroundImage: 'https://example.com/a.jpg' } as Section;
    const dressed = dressPage([hero, bare('light', [image]), bare('light', [image])]);
    expect(dressed[0].motion).toEqual({ recipe: 'A6', intensity: 2 });
    expect(dressed[1].motion).toEqual({ recipe: 'A5', intensity: 2 });
    // ONE moment, not an effect bolted onto every section.
    expect(dressed[2].motion).toBeUndefined();
  });

  it('never overrules motion a section already carries', () => {
    const hero = {
      ...bare('dark'),
      backgroundImage: 'https://example.com/a.jpg',
      motion: { recipe: 'A2', intensity: 1 },
    } as Section;
    expect(dressPage([hero])[0].motion).toEqual({ recipe: 'A2', intensity: 1 });
  });
});

describe('the buttons work', () => {
  const withButtons = (): Section =>
    ({
      id: 'sec_btns',
      tone: 'light',
      rows: [
        {
          columns: [
            {
              blocks: [
                { type: 'button', props: { label: 'Start an enquiry', href: '' } },
                {
                  type: 'button-group',
                  props: {
                    buttons: [
                      { label: 'Talk to us', href: '' },
                      { label: 'Our story', href: '/about' },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    }) as unknown as Section;

  it('points empty hrefs at the planned contact page and touches nothing else', () => {
    const [section] = wireButtons([withButtons()], '/contact');
    const blocks = section.rows[0].columns[0].blocks as Array<{ props: Record<string, unknown> }>;
    expect(blocks[0].props.href).toBe('/contact');
    const buttons = blocks[1].props.buttons as Array<{ href: string }>;
    expect(buttons[0].href).toBe('/contact');
    // A button that already points somewhere is somebody's decision.
    expect(buttons[1].href).toBe('/about');
  });

  it('does nothing without a target, because a wrong link is worse than a dead one', () => {
    const [section] = wireButtons([withButtons()], '');
    const blocks = section.rows[0].columns[0].blocks as Array<{ props: Record<string, unknown> }>;
    expect(blocks[0].props.href).toBe('');
  });
});

describe('empty media never ships', () => {
  it('strips images and galleries the photo pass could not fill', async () => {
    /*
     * When Pexels is unconfigured or the budget ran out, an empty image block
     * renders "Choose an image" and an empty gallery "Add some images" - an
     * author placeholder shown to a VISITOR. A missing picture beats a page
     * telling its readers to add one.
     */
    const { stripPlaceholders } = await import('../lib/ai/page-build');
    const [section] = await sectionsFromPlan([{ preset: 'gallery-wide' }]);
    const stripped = stripPlaceholders([section]);
    // The whole section was pictures; with none found it disappears.
    expect(stripped).toHaveLength(0);
  });

  it('keeps them the moment they carry a real picture', async () => {
    const { stripPlaceholders } = await import('../lib/ai/page-build');
    const [section] = await sectionsFromPlan([{ preset: 'gallery-wide' }]);
    const gallery = section.rows[0].columns[0].blocks[0];
    gallery.props = { ...gallery.props, images: [{ src: 'https://media.example/p.jpg', alt: 'a bay' }] };
    expect(stripPlaceholders([section])).toHaveLength(1);
  });
});

describe('the eyebrow strip cannot shift a photograph address', () => {
  it('no picture block follows a stripped eyebrow in its column, across the library', async () => {
    /*
     * sectionPhotoTargets walks the PRESET to compute row/column/block
     * addresses, then applyPhoto dereferences them into the eyebrow-STRIPPED
     * sections. Removing a block above a picture in the same column would
     * shift the address and silently drop the photograph. This holds by data
     * today; this sweep is what turns "by data" into "by contract".
     */
    const { presetRoles } = await import('../lib/content/preset-types');
    const pictures = new Set(['image', 'video', 'gallery', 'cards']);
    for (const preset of PAGE_PRESETS) {
      const roles = presetRoles(preset);
      let titleAt = '';
      preset.rows.forEach((row, rowIndex) => {
        row.columns.forEach((column, columnIndex) => {
          column.forEach((block) => {
            if (roles.get(block) === 'title') titleAt = `${rowIndex}:${columnIndex}`;
          });
        });
      });
      preset.rows.forEach((row, rowIndex) => {
        row.columns.forEach((column, columnIndex) => {
          let sawEyebrow = false;
          column.forEach((block) => {
            if (roles.get(block) === 'eyebrow' && `${rowIndex}:${columnIndex}` === titleAt) sawEyebrow = true;
            if (sawEyebrow) {
              expect(
                pictures.has(block.type),
                `${preset.id} puts a ${block.type} after a kicker: its photo address would shift when the kicker is stripped`,
              ).toBe(false);
            }
          });
        });
      });
    }
  });
});

describe('what the dress keeps', () => {
  const bare2 = (tone: string): Section =>
    ({ id: 'sec_t', tone, rows: [{ columns: [{ blocks: [] }] }] }) as unknown as Section;

  it('a preset-authored subtle band stays subtle, as the catalogue promised', () => {
    const dressed = dressPage([bare2('light'), bare2('subtle'), bare2('light')]);
    expect(dressed.map((section) => section.tone)).toEqual(['light', 'subtle', 'light']);
  });

  it('a section whose column paints its own box keeps its ground', () => {
    const boxed = {
      id: 'sec_b',
      tone: 'light',
      rows: [{ columns: [{ box: { background: 'var(--tgs-surface-alt)' }, blocks: [] }] }],
    } as unknown as Section;
    // Second in the run, where the alternation would have turned it subtle
    // and made its panel invisible against the band.
    const dressed = dressPage([bare2('light'), boxed, bare2('light')]);
    expect(dressed[1].tone).toBe('light');
  });
});

describe('grids read as grids in the catalogue', () => {
  it('single-column card and gallery presets are not "centred stack"', () => {
    const byId = new Map(PAGE_PRESETS.map((preset) => [preset.id, preset]));
    expect(shapeNote(byId.get('gallery-wide')!)).toContain('grid of pictures');
    expect(shapeNote(byId.get('features-cards-with-pictures')!)).toContain('grid of cards');
  });
});
