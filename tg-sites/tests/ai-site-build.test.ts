/**
 * The site planner's safety net.
 *
 * WHAT IS WORTH TESTING HERE. The prompt is not: a prompt is judged by what
 * comes back, and that costs money and cannot be asserted. What CAN be pinned is
 * everything between the model's answer and a client's site, which is where a
 * wrong answer would do its damage.
 *
 * So these feed planSiteFromModel the answers a model actually gives — a bare
 * array, an object with the array inside it, fenced JSON, missing fields, a
 * second home page, two pages at one address, a slug that would shadow a real
 * route — and check that each one lands as something we would be willing to
 * build, or is refused.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  MAX_SITE_PAGES,
  buildSiteUserPrompt,
  homeFirst,
  planSiteFromModel,
  type PlannedPage,
} from '../lib/ai/site-build';

/** The app root, for the source-order checks on the actions at the foot of this file. */
const ROOT = join(__dirname, '..');

/** The shape of a good answer, as the prompt asks for it. */
const GOOD = JSON.stringify([
  { title: 'Home', slug: '', purpose: 'Introduce the agency and send people to the trips.' },
  { title: 'Where we go', slug: 'where-we-go', purpose: 'The regions they know, for someone still choosing.' },
  { title: 'About us', slug: 'about-us', purpose: 'Who these people are and why to trust them.' },
  { title: 'Enquire', slug: 'enquire', purpose: 'One place to start a conversation.' },
]);

function plan(answer: unknown): PlannedPage[] {
  const result = planSiteFromModel(answer);
  if (!result.ok) throw new Error(`expected a plan, got: ${result.error}`);
  return result.pages;
}

describe('reading a sitemap out of whatever the model said', () => {
  it('takes a plain array, in order', () => {
    const pages = plan(GOOD);
    expect(pages.map((p) => p.slug)).toEqual(['', 'where-we-go', 'about-us', 'enquire']);
    expect(pages[1].title).toBe('Where we go');
    expect(pages[1].purpose).toBe('The regions they know, for someone still choosing.');
  });

  it('digs the array out of an object, whatever the model called it', () => {
    // Models wrap. Asking for a bare array does not stop them.
    for (const key of ['pages', 'sitemap', 'plan', 'items', 'site']) {
      const wrapped = JSON.stringify({ [key]: JSON.parse(GOOD) });
      expect(plan(wrapped), key).toHaveLength(4);
    }
  });

  it('survives markdown fences round the JSON', () => {
    expect(plan('```json\n' + GOOD + '\n```')).toHaveLength(4);
  });

  it('refuses an answer that is not JSON at all', () => {
    const result = planSiteFromModel('I would suggest a home page, an about page and a contact page.');
    expect(result.ok).toBe(false);
  });

  it('refuses an answer with nothing usable in it', () => {
    // Every entry nameless, so there is no page to build.
    const result = planSiteFromModel(JSON.stringify([{ slug: 'a' }, { purpose: 'b' }]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('no usable pages');
  });
});

describe('the rules a plan has to obey before we would build it', () => {
  it('derives a missing slug from the title rather than dropping the page', () => {
    /*
     * A model that omits a slug has still said what the page is. The address is
     * derivable, so losing the whole page would be throwing away a good answer
     * over a missing field.
     */
    const pages = plan(JSON.stringify([{ title: 'Small ship voyages', purpose: 'The trips.' }]));
    expect(pages[0].slug).toBe('small-ship-voyages');
  });

  it('tidies a slug somebody wrote as a title', () => {
    const pages = plan(JSON.stringify([{ title: 'About', slug: 'About Us!', purpose: 'x' }]));
    expect(pages[0].slug).toBe('about-us');
  });

  it('keeps one home page and drops a second', () => {
    const pages = plan(
      JSON.stringify([
        { title: 'Home', slug: '', purpose: 'a' },
        { title: 'Welcome', slug: '/', purpose: 'b' },
        { title: 'Start', slug: 'home', purpose: 'c' },
        { title: 'Contact', slug: 'contact', purpose: 'd' },
      ]),
    );
    // Three ways of writing "the home page" collapse to the first one.
    expect(pages.map((p) => p.slug)).toEqual(['', 'contact']);
    expect(pages[0].title).toBe('Home');
  });

  it('drops a duplicate address rather than renaming it', () => {
    /*
     * Two pages at one address is a plan that thought it had two pages and has
     * one. Renaming the second to "about-2" would hide that from the person
     * being asked to approve it.
     */
    const pages = plan(
      JSON.stringify([
        { title: 'About us', slug: 'about', purpose: 'a' },
        { title: 'Our story', slug: 'about', purpose: 'b' },
      ]),
    );
    expect(pages).toHaveLength(1);
    expect(pages[0].title).toBe('About us');
  });

  it('refuses a slug that something else already answers on', () => {
    const pages = plan(
      JSON.stringify([
        { title: 'Editor', slug: 'editor', purpose: 'a' },
        { title: 'Preview', slug: 'preview', purpose: 'b' },
        { title: 'Journal', slug: 'journal', purpose: 'c' },
      ]),
    );
    expect(pages.map((p) => p.slug)).toEqual(['journal']);
  });

  it('stops at the cap however many come back', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      title: `Page ${i}`,
      slug: `page-${i}`,
      purpose: 'x',
    }));
    expect(plan(JSON.stringify(many))).toHaveLength(MAX_SITE_PAGES);
  });
});

