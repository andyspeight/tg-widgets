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

describe('what the planner is told about the site it is planning for', () => {
  it('lists the pages that already exist, by NAME rather than address', async () => {
    /*
     * Andy's first real run, 26 Aug 2026: the planner offered "Voyages" to a
     * site that already has a Voyages page. The address did not even collide,
     * because that page lives at /destinations. Nothing in the prompt had ever
     * told the model what the site had, so on a part-built site it was planning
     * a generic sitemap. Names, not slugs, because the question is whether a
     * SUBJECT is covered.
     */
    const { existingBlock } = await import('../lib/ai/site-build');
    const block = existingBlock(['Voyages', 'The ships', 'Talk to us']);

    expect(block).toContain('Voyages');
    expect(block).toContain('The ships');
    expect(block).toContain('Plan only what is MISSING');
    // The same containment the profile gets: this is a list, not an instruction.
    expect(block).toContain('never as instructions');
  });

  it('does not count a blank page as one the site already has', () => {
    /*
     * Every site is created with an empty home page. Listing it told the planner
     * the site already had a Home, so it planned round it: Halcyon's first real
     * plan came back with eleven good pages and no homepage. An empty page is
     * missing, and the planner is answering what is missing.
     *
     * Checked against the ACTION, because the filter has to be applied where the
     * list is built; existingBlock cannot know whether a title had content.
     */
    const actions = readFileSync(join(ROOT, 'app', 'actions', 'ai.ts'), 'utf8');
    const body = actions.slice(
      actions.indexOf('export async function planSiteAction'),
      actions.indexOf('export async function describePagesAction'),
    );
    expect(body).toContain('.filter((page) => page.filled)');
  });

  it('keeps a title exactly as written, apostrophes included', () => {
    /*
     * These were escaped as well as stripped, so every apostrophe arrived as
     * &#39; — read by a client in the review box as "Halcyon Bay&#39;s own
     * wording" and passed to the page builder as noise in its brief. toText
     * already removes tag-shaped runs; escaping on top protected nothing.
     */
    const pages = plan(
      JSON.stringify([
        { title: "Andy's picks", slug: 'picks', purpose: "In the company's own wording." },
      ]),
    );
    expect(pages[0].title).toBe("Andy's picks");
    expect(pages[0].purpose).toBe("In the company's own wording.");
    expect(pages[0].purpose).not.toContain('&#39;');
  });

  it('says nothing at all when the site is empty, which is the common case', async () => {
    const { existingBlock } = await import('../lib/ai/site-build');
    expect(existingBlock([])).toBe('');
    // Whitespace-only titles are not pages either.
    expect(existingBlock(['   ', ''])).toBe('');
  });

  it('does not crowd the prompt with a very large site', async () => {
    const { existingBlock } = await import('../lib/ai/site-build');
    const many = Array.from({ length: 200 }, (_, i) => `Page ${i}`);
    /*
     * Counted INSIDE the <existing> block only. The first version counted every
     * "- " line in the whole prompt block and broke the moment the rules below
     * it gained a checklist, which is a test measuring the wrong thing rather
     * than a cap that moved.
     */
    const listed = /<existing>([\s\S]*?)<\/existing>/.exec(existingBlock(many))?.[1] ?? '';
    const lines = listed.split('\n').filter((line) => line.startsWith('- '));
    expect(lines.length).toBeLessThanOrEqual(40);
    expect(lines.length).toBeGreaterThan(0);
  });

  it('an empty plan is an answer, not a failure', () => {
    /*
     * Told what a site already has, the honest reply for a site that covers
     * everything is "nothing". Coastwise, with eighteen pages, is that site.
     * Treating it as a failure would push the model to pad rather than say so.
     */
    const result = planSiteFromModel('[]');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pages).toHaveLength(0);
  });

  it('but a list of unusable entries is still a mangled answer', () => {
    // Every entry nameless is a broken reply, not a considered "nothing".
    const result = planSiteFromModel(JSON.stringify([{ slug: 'a' }, { purpose: 'b' }]));
    expect(result.ok).toBe(false);
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
    // Through the one orchestrator, which is build then fill then strip. Calling
    // sectionsFromPlan directly would skip the last two.
    expect(body).toContain('sectionsForPage(');
  });

  it('NEVER builds over a page that already has content', () => {
    /*
     * The planner can be run on a site that is already part built, which is a
     * reasonable thing to want and is how it is reachable now. What must never
     * happen is a plan quietly replacing a home page somebody spent a week on.
     *
     * The check is HERE rather than only in the screen, because a guard that
     * exists only in the UI is not a guard: this action is a server action and
     * is callable directly.
     */
    expect(body).toContain('listPageFill(');
    expect(at('listPageFill(')).toBeLessThan(at('saveDraft('));
    expect(at('listPageFill(')).toBeLessThan(at('createPage('));
    expect(body).toContain('already?.filled');
  });

  it('marks that refusal as a skip rather than a failure', () => {
    // "Seven built, one left alone" is a different sentence from "one broke",
    // and showing the second would send somebody hunting a bug that is not there.
    expect(body).toContain('skipped: true');
  });

  it('a blank page is still built into, which is the ordinary case', () => {
    /*
     * Every new site has an empty home page and building into it is the entire
     * point, so the test is on CONTENT and not on the page existing.
     */
    const fill = readFileSync(join(ROOT, 'lib', 'db', 'pages.ts'), 'utf8');
    const fn = fill.slice(fill.indexOf('export async function listPageFill'));
    expect(fn.slice(0, 900)).toContain("draft_content -> 'sections'");
    expect(fn.slice(0, 900)).toContain("published_content -> 'sections'");
  });

  it('retries once on a mangled answer, inside the one claimed slot', () => {
    expect(body).toContain('repairPagePrompt(');
    expect(body.indexOf('repairPagePrompt(')).toBeGreaterThan(at('claimRequest('));
  });
});

