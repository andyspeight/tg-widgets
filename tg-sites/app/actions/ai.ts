'use server';

/**
 * The writing assistant.
 *
 * ONE ACTION, AND FOUR THINGS HAVE TO BE TRUE BEFORE IT SPENDS ANY MONEY
 *
 *   1. There is a session, and it belongs to a member of this site. requireSite
 *      throws otherwise, so the failure is a refusal rather than a default.
 *   2. The intent is one of five known strings. Not "a string", not "trimmed and
 *      hopefully fine": a member of a closed set, checked here.
 *   3. The site has slots left in its daily allowance, taken from the database
 *      rather than from memory. See lib/db/ai.ts for why that distinction matters
 *      on serverless.
 *   4. The key is configured, which it will not be in a preview deployment
 *      somebody forgot to set it on, and that should read as "not switched on"
 *      rather than as a crash.
 *
 * A SERVER ACTION IS A PUBLIC ENDPOINT. Next generates the URL and puts it in the
 * page's own JavaScript, so every one of those checks has to be here. A toolbar
 * button that only appears for members is a courtesy to the person looking at the
 * screen and no obstacle at all to anybody reading the bundle.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It does not write anything to the page. It returns copy, and the editor puts it
 * where the caret is, through the same undo history as typing. An assistant that
 * saved for you would be an assistant whose mistakes are already in the database.
 */

import {
  currentUserId,
  isSignInRequired,
  requireSite,
} from '../../lib/auth/session';
import {
  aiIsConfigured,
  AiError,
  ask,
  BUILD_EFFORT,
  BUILD_TIMEOUT_MS,
  MODEL_BUILD,
  remainingBudget,
} from '../../lib/ai/anthropic';
import {
  BUILD_MAX_TOKENS,
  buildSystemPrompt,
  buildUserPrompt,
  MAX_BUILD_INSTRUCTION,
  repairUserPrompt,
  sectionFromModel,
} from '../../lib/ai/section-build';
import type { Section } from '../../lib/content/schema';
import { pexelsConfigured, searchPexels } from '../../lib/media/pexels';
import { blobConfigured } from '../../lib/media/blob';
import { importStockAction } from './media';
import { toCopy, type Copy } from '../../lib/ai/copy';
import {
  isAiIntent,
  MAX_PAGE_TEXT,
  parseSeoAnswer,
  profileBlock,
  seoPrompt,
  seoRules,
  MAX_INSTRUCTION,
  MAX_SELECTION,
  systemPrompt,
  userPrompt,
  type AiIntent,
} from '../../lib/ai/prompt';
import { claimRequest, DAILY_LIMIT, recordTokens } from '../../lib/db/ai';
import { describePicture, fetchableByModel } from '../../lib/ai/alt';
import { getMediaItem } from '../../lib/db/media';
import { fillPagePhotos } from '../../lib/media/photo-fill';
import { createPage, getPage, listPageFill, listPages, saveDraft, type PageWithContent } from '../../lib/db/pages';
import { slugify } from '../../lib/content/slug';
import { safeSlug } from '../../lib/content/collection';
import {
  buildPageSystemPrompt,
  stripPlaceholders,
  buildPageUserPrompt,
  dressPage,
  dropStubSections,
  featurePageImage,
  MAX_PAGE_BRIEF,
  PAGE_BUILD_MAX_TOKENS,
  planFromModel,
  repairPagePrompt,
  sectionsFromPlan,
  wireButtons,
} from '../../lib/ai/page-build';
import {
  pairingCatalogue,
  THEME_OUTPUT_SHAPE,
  THEME_RULES,
  themeFromModel,
} from '../../lib/ai/theme-design';
import { applyDesignedTheme } from '../../lib/ai/theme-apply';
import { getTheme } from '../../lib/db/theme';
import { themeIsDefault } from '../../lib/theme/schema';
import { getRegion, saveRegionDraft } from '../../lib/db/regions';
import { currentCapabilities, PermissionError, requireCapability } from '../../lib/auth/capabilities';
import { buildStarterRegion } from '../../lib/content/starters';
import type { Region, RegionName } from '../../lib/content/schema';
import { DESCRIPTION_MAX, DESCRIPTION_MIN, TITLE_MAX } from '../../lib/seo/audit';
import { getSettings } from '../../lib/db/settings';
import type { StarterSection } from '../../lib/content/starters';
import type { SiteSettings } from '../../lib/settings/schema';
import {
  FILL_MAX_TOKENS,
  applyFill,
  buildFillSystemPrompt,
  buildFillUserPrompt,
  fillFromModel,
  slotsOf,
  stripUnfilled,
} from '../../lib/ai/page-fill';
import { hasBrandProfile } from '../../lib/settings/schema';
import {
  MAX_SITE_BRIEF,
  SITE_BUILD_MAX_TOKENS,
  buildSiteSystemPrompt,
  buildSiteUserPrompt,
  buildDescribeSystemPrompt,
  buildDescribeUserPrompt,
  homeFirst,
  planSiteFromModel,
  titlesFromInput,
  repairSitePrompt,
  type PlannedPage,
  ensureMustHavePages,
} from '../../lib/ai/site-build';
import { revalidatePath } from 'next/cache';

export type AiResult =
  | { ok: true; data: Copy }
  | { ok: false; error: string; retryable?: boolean };

/**
 * A string off the wire, at a length we are willing to pay for.
 *
 * The cap is applied HERE as well as in the prompt builder, and that repetition is
 * deliberate: this is the boundary where somebody else's input arrives, and the
 * prompt builder is a pure function that should not be the only thing standing
 * between a paste and a bill.
 */
function text(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

export async function writeCopyAction(input: unknown): Promise<AiResult> {
  try {
    if (!aiIsConfigured()) {
      return { ok: false, error: 'The writing assistant is not switched on yet.' };
    }

    // Membership first, before anything is read or parsed. A refusal should not
    // depend on what was sent.
    const site = await requireSite();
    // The id off the session claims rather than currentUser(), which costs a
    // query to fetch a name and an email this does not want.
    const userId = await currentUserId();

    const fields = (input ?? {}) as Record<string, unknown>;

    const intent: AiIntent = isAiIntent(fields.intent) ? fields.intent : 'write';
    const instruction = text(fields.instruction, MAX_INSTRUCTION);
    const selection = text(fields.selection, MAX_SELECTION);

    /*
     * Something has to be asked for. Without this, an empty request would produce
     * a paid-for paragraph about nothing, and the button is one keystroke away
     * from being pressed by accident.
     */
    if (!instruction && !selection) {
      return { ok: false, error: 'Say what you would like written.' };
    }

    /*
     * The slot is taken BEFORE the model is called, so a call that fails still
     * counts. Otherwise a request that reliably errors is a request outside the
     * limit, and the charge lands anyway.
     */
    const claim = await claimRequest(site.tenantId, { userId, intent });

    if (!claim.allowed) {
      return {
        ok: false,
        error:
          `This site has used all ${DAILY_LIMIT} of today's writing requests. `
          + 'It resets through the day, so try again later.',
      };
    }

    const settings = await getSettings(site.tenantId);
    const answer = await ask(
      systemPrompt(settings),
      userPrompt({ intent, instruction, selection }),
    );

    // Best effort, and it must not fail the request: there is an answer for the
    // person waiting, and the slot has already been counted.
    if (claim.id) {
      await recordTokens(site.tenantId, claim.id, {
        input: answer.inputTokens,
        output: answer.outputTokens,
      });
    }

    const copy = toCopy(answer.text);
    if (!copy.text) {
      return {
        ok: false,
        error: 'The assistant came back with nothing usable. Try asking again.',
        retryable: true,
      };
    }

    return { ok: true, data: copy };
  } catch (error) {
    if (error instanceof AiError) {
      return { ok: false, error: error.message, retryable: error.retryable };
    }
    if (isSignInRequired(error)) {
      return { ok: false, error: (error as Error).message };
    }

    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('This account is not a member')) {
      return { ok: false, error: message };
    }

    /*
     * Everything else is generic on purpose. An error thrown anywhere below this
     * line has had the prompt in scope, and the prompt has the client's profile
     * in it.
     */
    console.error('[tg-sites] the writing assistant failed', error);
    return { ok: false, error: 'Something went wrong asking for that. Try again.' };
  }
}

