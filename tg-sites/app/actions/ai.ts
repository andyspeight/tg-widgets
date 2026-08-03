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
import { aiIsConfigured, AiError, ask, MODEL_BUILD } from '../../lib/ai/anthropic';
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
  altPrompt,
  ALT_RULES,
  HOUSE_RULES,
  isAiIntent,
  MAX_ALT,
  MAX_PAGE_TEXT,
  parseSeoAnswer,
  seoPrompt,
  seoRules,
  MAX_INSTRUCTION,
  MAX_SELECTION,
  systemPrompt,
  userPrompt,
  type AiIntent,
} from '../../lib/ai/prompt';
import { claimRequest, DAILY_LIMIT, recordTokens } from '../../lib/db/ai';
import { getMediaItem } from '../../lib/db/media';
import { DESCRIPTION_MAX, DESCRIPTION_MIN, TITLE_MAX } from '../../lib/seo/audit';
import { getSettings } from '../../lib/db/settings';

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
    if (!/^https:\/\//i.test(item.url)) {
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
    const answer = await ask(
      `${HOUSE_RULES}\n\n${ALT_RULES}`,
      altPrompt(item.filename),
      { image: { url: item.url } },
    );

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
    const alt = answer.text
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^["\u201c\u2018']+|["\u201d\u2019']+$/g, '')
      .slice(0, MAX_ALT);

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
    const build = { model: MODEL_BUILD, maxTokens: BUILD_MAX_TOKENS };

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
