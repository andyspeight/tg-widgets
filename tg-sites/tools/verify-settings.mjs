/**
 * Browser checks for the settings screen.
 *
 * WHY THIS EXISTS RATHER THAN MORE UNIT TESTS
 *
 * Two bugs on these screens got past a full green suite this month, and both were
 * only visible to an eye or a measurement. The Pexels search box was about eight
 * pixels wide, because two shared classes both set width:100% in a flex row, and all
 * twenty-six assertions passed while the field was unusable. The settings screen
 * itself shipped with two save buttons, one of which silently ignored what had just
 * been typed. Neither is expressible as a claim about a function.
 *
 * So this drives the real component in a real browser: which tabs exist, which save
 * button is on screen, whether the code fields are wide enough to read a snippet in,
 * and whether the classes actually resolve to styles. That last one is a gap worth
 * naming: tests/db.test.ts fails the build for a var() that resolves to nothing, and
 * there is no equivalent for a class name that matches no rule. A renamed panel class
 * would leave the markup correct and the styling gone.
 *
 * Served over a made-up origin rather than opened with file://, so the image the
 * favicon field shows can be fulfilled instead of 404ing into the console error
 * check.
 *
 *   node tools/build-theme-harness.mjs && node tools/verify-settings.mjs
 */

import { chromium } from 'playwright';
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const file = resolve(root, 'standalone/out/settings-harness.html');

/*
 * THE BUNDLE HAS TO BE NEWER THAN THE SOURCE, checked before anything else.
 *
 * Written after watching this exact thing happen: the harness build failed on a
 * syntax error, this script ran anyway against the previous bundle, and printed
 * twenty-three passes for code that did not compile. A stale green is worse than a
 * red, because a red sends you looking.
 */
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

const CHROMIUM = process.env.TG_CHROMIUM
  ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const ORIGIN = 'http://settings.harness';
const html = await readFile(file, 'utf8');

/** A 1x1 PNG, so an <img> in the harness resolves rather than logging an error. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

const browser = await chromium.launch({ executablePath: CHROMIUM });

const checks = [];
const check = async (name, fn) => {
  try {
    const value = await fn();
    checks.push([name, value === true ? 'PASS' : `FAIL (${value})`]);
  } catch (error) {
    checks.push([name, `FAIL (${error.message})`]);
  }
};

const errors = [];

/**
 * A page on the harness, with or without permission to edit code.
 *
 * Two separate loads rather than one, because the interesting property is a
 * difference between them and React would have to remount the whole tree anyway.
 */
async function open({ canEditCode }) {
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });

  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(`${ORIGIN}/?`) || url === `${ORIGIN}/` || url === ORIGIN) {
      return route.fulfill({ contentType: 'text/html', body: html });
    }
    if (/\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(url) || url.endsWith('/f.png')) {
      return route.fulfill({ contentType: 'image/png', body: PNG });
    }
    return route.fulfill({ status: 404 });
  });

  await page.goto(`${ORIGIN}/?staff=${canEditCode ? '1' : '0'}`);
  await page.waitForSelector('.tv-tabs .tv-tab', { timeout: 15000 });
  return page;
}

/** Open a tab by its visible name. */
async function openTab(page, label) {
  await page.locator('.tv-tab', { hasText: label }).first().click();
  await page.waitForTimeout(250);
}

// ---------------------------------------------------------------------------
// Without permission: three tabs, and no way in
// ---------------------------------------------------------------------------

const plain = await open({ canEditCode: false });

await check('the settings screen mounts', async () => {
  const tabs = await plain.locator('.tv-tab').allInnerTexts();
  return tabs.length > 0 ? true : 'no tabs';
});

await check('somebody without permission gets three tabs and no custom code', async () => {
  const tabs = (await plain.locator('.tv-tab').allInnerTexts()).map((t) => t.trim());
  return JSON.stringify(tabs) === JSON.stringify(['Analytics', 'Icons and sharing', 'Language'])
    ? true
    : JSON.stringify(tabs);
});

await check('and no code field is anywhere in their page', async () => {
  // The markup, not just the tab. If the panel rendered hidden, the head HTML of
  // the site would be in a page it should not be in at all.
  const fields = await plain.locator('#head-html, #body-html, .st-code').count();
  return fields === 0 ? true : `${fields} code fields present`;
});

await plain.close();

// ---------------------------------------------------------------------------
// With permission
// ---------------------------------------------------------------------------

const page = await open({ canEditCode: true });

await check('an owner gets a fourth tab, called Custom code', async () => {
  const tabs = (await page.locator('.tv-tab').allInnerTexts()).map((t) => t.trim());
  return tabs.length === 4 && tabs[3] === 'Custom code' ? true : JSON.stringify(tabs);
});

