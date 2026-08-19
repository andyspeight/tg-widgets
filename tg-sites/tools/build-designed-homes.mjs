/**
 * Freezes the ten concept homepages into native imported-section JSON.
 *
 *   node tools/build-designed-homes.mjs
 *   reads  lib/content/designed/sources/<slug>.html
 *   writes lib/content/designed/<slug>.json
 *
 * A distribution step, not a second implementation: it drives the real import
 * pipeline (lib/import) and the real sanitiser, so what it bakes is what a
 * client pasting the design would have got. Re-run it after editing a source.
 */
import * as esbuild from 'esbuild';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const work = await mkdtemp(join(tmpdir(), 'tg-designed-'));

try {
  const bundle = join(work, 'bake.cjs');
  await esbuild.build({
    entryPoints: [resolve(root, 'tools/designed-bake-entry.tsx')],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    logLevel: 'error',
  });

  const { stdout } = await run(process.execPath, [bundle], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
  });
  process.stdout.write(stdout);
} finally {
  await rm(work, { recursive: true, force: true });
}