export type AltResult =
  | { ok: true; alt: string }
  | { ok: false; error: string; retryable?: boolean };

/**
 * Alt text for one picture in the image bank.
 *
 * THE SAME FOUR GATES as writeCopyAction, and they are repeated rather than
 * shared because a server action is a PUBLIC ENDPOINT: Next generates the URL
 * and puts it in the page's own JavaScript, so a button that only appears for
 * members is a courtesy to whoever is looking at the screen and no obstacle at
 * all to anybody reading the bundle.
 *
 * THE ID IS RESOLVED AGAINST THIS TENANT'S OWN MEDIA, and that is the check
 * that matters here rather than in the writing assistant. The caller sends an
 * id and we send the picture at that id to a third party, so without the lookup
 * a guessed id would have another client's photograph described and returned.
 * getMediaItem runs inside the tenant's policy, so an id belonging to somebody
 * else comes back as not found, exactly as a made-up one does.
 *
 * IT DOES NOT SAVE. It returns a sentence and the screen puts it in the field,
 * where somebody reads it before it is kept. A model that looked at a
 * photograph and wrote straight into the database would be one whose mistakes
 * are already published.
 */
export async function describeImageAction(input: unknown): Promise<AltResult> {
  try {
    if (!aiIsConfigured()) {
      return { ok: false, error: 'The writing assistant is not switched on yet.' };
    }

    const site = await requireSite();
    const userId = await currentUserId();

    const fields = (input ?? {}) as Record<string, unknown>;
    const id = text(fields.id, 100);
    if (!id) return { ok: false, error: 'No picture was chosen.' };

    const item = await getMediaItem(site.tenantId, id);
    if (!item) return { ok: false, error: 'That picture is not in this image bank.' };

    /*
     * The model is fetching this URL itself, so it has to be one anybody can
     * fetch. A blob URL is; a data: URI is not a URL the API will follow, which
     * is what the demo doubles hand back, so this fails honestly in a review
     * copy rather than timing out.
     */
    if (!fetchableByModel(item.url)) {
      return { ok: false, error: 'That picture is not somewhere the assistant can see it.' };
    }

    const claim = await claimRequest(site.tenantId, { userId, intent: 'alt' });
    if (!claim.allowed) {
      return {
        ok: false,
        error:
          `This site has used all ${DAILY_LIMIT} of today's AI requests. `
          + 'It resets through the day, so try again later.',
      };
    }

    /*
     * THE HOUSE RULES AND THE ALT RULES, AND NOT THE COMPANY PROFILE. Alt text
     * says what is in the picture. Given the profile a model writes "a couple
     * enjoying a luxury Someshop escape", which is a brochure caption and a lie
     * to somebody who cannot see the photograph. See ALT_RULES.
     */
    const answer = await describePicture(item.url, item.filename);

    if (claim.id) {
      await recordTokens(site.tenantId, claim.id, {
        input: answer.inputTokens,
        output: answer.outputTokens,
      });
    }

    /*
     * Trimmed of the quotation marks a model sometimes wraps a sentence in even
     * when told not to, and capped. The cap is here as well as in the prompt
     * because a prompt is a request and this is the boundary.
     */
    const { alt } = answer;

    if (!alt) {
      return {
        ok: false,
        error: 'The assistant could not describe that one. Try again, or write it yourself.',
        retryable: true,
      };
    }

    return { ok: true, alt };
  } catch (error) {
    if (error instanceof AiError) {
      return { ok: false, error: error.message, retryable: error.retryable };
    }
    if (isSignInRequired(error)) {
      return { ok: false, error: (error as Error).message };
    }
    console.error('[tg-sites] describing an image failed', error);
    return { ok: false, error: 'Something went wrong. Try again in a moment.' };
  }
}

export type SeoResult =
  | { ok: true; title: string; description: string }
  | { ok: false; error: string; retryable?: boolean };

/**
 * A search title and description, written from what is on the page.
 *
 * THE SAME FOUR GATES, repeated for the same reason as describeImageAction: a
 * server action is a public endpoint whatever the editor chooses to show.
 *
 * THE PAGE TEXT COMES FROM THE CALLER, and that is worth defending because it
 * looks careless. The alternative is to take a page id and read the tree here,
 * which sounds safer and is worse for this one job: the client is looking at a
 * DRAFT they have not saved, and the description they want is of the page in
 * front of them rather than of the version in the database. Nothing is trusted
 * about the text either way, because all it ever becomes is a prompt: it is
 * capped, and the model is told to treat it as content rather than instructions.
 *
 * WRITTEN TO THE SAME LIMITS THE REPORT ENFORCES. Without that the product does
 * something absurd: a client presses this, gets a 190 character description, and
 * the Being found screen immediately says it is too long. The constants come
 * from lib/seo/audit.ts so there is one place to change them.
 *
 * IT DOES NOT SAVE. It returns two strings and the editor puts them in the two
 * fields, through the same undo history as typing.
 */
export async function writeSeoAction(input: unknown): Promise<SeoResult> {
  try {
    if (!aiIsConfigured()) {
      return { ok: false, error: 'The writing assistant is not switched on yet.' };
    }

    const site = await requireSite();
    const userId = await currentUserId();

    const fields = (input ?? {}) as Record<string, unknown>;
    const pageTitle = text(fields.pageTitle, 200);
    const path = text(fields.path, 300);
    const pageText = text(fields.text, MAX_PAGE_TEXT);

    /*
     * A page with nothing on it cannot be described, and the honest answer is to
     * say so rather than to spend a request having a model invent one. This is
     * also the commonest way somebody would press the button: on a page they
     * have just created.
     */
    if (pageText.length < 40) {
      return {
        ok: false,
        error: 'There is not enough on this page yet to describe. Add some words first.',
      };
    }

    const claim = await claimRequest(site.tenantId, { userId, intent: 'seo' });
    if (!claim.allowed) {
      return {
        ok: false,
        error:
          `This site has used all ${DAILY_LIMIT} of today's AI requests. `
          + 'It resets through the day, so try again later.',
      };
    }

    const settings = await getSettings(site.tenantId);

    /*
     * THE PROFILE IS INCLUDED HERE, unlike the alt text call. A search
     * description IS about the business, and the tone of voice applies to it,
     * so the same system prompt every other piece of copy gets is right.
     */
    const answer = await ask(
      `${systemPrompt(settings)}\n\n${seoRules(TITLE_MAX, DESCRIPTION_MIN, DESCRIPTION_MAX)}`,
      seoPrompt({ pageTitle, path, text: pageText }),
    );

    if (claim.id) {
      await recordTokens(site.tenantId, claim.id, {
        input: answer.inputTokens,
        output: answer.outputTokens,
      });
    }

    const parsed = parseSeoAnswer(answer.text);

    /*
     * CAPPED HERE TOO. The prompt asks for a length and a prompt is a request:
     * the schema allows 70 and 200, so a model that overshoots would produce
     * something that saves fine and then gets reported as too long by the very
     * screen this exists to satisfy.
     */
    const title = parsed.title.slice(0, TITLE_MAX);
    const description = parsed.description.slice(0, DESCRIPTION_MAX);

    if (!title && !description) {
      return {
        ok: false,
        error: 'The assistant came back with nothing usable. Try again.',
        retryable: true,
      };
    }

    return { ok: true, title, description };
  } catch (error) {
    if (error instanceof AiError) {
      return { ok: false, error: error.message, retryable: error.retryable };
    }
    if (isSignInRequired(error)) {
      return { ok: false, error: (error as Error).message };
    }
    console.error('[tg-sites] writing the search details failed', error);
    return { ok: false, error: 'Something went wrong. Try again in a moment.' };
  }
}