/*
 * The red dot that used to sit on this tab is gone, and its absence is checked
 * rather than assumed. Beside a tab a client is meant to use, a red dot reads as an
 * unread badge or an error.
 */
await check('the tab carries no warning dot now that it is theirs to use', async () =>
  (await page.locator('.st-staff-dot').count()) === 0 ? true : 'the dot is still there');

// --- the save bar, which is the bug this file was written for ---------------

await check('every other tab has exactly one save bar', async () => {
  for (const label of ['Analytics', 'Icons and sharing', 'Language']) {
    await openTab(page, label);
    const bars = await page.locator('.tv-bar').count();
    if (bars !== 1) return `${label} has ${bars}`;
  }
  return true;
});

await openTab(page, 'Custom code');

await check('the custom code tab has none, because the panel has its own', async () => {
  const bars = await page.locator('.tv-bar').count();
  const own = await page.locator('.st-code-panel .tg-btn').count();
  return bars === 0 && own === 1
    ? true
    : `${bars} global bars, ${own} buttons in the panel`;
});

// --- the panel itself ------------------------------------------------------

await check('the panel loads the current values over its own action', async () => {
  await page.waitForFunction(
    () => document.querySelector('#head-html')?.value?.length > 0,
    null,
    { timeout: 5000 },
  );
  const head = await page.locator('#head-html').inputValue();
  const body = await page.locator('#body-html').inputValue();
  return head.includes('<meta') && body.includes('<script')
    ? true
    : `head "${head.slice(0, 40)}", body "${body.slice(0, 40)}"`;
});

/*
 * THE CLASS ACTUALLY RESOLVES TO A RULE, on all four sides.
 *
 * The rename from .st-staff to .st-code-panel is exactly the kind of change that
 * leaves correct markup with no styling and nothing else would notice, which is why
 * this check is here. The first version of it read border-top-width, got the 1px
 * that the shared .tv-group supplies, and passed with the rule deleted. It also
 * masked a real bug: .tv-group's border-top was beating the shorthand here on source
 * order, so the panel had three red sides and a grey top.
 *
 * So it compares against a plain group rather than against zero. Whatever the panel
 * is, it has to be visibly different from every other section on the screen.
 */
await check('the panel is framed on all four sides, unlike a plain group', async () => {
  const panel = await page.locator('.st-code-panel').evaluate((el) => {
    const c = getComputedStyle(el);
    return [c.borderTopColor, c.borderRightColor, c.borderBottomColor, c.borderLeftColor]
      .map((colour, index) => `${[c.borderTopWidth, c.borderRightWidth, c.borderBottomWidth, c.borderLeftWidth][index]} ${colour}`);
  });

  const plain = await page.evaluate(() => {
    // A throwaway .tv-group, so the comparison is against the shared rule as the
    // browser applies it rather than against a colour written down here.
    const probe = document.createElement('section');
    probe.className = 'tv-group';
    document.querySelector('.tv-wrap').append(probe);
    const c = getComputedStyle(probe);
    const value = `${c.borderTopWidth} ${c.borderTopColor}`;
    probe.remove();
    return value;
  });

  const distinct = new Set(panel);
  if (distinct.size !== 1) return `the four sides differ: ${JSON.stringify(panel)}`;
  return panel[0] !== plain ? true : `it is styled like any other group (${plain})`;
});

await check('the warning is on screen above the fields', async () => {
  const warn = page.locator('.st-code-panel .st-warn');
  if ((await warn.count()) !== 1) return `${await warn.count()} warnings`;
  const text = (await warn.innerText()).toLowerCase();
  // It has to say the two things that matter: it runs live, and we do not check it.
  return text.includes('every page') && text.includes('do not check')
    ? true
    : `it says "${text.slice(0, 90)}"`;
});

await check('the copy addresses the site owner, not a colleague', async () => {
  const text = await page.locator('.st-code-panel').innerText();
  return !/travelgenix/i.test(text) ? true : 'it still mentions Travelgenix';
});

/*
 * The Pexels-width class of bug. A code field narrower than its own content is
 * unusable and every assertion about its value would still pass.
 */
await check('both code fields are full width and tall enough to read', async () => {
  const boxes = await page.locator('.st-code').evaluateAll((els) =>
    els.map((el) => {
      const rect = el.getBoundingClientRect();
      const parent = el.parentElement.getBoundingClientRect();
      return { width: Math.round(rect.width), height: Math.round(rect.height), parent: Math.round(parent.width) };
    }),
  );
  if (boxes.length !== 2) return `${boxes.length} code fields`;
  const bad = boxes.filter((b) => b.width < b.parent - 4 || b.height < 120);
  return bad.length === 0 ? true : JSON.stringify(bad);
});

