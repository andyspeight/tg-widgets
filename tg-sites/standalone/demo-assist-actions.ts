/**
 * Luna Assist's one action, for the standalone review copy.
 *
 * The real one (app/actions/assist.ts) writes a line to assist_log saying a
 * proposal was applied, which means the Postgres driver, which cannot exist in a
 * file served from a static host. It writes no page, so a double that records
 * nothing leaves the review copy behaving exactly as the real editor does: the
 * change is applied by the editor through its own history either way.
 *
 * MISSING FOR AN HOUR ON 17 SEP 2026, which is how long npm run verify:browser
 * was dead: EditorShell started importing recordAssistApplied with slice 2 and
 * nothing here matched it, so tools/build-standalone.mjs dragged Postgres into a
 * browser bundle and every browser check after it never ran. The drift test in
 * tests/settings.test.ts now fails instead.
 */

import type * as real from '../app/actions/assist';

export async function recordAssistApplied(input: unknown): Promise<{ ok: boolean }> {
  void input;
  return { ok: true };
}

const _applied = recordAssistApplied satisfies typeof real.recordAssistApplied;
void _applied;