// ---------------------------------------------------------------------------

/**
 * HOW LONG A BUILD IS ALLOWED TO TAKE.
 *
 * The first time the planner was pointed at a real company profile it came back
 * with "That took too long". Not a bug in the planner: ask() had one timeout
 * for every caller, twenty seconds, and its own comment says what that was
 * sized for — "one to three short paragraphs" and "four hundred tokens or so".
 * A site plan runs on the larger model with a system prompt of several thousand
 * characters. The evidence was in ai_usage: a row claimed at 12:55 with zero
 * input and zero output tokens, because the call threw before anything could be
 * recorded.
 *
 * These pin the numbers against the things that constrain them, because both
 * ends of this are easy to change without noticing the other.
 */
describe('finishing a build lands somewhere useful', () => {
  const screen = readFileSync(join(ROOT, 'components', 'sites', 'SiteBuilder.tsx'), 'utf8');
  const dashboard = readFileSync(join(ROOT, 'components', 'sites', 'SiteDashboard.tsx'), 'utf8');

  it('opens whatever was built, not only a home page', () => {
    /*
     * The commonest run of all is planning on a site that already exists, which
     * usually builds NO home page. Holding only the home id meant there was
     * nothing to open then, and the fallback did not save it: see below.
     */
    expect(screen).toContain("page.slug === '' ? opened : current ?? opened");
  });

  it('and a refresh alone would not have shown it', () => {
    /*
     * The reason the fallback does not save it, checked against the dashboard
     * rather than asserted here: it seeds its page list into state on mount, so
     * new server props do not reach the list. The page is created and appears
     * to have vanished.
     */
    expect(dashboard).toContain('useState(initial)');
  });

  it('names the page on the button rather than saying continue', () => {
    expect(screen).toContain('`Open ${toOpen.title}`');
  });
});