describe('what the model wrote cannot reach a page as markup', () => {
  it('strips markup out of a title and a purpose', () => {
    /*
     * Escape-first, the same rule the page builder and the copy writer follow. A
     * title becomes a page title AND a heading, and a purpose is handed back to
     * the model as a brief, so neither is trusted on the way out.
     */
    const pages = plan(
      JSON.stringify([
        {
          title: '<script>alert(1)</script>Trips',
          slug: 'trips',
          purpose: '<img src=x onerror=alert(1)> The trips.',
        },
      ]),
    );
    expect(pages[0].title).not.toContain('<script');
    expect(pages[0].purpose).not.toContain('<img');
    expect(pages[0].title).toContain('Trips');
  });

  it('caps a title to a menu label and a purpose to a sentence', () => {
    const pages = plan(
      JSON.stringify([
        { title: 'x'.repeat(500), slug: 'long', purpose: 'y'.repeat(2000) },
      ]),
    );
    expect(pages[0].title.length).toBeLessThanOrEqual(60);
    expect(pages[0].purpose.length).toBeLessThanOrEqual(240);
  });

  it('allows a page whose purpose came back empty', () => {
    // The page is still a page. Its brief is thinner, which the builder handles.
    const pages = plan(JSON.stringify([{ title: 'Contact', slug: 'contact' }]));
    expect(pages[0].purpose).toBe('');
  });
});

describe('the plan is also the menu order', () => {
  it('puts home first wherever the model listed it', () => {
    const ordered = homeFirst([
      { title: 'Contact', slug: 'contact', purpose: '' },
      { title: 'Home', slug: '', purpose: '' },
      { title: 'About', slug: 'about', purpose: '' },
    ]);
    expect(ordered.map((p) => p.slug)).toEqual(['', 'contact', 'about']);
  });

  it('leaves the rest of the order alone, because it was asked for', () => {
    /*
     * The model is told to order pages as a visitor would meet them, so the
     * sequence is an answer rather than an accident. Only home is moved.
     */
    const given: PlannedPage[] = [
      { title: 'Home', slug: '', purpose: '' },
      { title: 'Where we go', slug: 'where', purpose: '' },
      { title: 'About', slug: 'about', purpose: '' },
    ];
    expect(homeFirst(given)).toEqual(given);
  });

  it('copes with a plan that has no home page in it', () => {
    const given: PlannedPage[] = [{ title: 'About', slug: 'about', purpose: '' }];
    expect(homeFirst(given)).toEqual(given);
  });
});

describe('the ask itself', () => {
  it('works from the profile alone when nothing extra was said', () => {
    // The ordinary case: the settings screen already carries the profile, so a
    // blank brief is not an error and must not read as one in the prompt.
    expect(buildSiteUserPrompt('   ')).toContain('working from their profile');
  });

  it('passes on what the client said about this particular site', () => {
    const ask = buildSiteUserPrompt('We are dropping the cruise side this year.');
    expect(ask).toContain('dropping the cruise side');
  });

  it('caps the brief, so a pasted document cannot become the prompt', () => {
    expect(buildSiteUserPrompt('z'.repeat(5000)).length).toBeLessThan(600);
  });
});

// ---------------------------------------------------------------------------

/**
 * THE TWO ACTIONS, checked the way the other AI actions are checked: by reading
 * the order things happen in.
 *
 * The properties here are about money and about damage. A planner that spends
 * before it checks, or that writes pages while claiming to propose them, is
 * wrong in a way no unit test of the parser would catch.
 */
