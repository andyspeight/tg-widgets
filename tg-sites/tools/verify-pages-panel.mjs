/**
 * Browser checks for the Pages panel's Add page composer.
 *
 * WHY THIS EXISTS
 *
 * On 17 September 2026 Andy said adding a page did not work. It did work; the
 * composer was unusable. The Start from list draws one card per designed page
 * and there are two dozen, with no bound on its height, so the composer stood
 * 1,966px tall inside a 900px panel. The name box sat at the top, the Add page
 * button 1,800px below it, and the search box twelve pixels below THAT. By the
 * time you had scrolled to the button, the only text box in sight was the wrong
 * one, so the page name went into the search box and the composer answered
 * "Give the page a name."
 *
 * Every assertion in tests/pages-panel.test.ts passed throughout. None of them
 * can see it, because it is not a claim about a function: it is whether the box
 * you are asked to fill in is on the same screen as the button you press. That
 * is a measurement, so this measures it.
 *
 * The checks are deliberately about reach rather than looks: the name box on
 * screen, the button on screen, no second text box under the button, every
 * design reachable by scrolling, and the composer handing over the name that was
 * typed with the design that was picked. At three viewport heights including a
 * phone, since the bound is a share of the viewport.
 *
 *   node tools/build-theme-harness.mjs && node tools/verify-pages-panel.mjs
 */

import { chromium } from 'playwright';
import { chromiumPath } from './chromium.mjs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const file = resolve(root, 'standalone/out/pages-harness.html');

/* The bundle has to be newer than the source. See the same guard in
   tools/verify-settings.mjs for the stale green it is there to prevent. */
async function newestSource() {
  let newest = 0;
  const skip = new Set(['node_modules', '.next', '.git', 'out']);

  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.(tsx?|css)$/.test(entry.name)) {
        const { mtimeMs } = await stat(full);
        if (mtimeMs > newest) newest = mtimeMs;
      }
    }
  }

  for (const dir of ['components', 'lib', 'app', 'standalone']) {
    await walk(resolve(root, dir));
  }
  return newest;
}

const built = await stat(file).then((s) => s.mtimeMs).catch(() => 0);
if (built === 0 || built < (await newestSource())) {
  console.log(
    '\n  STALE. Run node tools/build-theme-harness.mjs first: the bundle is older\n' +
      '  than the source, so anything below would be checking the previous version.\n',
  );
  process.exit(1);
}

const CHROMIUM = chromiumPath();
const ORIGIN = 'http://pages.harness';
const html = await readFile(file, 'utf8');

const browser = await chromium.launch({ executablePath: CHROMIUM });
const checks = [];
const errors = [];
const check = async (name, fn) => {
  try {
    const value = await fn();
    checks.push([name, value === true ? 'PASS' : `FAIL (${value})`]);
  } catch (error) {
    checks.push([name, `FAIL (${error.message})`]);
  }
};

async function open({ width = 1280, height = 900, phone = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, isMobile: phone, hasTouch: phone });
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url === ORIGIN || url === `${ORIGIN}/`) return route.fulfill({ contentType: 'text/html', body: html });
    return route.fulfill({ status: 404 });
  });
  await page.goto(`${ORIGIN}/`);
  await page.waitForSelector('.ed-pages__add', { timeout: 15000 });
  await page.click('.ed-pages__add');
  await page.waitForSelector('.ed-pages__new');
  return page;
}

/** Where something is, and whether it is on the screen at all. */
const box = (page, selector) =>
  page.evaluate((target) => {
    const el = document.querySelector(target);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      onScreen: rect.top >= 0 && rect.bottom <= window.innerHeight,
    };
  }, selector);

// ---------------------------------------------------------------------------
// The composer fits the screen it is used on
// ---------------------------------------------------------------------------