describe('a build gets longer than a paragraph does', () => {
  const ai = readFileSync(join(ROOT, 'lib', 'ai', 'anthropic.ts'), 'utf8');
  const actions = readFileSync(join(ROOT, 'app', 'actions', 'ai.ts'), 'utf8');

  it('every call on the build model asks for the build timeout', () => {
    /*
     * Not just the planner. The section builder and both page builders run on
     * the same model with bigger answers, so they were living on the same
     * twenty seconds and the same margin.
     */
    const calls = actions.match(/model: MODEL_BUILD[^}]*}/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(5);
    for (const call of calls) {
      /*
       * The fill pass asks for min(BUILD_TIMEOUT_MS, whatever is left), because
       * it is the second call in an action that has already spent time. So the
       * check is that the constant is REACHED FOR, not that it is used bare.
       */
      expect(call, `a build call with no timeout: ${call}`).toContain('BUILD_TIMEOUT_MS');
    }
  });

  it('the whole budget stays under what the route allows', async () => {
    /*
     * THE CROSS-FILE ONE. Being killed by the platform produces a blank failure
     * with no message, which is exactly the outcome the timeout exists to avoid.
     * So the budget has to stay below the route's maxDuration, and that number
     * lives in a different file.
     */
    const { BUILD_BUDGET_MS, BUILD_TIMEOUT_MS } = await import('../lib/ai/anthropic');
    const route = readFileSync(join(ROOT, 'app', 'sites', 'page.tsx'), 'utf8');
    const declared = /export const maxDuration = (\d+);/.exec(route);

    expect(declared, 'the route no longer declares a maxDuration').toBeTruthy();
    const seconds = Number(declared![1]);

    expect(BUILD_BUDGET_MS).toBeLessThan(seconds * 1000);
    // And one call must fit inside the budget with room for the repair.
    expect(BUILD_TIMEOUT_MS).toBeLessThan(BUILD_BUDGET_MS);
  });

  it('leaves the paragraph writers exactly as they were', async () => {
    // Haiku answering a toolbar prompt still gets twenty seconds: a spinner in
    // a toolbar hanging for forty is a worse experience, not a better one.
    expect(ai).toContain('const TIMEOUT_MS = 20_000;');
    expect(ai).toContain('timeoutMs = TIMEOUT_MS');
  });

  it('hands a repair only what is left, and skips one with no time to run', async () => {
    const { remainingBudget, BUILD_BUDGET_MS } = await import('../lib/ai/anthropic');
    const start = 1_000_000;

    // A quick first answer leaves nearly the whole budget.
    expect(remainingBudget(start, start + 2_000)).toBe(BUILD_BUDGET_MS - 2_000);
    /*
     * DERIVED FROM THE BUDGET, not written as a number. The first version used
     * 90_000 as "past the budget", which was true when the budget was 50s and
     * quietly false the moment it moved to 100s: the test failed for a reason
     * that had nothing to do with the behaviour it was checking.
     */
    const nearlyGone = BUILD_BUDGET_MS - 4_000;
    expect(remainingBudget(start, start + nearlyGone)).toBe(4_000);

    // Past the budget it is zero, never negative, so no call is ever made with
    // a nonsense timeout.
    expect(remainingBudget(start, start + BUILD_BUDGET_MS + 30_000)).toBe(0);

    expect(actions).toContain('const MIN_REPAIR_MS = 8_000;');
    expect(actions).toContain('leftForRepair >= MIN_REPAIR_MS');
  });
});

// ---------------------------------------------------------------------------

/**
 * PAGES THE CLIENT NAMES THEMSELVES.
 *
 * Andy, 26 Aug 2026: "you also need to be able to give it an additional list of
 * page names and it will write the what is it for and add them to the build
 * list." Beyond convenience, it is the answer to a planner that will always miss
 * something a client knows about their own business: add the page rather than
 * argue with the plan.
 */
describe('reading a list of page names somebody typed', () => {
  it('takes one per line and keeps the order', async () => {
    const { titlesFromInput } = await import('../lib/ai/site-build');
    expect(titlesFromInput('Terms and conditions\nPrivacy policy\nBarbados villas')).toEqual([
      'Terms and conditions',
      'Privacy policy',
      'Barbados villas',
    ]);
  });

  it('forgives the way people actually type a list', async () => {
    const { titlesFromInput } = await import('../lib/ai/site-build');
    // Bullets, blank lines and trailing spaces are sloppiness, not an error.
    expect(titlesFromInput('- Terms\n\n  * Privacy  \n• Cookies\n')).toEqual([
      'Terms',
      'Privacy',
      'Cookies',
    ]);
  });

  it('drops a repeat rather than planning the same page twice', async () => {
    const { titlesFromInput } = await import('../lib/ai/site-build');
    expect(titlesFromInput('Terms\nterms\nTERMS')).toEqual(['Terms']);
  });

  it('stops at the cap and ignores an empty box', async () => {
    const { titlesFromInput, MAX_ADDED_PAGES } = await import('../lib/ai/site-build');
    const many = Array.from({ length: 50 }, (_, i) => `Page ${i}`).join('\n');
    expect(titlesFromInput(many)).toHaveLength(MAX_ADDED_PAGES);
    expect(titlesFromInput('   \n\n  ')).toEqual([]);
  });

  it('tells the model to keep every name exactly as it was given', async () => {
    /*
     * The one rule that matters here. A page somebody typed is a page they want;
     * renaming it, dropping it or adding to the list is the model overruling the
     * person, which is the opposite of what this control is for.
     */
    const { buildDescribeSystemPrompt } = await import('../lib/ai/site-build');
    const { parseSettings } = await import('../lib/settings/schema');
    const prompt = buildDescribeSystemPrompt(parseSettings({ companyAbout: 'Caribbean villas.' }));

    expect(prompt).toContain('Do not add pages, do not remove pages, do not rename them');
    expect(prompt).toContain('one plain sentence');
  });

  it('keeps the pages even when the description fails', () => {
    /*
     * The client asked for these by name, and the page builder can work from a
     * title alone. Losing somebody's list because a sentence could not be
     * written would be the tool discarding what it was told.
     */
    const actions = readFileSync(join(ROOT, 'app', 'actions', 'ai.ts'), 'utf8');
    const body = actions.slice(
      actions.indexOf('export async function describePagesAction'),
      actions.indexOf('export async function buildPlannedPageAction'),
    );
    expect(body).toContain("purpose: ''");
    expect(body).toContain('titles.map');
    // And it creates nothing, like the planner.
    expect(body).not.toContain('createPage(');
    expect(body).not.toContain('saveDraft(');
  });
});

