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
  isAiIntent,
  MAX_INSTRUCTION,
  MAX_SELECTION,
  systemPrompt,
  userPrompt,
  type AiIntent,
} from '../../lib/ai/prompt';
import { claimRequest, DAILY_LIMIT, recordTokens } from '../../lib/db/ai';
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