// ---------------------------------------------------------------------------
// The section builder
// ---------------------------------------------------------------------------

export type BuildResult =
  | { ok: true; section: Section }
  | { ok: false; error: string; retryable?: boolean };

/**
 * Build one section from a description, on the dearer model.
 *
 * THE SAME FOUR GATES as writeCopyAction, repeated not shared because a server
 * action is a public endpoint. What is different is only what happens once they
 * pass: a Sonnet call with a bigger ceiling, and the answer taken through
 * sectionFromModel rather than toCopy, because this returns a Section rather than
 * a paragraph. The Section is validated and sanitised in there, so what this
 * hands back is as safe as a hand-built one and editable the instant it lands.
 *
 * ONE REPAIR, THEN STOP. A model asked for JSON occasionally returns something
 * that will not parse. The reason is fed back for a single second attempt, which
 * turns most near-misses into hits without turning a bad request into an
 * unbounded bill. Both calls' tokens are counted against the one slot.
 */
export async function buildSectionAction(input: unknown): Promise<BuildResult> {
  try {
    if (!aiIsConfigured()) {
      return { ok: false, error: 'The AI builder is not switched on for this site yet.' };
    }

    const site = await requireSite();
    const userId = await currentUserId();

    const fields = (input ?? {}) as Record<string, unknown>;
    const instruction = text(fields.instruction, MAX_BUILD_INSTRUCTION);
    if (!instruction) {
      return { ok: false, error: 'Describe the section you want.' };
    }

    // The slot is taken before the model is called, and one slot covers the
    // build and its repair: a build is one request whether it takes one call or
    // two.
    const claim = await claimRequest(site.tenantId, { userId, intent: 'write' });
    if (!claim.allowed) {
      return {
        ok: false,
        error:
          `This site has used all ${DAILY_LIMIT} of today's AI requests. `
          + 'It resets through the day, so try again later.',
      };
    }

    const settings = await getSettings(site.tenantId);
    const system = buildSystemPrompt(settings);

    let inputTokens = 0;
    let outputTokens = 0;
    const build = { model: MODEL_BUILD, maxTokens: BUILD_MAX_TOKENS, timeoutMs: BUILD_TIMEOUT_MS, effort: BUILD_EFFORT };

    const first = await ask(system, buildUserPrompt(instruction), build);
    inputTokens += first.inputTokens;
    outputTokens += first.outputTokens;
    let result = sectionFromModel(first.text);

    // The one repair: hand back the request and what went wrong, ask again.
    if (!result.ok) {
      const second = await ask(
        system,
        `${buildUserPrompt(instruction)}\n\n${repairUserPrompt(result.error)}`,
        build,
      );
      inputTokens += second.inputTokens;
      outputTokens += second.outputTokens;
      result = sectionFromModel(second.text);
    }

    if (claim.id) {
      await recordTokens(site.tenantId, claim.id, { input: inputTokens, output: outputTokens });
    }

    if (!result.ok) {
      return {
        ok: false,
        error: 'The builder could not put that together. Try describing it a little differently.',
        retryable: true,
      };
    }

    /*
     * A RELEVANT PHOTOGRAPH BEHIND THE HERO, if the model asked for one. The wow
     * is in the picture, so a hero that arrives dark and empty undersells the
     * whole feature (Andy, 3 Aug 2026). The model proposes the search words,
     * which it is good at because it read the brief, and the picture is fetched
     * here rather than there because finding one is a network call and a client's
     * media, neither of which belongs in a pure function.
     *
     * IMPORTED INTO THE CLIENT'S OWN MEDIA, not hotlinked: it becomes theirs,
     * served from our CDN, credited, and it shows in their library to reuse or
     * swap. BEST EFFORT to the last: a search that finds nothing, a store that is
     * not connected, or any error leaves the hero image-ready rather than failing
     * the build. A good dark hero with no photo is still a good hero.
     */
    if (result.backgroundQuery && pexelsConfigured() && blobConfigured()) {
      try {
        const found = await searchPexels({ query: result.backgroundQuery, orientation: 'landscape' });
        const photo = found.photos[0];
        if (photo) {
          const imported = await importStockAction(photo);
          if (imported.ok) {
            result.section.backgroundImage = imported.data.url;
            // A scrim so white hero text stays readable over a bright photograph.
            if (result.section.overlay < 30) result.section.overlay = 45;
          }
        }
      } catch {
        // Leave it image-ready. The hero is still a good hero without the photo.
      }
    }

    return { ok: true, section: result.section };
  } catch (error) {
    if (error instanceof AiError) {
      return { ok: false, error: error.message, retryable: error.retryable };
    }
    if (isSignInRequired(error)) {
      return { ok: false, error: (error as Error).message };
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('This account is not a member')) {
      return { ok: false, error: message };
    }
    // Generic below this line: the prompt, with the client's profile in it, has
    // been in scope.
    console.error('[tg-sites] the section builder failed', error);
    return { ok: false, error: 'Something went wrong building that. Try again.' };
  }
}

// ---------------------------------------------------------------------------
// The page builder
// ---------------------------------------------------------------------------

/**
 * A plan, turned into the finished sections of a page.
 *
 * THE ONE PATH EVERY AI-BUILT PAGE TAKES, in the one order that works:
 *
 *   1. BUILD   the chosen presets into real sections, each with its heading and
 *              opening paragraph.
 *   2. FILL    every slot with its own words — headings, paragraphs, card and
 *              step entries, icon items — so a section is not a headline
 *              sitting on the copy a preset ships with.
 *   3. PHOTOS  from the FILLED sections, so a card rewritten to say Barbados
 *              searches for Barbados, and while every address in the photo plan
 *              still points at the block it was computed for.
 *   4. STRIP   whatever the fill could not reach, so no page ever leaves here
 *              carrying "Tagline here".
 *
 * The order is the whole thing, and getting it wrong is silent — both ways are
 * bugs this file has already had. Stripping before filling deleted the very
 * slots the fill exists to write. Stripping before PHOTOS shifted the numeric
 * addresses the plan was computed against, so pictures landed on the wrong
 * blocks whenever the strip removed anything.
 *
 * THE FILL IS BEST EFFORT. A planned page that could not be filled is still a
 * page, so a failure there costs richness and never the build. It shares the
 * request slot already claimed, because a client asked for one page and should
 * pay for one page.
 */
