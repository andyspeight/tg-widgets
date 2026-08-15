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
  featurePageImage,
  MAX_PLAN_SECTIONS,
  pageCatalogue,
  planFromModel,
  sectionsFromPlan,
} from '../lib/ai/page-build';

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
  it('seeds a page the schema accepts and the sanitiser leaves alone', () => {
    const result = planFromModel(
      JSON.stringify([
        { preset: HERO, heading: 'A real opener', body: 'A short line under it.' },
        { preset: FEATURES, heading: 'Three points' },
        { preset: CTA, heading: 'Talk to us', body: 'A prompt to enquire.' },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const sections = sectionsFromPlan(result.plan);
    expect(sections.length).toBe(3);

    const parsed = seed(sections);
    expect(parsed.ok, parsed.ok ? '' : parsed.errors.join('; ')).toBe(true);
    if (!parsed.ok) return;
    expect(sanitisePage(parsed.page)).toEqual(parsed.page);
  });

  it('writes the heading it was given into the opener', () => {
    const result = planFromModel(JSON.stringify([{ preset: HERO, heading: 'The words I asked for' }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const sections = sectionsFromPlan(result.plan);
    const headings = blocks(sections).filter((block) => block.type === 'heading');
    expect(headings.some((block) => String(block.props.html) === 'The words I asked for')).toBe(true);
  });

  it('mints fresh ids each build, so two pages never share a section', () => {
    const result = planFromModel(JSON.stringify([{ preset: HERO }]));
    if (!result.ok) throw new Error('plan did not build');
    const a = sectionsFromPlan(result.plan);
    const b = sectionsFromPlan(result.plan);
    expect(a[0].id).not.toBe(b[0].id);
  });

  /*
   * A SCRIPT TAG END TO END. The strongest claim: even if escaping were undone,
   * the built and sanitised page carries no live script or handler.
   */
  it('carries no script or handler through to the built page', () => {
    const result = planFromModel(
      JSON.stringify([{ preset: HERO, heading: '<script>alert(1)</script>', body: '<b onmouseover=alert(1)>x</b>' }]),
    );
    if (!result.ok) throw new Error('plan did not build');
    const parsed = seed(sectionsFromPlan(result.plan));
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

  it('places the picture behind the opening section and darkens it', () => {
    const sections = featurePageImage(sectionsFromPlan(plan), BLOB);
    expect(sections[0].backgroundImage).toBe(BLOB);
    expect(sections[0].tone).toBe('dark');
    expect(Number(sections[0].overlay)).toBeGreaterThanOrEqual(45);
  });

  it('touches only the first section', () => {
    const featured = featurePageImage(sectionsFromPlan(plan), BLOB);
    expect(featured[1].backgroundImage ?? '').not.toBe(BLOB);
  });

  it('does nothing with no sections or no url', () => {
    expect(featurePageImage([], BLOB)).toEqual([]);
    const built = sectionsFromPlan(plan);
    expect(featurePageImage(built, '')).toBe(built);
  });

  it('leaves a page the schema accepts and the sanitiser keeps, picture and all', () => {
    const sections = featurePageImage(sectionsFromPlan(plan), BLOB);
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
    expect(action).toContain('sectionsFromPlan(');
    expect(action).toContain('createPage(');
  });

  it('resolves the picture against the tenant bank and only sends an https url', () => {
    // The browser sends a media id; the URL is looked up here, tenant-scoped, and
    // only an https one is handed to the model, the same rule the alt text uses.
    expect(action).toContain('getMediaItem(site.tenantId, imageId)');
    expect(action).toContain('/^https:\\/\\//i.test(item.url)');
    expect(action).toContain('featurePageImage(');
  });

  it('never names the model endpoint or key where an error could echo it', () => {
    expect(action).not.toContain('api.anthropic.com');
    expect(action).not.toContain('ANTHROPIC_API_KEY');
  });
});
