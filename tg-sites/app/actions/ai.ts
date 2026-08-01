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
import { aiIsConfigured, AiError, ask } from '../../lib/ai/anthropic';
import { toCopy, type Copy } from '../../lib/ai/copy';
import {
  altPrompt,
  ALT_RULES,
  HOUSE_RULES,
  isAiIntent,
  MAX_ALT,
  MAX_INSTRUCTION,
  MAX_SELECTION,
  systemPrompt,
  userPrompt,
  type AiIntent,
} from '../../lib/ai/prompt';
import { claimRequest, DAILY_LIMIT, recordTokens } from '../../lib/db/ai';
import { getMediaItem } from '../../lib/db/media';
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
      { url: item.url },
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
