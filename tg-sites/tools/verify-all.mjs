/**
 * Run every browser check, and say what ALL of them did.
 *
 * WHY THIS EXISTS (20 Sep 2026). `verify:browser` was a single shell line with
 * twelve commands joined by `&&`, which means the first non-zero exit ends the
 * run. On 20 September verify-destination was throwing before it opened a
 * browser, on a fixture whose shape had changed underneath it. Everything after
 * it in the chain simply never ran: the Add page composer, the text controls,
 * and the editor's own suite. Nobody saw the eight dead checks behind it,
 * because the line that would have reported them was never reached, and the one
 * line that WAS printed looked like an ordinary red test.
 *
 * So the chain does not stop any more. Every suite runs, every suite's own
 * summary is printed, and the exit code is non-zero if any of them failed. A
 * suite that dies before it can report is called out by name rather than
 * silently taking the rest of the run down with it.
 *
 * Order still matters for the two builds at the front: the verifiers read the
 * bundles those produce and refuse to run against a stale one, so a failed
 * build is the one thing that DOES stop everything.
 *
 *   npm run verify:browser
 *   npm run verify:browser -- verify-text-controls   (one suite, by name)
 */

import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

/** The bundles the checks are run against. A failure here stops the run. */
const BUILDS = ['build-standalone.mjs', 'build-theme-harness.mjs'];

/** Every suite, in the order they were written. None of them depends on another. */
const SUITES = [
  'verify-standalone.mjs',
  'verify-theme.mjs',
  'verify-settings.mjs',
  'verify-motion.mjs',
  'verify-motion-recipes.mjs',
  'verify-motion-rail.mjs',
  'verify-motion-video.mjs',
  'verify-destination.mjs',
  'verify-pages-panel.mjs',
  'verify-text-controls.mjs',
  /*
   * These two were written, committed, and left out of the chain, so from the day
   * each landed the only thing that ran it was somebody typing its name. Both were
   * green when they were added here on 20 Sep 2026, which is luck rather than
   * evidence: a check nothing runs is a check nobody is relying on.
   */
  'verify-overlap-css.mjs',
  'verify-slideshow.mjs',
];

function run(script) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [resolve(here, script)], {
      cwd: root,
      stdio: 'inherit',
    });
    child.on('close', (code) => done(code ?? 1));
    child.on('error', () => done(1));
  });
}

const only = process.argv.slice(2).map((name) => (name.endsWith('.mjs') ? name : `${name}.mjs`));
const suites = only.length ? SUITES.filter((s) => only.includes(s)) : SUITES;
if (only.length && suites.length !== only.length) {
  console.error(`\n  No such suite: ${only.filter((n) => !SUITES.includes(n)).join(', ')}\n`);
  process.exit(1);
}

for (const build of BUILDS) {
  console.log(`\n── ${build}`);
  const code = await run(build);
  if (code !== 0) {
    console.error(`\n  ${build} failed, so nothing below it can be trusted. Stopping here.\n`);
    process.exit(1);
  }
}

const results = [];
for (const suite of suites) {
  console.log(`\n── ${suite}`);
  results.push([suite, await run(suite)]);
}

const failed = results.filter(([, code]) => code !== 0);

console.log('\n── All of it\n');
for (const [suite, code] of results) {
  console.log(`  ${code === 0 ? 'PASS' : 'FAIL'}  ${suite}`);
}

if (failed.length) {
  console.log(`\n  ${failed.length} of ${results.length} suites failed. Their own output is above.\n`);
  process.exit(1);
}

console.log(`\n  ${results.length} suites, all green.\n`);
