/**
 * The Scheduler extension stays store-ready, and its `hidden` attribute works.
 *
 * Two jobs.
 *
 * 1. THE HIDDEN BUG (11 Sep 2026). panel.html hides four things with the
 *    `hidden` attribute: the back arrow, the staff acting-as strip, the account
 *    strip and the tab bar. `hidden` is only `display:none` from the browser's
 *    own stylesheet, so any class rule carrying a display beats it — and all
 *    four had one. Every user saw an empty amber bar under the header and a
 *    back arrow on a screen with nothing to go back to. Found while rendering
 *    the store screenshot, fixed with one `[hidden]` rule. This guards it,
 *    because the same mistake is one careless `display:flex` away.
 *
 * 2. STORE READINESS. A rejection costs days in a review queue, so the things
 *    the Chrome Web Store checks are asserted here rather than discovered
 *    later: manifest shape, the 132-character description cap, icons present,
 *    no permission wider than we justify in STORE-LISTING.md, and the
 *    read-only shape of the Gmail proxy bridge.
 *
 * Run: node test/extension-store-ready-smoke.mjs  (npm run test:extension-store-ready)
 */
import { readFileSync, existsSync } from 'node:fs';

const DIR = new URL('../extension/scheduler-companion/', import.meta.url);
const read = (f) => readFileSync(new URL(f, DIR), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
};

const manifest = JSON.parse(read('manifest.json'));
const css = read('panel.css');
const html = read('panel.html');
const panelJs = read('panel.js');
const background = read('background.js');
const listing = read('STORE-LISTING.md');
const privacy = readFileSync(new URL('../public/extension-privacy.html', import.meta.url), 'utf8');

console.log('The hidden attribute actually hides');
{
  ok('panel.css restores [hidden] with !important',
    /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/.test(css));

  // Everything panel.html marks hidden, or panel.js toggles, must survive a
  // class rule with a display. The [hidden] rule above is what makes that true;
  // this lists them so a new one is noticed.
  const markedInHtml = [...html.matchAll(/id="([a-z-]+)"[^>]*\shidden/g)].map((m) => m[1]);
  ok('the elements that start hidden are the four we know about (' + markedInHtml.join(', ') + ')',
    ['back', 'actas', 'account', 'tabs'].every((id) => markedInHtml.includes(id)), markedInHtml.join(', '));

  const toggled = [...panelJs.matchAll(/\$\('([a-z-]+)'\)\.hidden\s*=/g)].map((m) => m[1]);
  ok('panel.js toggles them by .hidden, never by style.display',
    toggled.length >= 3 && !/\.style\.display\s*=/.test(panelJs), toggled.join(', '));

  // The specific rules that beat `hidden` before the fix. If someone removes
  // the guard these become bugs again, so name them.
  for (const sel of ['.icon-btn', '.actas', '.account', 'nav']) {
    const re = new RegExp('(^|\\})\\s*' + sel.replace('.', '\\.') + '\\s*\\{[^}]*display:', 'm');
    ok(sel + ' still carries a display (so the [hidden] rule is load-bearing)', re.test(css));
  }
}

console.log('The manifest is what the store expects');
{
  ok('manifest v3', manifest.manifest_version === 3);
  ok('version looks like a version (' + manifest.version + ')', /^\d+(\.\d+){0,3}$/.test(manifest.version));
  ok('name is within the 75-character limit (' + manifest.name.length + ')', manifest.name.length <= 75);
  ok('description is within the 132-character limit (' + manifest.description.length + ')',
    manifest.description.length > 0 && manifest.description.length <= 132);
  ok('a 128px icon exists for the listing', !!(manifest.icons || {})['128'] && existsSync(new URL(manifest.icons['128'], DIR)));
  for (const rel of Object.values(manifest.icons || {})) {
    ok('icon present: ' + rel, existsSync(new URL(rel, DIR)));
  }
  ok('the service worker and panel files exist',
    existsSync(new URL(manifest.background.service_worker, DIR))
    && existsSync(new URL(manifest.side_panel.default_path, DIR)));
}

console.log('Permissions stay as narrow as the listing claims');
{
  ok('the only API permission is sidePanel',
    JSON.stringify(manifest.permissions) === JSON.stringify(['sidePanel']), JSON.stringify(manifest.permissions));
  ok('no storage permission, so "stores nothing" stays true',
    !(manifest.permissions || []).includes('storage'));
  ok('no scripting or activeTab (the wide pair the retired extension used)',
    !(manifest.permissions || []).some((p) => p === 'scripting' || p === 'activeTab'));

  const hosts = manifest.host_permissions || [];
  ok('host permissions are our two named hosts only',
    hosts.length === 2 && hosts.includes('https://widgets.travelify.io/*') && hosts.includes('https://id.travelify.io/*'),
    hosts.join(', '));
  ok('no wildcard host permission',
    !hosts.some((h) => /<all_urls>|\*:\/\/\*|https:\/\/\*\//.test(h)));

  const matches = (manifest.content_scripts || []).flatMap((c) => c.matches || []);
  ok('the content script runs on Gmail and nowhere else',
    matches.length === 1 && matches[0] === 'https://mail.google.com/*', matches.join(', '));
}

console.log('The Gmail bridge stays read-only');
{
  ok('background.js checks the sender is this extension',
    /sender\.id !== chrome\.runtime\.id/.test(background));
  ok('it allows only whitelisted paths',
    /ALLOWED_PATHS\.some\(/.test(background));
  ok('the whitelist is the three reads the panel needs',
    /widget-list/.test(background) && /appointment\\?\/list/.test(background) && /widget-config/.test(background));
  ok('the bridge never issues a write',
    !/method:\s*'(POST|PUT|PATCH|DELETE)'/i.test(background));
}

console.log('The listing and the privacy policy agree with the code');
{
  ok('the privacy page is served from the repo', privacy.length > 500);
  ok('the listing points at the hosted privacy policy',
    listing.includes('https://widgets.travelify.io/extension-privacy'));
  ok('the vercel route for it exists',
    JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
      .rewrites.some((r) => r.source === '/extension-privacy'));
  ok('the listing quotes the manifest description verbatim (the store shows that one)',
    listing.includes(manifest.description));
  ok('the privacy page claims no storage, which the manifest backs up',
    /stores nothing/i.test(privacy) && !(manifest.permissions || []).includes('storage'));
  ok('the privacy page names both hosts it reaches',
    privacy.includes('widgets.travelify.io') && privacy.includes('id.travelify.io'));
  ok('the listing justifies every permission in the manifest',
    [...(manifest.permissions || []), ...(manifest.host_permissions || [])].every((p) => listing.includes(p)));
}

console.log('The retired extension is gone');
{
  ok('chrome-extension/ no longer exists',
    !existsSync(new URL('../chrome-extension/manifest.json', import.meta.url)));
  ok('the README records where it went and what went with it',
    /retired on\s*\n?\s*11 Sep 2026/.test(read('README.md')) && /What was lost/.test(read('README.md')));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