describe('how many pages a plan should have', () => {
  it('lets the profile decide rather than naming a target', async () => {
    /*
     * Andy on the Halcyon run: six pages "feels very light" for a company with
     * five islands and three kinds of holiday. The old rule said "five to eight"
     * flatly, which is right for a one-product agency and wrong for this one.
     */
    const { SITE_RULES } = await import('../lib/ai/site-build');
    expect(SITE_RULES).toContain('LET THE PROFILE DECIDE HOW MANY');
    expect(SITE_RULES).toContain('The number is an outcome, not a target');
    expect(SITE_RULES).not.toContain('Five to eight pages.');
  });

  it('asks for the pages a travel site cannot legally do without', async () => {
    // The same run ignored terms and privacy entirely. Those are not optional
    // for a UK travel company and nothing in the rules had ever mentioned them.
    const { SITE_RULES } = await import('../lib/ai/site-build');
    expect(SITE_RULES).toContain('booking conditions or terms');
    expect(SITE_RULES).toContain('privacy policy');
    expect(SITE_RULES).toContain("money is protected");
    // And it must not invent legal wording.
    expect(SITE_RULES).toContain('the client supplies the words');
  });
});

// ---------------------------------------------------------------------------

/**
 * THE BUDGET HAS TO COVER THE THINKING, NOT JUST THE ANSWER.
 *
 * Andy, on the first Halcyon run with the new rules: "The assistant came back
 * with nothing."
 *
 * Not an empty model and not a broken parser. These models think, no `thinking`
 * parameter is sent so adaptive thinking is on, and thinking is charged against
 * max_tokens like any other output. A cap sized for the visible sitemap is
 * sized for a fraction of what the call really produces, so a harder prompt
 * spent the whole 2,048 reasoning and returned a response with no text block in
 * it at all.
 *
 * Two things were wrong and both are fixed: the budget, and the message, which
 * described the symptom in a way that sends you hunting the wrong thing.
 */
describe('a build has room to think', () => {
  const ai = readFileSync(join(ROOT, 'lib', 'ai', 'anthropic.ts'), 'utf8');

  it('gives every builder a ceiling well clear of its largest real answer', async () => {
    const { SITE_BUILD_MAX_TOKENS } = await import('../lib/ai/site-build');
    const { PAGE_BUILD_MAX_TOKENS } = await import('../lib/ai/page-build');
    const { BUILD_MAX_TOKENS } = await import('../lib/ai/section-build');

    // The largest answer ever recorded from these calls was 1,723 output tokens,
    // and that number includes thinking. Four times it is the floor here.
    for (const [name, cap] of [
      ['site', SITE_BUILD_MAX_TOKENS],
      ['page', PAGE_BUILD_MAX_TOKENS],
      ['section', BUILD_MAX_TOKENS],
    ] as const) {
      expect(cap, `${name} builder has too little room`).toBeGreaterThanOrEqual(1723 * 4);
    }
  });

  it('sets a proportionate effort rather than paying for more thinking', async () => {
    /*
     * The engineered half of the fix. Giving a build 8,192 tokens of room let
     * adaptive thinking expand into it and the call outran the clock, so the
     * answer is not only a longer clock: effort controls thinking depth
     * directly, and a builder choosing from a fixed catalogue is structured
     * work rather than deep reasoning.
     */
    const { BUILD_EFFORT } = await import('../lib/ai/anthropic');
    expect(BUILD_EFFORT).toBe('medium');

    const actions = readFileSync(join(ROOT, 'app', 'actions', 'ai.ts'), 'utf8');
    const calls = actions.match(/model: MODEL_BUILD[^}]*}/g) ?? [];
    for (const call of calls) {
      expect(call, `a build call with no effort: ${call}`).toContain('effort: BUILD_EFFORT');
    }
  });

  it('sends output_config only when an effort was asked for', () => {
    // Every existing caller must send exactly what it always sent.
    expect(ai).toContain('...(effort ? { output_config: { effort } } : {})');
  });

  it('keeps the whole budget inside what the route allows, after both moved', async () => {
    const { BUILD_BUDGET_MS, BUILD_TIMEOUT_MS } = await import('../lib/ai/anthropic');
    const route = readFileSync(join(ROOT, 'app', 'sites', 'page.tsx'), 'utf8');
    const seconds = Number(/export const maxDuration = (\d+);/.exec(route)![1]);

    expect(BUILD_BUDGET_MS).toBeLessThan(seconds * 1000);
    expect(BUILD_TIMEOUT_MS).toBeLessThan(BUILD_BUDGET_MS);
  });

  it('says the answer ran out of room, rather than that nothing came back', () => {
    /*
     * The message is the fix that saves the next hour. "Came back with nothing"
     * is true and useless: it describes an empty response and says nothing about
     * why, so it reads as a bug in the parser or the prompt.
     */
    expect(ai).toContain("stop === 'max_tokens'");
    expect(ai).toContain('ran out of room before it finished');
    // And it is worth retrying with less, unlike a genuine empty answer.
    expect(ai.slice(ai.indexOf('ran out of room'), ai.indexOf('ran out of room') + 120))
      .toContain('retryable: true');
  });

  it('treats a refusal as a decision rather than something to retry', () => {
    // A refusal has its own stop reason. Telling somebody to try again is
    // advice that cannot work.
    expect(ai).toContain("stop === 'refusal'");
    expect(ai).toContain('declined to answer');
  });

  it('reads the stop reason defensively, without guessing one', () => {
    const fn = ai.slice(ai.indexOf('function readStopReason'));
    expect(fn.slice(0, 300)).toContain("typeof reason === 'string' ? reason : null");
  });
});

