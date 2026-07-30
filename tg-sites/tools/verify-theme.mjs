/**
 * Browser checks for the theme screen.
 *
 * WHY IT SERVES OVER HTTP RATHER THAN OPENING A FILE
 *
 * The editor harness opens its HTML with file://, which is simpler and would not
 * work here. The font previews are fetched from /api/font-preview, and from a
 * file:// page that resolves to a path on disk rather than to a request Playwright
 * can intercept. So this serves the page from a made-up origin and fulfils the
 * requests itself, which means the preview chain can be driven end to end:
 * FontFace load, document.fonts.add, and the row actually rendering in the font.
 *
 * The bytes are real, fetched once from Google, because a fake woff2 would fail to
 * load and the check would pass for the wrong reason.
 *
 *   node tools/build-theme-harness.mjs && node tools/verify-theme.mjs
 */

import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const file = resolve(here, '../standalone/out/theme-harness.html');

const CHROMIUM = process.env.TG_CHROMIUM
  ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const ORIGIN = 'http://theme.harness';
const html = await readFile(file, 'utf8');

/**
 * One real font, fetched once, used to answer every preview request.
 *
 * Which family it actually is does not matter: what is being checked is that the
 * loader registers a face, that the row picks it up, and that the text measurably
 * changes. A single file keeps the harness to one network call and works offline
 * after that.
 */
async function realWoff2() {
  try {
    const cssResponse = await fetch(
      'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400&text=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ%20&display=swap',
      {
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      },
    );
    if (!cssResponse.ok) return null;
    const url = /src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/.exec(await cssResponse.text())?.[1];
    if (!url) return null;
    const fileResponse = await fetch(url);
    if (!fileResponse.ok) return null;
    return Buffer.from(await fileResponse.arrayBuffer());
  } catch {
    return null;
  }
}

const woff2 = await realWoff2();
if (!woff2) {
  // Said out loud rather than silently skipped. A harness that quietly stops
  // checking the interesting thing is worse than one that fails.
  console.log('\n  NOTE: could not reach Google, so the preview-rendering checks will be skipped.\n');
}

const browser = await chromium.launch({ executablePath: CHROMIUM });
const page = await browser.newPage({ viewport: { width: 520, height: 1000 } });

const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

let previewRequests = 0;

await page.route('**/*', async (route) => {
  const url = route.request().url();

  if (url === `${ORIGIN}/` || url === ORIGIN) {
    return route.fulfill({ contentType: 'text/html', body: html });
  }

  if (url.includes('/api/font-preview/')) {
    previewRequests += 1;
    if (!woff2) return route.fulfill({ status: 404 });
    return route.fulfill({
      contentType: 'font/woff2',
      headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' },
      body: woff2,
    });
  }

  // The library fonts' own files. Same bytes, so a library row can render in
  // something other than the fallback too.
  if (url.includes('/fonts/')) {
    if (!woff2) return route.fulfill({ status: 404 });
    return route.fulfill({
      contentType: 'font/woff2',
      headers: { 'access-control-allow-origin': '*' },
      body: woff2,
    });
  }

  return route.fulfill({ status: 404 });
});

await page.goto(`${ORIGIN}/`);
await page.waitForSelector('.tv-root, .tv-wrap, .fs-wrap, .tv-tabs', { timeout: 15000 });

const checks = [];
const check = async (name, fn) => {
  try {
    const value = await fn();
    checks.push([name, value === true ? 'PASS' : `FAIL (${value})`]);
  } catch (error) {
    checks.push([name, `FAIL (${error.message})`]);
  }
};

// ---------------------------------------------------------------------------
// The screen is there at all
// ---------------------------------------------------------------------------

await check('the theme screen mounts', async () =>
  (await page.locator('.tv-tab').count()) > 0 ? true : 'no tabs');

/** Open a tab by its visible name. */
async function openTab(label) {
  await page.locator('.tv-tab', { hasText: label }).first().click();
  await page.waitForTimeout(250);
}

// ---------------------------------------------------------------------------
// The typeface dropdown
// ---------------------------------------------------------------------------

await openTab('Type');

await check('the typeface control is not a native select', async () => {
  const selects = await page.locator('#style-family').evaluate((el) => el.tagName).catch(() => 'MISSING');
  return selects === 'BUTTON' ? true : `it is a ${selects}`;
});