async function sectionsForPage(
  plan: StarterSection[],
  ctx: {
    tenantId: string;
    claimId: string | null;
    settings: SiteSettings;
    title: string;
    purpose: string;
    startedAt: number;
    /** Where this page's calls to action point: the planned contact page. */
    contactHref?: string;
    /** A client-uploaded photo to feature behind the opening section. */
    featureImageUrl?: string;
  },
): Promise<Section[]> {
  const built = await sectionsFromPlan(plan);
  const slots = slotsOf(built);

  /*
   * EVERY SECTION GETS A PHOTO SUBJECT, defaulting to the page's own name.
   *
   * The output contract asks the model for one per section, but it may omit
   * them, and an omitted subject used to fall through to the hero palette —
   * which fetched a mountain lake, or an Amalfi photograph, for a Caribbean
   * page. The page title is not a great query; it is an honest one, about this
   * page rather than about a palette written for no page in particular. Only
   * when the title actually names something: "Home" and "New page" describe
   * nothing photographable.
   */
  const generic = new Set(['', 'home', 'new page']);
  const pageSubject = generic.has(ctx.title.trim().toLowerCase()) ? '' : ctx.title.trim().slice(0, 60);
  const planned = pageSubject
    ? plan.map((entry) => (entry.photo ? entry : { ...entry, photo: pageSubject }))
    : plan;

  /*
   * ONE EXIT, so the fill can only ever change `sections` and every path is
   * photographed and stripped identically. The previous three-exit shape let a
   * throw from the photos or the strip on the SUCCESS path be caught as
   * "filling a page failed", discarding a fill that had been paid for.
   */
  let sections = built;

  /*
   * The fill runs only when there is both something to write and time to write
   * it. A page of one section has nothing the first pass missed, and a fill
   * started with seconds left is a call that will be aborted and still be paid
   * for.
   */
  const left = remainingBudget(ctx.startedAt);
  if (slots.length > 0 && left >= MIN_REPAIR_MS) {
    try {
      const system = buildFillSystemPrompt(ctx.settings);
      const answer = await ask(system, buildFillUserPrompt(ctx.title, ctx.purpose, slots), {
        model: MODEL_BUILD,
        maxTokens: FILL_MAX_TOKENS,
        timeoutMs: Math.min(BUILD_TIMEOUT_MS, left),
        effort: BUILD_EFFORT,
      });

      if (ctx.claimId) {
        await recordTokens(ctx.tenantId, ctx.claimId, {
          input: answer.inputTokens,
          output: answer.outputTokens,
        });
      }

      const filled = fillFromModel(answer.text, slots);
      if (filled.ok) sections = applyFill(built, filled.copy);
      else console.error('[tg-sites] the fill answer could not be used:', filled.error);
    } catch (error) {
      // Never fatal: the page stands without it. Logged because a fill that
      // keeps failing is worth knowing about, and the client will never see it.
      console.error('[tg-sites] filling a page failed', error);
    }
  }

  /*
   * Photographs only while there is budget to fetch them: the imports run
   * inside this same serverless invocation, and being killed at the route's
   * maxDuration is a blank failure with no message. A page without pictures is
   * a page; a function killed mid-write is not.
   */
  if (remainingBudget(ctx.startedAt) >= PHOTO_FLOOR_MS) {
    sections = await withPhotos(ctx.tenantId, planned, sections);
  }

  /*
   * The finishing order: STRIP what was never written, WIRE the surviving
   * buttons at the contact page, then DRESS what is left - tones and motion
   * are positional, so they are decided by the sections that survived, not
   * the ones the strip was about to remove.
   */
  const kept = dropStubSections(stripPlaceholders(stripUnfilled(sections, slots)));
  const wired = wireButtons(kept, ctx.contactHref ?? '');
  // The uploaded photo lands BEFORE the dress: a featured hero is a background
  // hero, and the dress is what gives a background hero its drift and counts
  // it dark in the banding. Featuring it afterwards left it unmoving and the
  // tones below it one step out.
  return dressPage(ctx.featureImageUrl ? featurePageImage(wired, ctx.featureImageUrl) : wired);
}

/** The least budget worth starting the photo imports with. */
const PHOTO_FLOOR_MS = 12_000;

/**
 * The page's photographs, from the client's own library.
 *
 * REUSED WHOLESALE from the starter wizard, which has filled template pages this
 * way since August: fillPagePhotos resolves each distinct query against Pexels,
 * copies what it finds into the tenant's own storage with the photographer's
 * credit, and writes the stored url into the slot. Nothing here is new except
 * where the queries come from.
 *
 * WHICH IS THE MODEL. The plan carries a "photo" per section, two or three words
 * naming what a picture there should show — and the photo plan itself now reads
 * the FILLED sections, so a card the fill rewrote to say Barbados searches for
 * Barbados rather than for the factory card's Italy. The subject only ever
 * REPLACES a background on presets designed to carry one; everywhere else it
 * steers the inline pictures, because the first built site proved what a forced
 * background does to a section designed for a white ground.
 *
 * BEST EFFORT, ALL THE WAY DOWN. fillPagePhotos swallows a miss, a rate limit
 * and an unconfigured library alike, and one picture that cannot be found leaves
 * that slot as it was. A page without a photograph is still a page.
 *
 * The distinct queries resolve together, so a page of eight sections costs one
 * round of latency rather than eight.
 */
async function withPhotos(
  tenantId: string,
  plan: StarterSection[],
  sections: Section[],
): Promise<Section[]> {
  await fillPagePhotos(
    tenantId,
    { title: '', slug: '', description: '', sections: plan },
    sections,
  );
  return sections;
}

export type AiPageResult =
  | { ok: true; data: PageWithContent }
  /**
   * `skipped` marks a refusal that is not a failure: the page was left alone
   * because it already had content on it. The screen reads it differently for
   * that reason — "seven built, one left alone" is a different sentence from
   * "seven built, one broke", and showing the second when the first is true
   * would have somebody hunting a bug that is not there.
   */
  | { ok: false; error: string; retryable?: boolean; skipped?: boolean };

/**
 * Build a whole page from a description, and create it.
 *
 * THE SAME FOUR GATES as the other AI actions, repeated not shared because a
 * server action is a public endpoint. It spends one slot (intent 'write', the
 * same as the section builder: a build is one request whether it takes one call
 * or its one repair).
 *
 * IT DOES CREATE THE PAGE, unlike the copy and section actions, and that is the
 * one real difference. Those hand something back for the editor to place; a page
 * is the unit being added, so the safe move is to build the sections and create
 * the page in one server round trip. The sections are OURS, chosen from the
 * closed preset catalogue and built by buildStarterPage, and they still go
 * through createPage's parse and sanitise like every other write. Nothing the
 * model produced ever crosses back through the browser to be trusted a second
 * time.
 *
 * THE MODEL PICKS SECTIONS, IT DOES NOT WRITE MARKUP. planFromModel keeps only
 * catalogue ids and escapes every heading and body to plain text, so a page that
 * fails to parse falls to an honest error rather than to anything reaching the
 * database.
 */
/**
 * The least time worth giving a repair.
 *
 * A second call with four seconds to live will certainly be aborted and will
 * still be paid for, so below this the honest answer is the first failure
 * rather than a second one dressed up as a retry.
 */
const MIN_REPAIR_MS = 8_000;

export type SitePlanActionResult =
  | { ok: true; data: PlannedPage[] }
  | { ok: false; error: string; retryable?: boolean };

/**
 * Plan the pages a site needs. CREATES NOTHING.
 *
 * The one network call and the one repair, exactly like the page builder above.
 * What it does NOT do is write anything: the answer is a proposal for somebody
 * to read, edit and approve, and the pages are built one at a time afterwards by
 * buildPlannedPageAction. Approving a sitemap is cheap; rejecting eight
 * generated pages is not.
 *
 * A BLANK BRIEF IS THE ORDINARY CASE. The settings screen already carries the
 * company profile and it already feeds every other AI surface, so a client who
 * has filled that in has said enough. The brief is for what a profile does not
 * cover: "we are dropping the cruise side", "this is the trade-facing site".
 *
 * WITHOUT A PROFILE THERE IS NOTHING TO PLAN FROM, and the check is
 * hasBrandProfile rather than a name. A sitemap built from a company name alone
 * is a sitemap that would fit anybody, which is worse than refusing, because it
 * looks like the feature working.
 */
