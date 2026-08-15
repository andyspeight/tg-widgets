/**
 * A stand-in for the writing assistant, harness only.
 *
 * The real action imports the Postgres driver and calls api.anthropic.com with a
 * key that bills Travelgenix. Neither belongs in a file served from a static
 * host, and the second one would mean every open of the review copy could spend
 * money.
 *
 * WHAT IT ANSWERS WITH, AND WHY IT IS NOT LOREM IPSUM
 *
 * Real-shaped copy: two paragraphs for a write, a shorter version for shorter, a
 * list when the request sounds like one. That is what makes the browser checks
 * worth anything. A double returning "ok" proves the button is wired; a double
 * returning two paragraphs proves the paragraphs land where the caret was, that
 * they replace a highlighted run rather than doubling it, and that the panel
 * closes afterwards.
 *
 * It goes through toCopy, the SAME conversion the real one uses, so the escaping
 * and the paragraph splitting under test are the real ones rather than a
 * hand-written approximation of them.
 */

import { toCopy } from '../lib/ai/copy';
import { isAiIntent } from '../lib/ai/prompt';

/** Long enough to see wrap, short enough to read in a check. */
const WRITTEN = `We put together tailor-made trips to Greece and Cyprus, and we
have been doing it since 1994.

Every itinerary is planned by somebody who has been there, so what you get is a
holiday shaped around how you actually travel.`;

const SHORTER = 'Tailor-made trips to Greece and Cyprus, planned by people who have been.';

const LONGER = `We put together tailor-made trips to Greece and Cyprus, and we have
been doing it since 1994.

Every itinerary is planned by somebody who has been there. That means the ferry
timings are right, the rooms face the way you were told, and the walk to the
village is the one you were promised.

If something is not working on the day, there is a person to ring.`;

const LIST = `Three reasons to book with us:

- Every trip planned by somebody who has been there
- No package deals, ever
- A person to ring when you are away`;

export async function writeCopyAction(input: unknown) {
  const fields = (input ?? {}) as Record<string, unknown>;
  const intent = isAiIntent(fields.intent) ? fields.intent : 'write';
  const instruction = typeof fields.instruction === 'string' ? fields.instruction : '';
  const selection = typeof fields.selection === 'string' ? fields.selection : '';

  // The same refusals the real action makes, so a check can see them without a
  // server. Not the membership one: the harness has no session, and pretending
  // to enforce a gate here would test the double rather than the product.
  if (!instruction.trim() && !selection.trim()) {
    return { ok: false as const, error: 'Say what you would like written.' };
  }

  /*
   * A way to see the failure path in a browser without breaking anything.
   * Typing "fail" into the panel gets the same shape of refusal a spent
   * allowance or an unreachable model produces.
   */
  if (/\bfail\b/i.test(instruction)) {
    return {
      ok: false as const,
      error: 'The assistant is busy right now. Try again in a moment.',
      retryable: true,
    };
  }

  const text =
    intent === 'shorter'
      ? SHORTER
      : intent === 'longer'
        ? LONGER
        : intent === 'improve'
          ? `${selection.trim()} And every trip is planned by somebody who has been.`
          : intent === 'title'
            ? 'Tailor-made trips to Greece and Cyprus'
            : /\b(reasons?|list|bullets?|points?)\b/i.test(instruction)
              ? LIST
              : WRITTEN;

  return { ok: true as const, data: toCopy(text) };
}

import type * as real from '../app/actions/ai';

// The satisfies clause is what keeps this honest: a change to the real
// signature fails the typecheck here rather than at the next browser run.
/**
 * Alt text, in the review copy.
 *
 * NOT A FIXED STRING, for the same reason the copy above is not lorem ipsum. A
 * double answering "a photograph" would prove the button is wired and nothing
 * else. This answers with something of a plausible SHAPE and LENGTH, so a check
 * can see it land in the right field, replace what was there, and stay inside
 * the cap.
 *
 * THE REAL ONE CANNOT RUN HERE ANYWAY, and it says so honestly rather than
 * timing out: the demo image bank hands back data: URIs, and the API follows a
 * URL rather than reading a file, so the real action refuses anything that is
 * not https. This double stands in for the answer, not for that check.
 */
export async function describeImageAction(input: unknown): Promise<real.AltResult> {
  const fields = (input ?? {}) as Record<string, unknown>;
  const id = typeof fields.id === 'string' ? fields.id : '';
  if (!id) return { ok: false, error: 'No picture was chosen.' };

  return {
    ok: true,
    alt: 'A whitewashed church above a bay, with fishing boats moored below.',
  };
}

/**
 * The search title and description, in the review copy.
 *
 * BUILT FROM THE TEXT IT WAS GIVEN rather than fixed, because the thing worth
 * checking in a browser is that the answer reaches the two fields and that a
 * page with nothing on it is refused. A fixed pair would pass whether or not
 * the editor ever sent the page's words.
 */
export async function writeSeoAction(input: unknown): Promise<real.SeoResult> {
  const fields = (input ?? {}) as Record<string, unknown>;
  const pageText = typeof fields.text === 'string' ? fields.text : '';
  const pageTitle = typeof fields.pageTitle === 'string' ? fields.pageTitle : 'This page';

  // The same refusal the real one makes, so the check for it is real.
  if (pageText.trim().length < 40) {
    return {
      ok: false,
      error: 'There is not enough on this page yet to describe. Add some words first.',
    };
  }

  const words = pageText.split(/\s+/).filter(Boolean).slice(0, 18).join(' ');

  return {
    ok: true,
    title: `${pageTitle} for UK travellers`.slice(0, 60),
    description: `${words}`.slice(0, 160),
  };
}

