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
const _write = writeCopyAction satisfies typeof real.writeCopyAction;
void _write;