/** One planned page as the client sends it back: a name and an address. */
interface PlannedPageRef {
  title: string;
  slug: string;
}

/** The plan's page list from the client, made safe. Same gates as a page's own fields. */
function plannedPagesFrom(value: unknown): PlannedPageRef[] {
  if (!Array.isArray(value)) return [];
  const pages: PlannedPageRef[] = [];
  for (const entry of value.slice(0, 40)) {
    if (entry === null || typeof entry !== 'object') continue;
    const fields = entry as Record<string, unknown>;
    const title = text(fields.title, 200);
    const home = fields.slug === '';
    const slug = typeof fields.slug === 'string' ? safeSlug(fields.slug) : '';
    if (!title || (!home && !slug)) continue;
    pages.push({ title, slug: home ? '' : slug });
  }
  return pages;
}

/**
 * The page a call to action should point at, from the plan.
 *
 * A slug or title that says contact, enquire, quote or "get in touch" is that
 * page. The match is deliberately dull: a plan without one leaves the buttons
 * alone rather than guessing, because a button pointing at the wrong page is
 * worse than one a human still has to wire.
 */
const CONTACT_WORDS = /contact|enquir|quote|get in touch|talk to us|speak to/i;

function contactHrefFrom(pages: PlannedPageRef[]): string {
  const found = pages.find((page) => page.slug !== '' && (CONTACT_WORDS.test(page.slug) || CONTACT_WORDS.test(page.title)));
  return found ? `/${found.slug}` : '';
}

/** The same, against the site's real pages, for builds outside a site plan. */
async function contactHrefFromSite(tenantId: string): Promise<string> {
  try {
    const pages = await listPages(tenantId);
    return contactHrefFrom(pages.map((page) => ({ title: page.title, slug: page.slug })));
  } catch {
    return '';
  }
}

/**
 * Design the site's THEME from the profile, once, while the sitemap is planned.
 *
 * ONLY WHEN THE THEME IS STILL THE PLATFORM DEFAULT. A theme somebody has set,
 * by hand or by an earlier plan, is a decision, and the planner does not
 * overrule decisions (never rebuild, always upgrade). This is why running
 * "Plan my site" twice does not repaint the site between plans.
 *
 * BEST EFFORT, SHARING THE PLAN'S REQUEST SLOT. A failed design leaves the
 * default look and costs nothing else: the plan is the thing the client asked
 * for. Tokens are recorded against the same claim (recordTokens adds). This
 * function never rejects, which is what lets the caller await it in a finally
 * without masking a real plan error.
 */
async function designSiteTheme(
  tenantId: string,
  settings: SiteSettings,
  brief: string,
  claimId: string | null,
): Promise<Extract<ReturnType<typeof themeFromModel>, { ok: true }> | null> {
  try {
    if (!themeIsDefault(await getTheme(tenantId))) return null;

    const system = [
      THEME_RULES,
      `TYPEFACE PAIRINGS you may choose from:\n${pairingCatalogue()}`,
      THEME_OUTPUT_SHAPE,
      profileBlock(settings),
    ].join('\n\n');
    const user = brief
      ? `Design the look for this company's website. What they have said about the site:\n\n${brief}`
      : "Design the look for this company's website, working from their profile above.";

    const answer = await ask(system, user, {
      model: MODEL_BUILD,
      maxTokens: 4096,
      timeoutMs: BUILD_TIMEOUT_MS,
      effort: BUILD_EFFORT,
    });
    if (claimId) {
      await recordTokens(tenantId, claimId, { input: answer.inputTokens, output: answer.outputTokens });
    }

    const design = themeFromModel(answer.text);
    if (!design.ok) {
      console.error('[tg-sites] the theme design could not be used:', design.error);
      return null;
    }
    /*
     * Returned, not applied. The write happens in planSiteAction, and ONLY
     * when the plan itself succeeded: a failed plan must leave the site
     * exactly as it was, and an applied theme would also stop the retry from
     * designing one (themeIsDefault would be false).
     */
    return design;
  } catch (error) {
    // The plan is the deliverable; a site that keeps the default look is not a failure of it.
    console.error('[tg-sites] designing a theme failed', error);
    return null;
  }
}

export async function planSiteAction(input: unknown): Promise<SitePlanActionResult> {
  try {
    if (!aiIsConfigured()) {
      return { ok: false, error: 'The AI builder is not switched on for this site yet.' };
    }

    const site = await requireSite();
    const userId = await currentUserId();

    const fields = (input ?? {}) as Record<string, unknown>;
    const brief = text(fields.brief, MAX_SITE_BRIEF);

    const settings = await getSettings(site.tenantId);
    if (!hasBrandProfile(settings) && !brief) {
      return {
        ok: false,
        error:
          'Tell the builder about the company first. Fill in "About the company" on the '
          + 'Settings screen, or say a line here about what this site is for.',
      };
    }

    // One slot covers the plan and its repair, the same bargain the page builder
    // makes: a retry for a mangled answer is not a second request.
    const claim = await claimRequest(site.tenantId, { userId, intent: 'write' });
    if (!claim.allowed) {
      return {
        ok: false,
        error:
          `This site has used all ${DAILY_LIMIT} of today's AI requests. `
          + 'It resets through the day, so try again later.',
      };
    }

    /*
     * The pages already on this site, by TITLE, so the planner proposes what is
     * missing rather than a generic sitemap. Andy's first real run made the case:
     * it offered "Voyages" to a site that already has a Voyages page, and the
     * address did not even collide because that page lives at /destinations.
     */
    /*
     * ONLY PAGES WITH SOMETHING ON THEM COUNT AS EXISTING.
     *
     * Every site is created with a blank home page, so listing all of them told
     * the planner "you already have Home" and it correctly left out the one page
     * that most needed building. Halcyon's first real plan came back with eleven
     * good pages and no homepage for exactly this reason.
     *
     * The question the model is answering is what the site is MISSING, and an
     * empty page is missing. It is the same test buildPlannedPageAction uses to
     * decide what it may build into, which is why both read the same column.
     */
    const existingTitles = (await listPageFill(site.tenantId))
      .filter((page) => page.filled)
      .map((page) => page.title);

    const system = buildSiteSystemPrompt(settings, existingTitles);
    const userPrompt = buildSiteUserPrompt(brief);
    const call = { model: MODEL_BUILD, maxTokens: SITE_BUILD_MAX_TOKENS, timeoutMs: BUILD_TIMEOUT_MS, effort: BUILD_EFFORT };

    let inputTokens = 0;
    let outputTokens = 0;

    // The clock for the whole action, so a repair after a slow first answer

    // cannot run past what the route allows. See remainingBudget.

    const startedAt = Date.now();

    /*
     * The LOOK is designed alongside the sitemap, from the same profile, in
     * the same claimed slot - but only for a caller who could change the
     * theme by hand. A member without the theme capability still gets their
     * plan; the site keeps its look.
     */
    const themeAllowed = await requireCapability('theme').then(() => true, () => false);
    const themePromise = themeAllowed
      ? designSiteTheme(site.tenantId, settings, brief, claim.id)
      : Promise.resolve(null);
    let design: Awaited<typeof themePromise> = null;

    let plan;
    try {
      const firstAnswer = await ask(system, userPrompt, call);
      inputTokens += firstAnswer.inputTokens;
      outputTokens += firstAnswer.outputTokens;
      plan = planSiteFromModel(firstAnswer.text);

      const leftForRepair = remainingBudget(startedAt);
      if (!plan.ok && leftForRepair >= MIN_REPAIR_MS) {
        const second = await ask(system, `${userPrompt}\n\n${repairSitePrompt(plan.error)}`, {
          ...call,
          timeoutMs: leftForRepair,
        });
        inputTokens += second.inputTokens;
        outputTokens += second.outputTokens;
        plan = planSiteFromModel(second.text);
      }

      if (claim.id) {
        await recordTokens(site.tenantId, claim.id, { input: inputTokens, output: outputTokens });
      }
    } finally {
      /*
       * EVERY exit waits for the theme call, the failing ones included: a
       * serverless invocation can be frozen the moment the response returns,
       * and a design still in flight would be killed mid-write. Safe because
       * designSiteTheme never rejects, so this cannot mask a real error.
       */
      design = await themePromise;
    }

    if (!plan.ok) {
      // The site keeps its look when the plan failed: a retry should start
      // from exactly the state this attempt found.
      return {
        ok: false,
        error: 'The builder could not plan a site from that. Try saying a little more about the company.',
        retryable: true,
      };
    }

    if (design) {
      try {
        await applyDesignedTheme(site.tenantId, design);
      } catch (error) {
        console.error('[tg-sites] applying the designed theme failed', error);
      }
    }

    // Home first whatever order it came back in: this list is also the menu.
    // Home first, and the pages no plan may omit appended when the model
    // forgot them - the 27 Aug run came back with twelve pages and no way to
    // get in touch, which silently killed every button on the site.
    return { ok: true, data: homeFirst(ensureMustHavePages(plan.pages)) };
  } catch (error) {
    if (error instanceof AiError) {
      return { ok: false, error: error.message, retryable: error.retryable };
    }
    if (isSignInRequired(error)) {
      return { ok: false, error: (error as Error).message };
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('This account is not a member')) {
      return { ok: false, error: message };
    }
    // Generic below this line: the prompt, with the client's profile in it, has
    // been in scope.
    console.error('[tg-sites] the site planner failed', error);
    return { ok: false, error: 'Something went wrong planning that site. Try again.' };
  }
}