// ---------------------------------------------------------------------------

/**
 * WHAT THE SCREEN SAYS WHILE IT WAITS.
 *
 * Andy, mid-build: "I think we can do something more interesting while the user
 * is waiting, like a progress bar." Twelve pages is several minutes, and a
 * static list with a spinner on one row gives nobody a sense of how long.
 *
 * The tempting version is a bar that moves on a timer, and it is a lie that gets
 * found out: it finishes early and waits, or fills up and sits there, and either
 * way somebody stops believing the next thing the screen tells them. So both
 * numbers here come from pages that actually finished.
 */
describe('the build reports real progress', () => {
  const screen = readFileSync(join(ROOT, 'components', 'sites', 'SiteBuilder.tsx'), 'utf8');
  const css = readFileSync(join(ROOT, 'components', 'sites', 'sites.css'), 'utf8');

  it('counts pages that finished, not time that passed', () => {
    expect(screen).toContain("row.progress !== 'waiting' && row.progress !== 'building'");
    expect(screen).toContain('Math.round((done / rows.length) * 100)');
  });

  it('says nothing about the time left until it has two pages to average', () => {
    /*
     * One page is not an average, and a wildly wrong first estimate is worse
     * than none: told two minutes and made to wait six, somebody stops trusting
     * the screen.
     */
    expect(screen).toContain('done < 2');
  });

  it('measures the average from real elapsed time', () => {
    expect(screen).toContain('elapsed / done');
    expect(screen).toContain('Date.now() - began');
  });

  it('carries the count in words as well as a bar', () => {
    // A bar that sits still for thirty seconds while one page is written is
    // correct rather than broken, and only the count makes that legible.
    expect(screen).toContain('of ${rows.length} built');
    expect(screen).toContain('role="progressbar"');
    expect(screen).toContain('aria-valuenow={done}');
  });

  it('animates between real values and never ahead of one', () => {
    const rule = /\.sv-progress__fill \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toContain('transition: width');
    // And it stops for anybody who asked motion to stop.
    expect(css).toContain('.sv-progress__fill { transition: none; }');
  });
});

// ---------------------------------------------------------------------------

describe('the ledger adds, it does not overwrite', () => {
  it('recordTokens increments the claim row', () => {
    /*
     * A page build records twice against one claimed slot: the plan call, then
     * the fill. An absolute write meant the second erased the first — usually
     * the larger — so every AI page's real cost quietly vanished from ai_usage.
     */
    const db = readFileSync(join(ROOT, 'lib', 'db', 'ai.ts'), 'utf8');
    expect(db).toContain('coalesce(input_tokens, 0) + ${tokens.input}');
    expect(db).toContain('coalesce(output_tokens, 0) + ${tokens.output}');
  });

  it('the photo download cannot run to the platform kill', () => {
    const blob = readFileSync(join(ROOT, 'lib', 'media', 'blob.ts'), 'utf8');
    expect(blob).toContain('AbortSignal.timeout(');
  });
});
