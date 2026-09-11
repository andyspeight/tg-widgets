/**
 * Build a Chrome Web Store upload package for the Scheduler extension.
 *
 *   npm run extension:package
 *
 * Writes build/scheduler-companion-<version>.zip with manifest.json at the ZIP
 * ROOT, which the store requires (zip the folder's contents, never the folder).
 * Repo-only files are excluded so nothing internal ships to the listing.
 *
 * It also refuses to build a package the store would reject on sight: a bad
 * manifest, a missing icon, a version that does not look like a version, or a
 * README/listing file that would otherwise be bundled. Better to fail here than
 * to find out days later at the end of a review queue.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'extension', 'scheduler-companion');
const OUT_DIR = join(ROOT, 'build');

// Kept out of the upload: repo documentation and editor/OS litter.
const EXCLUDE = ['README.md', 'STORE-LISTING.md', '*.DS_Store', '__MACOSX/*', '*.map'];

function die(msg) {
  console.error('\n  ✗ ' + msg + '\n');
  process.exit(1);
}

if (!existsSync(SRC)) die('No extension at ' + SRC);

let manifest;
try {
  manifest = JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8'));
} catch (e) {
  die('manifest.json is missing or is not valid JSON: ' + e.message);
}

if (manifest.manifest_version !== 3) die('manifest_version must be 3, found ' + manifest.manifest_version);
if (!/^\d+(\.\d+){0,3}$/.test(String(manifest.version || ''))) {
  die('version must be one to four dot-separated numbers, found "' + manifest.version + '"');
}
if (!manifest.name || !manifest.description) die('manifest needs both a name and a description');
// The store shows the description verbatim under the name and caps it at 132.
if (manifest.description.length > 132) {
  die('manifest description is ' + manifest.description.length + ' characters, the store allows 132');
}

// Every file the manifest points at must exist, or the upload fails validation.
const referenced = [
  ...Object.values(manifest.icons || {}),
  ...Object.values((manifest.action && manifest.action.default_icon) || {}),
  manifest.background && manifest.background.service_worker,
  manifest.side_panel && manifest.side_panel.default_path,
  ...(manifest.content_scripts || []).flatMap((cs) => [...(cs.js || []), ...(cs.css || [])]),
].filter(Boolean);

for (const rel of referenced) {
  if (!existsSync(join(SRC, rel))) die('manifest references "' + rel + '" but it is not in the folder');
}
if (!(manifest.icons || {})['128']) die('the store listing needs a 128px icon and the manifest has none');

mkdirSync(OUT_DIR, { recursive: true });
const zipPath = join(OUT_DIR, 'scheduler-companion-' + manifest.version + '.zip');
rmSync(zipPath, { force: true });

// -r recurse, -X drop extra OS attributes so the zip is tidy and reproducible.
execFileSync('zip', ['-r', '-X', '-q', zipPath, '.', '-x', ...EXCLUDE], { cwd: SRC });

const listed = execFileSync('zip', ['-sf', zipPath], { encoding: 'utf8' })
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.endsWith('/') && !l.startsWith('Archive contains:') && !l.startsWith('Total '));

if (!listed.includes('manifest.json')) die('manifest.json is not at the zip root; the store will reject this');
for (const bad of ['README.md', 'STORE-LISTING.md']) {
  if (listed.includes(bad)) die(bad + ' ended up in the package; fix the exclude list');
}

const kb = (statSync(zipPath).size / 1024).toFixed(1);
console.log('\n  ' + manifest.name + ' v' + manifest.version);
console.log('  ' + zipPath.replace(ROOT + '/', '') + '  (' + kb + ' KB, ' + listed.length + ' files)\n');
for (const f of listed.sort()) console.log('    ' + f);
console.log('\n  Upload at https://chrome.google.com/webstore/devconsole');
console.log('  Listing copy: extension/scheduler-companion/STORE-LISTING.md\n');