for (const [label, viewport] of [
  ['a tall screen', { height: 900 }],
  ['a short laptop', { height: 760 }],
  ['a phone', { width: 390, height: 780, phone: true }],
]) {
  const page = await open(viewport);

  await check(`the name box is on screen (${label})`, async () => {
    const name = await box(page, 'input[aria-label="New page name"]');
    return name?.onScreen === true ? true : JSON.stringify(name);
  });

  await check(`the Add page button is on screen with it (${label})`, async () => {
    const submit = await box(page, '.ed-pages__new-actions button[type="submit"]');
    return submit?.onScreen === true ? true : JSON.stringify(submit);
  });

  /*
   * THE ONE THAT CAUGHT IT. A second text box below the button you are about to
   * press is a box somebody will type into, whatever it is labelled.
   */
  await check(`no other text box sits below the Add page button (${label})`, async () => {
    const submit = await box(page, '.ed-pages__new-actions button[type="submit"]');
    const below = await page.evaluate((bottom) => {
      const boxes = [...document.querySelectorAll('input[type="text"], input[type="search"], input:not([type])')];
      return boxes
        .filter((el) => el.getBoundingClientRect().top >= bottom)
        .map((el) => el.getAttribute('aria-label') ?? el.placeholder ?? el.className);
    }, submit?.bottom ?? 0);
    return below.length === 0 ? true : below.join(', ');
  });

  await page.close();
}

// ---------------------------------------------------------------------------
// And everything in it is reachable and works
// ---------------------------------------------------------------------------

{
  const page = await open();

  await check('the caret starts in the name box', async () => {
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    return focused === 'New page name' ? true : String(focused);
  });

  await check('the designs scroll inside the composer rather than pushing it off screen', async () => {
    const size = await page.evaluate(() => {
      const el = document.querySelector('.ed-pages__templates');
      return { scroll: el.scrollHeight, client: el.clientHeight };
    });
    return size.scroll > size.client ? true : JSON.stringify(size);
  });

  await check('the last design is reachable by scrolling, and the button has not moved', async () => {
    await page.evaluate(() => {
      const el = document.querySelector('.ed-pages__templates');
      el.scrollTop = el.scrollHeight;
    });
    const reached = await page.evaluate(() => {
      const cards = document.querySelectorAll('.ed-pages__template');
      const view = document.querySelector('.ed-pages__templates').getBoundingClientRect();
      const last = cards[cards.length - 1].getBoundingClientRect();
      return last.bottom <= view.bottom + 1 && last.top >= view.top - 1;
    });
    const submit = await box(page, '.ed-pages__new-actions button[type="submit"]');
    return reached && submit?.onScreen === true ? true : `reached ${reached}, submit ${JSON.stringify(submit)}`;
  });

  await check('an empty name says so, on screen, with the caret back in the box', async () => {
    await page.click('.ed-pages__new-actions button[type="submit"]');
    await page.waitForSelector('.ed-pages__error');
    const error = await box(page, '.ed-pages__error');
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    return error?.onScreen === true && focused === 'New page name' ? true : `${JSON.stringify(error)} ${focused}`;
  });

  await check('a name and a design make the page they name', async () => {
    await page.fill('input[aria-label="New page name"]', 'Test Destination');
    await page.click('.ed-pages__template:nth-of-type(3)');
    await page.click('.ed-pages__new-actions button[type="submit"]');
    await page.waitForFunction(() => window.__created.length === 1, null, { timeout: 5000 });
    const made = (await page.evaluate(() => window.__created))[0];
    return made.title === 'Test Destination' && made.template !== 'blank' ? true : JSON.stringify(made);
  });

  await page.close();
}

// The AI start is the tallest the composer gets: its brief box and picture sit
// under the designs, so it is the case a bound on the list could still fail.
{
  const page = await open({ height: 760 });
  await page.click('.ed-pages__template--ai');
  await page.waitForSelector('.ed-pages__brief-box');

  await check('the AI start shows its brief box and its button on a short laptop', async () => {
    const brief = await box(page, '.ed-pages__brief-box');
    const submit = await box(page, '.ed-pages__new-actions button[type="submit"]');
    return brief?.onScreen === true && submit?.onScreen === true
      ? true
      : `brief ${JSON.stringify(brief)} submit ${JSON.stringify(submit)}`;
  });

  await page.close();
}

// ---------------------------------------------------------------------------

await browser.close();

let failed = false;
console.log('');
for (const [name, status] of checks) {
  if (!status.startsWith('PASS')) failed = true;
  console.log(`  ${status.padEnd(30)} ${name}`);
}

if (errors.length > 0) {
  failed = true;
  console.log('\n  Console errors:');
  for (const error of errors) console.log(`    ${error}`);
} else {
  console.log('\n  No console errors.');
}

console.log(`\n  ${checks.length} checks on the Add page composer.\n`);
process.exit(failed ? 1 : 0);
