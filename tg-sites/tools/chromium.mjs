/**
 * Which Chromium the browser checks drive.
 *
 * WHY THIS IS NOT JUST A CONSTANT. Every verifier here carried the same line:
 *
 *   const CHROMIUM = process.env.TG_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
 *
 * That path is this sandbox's, not the world's. It is right here, wrong on a
 * laptop, and wrong on a CI runner, and passing an executablePath that does not
 * exist fails with a message about a missing file rather than "no browser", which
 * is a confusing first five minutes for whoever meets it.
 *
 * So: an explicit TG_CHROMIUM wins, then the sandbox's own copy IF IT IS THERE,
 * and otherwise nothing at all, which is what tells Playwright to use the browser
 * it downloaded itself. All three answers are correct in the place they apply, and
 * nobody has to set an environment variable to run the checks on their own machine.
 */

import { existsSync } from 'node:fs';

/** The image this repo's sandbox ships, at a version-pinned path. */
const SANDBOX = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/**
 * The executablePath to launch with, or undefined to let Playwright choose.
 *
 * Undefined rather than a guessed path: Playwright resolves its own download
 * location per platform and version, and a guess that is close but wrong is worse
 * than no answer, because the error blames the file rather than the setup.
 */
export function chromiumPath() {
  const named = process.env.TG_CHROMIUM;
  if (named) return named;
  return existsSync(SANDBOX) ? SANDBOX : undefined;
}