await check('they are monospace, which is the point of the class', async () => {
  const fonts = await page.locator('.st-code').evaluateAll((els) =>
    els.map((el) => getComputedStyle(el).fontFamily),
  );
  return fonts.every((font) => /mono|menlo|consolas/i.test(font)) ? true : JSON.stringify(fonts);
});

await check('the save button is off until something changes', async () => {
  const disabled = await page.locator('.st-code-panel .tg-btn').isDisabled();
  return disabled ? true : 'it is enabled with nothing edited';
});

await check('typing turns it on, and marks it as the risky one', async () => {
  await page.locator('#head-html').fill('<meta name="verify" content="changed">');
  await page.waitForTimeout(200);
  const button = page.locator('.st-code-panel .tg-btn');
  const variant = await button.getAttribute('data-variant');
  return !(await button.isDisabled()) && variant === 'danger'
    ? true
    : `disabled ${await button.isDisabled()}, variant ${variant}`;
});

await check('the counter follows what has been typed', async () => {
  const help = await page.locator('.st-code-panel .tv-field__help').first().innerText();
  return help.includes('38 of 16384') ? true : `it says "${help.slice(-30)}"`;
});

/*
 * A screenshot fix, so a screenshot fix gets a check. The button was a bare
 * .tv-field with no top margin, sitting flush against the grey note above it and
 * reading as part of that paragraph rather than as the thing that commits.
 */
await check('the save row is separated from the note above it', async () => {
  const gap = await page.locator('.st-code-save').evaluate((el) => {
    const row = el.getBoundingClientRect();
    const above = el.previousElementSibling.getBoundingClientRect();
    return Math.round(row.top - above.bottom);
  });
  return gap >= 16 ? true : `only ${gap}px below the note`;
});

await check('and says whether it is saved, since there is no bar to say it', async () => {
  const state = await page.locator('.st-code-save__state').innerText();
  return /not saved/i.test(state) ? true : `it says "${state}" with an unsaved edit`;
});

await check('saving settles it back down', async () => {
  await page.locator('.st-code-panel .tg-btn').click();
  await page.waitForTimeout(400);
  const button = page.locator('.st-code-panel .tg-btn');
  const state = await page.locator('.st-code-save__state').innerText();
  return (await button.isDisabled())
    && (await button.innerText()) === 'Save custom code'
    && state === 'Saved'
    ? true
    : `disabled ${await button.isDisabled()}, label "${await button.innerText()}", state "${state}"`;
});

await check('it says the preview will not run this', async () => {
  const notes = await page.locator('.st-code-panel .tv-note').allInnerTexts();
  return notes.some((note) => /preview/i.test(note) && /own domain/i.test(note))
    ? true
    : JSON.stringify(notes);
});

// --- the other tabs, briefly ----------------------------------------------

await openTab(page, 'Analytics');

await check('the double-counting warning appears only when both ids are set', async () => {
  await page.locator('#ga4').fill('');
  await page.waitForTimeout(150);
  const before = await page.locator('.tv-group .st-warn').count();

  await page.locator('#ga4').fill('G-ABC1234567');
  await page.waitForTimeout(200);
  const after = await page.locator('.tv-group .st-warn').count();

  return before === 0 && after === 1 ? true : `${before} then ${after}`;
});

await check('a bad measurement id does not stop anything being typed', async () => {
  // The parser refuses it on save. The field must not fight the person mid-word.
  await page.locator('#ga4').fill('UA-1234-5');
  await page.waitForTimeout(150);
  return (await page.locator('#ga4').inputValue()) === 'UA-1234-5' ? true : 'the field rejected it';
});

await check('the save bar wakes up when a field changes', async () => {
  const bar = page.locator('.tv-bar');
  const dirty = await bar.getAttribute('data-dirty');
  const label = await bar.locator('.tv-bar__state').innerText();
  return dirty === 'true' && /not saved/i.test(label) ? true : `dirty ${dirty}, "${label}"`;
});

await openTab(page, 'Icons and sharing');

await check('all three image fields are there', async () => {
  const chosen = await page.locator('.mp-chosen').count();
  const empty = await page.locator('.mp-choose').count();
  return chosen + empty === 3 ? true : `${chosen} chosen and ${empty} empty`;
});

await check('choosing an image opens the picker', async () => {
  await page.locator('.mp-choose').first().click();
  await page.waitForTimeout(400);
  const tabs = await page.locator('.mp-tabs .mp-tab').allInnerTexts();
  return tabs.length >= 2 ? true : JSON.stringify(tabs);
});

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

console.log(`\n  ${checks.length} checks on the settings screen.\n`);
process.exit(failed ? 1 : 0);