/**
 * Build ONE page from an approved plan.
 *
 * ONE PAGE PER CALL, NOT A WHOLE SITE PER CALL, and that is deliberate three
 * times over. A serverless function has a time limit and eight page builds would
 * walk into it. A failure on page six loses page six rather than the five that
 * worked. And the screen can say which page it is on, which matters when the
 * thing takes a minute: a progress line is the difference between working and
 * hung.
 *
 * IT REUSES THE PAGE BUILDER RATHER THAN REPEATING IT. The purpose from the plan
 * IS the brief, so this is the existing builder with the sitemap's answer handed
 * to it. Nothing about how a page is composed lives here.
 *
 * THE HOME PAGE IS UPDATED, NEVER CREATED. Every site already has one from the
 * starter, and an address can only belong to one page, so creating would fail on
 * the unique index and "build my site" would skip the most important page in it.
 */
/**
 * Write the purpose for pages the client named, and hand them back as plan rows.
 *
 * CREATES NOTHING, like the planner: these join the list on screen and are built
 * by the same button as everything else. The client keeps the names they typed;
 * all this decides is what each page is for.
 */
export async function describePagesAction(input: unknown): Promise<SitePlanActionResult> {
  try {
    if (!aiIsConfigured()) {
      return { ok: false, error: 'The AI builder is not switched on for this site yet.' };
    }

    const site = await requireSite();
    const userId = await currentUserId();

    const fields = (input ?? {}) as Record<string, unknown>;
    const titles = titlesFromInput(typeof fields.titles === 'string' ? fields.titles : '');
    if (titles.length === 0) {
      return { ok: false, error: 'Type at least one page name, one per line.' };
    }

    const claim = await claimRequest(site.tenantId, { userId, intent: 'write' });
    if (!claim.allowed) {
      return {
        ok: false,
        error:
          `This site has used all ${DAILY_LIMIT} of today's AI requests. `
          + 'It resets through the day, so try again later.',
      };
    }

    const settings = await getSettings(site.tenantId);
    const system = buildDescribeSystemPrompt(settings);
    const userPrompt = buildDescribeUserPrompt(titles);
    const call = { model: MODEL_BUILD, maxTokens: SITE_BUILD_MAX_TOKENS, timeoutMs: BUILD_TIMEOUT_MS, effort: BUILD_EFFORT };

    let inputTokens = 0;
    let outputTokens = 0;

    const startedAt = Date.now();
    const firstAnswer = await ask(system, userPrompt, call);
    inputTokens += firstAnswer.inputTokens;
    outputTokens += firstAnswer.outputTokens;
    let plan = planSiteFromModel(firstAnswer.text);

    const leftForRepair = remainingBudget(startedAt);
    if (!plan.ok && leftForRepair >= MIN_REPAIR_MS) {
      const second = await ask(system, `${userPrompt}\n\n${repairSitePrompt(plan.error)}`, {
        ...call,
        timeoutMs: leftForRepair,
      });
      inputTokens += second.inputTokens;
      outputTokens += second.outputTokens;
      plan = planSiteFromModel(second.text);
    }

    if (claim.id) {
      await recordTokens(site.tenantId, claim.id, { input: inputTokens, output: outputTokens });
    }

    /*
     * THE PAGES SURVIVE A FAILED DESCRIPTION. If the model would not answer in
     * shape, the client still asked for these pages by name and the builder can
     * work from a title alone. Losing their list because a sentence could not be
     * written would be the tool discarding what it was told.
     */
    if (!plan.ok) {
      return {
        ok: true,
        data: titles.map((title) => ({ title, slug: safeSlug(title), purpose: '' })),
      };
    }

    return { ok: true, data: plan.pages };
  } catch (error) {
    if (error instanceof AiError) {
      return { ok: false, error: error.message, retryable: error.retryable };
    }
    if (isSignInRequired(error)) {
      return { ok: false, error: (error as Error).message };
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('This account is not a member')) {
      return { ok: false, error: message };
    }
    console.error('[tg-sites] describing pages failed', error);
    return { ok: false, error: 'Something went wrong adding those pages. Try again.' };
  }
}