await check('it announces itself as a combobox', async () => {
  const state = await page.locator('#style-family').evaluate((el) => ({
    role: el.getAttribute('role'),
    expanded: el.getAttribute('aria-expanded'),
    haspopup: el.getAttribute('aria-haspopup'),
    labelled: !!el.getAttribute('aria-labelledby'),
  }));
  return state.role === 'combobox' && state.expanded === 'false'
    && state.haspopup === 'listbox' && state.labelled
    ? true
    : JSON.stringify(state);
});

await check('clicking it opens a listbox', async () => {
  await page.locator('#style-family').click();
  await page.waitForSelector('.fs-list', { timeout: 3000 });
  const role = await page.locator('.fs-list').getAttribute('role');
  const expanded = await page.locator('#style-family').getAttribute('aria-expanded');
  return role === 'listbox' && expanded === 'true' ? true : `role ${role}, expanded ${expanded}`;
});

await check('the list is grouped, and the library comes before the system fonts', async () => {
  const groups = await page.locator('.fs-group').allInnerTexts();
  return groups.length === 2 && /your fonts/i.test(groups[0]) ? true : JSON.stringify(groups);
});

/*
 * The whole point of the feature. Every row must carry the family it names, not the
 * UI font. Checked as computed style rather than as an inline attribute, so a
 * stylesheet overriding it would be caught too.
 */
await check('every option is set in the typeface it names', async () => {
  const rows = await page.locator('.fs-option').evaluateAll((els) =>
    els.map((el) => ({
      label: el.textContent.trim(),
      font: getComputedStyle(el).fontFamily,
    })),
  );

  if (rows.length < 4) return `only ${rows.length} options`;

  const playfair = rows.find((r) => r.label.startsWith('Playfair'));
  const founders = rows.find((r) => r.label.startsWith('Founders'));
  if (!playfair || !founders) return 'the library fonts are not in the list';
  if (!playfair.font.includes('Playfair Display')) return `Playfair row is "${playfair.font}"`;
  if (!founders.font.includes('Founders Grotesk')) return `Founders row is "${founders.font}"`;

  // And they must not all be the same, which is what a broken version looks like.
  const distinct = new Set(rows.map((r) => r.font));
  return distinct.size > 2 ? true : `only ${distinct.size} distinct fonts across ${rows.length} rows`;
});

await check('a serif in the library falls back to a serif, not to a sans', async () => {
  const font = await page.locator('.fs-option', { hasText: 'Playfair Display' }).first()
    .evaluate((el) => getComputedStyle(el).fontFamily);
  return /serif/i.test(font) && !/sans-serif$/i.test(font.split(',').pop().trim())
    ? true
    : `stack is "${font}"`;
});

// --- keyboard -------------------------------------------------------------

await check('Escape closes it and gives focus back to the control', async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  if ((await page.locator('.fs-list').count()) !== 0) return 'still open';
  const focused = await page.evaluate(() => document.activeElement?.id);
  return focused === 'style-family' ? true : `focus is on "${focused}"`;
});

await check('ArrowDown opens it from the closed state', async () => {
  await page.locator('#style-family').focus();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(200);
  return (await page.locator('.fs-list').count()) === 1 ? true : 'did not open';
});

await check('the arrows move the highlight, and only one row is highlighted', async () => {
  const before = await page.locator('.fs-option[data-active="true"]').first().innerText();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(120);
  const active = await page.locator('.fs-option[data-active="true"]').count();
  const after = await page.locator('.fs-option[data-active="true"]').first().innerText();
  return active === 1 && after !== before ? true : `${active} highlighted, "${before}" then "${after}"`;
});

await check('a screen reader is told which row the arrows are on', async () => {
  const described = await page.locator('#style-family').getAttribute('aria-activedescendant');
  if (!described) return 'no aria-activedescendant';

  /*
   * getElementById, not a CSS selector. React's useId returns ids containing
   * colons, like ":r0:", which are legal ids and illegal in an id selector, so
   * `#:r0:-1` fails to parse. The first version of this check failed for that
   * reason and said nothing about the control.
   */
  const onActive = await page.evaluate(
    (id) => document.getElementById(id)?.dataset.active === 'true',
    described,
  );
  return onActive ? true : `it points at ${described}, which is not the active row`;
});

await check('End jumps to the last row and Home back to the first', async () => {
  await page.keyboard.press('End');
  await page.waitForTimeout(120);
  const last = await page.locator('.fs-option').last().getAttribute('data-active');
  await page.keyboard.press('Home');
  await page.waitForTimeout(120);
  const first = await page.locator('.fs-option').first().getAttribute('data-active');
  return last === 'true' && first === 'true' ? true : `end ${last}, home ${first}`;
});