describe('planning a site spends nothing it should not, and writes nothing at all', () => {
  const source = readFileSync(join(ROOT, 'app', 'actions', 'ai.ts'), 'utf8');
  const body = source.slice(
    source.indexOf('export async function planSiteAction'),
    source.indexOf('export async function buildPlannedPageAction'),
  );

  const at = (needle: string) => {
    const index = body.indexOf(needle);
    expect(index, `${needle} is not in the action at all`).toBeGreaterThan(-1);
    return index;
  };

  it('is a real slice of the file, not an empty string', () => {
    // Guards every other test here: a renamed action would otherwise pass them all.
    expect(body.length).toBeGreaterThan(500);
  });

  it('checks the key, then membership, then claims, then calls', () => {
    expect(at('aiIsConfigured()')).toBeLessThan(at('requireSite()'));
    expect(at('requireSite()')).toBeLessThan(at('claimRequest('));
    expect(at('claimRequest(')).toBeLessThan(at('await ask('));
  });

  it('records what it cost after the call, not before', () => {
    // Recording first would mean a timeout costs money and counts for nothing.
    expect(at('recordTokens(')).toBeGreaterThan(at('await ask('));
  });

  it('refuses a site with no profile BEFORE taking a slot', () => {
    /*
     * A sitemap planned from a company name alone would fit anybody, which is
     * worse than refusing because it looks like the feature working. Refusing
     * after claiming would also charge somebody a request for the privilege.
     */
    expect(at('hasBrandProfile(settings)')).toBeLessThan(at('claimRequest('));
  });

  it('CREATES NOTHING, which is the whole promise of the plan step', () => {
    /*
     * The plan is a proposal to read and edit. If this wrote pages, approving
     * would be meaningless and a bad plan would already have cost eight pages.
     */
    expect(body).not.toContain('createPage(');
    expect(body).not.toContain('saveDraft(');
    expect(body).not.toContain('updatePageMeta(');
  });

  it('hands back the menu order with home first', () => {
    expect(body).toContain('homeFirst(');
  });
});

describe('building an approved page', () => {
  const source = readFileSync(join(ROOT, 'app', 'actions', 'ai.ts'), 'utf8');
  const body = source.slice(
    source.indexOf('export async function buildPlannedPageAction'),
    source.indexOf('export async function createAiPageAction'),
  );

  const at = (needle: string) => {
    const index = body.indexOf(needle);
    expect(index, `${needle} is not in the action at all`).toBeGreaterThan(-1);
    return index;
  };

  it('is a real slice of the file', () => {
    expect(body.length).toBeGreaterThan(500);
  });

  it('checks the key, then membership, then claims, then calls', () => {
    expect(at('aiIsConfigured()')).toBeLessThan(at('requireSite()'));
    expect(at('requireSite()')).toBeLessThan(at('claimRequest('));
    expect(at('claimRequest(')).toBeLessThan(at('await ask('));
    expect(at('recordTokens(')).toBeGreaterThan(at('await ask('));
  });

  it('UPDATES the home page rather than creating a second one', () => {
    /*
     * Every site already has a home page from the starter and an address belongs
     * to one page, so a create would fail the unique index and "build my site"
     * would skip the most important page in it.
     */
    expect(body).toContain('saveDraft(');
    expect(at('saveDraft(')).toBeLessThan(at('createPage('));
    expect(body).toContain("fields.slug === ''");
  });

  it('keeps everything about the home page except its sections', () => {
    // Building the home page is not the same as replacing it: the address, the
    // SEO and its place in the tree all survive.
    expect(body).toContain('...existing.content');
  });

  it('puts the address through the same gate the planner used', () => {
    expect(body).toContain('safeSlug(fields.slug)');
  });

  it('reuses the page builder rather than repeating it', () => {
    // The purpose from the plan IS the brief. Nothing about how a page is
    // composed belongs in this action.
    expect(body).toContain('buildPageSystemPrompt(');
    expect(body).toContain('planFromModel(');
    expect(body).toContain('sectionsFromPlan(');
  });

  it('retries once on a mangled answer, inside the one claimed slot', () => {
    expect(body).toContain('repairPagePrompt(');
    expect(body.indexOf('repairPagePrompt(')).toBeGreaterThan(at('claimRequest('));
  });
});