export async function buildPlannedPageAction(input: unknown): Promise<AiPageResult> {
  try {
    if (!aiIsConfigured()) {
      return { ok: false, error: 'The AI builder is not switched on for this site yet.' };
    }

    const site = await requireSite();
    const userId = await currentUserId();

    const fields = (input ?? {}) as Record<string, unknown>;
    const title = text(fields.title, 200);
    const purpose = text(fields.purpose, MAX_PAGE_BRIEF);
    // Trusted only as far as safeSlug takes it, the same gate the planner used.
    const slug = typeof fields.slug === 'string' ? safeSlug(fields.slug) : '';
    const isHome = fields.slug === '';

    /*
     * The rest of the plan rides along, so this page's buttons can point at a
     * page that is really being made. Trusted exactly as far as the page's own
     * fields are: titles capped, slugs through safeSlug, the list capped.
     */
    const planned = plannedPagesFrom(fields.pages);

    if (!title) return { ok: false, error: 'That page has no name.' };

    const claim = await claimRequest(site.tenantId, { userId, intent: 'write' });
    if (!claim.allowed) {
      return {
        ok: false,
        error:
          `This site has used all ${DAILY_LIMIT} of today's AI requests. `
          + 'It resets through the day, so try again later.',
      };
    }

    const settings = await getSettings(site.tenantId);
    // After the claim, so an invalid or rate-limited request never pays for
    // the fallback lookup. The plan's own list answers without a query.
    const contactHref = contactHrefFrom(planned) || (await contactHrefFromSite(site.tenantId));
    const system = buildPageSystemPrompt(settings);
    /*
     * The page's own name rides with its purpose. A purpose is one sentence and
     * the builder is choosing sections from it, so "Where we go" alongside "the
     * regions they know" is a materially better brief than either alone.
     */
    const brief = purpose ? `The page is called "${title}". ${purpose}` : `A page called "${title}".`;
    /*
     * The home page carries the whole first impression, and left to its own
     * judgement the model opens it with a modest contained banner (Halcyon,
     * 27 Aug: a light split hero, padding 80, no photograph). The opening is
     * not the model's call on a home page.
     */
    const userPrompt = buildPageUserPrompt(
      isHome
        ? `${brief} This is the site's HOME page: open it with a full-bleed photograph hero - a section whose shape note says [full-bleed photograph behind the words] - and make the opening confident, not a thin banner.`
        : brief,
    );
    const call = { model: MODEL_BUILD, maxTokens: PAGE_BUILD_MAX_TOKENS, timeoutMs: BUILD_TIMEOUT_MS, effort: BUILD_EFFORT };

    let inputTokens = 0;
    let outputTokens = 0;

    // The clock for the whole action, so a repair after a slow first answer

    // cannot run past what the route allows. See remainingBudget.

    const startedAt = Date.now();

    const firstAnswer = await ask(system, userPrompt, call);
    inputTokens += firstAnswer.inputTokens;
    outputTokens += firstAnswer.outputTokens;
    let plan = planFromModel(firstAnswer.text);

    const leftForRepair = remainingBudget(startedAt);
    if (!plan.ok && leftForRepair >= MIN_REPAIR_MS) {
      const second = await ask(system, `${userPrompt}\n\n${repairPagePrompt(plan.error)}`, {
        ...call,
        timeoutMs: leftForRepair,
      });
      inputTokens += second.inputTokens;
      outputTokens += second.outputTokens;
      plan = planFromModel(second.text);
    }

    if (claim.id) {
      await recordTokens(site.tenantId, claim.id, { input: inputTokens, output: outputTokens });
    }

    if (!plan.ok) {
      return {
        ok: false,
        error: `The builder could not put "${title}" together. Try changing what that page is for.`,
        retryable: true,
      };
    }

    const sections = await sectionsForPage(plan.plan, {
      tenantId: site.tenantId,
      claimId: claim.id,
      settings,
      title,
      purpose,
      startedAt,
      contactHref,
    });

    /*
     * NOTHING IS BUILT OVER WORK THAT IS ALREADY THERE, and this check is on the
     * SERVER because a guard that only exists in the screen is not a guard.
     *
     * The planner can be run on a site that is already part built, which is a
     * reasonable thing to want. What must never happen is a plan quietly
     * replacing a home page somebody has spent a week on, or a second page
     * appearing at an address that is taken. A BLANK page is different and is
     * the ordinary case: every new site has an empty home page and building
     * into it is the whole point.
     */
    const already = (await listPageFill(site.tenantId)).find((page) => page.slug === slug);
    if (already?.filled) {
      return {
        ok: false,
        skipped: true,
        error: `"${already.title}" already has content, so it was left as it is.`,
      };
    }

    if (isHome) {
      const home = (await listPages(site.tenantId)).find((page) => page.slug === '');
      if (!home) {
        return { ok: false, error: 'This site has no home page to build into.' };
      }
      const existing = await getPage(site.tenantId, home.id);
      if (!existing) {
        return { ok: false, error: 'This site has no home page to build into.' };
      }
      /*
       * The sections are replaced and everything else about the page is kept:
       * its address, its SEO, its place in the tree. Building the home page is
       * not the same as replacing it.
       */
      await saveDraft(
        site.tenantId,
        home.id,
        { ...existing.content, title, sections },
        userId ?? undefined,
      );
      const built = await getPage(site.tenantId, home.id);
      revalidatePath('/sites');
      return built
        ? { ok: true, data: built }
        : { ok: false, error: 'The home page was built but could not be read back.' };
    }

    const page = await createPage(site.tenantId, { title, slug, sections });
    revalidatePath('/sites');
    return { ok: true, data: page };
  } catch (error) {
    if (error instanceof AiError) {
      return { ok: false, error: error.message, retryable: error.retryable };
    }
    if (isSignInRequired(error)) {
      return { ok: false, error: (error as Error).message };
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('This account is not a member')) {
      return { ok: false, error: message };
    }
    if (message.includes('23505') || message.includes('duplicate key')) {
      return { ok: false, error: 'A page already has that address. Rename it in the plan and try again.' };
    }
    console.error('[tg-sites] building a planned page failed', error);
    return { ok: false, error: 'Something went wrong building that page. Try again.' };
  }
}

/** Which planned pages are chrome for the footer rather than the menu. */
const LEGAL_WORDS = /terms|privacy|cookie|conditions|legal|complaint|protect/i;

/**
 * Make the site's menu match the plan that was just built.
 *
 * The plan IS the sitemap, and a sitemap the header does not show may as well
 * not exist: the wizard has written its own menu since starters shipped, and
 * the AI path was leaving whatever menu the site had before, pointing at pages
 * from another life. Called once by the builder dialog after the last page.
 *
 * WHAT IT TOUCHES AND WHAT IT KEEPS. In a header or footer that already has
 * sections, only the nav blocks' items are replaced: the design, the logo, the
 * phone number and everything else somebody set stay exactly as they are. A
 * region with no sections at all gets the wizard's own default preset, so an
 * AI-built site has a working menu even when no wizard ever ran. Legal pages
 * go to the footer's nav, not the header's, and the header list is capped
 * because an eleven-item menu is not navigation, it is a sitemap.
 */
