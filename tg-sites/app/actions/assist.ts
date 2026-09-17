'use server';

/**
 * What Luna Assist did, recorded after the person applied it.
 *
 * WHY THE EDITOR APPLIES AND THE SERVER ONLY WATCHES. A proposal is a list of
 * typed operations, and the editor runs them through lib/assist/operations.ts
 * into its own history as ONE step. That keeps two promises at once: Undo is
 * the Undo the person already knows, and the page still reaches the database
 * through the one save path everything else uses, already parsed by the schema
 * on the way in. A second writer here would be a second way for a page to be
 * saved, which is the thing the editor's own header warns against.
 *
 * So this action writes no page. It writes the line in the log that rule 9
 * asks for: who applied what, on which page, and how many changes. Labels and
 * kinds only, never the words themselves, the same as every other row in
 * assist_log.
 */

import { z } from 'zod';

import { OPERATION_KINDS } from '../../lib/assist/operations';
import { currentCapabilities } from '../../lib/auth/capabilities';
import { isSignInRequired } from '../../lib/auth/session';
import { logAssist } from '../../lib/db/assist';

const AppliedSchema = z.object({
  pageId: z.string().uuid().nullable().optional(),
  mode: z.enum(['plan', 'build']).default('build'),
  changes: z
    .array(
      z.object({
        kind: z.enum(OPERATION_KINDS),
        label: z.string().max(120),
      }),
    )
    .min(1)
    .max(16),
});

export async function recordAssistApplied(input: unknown): Promise<{ ok: boolean }> {
  const parsed = AppliedSchema.safeParse(input);
  if (!parsed.success) return { ok: false };

  try {
    const { tenantId, userId, caps } = await currentCapabilities();
    /* The same floor the tool needed to offer the proposal at all. The
       per-field checks happened where the operations were applied. */
    if (!caps.has('content')) return { ok: false };

    await logAssist(tenantId, {
      userId,
      usageId: null,
      pageId: parsed.data.pageId ?? null,
      mode: parsed.data.mode,
      kind: 'applied',
      detail: { changes: parsed.data.changes, count: parsed.data.changes.length },
    });
    return { ok: true };
  } catch (error) {
    if (isSignInRequired(error)) return { ok: false };
    console.error('[tg-sites] could not record an applied proposal', error);
    return { ok: false };
  }
}