const _seo = writeSeoAction satisfies typeof real.writeSeoAction;
void _seo;

const _describe = describeImageAction satisfies typeof real.describeImageAction;
void _describe;

const _write = writeCopyAction satisfies typeof real.writeCopyAction;
void _write;

/*
 * The section builder, doubled. Same reasoning as the copy double above: the
 * real action bills Anthropic and reaches Postgres, neither of which belongs in
 * a file served from a static host.
 *
 * IT RUNS THE REAL NORMALISER on a canned model answer, exactly as the copy
 * double runs the real toCopy. So the browser check exercises the actual
 * validate-and-sanitise path and proves what matters: a built section lands on
 * the canvas, is selected, and is editable like any other. Typing "fail" gets
 * the failure path without a server.
 */
import { sectionFromModel } from '../lib/ai/section-build';

const DEMO_MODEL_SECTION = {
  name: 'Why book with us',
  tone: 'subtle',
  width: 'contained',
  rows: [
    { columns: [{ blocks: [{ type: 'heading', props: { html: 'Why book with us', level: 'h2', align: 'centre' } }] }] },
    {
      columns: [
        { blocks: [{ type: 'icon-item', props: { icon: 'map', title: 'Planned by people who have been', body: 'Every trip is shaped by someone who knows the place, so the details are right.', align: 'centre' } }] },
        { blocks: [{ type: 'icon-item', props: { icon: 'shield', title: 'ABTA and ATOL protected', body: 'Your money and your holiday are covered, every time.', align: 'centre' } }] },
        { blocks: [{ type: 'icon-item', props: { icon: 'phone', title: 'On the end of the phone', body: 'We are here while you travel, not just while you book.', align: 'centre' } }] },
      ],
    },
    { columns: [{ blocks: [{ type: 'button-group', props: { align: 'centre', buttons: [{ label: 'Start an enquiry', variant: 'primary' }] } }] }] },
  ],
};

export async function buildSectionAction(input: unknown) {
  const fields = (input ?? {}) as Record<string, unknown>;
  const instruction = typeof fields.instruction === 'string' ? fields.instruction.trim() : '';

  if (!instruction) {
    return { ok: false as const, error: 'Describe the section you want.' };
  }
  if (/\bfail\b/i.test(instruction)) {
    return {
      ok: false as const,
      error: 'The builder could not put that together. Try describing it a little differently.',
      retryable: true,
    };
  }

  const result = sectionFromModel(DEMO_MODEL_SECTION);
  if (!result.ok) {
    return { ok: false as const, error: 'Something went wrong building that. Try again.' };
  }
  return { ok: true as const, section: result.section };
}

const _build = buildSectionAction satisfies typeof real.buildSectionAction;
void _build;

/*
 * The page builder, doubled. Same reasoning again: the real action bills
 * Anthropic and reaches Postgres. This runs the REAL planFromModel and
 * sectionsFromPlan on a canned plan, so the engine under test is the real one,
 * and it returns a page of the shape the editor navigates to. The browser check
 * stops at the composer rather than completing a build, because a real create
 * navigates and a static file cannot follow, so this stands in for the answer.
 */
import { planFromModel, sectionsFromPlan } from '../lib/ai/page-build';
import { parsePage, type Page } from '../lib/content/schema';

const DEMO_PAGE_PLAN = JSON.stringify([
  {
    preset: 'blank-opener',
    heading: 'Walking holidays in the Dolomites',
    body: 'Guided and self-guided trips through the high meadows, planned around how far you like to walk.',
  },
  { preset: 'features-three-icons', heading: 'Why walk with us' },
  {
    preset: 'cta-centred',
    heading: 'Tell us where you fancy',
    body: 'One line and we will come back with something worth reading.',
  },
]);

function demoPage(input: unknown): Page {
  const parsed = parsePage(input);
  if (!parsed.ok) throw new Error(`demo AI page fixture is malformed: ${parsed.errors.join('; ')}`);
  return parsed.page;
}

export async function createAiPageAction(input: unknown): Promise<real.AiPageResult> {
  const fields = (input ?? {}) as Record<string, unknown>;
  const title = typeof fields.title === 'string' ? fields.title.trim() : '';
  const brief = typeof fields.brief === 'string' ? fields.brief.trim() : '';
  const imageId = typeof fields.imageId === 'string' ? fields.imageId.trim() : '';

  // The same refusal the real action makes: a brief, a picture, or both.
  if (!brief && !imageId) return { ok: false, error: 'Say what the page is for, or add a picture.' };
  if (/\bfail\b/i.test(brief)) {
    return {
      ok: false,
      error: 'The builder could not put that page together. Try describing it a little differently.',
      retryable: true,
    };
  }

  const plan = planFromModel(DEMO_PAGE_PLAN);
  if (!plan.ok) return { ok: false, error: 'Something went wrong building that page. Try again.' };

  const name = title || 'New page';
  const content = demoPage({ version: 1, id: 'demo-ai', slug: 'ai-page', title: name, sections: sectionsFromPlan(plan.plan) });

  return {
    ok: true,
    data: {
      id: 'demo-ai',
      parentId: null,
      slug: 'ai-page',
      title: name,
      status: 'draft',
      hasUnpublishedChanges: true,
      publishedAt: null,
      updatedAt: new Date(),
      content,
    },
  };
}

const _page = createAiPageAction satisfies typeof real.createAiPageAction;
void _page;