export async function syncSiteMenuAction(input: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    /*
     * The same gates the manual region editor enforces (see saveRegionAction):
     * items in a nav are content, and conjuring a header out of nothing is
     * structure. An AI convenience is not a way around either.
     */
    const { tenantId, userId, caps } = await currentCapabilities();
    if (!caps.has('content')) throw new PermissionError('content');

    const fields = (input ?? {}) as Record<string, unknown>;
    const planned = plannedPagesFrom(fields.pages);
    if (planned.length === 0) return { ok: false, error: 'No pages to put in the menu.' };

    /*
     * THE PLAN IS NOT THE WHOLE SITE. The planner deliberately proposes only
     * what is missing, so a site that already had a filled Voyages page would
     * lose it from its own menu if the menu were rebuilt from the plan alone.
     * The client's list says what is new and in what order; the site's own
     * filled pages fill in the rest, server-side, where the client cannot
     * understate them.
     */
    const pages = [...planned];
    for (const page of (await listPageFill(tenantId)).filter((entry) => entry.filled)) {
      if (!pages.some((entry) => entry.slug === page.slug)) {
        pages.push({ title: page.title, slug: page.slug });
      }
    }

    const contactHref = contactHrefFrom(pages);
    const isLegal = (page: PlannedPageRef) => LEGAL_WORDS.test(page.slug) || LEGAL_WORDS.test(page.title);
    const nonLegal = pages.filter((page) => !isLegal(page));

    // Seven at most, and never at the cost of the page the buttons point at.
    let headerPages = nonLegal.slice(0, 7);
    const contact = contactHref ? nonLegal.find((page) => `/${page.slug}` === contactHref) : undefined;
    if (contact && !headerPages.includes(contact)) {
      headerPages = [...headerPages.slice(0, 6), contact];
    }

    const item = (page: PlannedPageRef) => ({
      label: page.title,
      href: page.slug === '' ? '/' : `/${page.slug}`,
      newTab: false,
    });

    const writeMenu = async (name: RegionName, preset: string, main: PlannedPageRef[]) => {
      const record = await getRegion(tenantId, name);
      let region: Region = record.region;

      if (region.sections.length === 0) {
        // Building furniture from nothing is a structural change.
        if (!caps.has('structure')) return;
        const starterPages = main.map((page) => ({
          title: page.title,
          slug: page.slug,
          description: '',
          menu: page.title,
          sections: [],
        }));
        region = buildStarterRegion(preset, name, starterPages, { company: '', town: '', about: '' });
        /*
         * The starter presets ship their call-to-action pointing at /contact
         * by name. On a freshly built region only, follow the plan's actual
         * contact page instead; wireButtons below cannot, since it writes
         * only into EMPTY hrefs.
         */
        if (contactHref && contactHref !== '/contact') {
          for (const section of region.sections) {
            for (const row of section.rows) {
              for (const column of row.columns) {
                for (const block of column.blocks) {
                  if (block.type === 'button' && block.props.href === '/contact') block.props.href = contactHref;
                  if (block.type === 'button-group' && Array.isArray(block.props.buttons)) {
                    for (const button of block.props.buttons as Array<Record<string, unknown>>) {
                      if (button.href === '/contact') button.href = contactHref;
                    }
                  }
                }
              }
            }
          }
        }
      } else {
        /*
         * WHICH NAV GETS WHAT. A header's nav blocks all carry the menu (a
         * two-tier header is two copies by design). A footer is different:
         * the default footer keeps THREE curated nav columns, and stamping
         * one list into all of them flattens a design somebody may have
         * arranged. So a one-nav footer takes the whole list, and a multi-nav
         * footer gets the pages in its FIRST column and the legal pages in
         * its LAST, with anything between left exactly as it is.
         */
        const navs: Array<{ props: Record<string, unknown> }> = [];
        for (const section of region.sections) {
          for (const row of section.rows) {
            for (const column of row.columns) {
              for (const block of column.blocks) {
                if (block.type === 'nav') navs.push(block);
              }
            }
          }
        }
        if (navs.length === 0) return;

        if (name === 'header' || navs.length === 1) {
          const items = main.map(item);
          for (const nav of navs) nav.props.items = items.map((entry) => ({ ...entry }));
        } else {
          navs[0].props.items = nonLegal.map(item);
          navs[navs.length - 1].props.items = pages.filter(isLegal).map(item);
        }
      }

      if (contactHref) wireButtons(region.sections as Section[], contactHref);

      await saveRegionDraft(tenantId, name, region, userId || undefined);
    };

    await writeMenu('header', 'header-cta-bar', headerPages);
    await writeMenu('footer', 'footer-tinted-four', pages);

    revalidatePath('/sites');
    return { ok: true };
  } catch (error) {
    if (error instanceof PermissionError) {
      return { ok: false, error: error.message };
    }
    if (isSignInRequired(error)) {
      return { ok: false, error: (error as Error).message };
    }
    console.error('[tg-sites] syncing the site menu failed', error);
    return { ok: false, error: 'The pages were built, but the menu could not be updated.' };
  }
}

export async function createAiPageAction(input: unknown): Promise<AiPageResult> {
  try {
    if (!aiIsConfigured()) {
      return { ok: false, error: 'The AI builder is not switched on for this site yet.' };
    }

    const site = await requireSite();
    const userId = await currentUserId();

    const fields = (input ?? {}) as Record<string, unknown>;
    const title = text(fields.title, 200);
    const brief = text(fields.brief, MAX_PAGE_BRIEF);
    const imageId = text(fields.imageId, 100);

    /*
     * The picture is optional, and it is the client's own: resolved against their
     * bank here so a guessed id gets nobody else's, and used only if it is a URL
     * the model can fetch. The model follows a URL, not a data URI, exactly as the
     * alt text call does, so a demo bank's data: URIs fall through to a text-only
     * build rather than timing out.
     */
    let imageUrl: string | undefined;
    if (imageId) {
      const item = await getMediaItem(site.tenantId, imageId);
      if (item && /^https:\/\//i.test(item.url)) imageUrl = item.url;
    }

    // Something to work from: a brief, a picture, or both.
    if (!brief && !imageUrl) {
      return { ok: false, error: 'Say what the page is for, or add a picture.' };
    }

    // The slot is taken before the model is called, and one slot covers the build
    // and its repair.
    const claim = await claimRequest(site.tenantId, { userId, intent: 'write' });
    if (!claim.allowed) {
      return {
        ok: false,
        error:
          `This site has used all ${DAILY_LIMIT} of today's AI requests. `
          + 'It resets through the day, so try again later.',
      };
    }

    const settings = await getSettings(site.tenantId);
    const system = buildPageSystemPrompt(settings);
    // The picture rides along on both attempts, so the model sees it whether the
    // first answer parsed or the repair did.
    const build = imageUrl
      ? { model: MODEL_BUILD, maxTokens: PAGE_BUILD_MAX_TOKENS, timeoutMs: BUILD_TIMEOUT_MS, effort: BUILD_EFFORT, image: { url: imageUrl } }
      : { model: MODEL_BUILD, maxTokens: PAGE_BUILD_MAX_TOKENS, timeoutMs: BUILD_TIMEOUT_MS, effort: BUILD_EFFORT };
    const userPrompt = buildPageUserPrompt(brief, Boolean(imageUrl));

    let inputTokens = 0;
    let outputTokens = 0;

    // The clock for the whole action, so a repair after a slow first answer

    // cannot run past what the route allows. See remainingBudget.

    const startedAt = Date.now();

    const firstAnswer = await ask(system, userPrompt, build);
    inputTokens += firstAnswer.inputTokens;
    outputTokens += firstAnswer.outputTokens;
    let plan = planFromModel(firstAnswer.text);

    // The one repair: hand back the request and what went wrong, ask again.
    const leftForRepair = remainingBudget(startedAt);
    if (!plan.ok && leftForRepair >= MIN_REPAIR_MS) {
      const second = await ask(system, `${userPrompt}\n\n${repairPagePrompt(plan.error)}`, {
        ...build,
        timeoutMs: leftForRepair,
      });
      inputTokens += second.inputTokens;
      outputTokens += second.outputTokens;
      plan = planFromModel(second.text);
    }

    if (claim.id) {
      await recordTokens(site.tenantId, claim.id, { input: inputTokens, output: outputTokens });
    }

    if (!plan.ok) {
      return {
        ok: false,
        error: 'The builder could not put that page together. Try describing it a little differently.',
        retryable: true,
      };
    }

    const sections = await sectionsForPage(plan.plan, {
      tenantId: site.tenantId,
      claimId: claim.id,
      settings,
      title: title || 'New page',
      purpose: brief,
      startedAt,
      contactHref: await contactHrefFromSite(site.tenantId),
      // Featured inside the pipeline, before the dress, so the uploaded hero
      // moves and the tones band around it.
      featureImageUrl: imageUrl || undefined,
    });

    const page = await createPage(site.tenantId, {
      title: title || 'New page',
      slug: slugify(title || 'new page'),
      sections,
    });

    revalidatePath('/sites');
    return { ok: true, data: page };
  } catch (error) {
    if (error instanceof AiError) {
      return { ok: false, error: error.message, retryable: error.retryable };
    }
    if (isSignInRequired(error)) {
      return { ok: false, error: (error as Error).message };
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('This account is not a member')) {
      return { ok: false, error: message };
    }
    // The one create error worth naming: two pages cannot share an address, and
    // the client chose the name.
    if (message.includes('23505') || message.includes('duplicate key')) {
      return { ok: false, error: 'A page already has that address. Give this one a different name.' };
    }
    // Generic below this line: the prompt, with the client's profile in it, has
    // been in scope.
    console.error('[tg-sites] the page builder failed', error);
    return { ok: false, error: 'Something went wrong building that page. Try again.' };
  }
}