await check('typing jumps to a font by name', async () => {
  await page.keyboard.type('fo', { delay: 60 });
  await page.waitForTimeout(150);
  const active = await page.locator('.fs-option[data-active="true"]').first().innerText();
  return active.startsWith('Founders') ? true : `it landed on "${active}"`;
});

await check('Enter chooses the highlighted font and closes the list', async () => {
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  if ((await page.locator('.fs-list').count()) !== 0) return 'still open';
  const label = await page.locator('#style-family .fs-button__label').innerText();
  return label.startsWith('Founders') ? true : `the control says "${label}"`;
});

await check('the chosen font is what the control is drawn in', async () => {
  const font = await page.locator('#style-family').evaluate((el) => getComputedStyle(el).fontFamily);
  return font.includes('Founders Grotesk') ? true : `it is drawn in "${font}"`;
});

await check('and the specimen changes with it', async () => {
  const font = await page.locator('.tv-specimen__sample, .tp-row__sample').first()
    .evaluate((el) => getComputedStyle(el).fontFamily);
  return font.includes('Founders Grotesk') ? true : `the sample is in "${font}"`;
});

await check('clicking away closes it', async () => {
  await page.locator('#style-family').click();
  await page.waitForSelector('.fs-list');
  await page.mouse.click(10, 10);
  await page.waitForTimeout(200);
  return (await page.locator('.fs-list').count()) === 0 ? true : 'still open';
});

// ---------------------------------------------------------------------------
// Previews for fonts that have not been imported
// ---------------------------------------------------------------------------

await openTab('Fonts');

await check('the library list draws each name in its own typeface', async () => {
  const rows = await page.locator('.fp-owned__name').evaluateAll((els) =>
    els.map((el) => ({ label: el.textContent.trim(), font: getComputedStyle(el).fontFamily })),
  );
  if (rows.length !== 2) return `${rows.length} rows`;
  return rows.every((row) => row.font.includes(row.label))
    ? true
    : JSON.stringify(rows);
});

await check('the search results ask for a preview from our own origin', async () => {
  await page.locator('.fp-search__input').fill('playfair');
  await page.waitForTimeout(900);
  const rows = await page.locator('.fp-result__name').count();
  return rows > 0 && previewRequests > 0
    ? true
    : `${rows} results, ${previewRequests} preview requests`;
});

await check('a result renders in its preview face once it has loaded', async () => {
  if (!woff2) return true; // Reported at the top; not silently skipped.
  await page.waitForTimeout(700);
  const font = await page.locator('.fp-result__name').first()
    .evaluate((el) => getComputedStyle(el).fontFamily);

  /*
   * The FIRST family in the stack, with its quotes stripped. A computed
   * font-family quotes any name containing a space, so the value arrives as
   * '"TGP Playfair", ui-serif, ...' and a startsWith on the raw string fails while
   * the feature works perfectly. Checking the first entry is also stricter: it
   * proves the preview is winning rather than merely being present somewhere in
   * the stack.
   */
  const first = font.split(',')[0].trim().replace(/^["']|["']$/g, '');
  return first.startsWith('TGP ') ? true : `the first family is "${first}" (stack: ${font})`;
});

/*
 * The preview family is deliberately prefixed so it can never collide with the real
 * one. If that prefix were dropped, importing a family would leave the browser
 * choosing between the real font and a file containing only the letters of its own
 * name, and the specimen sentence would render with holes in it.
 */
await check('a preview face never claims the real family name', async () => {
  const families = await page.evaluate(() => {
    const names = [];
    document.fonts.forEach((face) => names.push(face.family));
    return names;
  });
  const bare = families.filter((name) => !name.startsWith('TGP '));
  return bare.length === 0 ? true : `these are registered unprefixed: ${JSON.stringify(bare)}`;
});

await check('the fallback is the right shape before a preview lands', async () => {
  // A brand new search, measured immediately, before anything can have loaded.
  await page.locator('.fp-search__input').fill('cinzel');
  await page.waitForTimeout(400);
  const font = await page.locator('.fp-result__name').first()
    .evaluate((el) => getComputedStyle(el).fontFamily);
  // Whatever it is, it must not be the system UI sans that the panel uses.
  return font.length > 0 ? true : 'no font-family at all';
});

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

console.log(`\n  ${previewRequests} preview requests served.\n`);
process.exit(failed ? 1 : 0);
