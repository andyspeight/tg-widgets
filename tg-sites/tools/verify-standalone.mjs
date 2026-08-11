/**
 * Smoke test for the standalone build.
 *
 * Loads the single-file editor in a real browser and drives the interactions
 * that matter, so a broken bundle is caught here rather than by whoever it
 * was sent to. Fails loudly on any console error or page exception.
 *
 *   node tools/verify-standalone.mjs
 */

import { chromium } from 'playwright';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const file = resolve(here, '../standalone/out/tg-sites-editor.html');

/*
 * REFUSE TO RUN AGAINST A STALE BUNDLE.
 *
 * This file drives a built artefact, not the source. Editing a component and
 * running the checks without rebuilding tests the PREVIOUS build, which reports
 * a wall of passes over work that is not in it, and reports failures for fixes
 * that are. Both have happened, and the second is worse: it sends you debugging
 * code that is already correct.
 *
 * Cheaper to compare timestamps than to trust anybody to remember.
 */
const WATCHED = ['components', 'lib', 'app', 'standalone'];
const SKIP = new Set(['node_modules', '.next', 'out']);

function newestUnder(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestUnder(full) : statSync(full).mtimeMs);
  }
  return newest;
}

const built = statSync(file).mtimeMs;
const newestSource = Math.max(
  ...WATCHED.map((name) => newestUnder(resolve(here, '..', name))),
);

if (newestSource > built) {
  const behind = Math.round((newestSource - built) / 1000);
  console.error(
    `\n  The bundle is ${behind}s older than the source it was built from.\n` +
      '  Run: node tools/build-standalone.mjs\n',
  );
  process.exit(1);
}

/*
 * This image ships Chromium at a fixed path and the npm playwright version
 * does not necessarily match its download revision, so point at the binary
 * that is already here rather than fetching another one.
 */
const CHROMIUM = process.env.TG_CHROMIUM
  ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const browser = await chromium.launch({ executablePath: CHROMIUM });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

/*
 * One expected network failure, and only one.
 *
 * The image checks type a deliberately fake address into the field to prove it
 * reaches the rendered img tag. The browser then tries to load it and cannot, which
 * is the point: the assertion is about the src attribute, not about the picture
 * arriving. Everything else that fails to load is still a real failure.
 *
 * Matched on the ADDRESS the failure came from rather than on a flag set around the
 * check. A flag looked tidier and did not work: a failed image load is asynchronous,
 * so the console message arrived after the check had finished and cleared it.
 */
const EXPECTED_TO_FAIL = 'images.example.test';

const errors = [];
page.on('console', (message) => {
  if (message.type() !== 'error') return;
  if ((message.location()?.url ?? '').includes(EXPECTED_TO_FAIL)) return;
  errors.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

await page.goto(pathToFileURL(file).href);
await page.waitForSelector('.ed-root', { timeout: 15000 });

const checks = [];
/*
 * PROGRESS ON STDERR WHILE IT RUNS, and the reason is worth writing down.
 *
 * The results are collected and printed together at the end, which is right: a
 * sorted list with the failures gathered is what somebody wants to read. What was
 * wrong was that NOTHING came out until then. This suite takes several minutes and
 * two sessions in a row have sat watching an empty file wondering whether it had
 * hung, killed it, and started again.
 *
 * So each check names itself as it finishes, on stderr rather than stdout, which
 * keeps `node tools/verify-standalone.mjs > out.txt` producing exactly the report
 * it produced before. Set TG_QUIET=1 to turn it off.
 */
const quiet = process.env.TG_QUIET === '1';
let done = 0;

const check = async (name, fn) => {
  try {
    const value = await fn();
    checks.push([name, value === true ? 'PASS' : `FAIL (${value})`]);
  } catch (error) {
    checks.push([name, `FAIL (${error.message})`]);
  }
  done += 1;
  if (!quiet) {
    const [, status] = checks[checks.length - 1];
    process.stderr.write(`  ${String(done).padStart(3)} ${status.slice(0, 4)}  ${name}\n`);
  }
};

await check('editor mounts', async () => (await page.locator('.ed-root').count()) === 1);

await check('seed page renders', async () =>
  (await page.locator('.tgs-section').count()) === 3);

await check('outline lists sections as cards', async () =>
  (await page.locator('.ed-sec').count()) === 3);

// The whole point of the redesign: the pane opens calm, not as a tree.
await check('sections start collapsed', async () =>
  (await page.locator('.ed-sec[data-open="true"]').count()) === 0);

await check('a section names itself from its heading', async () =>
  (await page.locator('.ed-sec-name', { hasText: 'Greece, planned properly' }).count()) === 1);

// Percentages belong in the properties pane and on the canvas handles, not
// in a list an agent reads at a glance.
await check('no percentages in the outline', async () => {
  const text = (await page.locator('.ed-outline').innerText()) ?? '';
  return text.includes('%') ? `outline still shows "${text.match(/\S*%\S*/)?.[0]}"` : true;
});

await check('layout reads in words', async () => {
  const text = await page.locator('.ed-outline').innerText();
  return text.includes('Two columns') && text.includes('Full width');
});

// Every icon must be an SVG. Any leftover glyph would show up as a bare
// character inside a button with no svg child.
await check('no glyph icons anywhere in the chrome', async () => {
  const bad = await page.evaluate(() => {
    const glyphs = /[\u2190-\u21FF\u2500-\u27BF\u25A0-\u25FF\u00B6]/;
    const hits = [];
    for (const node of document.querySelectorAll('.ed-root button, .ed-root .ed-item-icon')) {
      const own = [...node.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent)
        .join('');
      if (glyphs.test(own)) hits.push(own.trim());
    }
    return hits;
  });
  return bad.length === 0 ? true : `found ${JSON.stringify(bad)}`;
});

await check('every icon-only control has an accessible name', async () => {
  const unnamed = await page.evaluate(() => {
    const hits = [];
    for (const el of document.querySelectorAll('.ed-root button')) {
      const text = (el.textContent ?? '').trim();
      const label = el.getAttribute('aria-label') ?? el.getAttribute('title');
      if (!text && !label) hits.push(el.className);
    }
    return hits;
  });
  return unnamed.length === 0 ? true : `unnamed: ${JSON.stringify(unnamed)}`;
});

/*
 * Measured by probing, not by reading a box.
 *
 * Several controls here are deliberately a compact pill with an ::after
 * overlay claiming the rest of the 44px, so the visual stays small while the
 * target does not. getBoundingClientRect only sees the pill and called those
 * a failure, which is the test being wrong rather than the button.
 *
 * What matters is where a finger can land, so this asks the page: at the top
 * and bottom of the 44px band, what would a tap actually hit? A pseudo
 * element reports as its owner, so the overlay pattern passes and a genuinely
 * small button still fails.
 */
await check('touch targets meet the 44px rule', async () => {
  const small = await page.evaluate(() => {
    const MIN = 44;
    const hits = [];

    for (const el of document.querySelectorAll('.ed-root button')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue; // hidden
      if (r.height >= MIN) continue;

      const midY = r.top + r.height / 2;

      // Hit testing only means anything inside the viewport. Below the fold
      // elementFromPoint returns null for everything, which says nothing
      // about the control and would fail every long page.
      if (midY - MIN / 2 < 0 || midY + MIN / 2 > window.innerHeight) continue;

      // Strictly the button or something inside it. An ancestor happening to
      // cover the point is not the same as the button being tappable there.
      const ownsAt = (x, y) => {
        if (y < 0 || y > window.innerHeight) return false;
        const at = document.elementFromPoint(x, y);
        return at !== null && (at === el || el.contains(at));
      };

      /*
       * Try several points across the width before giving up.
       *
       * A wide control can be partly covered by something that legitimately
       * sits above it: the section height strip runs the full width of the
       * canvas and the Add Section pill sits on top of the middle of it. The
       * strip is still perfectly grabbable, just not at dead centre, and a
       * probe that only samples the centre calls that unreachable.
       */
      const columns = [0.5, 0.25, 0.75, 0.9, 0.1];
      const x = columns
        .map((f) => r.left + r.width * f)
        .find((candidate) => ownsAt(candidate, midY));

      if (x === undefined) {
        hits.push(`${el.className || el.tagName} unreachable`);
        continue;
      }

      const owns = (y) => ownsAt(x, y);

      /*
       * Walk outwards to find how tall the reachable band actually is.
       *
       * Not the same as probing a band centred on the element. The section
       * height grip extends its target upward only, on purpose, so it cannot
       * swallow a click meant for the section below it. That is still a 44px
       * target; it is just not a symmetrical one, and a centred probe called
       * it a failure.
       */
      let top = midY;
      let bottom = midY;
      while (midY - top < 80 && owns(top - 1)) top -= 1;
      while (bottom - midY < 80 && owns(bottom + 1)) bottom += 1;

      const reaches = bottom - top + 1 >= MIN;

      if (!reaches) hits.push(`${el.className || el.tagName} ${Math.round(r.height)}px`);
    }
    return hits;
  });
  return small.length === 0 ? true : `too small: ${JSON.stringify(small.slice(0, 4))}`;
});

await check('a section has a height handle', async () => {
  const count = await page.locator('.ed-vresize').count();
  return count >= 3 ? true : `found ${count}`;
});

await check('dragging the handle makes the section taller', async () => {
  const section = page.locator('.tgs-section').first();
  const before = (await section.boundingBox())?.height ?? 0;

  const grip = page.locator('.ed-vresize__grip').first();
  const box = await grip.boundingBox();
  if (!box) return 'no grip';

  // Grabbed at the grip, not at the centre of the strip: the Add Section pill
  // sits above the middle of the same seam and would take the pointer.
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();
  // Padding applies top and bottom, so 80px of pointer is 40px each end.
  await page.mouse.move(x, y + 80, { steps: 8 });
  await page.mouse.up();

  const after = (await section.boundingBox())?.height ?? 0;
  return after > before + 40 ? true : `${Math.round(before)}px then ${Math.round(after)}px`;
});

await check('the whole drag is one undo step', async () => {
  const section = page.locator('.tgs-section').first();
  const before = (await section.boundingBox())?.height ?? 0;
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(120);
  const after = (await section.boundingBox())?.height ?? 0;
  return after < before ? true : `still ${Math.round(after)}px`;
});

await check('the height is reachable by keyboard', async () => {
  const section = page.locator('.tgs-section').first();
  const before = (await section.boundingBox())?.height ?? 0;

  await page.locator('.ed-vresize').first().focus();
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(120);

  const after = (await section.boundingBox())?.height ?? 0;
  return after > before ? true : `${Math.round(before)}px then ${Math.round(after)}px`;
});

// Contrast is the one rule you cannot eyeball, and dark mode is where it
// slips. This measures the real computed colours rather than trusting them.
await check('primary button clears 4.5:1 in this theme', async () => {
  const ratio = await page.evaluate(() => {
    const el = document.querySelector('.ed-btn[data-variant="primary"]');
    if (!el) return null;
    const style = getComputedStyle(el);
    const parse = (value) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const lum = ([r, g, b]) => {
      const f = (c) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const a = lum(parse(style.color));
    const b = lum(parse(style.backgroundColor));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  if (ratio === null) return 'no primary button found';
  return ratio >= 4.5 ? true : `only ${ratio.toFixed(2)}:1`;
});

await check('hero row uses dragged widths', async () => {
  const style = await page.locator('.tgs-row').first().getAttribute('style');
  return style?.includes('55% 45%') ?? false;
});

// Click a block in the preview and confirm the properties pane follows.
await check('click to select loads properties', async () => {
  await page.locator('.tgs-heading').first().click();
  await page.waitForTimeout(250);
  return (await page.locator('.ed-props .ed-field').count()) > 0;
});

await check('selection outline is drawn', async () =>
  (await page.locator('.ed-canvas-frame [data-path].is-selected').count()) === 1);

/*
 * Edit a heading in the PANE and confirm the canvas follows.
 *
 * Through .ed-rt, the rich text field, not the plain input it used to be: a
 * heading holds markup since 31 Jul 2026, which is what gave it the toolbar.
 * The pane is still the second way in and still has to work.
 */
await check('editing a field updates the preview', async () => {
  const field = page.locator('.ed-props .ed-rt').first();
  if (!(await field.count())) return 'no rich text field on a heading';

  await field.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Feedback test heading', { delay: 20 });
  await page.waitForTimeout(400);
  return (await page.locator('.tgs-heading', { hasText: 'Feedback test heading' }).count()) > 0;
});

await check('undo reverts the edit', async () => {
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  return (await page.locator('.tgs-heading', { hasText: 'Feedback test heading' }).count()) === 0;
});

// Drag a column boundary and confirm the widths actually move.
await check('dragging a column edge resizes it', async () => {
  const before = await page.locator('.tgs-row').first().getAttribute('style');
  const handle = page.locator('.ed-resize').first();
  const box = await handle.boundingBox();
  if (!box) return 'no resize handle';

  await page.mouse.move(box.x + box.width / 2, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 120, box.y + 40, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const after = await page.locator('.tgs-row').first().getAttribute('style');
  return before !== after ? true : `width did not change (${after})`;
});

await check('widths still sum to 100 after the drag', async () => {
  const style = await page.locator('.tgs-row').first().getAttribute('style');
  const numbers = [...(style ?? '').matchAll(/([\d.]+)%/g)].map((m) => Number(m[1]));
  const total = numbers.reduce((sum, value) => sum + value, 0);
  return Math.abs(total - 100) < 0.05 ? true : `sums to ${total}`;
});

// Phone viewport must stack the columns.
await check('phone viewport stacks columns', async () => {
  await page.getByRole('button', { name: 'Phone' }).click();
  await page.waitForTimeout(400);
  const columns = await page.locator('.tgs-row').first().evaluate(
    (node) => getComputedStyle(node).gridTemplateColumns,
  );
  // One track once stacked, two while side by side.
  return columns.split(' ').length === 1 ? true : `grid is "${columns}"`;
});

/**
 * Put the outline panel back, if choosing Desktop folded it away.
 *
 * DESKTOP FOLDS THE PANELS ON PURPOSE. Andy asked for it on 31 Jul 2026: a 1200px
 * preview cannot be drawn in the 800px left between two panels, so Desktop takes
 * the room it needs. Everything the outline holds goes with it, including the
 * section toggles and the Add content buttons.
 *
 * Which broke these checks rather than the product: they clicked Desktop to undo
 * the Phone click above, then clicked into an outline that was no longer there,
 * and Playwright waited on an element that would never become clickable. Worth
 * naming because the same trap is waiting for the next check that reaches into
 * the outline after touching the viewport buttons.
 */
async function showOutline() {
  await showPanels();
}

/**
 * Both panels back, and it also has to survive a reload.
 *
 * The folded state is remembered in localStorage, deliberately, so somebody who
 * folds a panel does not have to fold it again tomorrow. Which means a
 * page.reload() in the middle of this file does NOT undo a fold: it restores it.
 * Every check that reads the outline or the properties pane after touching the
 * viewport buttons needs this, reload or no reload.
 */
async function showPanels() {
  for (const label of ['Show the page panel', 'Show the settings panel']) {
    const button = page.locator(`[aria-label="${label}"]`);
    if (await button.count()) {
      await button.click();
      await page.waitForTimeout(150);
    }
  }
}

await check('block picker opens from a section', async () => {
  await page.getByRole('button', { name: 'Desktop' }).click();
  await page.waitForTimeout(200);
  await showOutline();
  await page.locator('.ed-sec-toggle').first().click();
  await page.waitForTimeout(300);
  await page.locator('.ed-add', { hasText: 'Add content' }).first().click();
  await page.waitForTimeout(300);
  return (await page.locator('.tg-modal').count()) === 1;
});

/*
 * The count MOVES DELIBERATELY. 13 until the two widget blocks landed on 31 Jul
 * 2026, 15 when the menu joined them, 16 when Cards did, 18 with Accordion and
 * Tabs, 19 with the Slider, 20 with the Table, 27 once the social, steps, stats,
 * logos and imported blocks and then the inner container had all joined, 28 when
 * the Location map landed, then 31 when Before & After, the Testimonial slider
 * and Audio joined it together (7 Aug 2026). A hardcoded number is the point
 * rather than a maintenance cost: adding a block should make somebody look at
 * the picker, and a block that silently stops rendering its card is exactly what
 * this catches.
 *
 * The harness runs as staff, so the staff-only Embed block is counted here too:
 * 31 is the whole library, one fewer than that for a client.
 */
await check('block picker offers the full library', async () =>
  (await page.locator(".ed-block-card").count()) === 31);

await check('including both ways to put a widget on a page', async () => {
  const cards = (await page.locator('.ed-block-card').allInnerTexts()).join(' | ');
  const ours = /Travelgenix widget/.test(cards);
  const theirs = /Embedded widget/.test(cards);
  return ours && theirs ? true : `ours ${ours}, theirs ${theirs}`;
});

// Leave the page as we found it, or the open modal eats the next click.
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// --- adding a section ------------------------------------------------

await check('there is an insert point on every section seam', async () =>
  // One before the first section and one after each of the three.
  (await page.locator('.ed-insert__btn').count()) === 4);

// The preview has to stay pixel-accurate to the published page, so the
// insert affordance must float over the seam rather than occupy it.
await check('insert points do not shift the page', async () => {
  const heights = await page.evaluate(() =>
    [...document.querySelectorAll('.ed-insert')].map((n) => n.getBoundingClientRect().height),
  );
  return heights.every((h) => h === 0) ? true : `heights ${JSON.stringify(heights)}`;
});

await check('an insert point opens the section picker', async () => {
  await page.locator('.ed-insert__btn').first().click();
  await page.waitForTimeout(300);
  const heading = await page.locator('.tg-modal__head').innerText();
  return heading.includes('Add a section') ? true : `head reads "${heading}"`;
});

/*
 * Three ways in, Andy's ask on 30 Jul 2026. Layouts is what this dialog used to
 * be and stays the tab it opens on, because it is the one somebody reaches for
 * when they already know what they are building.
 */
await check('it offers Layouts, Designed and AI, opening on Layouts', async () => {
  const tabs = (await page.locator('.ed-tab').allInnerTexts()).map((t) => t.trim());
  const selected = await page.locator('.ed-tab[aria-selected="true"]').innerText();
  return JSON.stringify(tabs) === '["Layouts","Designed","AI"]' && selected === 'Layouts'
    ? true
    : `${JSON.stringify(tabs)}, on "${selected}"`;
});

await check('the picker offers the full layout set', async () =>
  (await page.locator('.ed-layout-card').count()) === 12);

await check('layout thumbnails are drawn, not described', async () =>
  (await page.locator('.ed-layout-card .ed-thumb rect').count()) > 12);

await check('Designed shows ready-made sections in a category', async () => {
  await page.locator('.ed-tab', { hasText: 'Designed' }).click();
  await page.waitForTimeout(300);

  const cards = await page.locator('.ed-preset-card').count();
  // The first line only: each category button now also carries a count badge,
  // so its text reads "Text\n15".
  const cats = (await page.locator('.ed-designed__cat').allInnerTexts()).map((t) =>
    t.trim().split('\n')[0].trim());
  // Layouts must be gone, or both grids would be on screen at once.
  const layouts = await page.locator('.ed-layout-card').count();

  return cards >= 6 && cats.includes('Text') && layouts === 0
    ? true
    : `${cards} cards, categories ${JSON.stringify(cats)}, ${layouts} layout cards still shown`;
});

/*
 * The thumbnails are drawn from the same rows and blocks that build the section,
 * which is the reason presets are data. A hand-made picture per entry can promise
 * something the entry does not build and nothing catches it, which is the lesson
 * layouts.ts records at the top of itself.
 */
/*
 * Andy asked for a second category on 31 Jul 2026: "Now adding more 'designed'
 * sections - these are under a label of 'Blank'". Eight neutral starting
 * arrangements, nothing about travel in any of them, which is why they are
 * called Blank and sit above Text.
 */
await check('there is more than one category, and Blank leads', async () => {
  const cats = (await page.locator('.ed-designed__cat').allInnerTexts()).map((t) =>
    t.trim().split('\n')[0].trim());
  return cats[0] === 'Blank' && cats.includes('Text')
    ? true
    : `the categories are ${JSON.stringify(cats)}`;
});

/*
 * The card presets style the COLUMN, not a block inside it, which is a thing
 * presets could not do until this category needed it. Checked on the page
 * rather than in the data: a border in the preset that no column ends up
 * drawing is a picture of a section nobody can build.
 */
await check('a card preset really produces bordered columns', async () => {
  await page.locator('.ed-preset-card', { hasText: 'Three cards' }).click();
  await page.waitForTimeout(600);

  const bordered = await page.evaluate(() =>
    [...document.querySelectorAll('.tgs-col')].filter(
      (col) => parseFloat(getComputedStyle(col).borderTopWidth) > 0,
    ).length);

  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  await openDesigned();

  return bordered === 3 ? true : `${bordered} columns came out with a border`;
});

await check('every designed card draws its own wireframe', async () => {
  const perCard = await page.locator('.ed-preset-card').evaluateAll((cards) =>
    cards.map((card) => card.querySelectorAll('.ed-thumb--preset rect').length));

  const empty = perCard.filter((count) => count === 0).length;
  const distinct = new Set(perCard).size;

  // Not all the same, or they are being drawn from something other than the
  // preset. Not zero, or a card is blank and looks like it failed to load.
  return empty === 0 && distinct > 2
    ? true
    : `${empty} blank, ${distinct} distinct bar counts across ${perCard.length} cards`;
});

await check('a preset builds a section with its content already in it', async () => {
  const before = await page.locator('.tgs-section').count();

  /*
   * THE TEXT CATEGORY FIRST. The Designed tab opens on whichever category is
   * first in the list, and since the Blank library landed that is Blank, not
   * Text. This check names a Text preset, so it has to go and get it.
   */
  await page.locator('.ed-designed__cat', { hasText: 'Text' }).first().click();
  await page.waitForTimeout(300);

  /*
   * MATCHED ON THE NAME ELEMENT, not on the card's text.
   *
   * hasText searches everything inside the card, name and description alike, and
   * the Blank library added a card called "Four points" whose description opens
   * "Four short points across the page". So `hasText: 'Four short points'` began
   * matching two cards and the click failed on the ambiguity, which read as the
   * preset being broken rather than as the selector being loose.
   */
  await page
    .locator('.ed-preset-card')
    .filter({ has: page.locator('.ed-preset-card__name', { hasText: /^Four short points$/ }) })
    .first()
    .click();
  await page.waitForTimeout(500);

  const after = await page.locator('.tgs-section').count();
  if (after !== before + 1) return `sections went ${before} -> ${after}`;

  /*
   * THE NEW SECTION, not the first one on the page.
   *
   * This read `.tgs-section` first and described the seed page's opening
   * section back at you: "2 columns, saying Tailor-made travel". Add a section
   * appends, so the new one is last, and a check that looks at the wrong
   * section reports a working preset as broken.
   */
  const section = page.locator('.tgs-section').last();
  const columns = await section.locator('.tgs-col').count();
  const text = await section.innerText();
  const ok = columns === 4 && /short title/i.test(text);

  /*
   * Undone before returning, so this check leaves the page as it found it.
   * The harness is sequential and a later check counts sections absolutely, so
   * a section left behind here fails a check three screens away that has
   * nothing to do with presets. It also proves a preset insert joins the undo
   * stack like every other whole-page change.
   */
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  const restored = await page.locator('.tgs-section').count();

  if (!ok) return `${columns} columns, saying "${text.slice(0, 60)}"`;
  return restored === before ? true : `undo left ${restored} sections, expected ${before}`;
});

/*
 * HOW MANY THERE ARE, said out loud.
 *
 * Nine of fifteen fit on a 1000px screen and the rest are below the fold behind
 * a half-clipped row. Andy asked for seven designs to be added on 30 Jul 2026
 * that had been built and shipped a few hours earlier: he saw what fitted and
 * reasonably took it for all of them.
 */
/** Open the section picker on the Designed tab, from wherever we are. */
async function openDesigned() {
  await closeAnyDialog();
  // The outline's own button, which is always on screen. The seam buttons the
  // checks above use only appear on hover, so clicking one from a cold start
  // waits for a visibility that never arrives.
  await page.locator('.ed-outline button', { hasText: 'Add a section' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.ed-tab', { hasText: 'Designed' }).click();
  await page.waitForTimeout(400);
}

await check('the category says how many designs are in it', async () => {
  await openDesigned();
  const shown = await page.locator('.ed-designed__count').first().innerText();
  const cards = await page.locator('.ed-preset-card').count();
  return Number(shown) === cards
    ? true
    : `the badge says ${shown} and there are ${cards} cards`;
});

await check('and there are more of them than fit on screen, so the count earns its place', async () => {
  const counts = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.ed-preset-card')];
    const fits = cards.filter((card) => card.getBoundingClientRect().bottom <= window.innerHeight);
    return { total: cards.length, visible: fits.length };
  });
  // Put the dialog away. The checks below open the picker from a seam button,
  // which an open modal covers, so leaving it up broke two of them.
  await closeAnyDialog();

  return counts.total > counts.visible
    ? true
    : `all ${counts.total} are on screen, so nothing is hidden`;
});

await check('the AI tab is an honest stub rather than a dead form', async () => {
  await page.locator('.ed-insert__btn').first().click();
  await page.waitForTimeout(300);
  await page.locator('.ed-tab', { hasText: 'AI' }).click();
  await page.waitForTimeout(300);

  const text = await page.locator('.ed-ai-stub').innerText();
  // Nothing to type into, because a disabled box looks like it might work if
  // you found the right words.
  const inputs = await page.locator('.ed-ai-stub input, .ed-ai-stub textarea').count();

  await closeAnyDialog();
  return /not built yet/i.test(text) && inputs === 0
    ? true
    : `${inputs} inputs, saying "${text.slice(0, 60)}"`;
});

// Back to Layouts for the check below, which picks one.
await check('the picker reopens on Layouts', async () => {
  await page.locator('.ed-insert__btn').first().click();
  await page.waitForTimeout(300);
  const selected = await page.locator('.ed-tab[aria-selected="true"]').innerText();
  return selected === 'Layouts' ? true : `it reopened on "${selected}"`;
});

await check('picking a layout inserts a section in the right place', async () => {
  const before = await page.locator('.tgs-section').count();
  // "Two by two" is the only four-cell layout, so the shape is checkable.
  await page.locator('.ed-layout-card', { hasText: 'Two by two' }).click();
  await page.waitForTimeout(400);

  const after = await page.locator('.tgs-section').count();
  if (after !== before + 1) return `sections went ${before} -> ${after}`;

  // Inserted at index 0, so it must be the first section, with two rows of
  // two columns each.
  const shape = await page.locator('.tgs-section').first().evaluate((node) =>
    [...node.querySelectorAll('.tgs-row')].map((row) => row.querySelectorAll('.tgs-col').length),
  );
  return JSON.stringify(shape) === '[2,2]' ? true : `shape ${JSON.stringify(shape)}`;
});

await check('the new section is undoable', async () => {
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  return (await page.locator('.tgs-section').count()) === 3;
});

/*
 * Dark mode gets its own pass. It is where contrast quietly fails, because
 * nobody looks at it as often, and a token that works as a background in one
 * theme can be a foreground in the other.
 */
const darkPage = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  colorScheme: 'dark',
});
darkPage.on('pageerror', (error) => errors.push(`dark pageerror: ${error.message}`));
await darkPage.goto(pathToFileURL(file).href);
await darkPage.waitForSelector('.ed-root', { timeout: 15000 });

// A dark operating system must NOT hand over a dark editor on its own.
await check('a dark system still opens in light', async () => {
  const theme = await darkPage.locator('.ed-root').getAttribute('data-theme');
  return theme === 'light' ? true : `opened as "${theme}"`;
});

await check('choosing Dark switches the chrome', async () => {
  await darkPage.getByRole('button', { name: 'More actions' }).click();
  await darkPage.waitForTimeout(200);
  await darkPage.getByRole('menuitemradio', { name: 'Dark' }).click();
  await darkPage.waitForTimeout(300);
  const theme = await darkPage.locator('.ed-root').getAttribute('data-theme');
  return theme === 'dark' ? true : `theme is "${theme}"`;
});

const contrastIn = (target) => async () => {
  const ratio = await target.evaluate(() => {
    const el = document.querySelector('.ed-btn[data-variant="primary"]');
    if (!el) return null;
    const style = getComputedStyle(el);
    const parse = (value) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const lum = ([r, g, b]) => {
      const f = (c) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const a = lum(parse(style.color));
    const b = lum(parse(style.backgroundColor));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  if (ratio === null) return 'no primary button found';
  return ratio >= 4.5 ? true : `only ${ratio.toFixed(2)}:1`;
};

await check('dark mode actually changes the chrome', async () => {
  const bg = await darkPage.locator('.ed-root').evaluate((n) => getComputedStyle(n).backgroundColor);
  const light = await page.locator('.ed-root').evaluate((n) => getComputedStyle(n).backgroundColor);
  return bg !== light ? true : `both themes render ${bg}`;
});

await check('dark mode: primary button clears 4.5:1', contrastIn(darkPage));

await check('dark mode: body text clears 4.5:1 on the panel', async () => {
  const ratio = await darkPage.evaluate(() => {
    const el = document.querySelector('.ed-sec-name');
    if (!el) return null;
    const panel = document.querySelector('.ed-outline');
    const parse = (value) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const lum = ([r, g, b]) => {
      const f = (c) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const a = lum(parse(getComputedStyle(el).color));
    const b = lum(parse(getComputedStyle(panel).backgroundColor));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  if (ratio === null) return 'no section name found';
  return ratio >= 4.5 ? true : `only ${ratio.toFixed(2)}:1`;
});

/*
 * Run last, after a reload.
 *
 * Everything above has clicked around the editor, so the selection is
 * whatever the previous check left. These two depend on selecting a specific
 * thing, so they start from a clean page rather than from wherever we ended
 * up. The first version of them failed for exactly that reason.
 */
await page.reload();
await page.waitForSelector('.ed-root');
// A reload RESTORES a folded panel rather than clearing it, and both of these
// read from the outline and the properties pane. See showPanels.
await showPanels();

/*
 * Select something, then open every collapsed group before reading labels.
 *
 * The pane groups its settings and Style opens closed, which is deliberate:
 * an agent who wants a tone should not scroll past a border colour to reach
 * it. A test that assumed everything was on screen at once was testing the
 * old flat list.
 */
async function labelsAfter(select) {
  await select();
  await page.waitForTimeout(200);

  /*
   * BOUNDED, and the bound is the point rather than tidiness.
   *
   * This was `while there is a closed group, click the first one`, with no cap. A
   * group that does not open on click makes that loop run for ever, and it does
   * it quietly: each turn is one click and an 80ms wait, so the process sits at
   * almost no CPU producing no output. Three runs were killed on the suspicion
   * that Playwright had hung before it turned out to be this.
   *
   * Twenty is far more than the pane has ever had. Reaching it means something
   * is wrong with the pane, so it stops and lets the checks below fail on what
   * they can see, which is a result somebody can read.
   */
  const closed = page.locator('.ed-group__head button[aria-expanded="false"]');
  for (let turn = 0; turn < 20 && (await closed.count()) > 0; turn += 1) {
    await closed.first().click();
    await page.waitForTimeout(80);
  }

  return page.evaluate(() =>
    [...document.querySelectorAll('.ed-props .ed-label')].map((l) => l.textContent?.trim()));
}

await check('a section and a column offer the same style controls', async () => {
  const section = await labelsAfter(() => page.locator('.ed-sec-name').first().click());
  // Through the outline's column label, not by clicking the column on the
  // canvas: a click there lands on the block inside it, which is the right
  // behaviour and the reason the label had to become a control.
  const column = await labelsAfter(async () => {
    await page.locator('.ed-side-btn').first().click();
  });

  // Every style control a section has, a column has too. That is the whole
  // reason BoxSchema and BoxPanel exist rather than two of each.
  const shared = ['Padding (inner spacing)', 'Background colour', 'Corner radius', 'Border', 'Shadow'];
  const missingOnSection = shared.filter((l) => !section.includes(l));
  const missingOnColumn = shared.filter((l) => !column.includes(l));

  if (missingOnSection.length) return `section is missing ${JSON.stringify(missingOnSection)}`;
  if (missingOnColumn.length) return `column is missing ${JSON.stringify(missingOnColumn)}`;
  return true;
});

/*
 * THE PRESETS, WHICH ARE THE REASON A COLUMN NOW MATCHES A SECTION.
 *
 * A section had a quick None/S/M/L/XL row and a column had only the four numeric
 * fields, so a comfortable inset on a column meant typing a number four times or
 * knowing to press the link button first. Andy asked for the same padding options
 * in both, 30 Jul 2026. They live in PaddingBox, which both panes embed, so the
 * interesting check is that BOTH show them rather than that one does.
 */
await check('both a section and a column offer the padding presets', async () => {
  const count = async () => page.locator('.ed-pad__presets button').count();

  await page.locator('.ed-sec-name').first().click();
  await page.waitForTimeout(200);

  /*
   * The Style group has to be opened on a section, and that asymmetry is real
   * rather than a flaw in the check. A section's padding box lives under Style
   * because a section already has a visible preset row of its own for the
   * vertical space above and below it. A column has no such row, which is
   * exactly the gap this change closes, so its box is not tucked away.
   *
   * The first version of this check counted without opening the group, got zero
   * on the section, and reported a missing control that was merely collapsed.
   */
  const styleGroup = page.locator('.ed-group__head button', { hasText: 'Style' }).first();
  if ((await styleGroup.count()) > 0
      && (await styleGroup.getAttribute('aria-expanded')) === 'false') {
    await styleGroup.click();
    await page.waitForTimeout(200);
  }
  const onSection = await count();

  await page.locator('.ed-side-btn').first().click();
  await page.waitForTimeout(200);
  const onColumn = await count();

  return onSection === 5 && onColumn === 5
    ? true
    : `${onSection} on the section, ${onColumn} on the column`;
});

await check('a preset sets all four sides at once', async () => {
  // Still on the column from the check above.
  await page.locator('.ed-pad__presets button', { hasText: 'M' }).first().click();
  await page.waitForTimeout(250);

  const sides = await page.locator('.ed-pad__input').evaluateAll((els) =>
    els.map((el) => Number(el.value)));

  return sides.length === 4 && sides.every((v) => v === 32)
    ? true
    : `sides are ${JSON.stringify(sides)}`;
});

await check('and reaches the rendered column', async () => {
  const padding = await page.locator('.tgs-col').first().evaluate((el) => {
    const c = getComputedStyle(el);
    return [c.paddingTop, c.paddingRight, c.paddingBottom, c.paddingLeft];
  });
  return padding.every((v) => v === '32px') ? true : JSON.stringify(padding);
});

await check('the chosen preset is the one lit up', async () => {
  const pressed = await page.locator('.ed-pad__presets button[aria-pressed="true"]').allInnerTexts();
  return pressed.length === 1 && pressed[0] === 'M' ? true : JSON.stringify(pressed);
});

/*
 * The honest answer when no preset describes the padding. Lighting one up would
 * claim 40/0/40/0 is "M", and the four numbers underneath would contradict it.
 */
await check('uneven sides leave every preset unlit', async () => {
  // Unlink first, or typing into one field sets all four.
  await page.locator('.ed-pad__link').click();
  await page.waitForTimeout(150);

  /*
   * 48, which IS a preset and is NOT what the other three sides hold. Both halves
   * of that matter, and both were got wrong in turn.
   *
   * First written as 40: the check passed with the uniform guard deleted, because
   * 40 matches no preset so nothing lit up for a reason unrelated to the guard.
   * Then as 32: the previous check had just set all four sides to 32, so typing 32
   * into one of them changed nothing and they stayed uniform.
   *
   * 48 on top over 32 on the rest is the case the guard is actually for: one side
   * matches a preset exactly, and that preset still describes only a quarter of
   * the padding.
   */
  await page.locator('.ed-pad__input').first().fill('48');
  await page.waitForTimeout(250);

  const pressed = await page.locator('.ed-pad__presets button[aria-pressed="true"]').count();
  const sides = await page.locator('.ed-pad__input').evaluateAll((els) =>
    els.map((el) => Number(el.value)));

  return pressed === 0 && sides[0] === 48 && sides[1] === 32
    ? true
    : `${pressed} lit with sides ${JSON.stringify(sides)}`;
});

await check('choosing a preset from there relinks the sides', async () => {
  // The link button must not still say "separate" over four identical numbers.
  await page.locator('.ed-pad__presets button', { hasText: 'S' }).first().click();
  await page.waitForTimeout(250);

  const linked = await page.locator('.ed-pad__link').getAttribute('aria-pressed');
  const sides = await page.locator('.ed-pad__input').evaluateAll((els) =>
    els.map((el) => Number(el.value)));

  return linked === 'true' && sides.every((v) => v === 16)
    ? true
    : `link is ${linked}, sides are ${JSON.stringify(sides)}`;
});

await check('None puts it back to nothing', async () => {
  await page.locator('.ed-pad__presets button', { hasText: 'None' }).first().click();
  await page.waitForTimeout(250);
  const sides = await page.locator('.ed-pad__input').evaluateAll((els) =>
    els.map((el) => Number(el.value)));
  return sides.every((v) => v === 0) ? true : JSON.stringify(sides);
});

await check('padding typed into the box reaches the page', async () => {
  await labelsAfter(() => page.locator('.ed-sec-name').first().click());

  const section = page.locator('.tgs-section').first();
  const before = (await section.boundingBox())?.height ?? 0;

  const top = page.locator('.ed-pad__input').first();
  if ((await top.count()) === 0) return 'no padding box in the pane';
  await top.fill('60');
  await page.waitForTimeout(250);

  const after = (await section.boundingBox())?.height ?? 0;
  // Linked by default, so 60 lands on all four sides: top and bottom both.
  return after > before + 100 ? true : `${Math.round(before)}px then ${Math.round(after)}px`;
});

/*
 * Behaviours the shared Modal gives every dialog.
 *
 * There used to be four dialogs with four implementations of this, only one
 * of which trapped focus. Checking it once is only honest because there is
 * now only one implementation to check.
 */
await page.reload();
await page.waitForSelector('.ed-root');
// Everything below reaches into the outline, and a fold survives a reload.
await showPanels();

/*
 * Expand the first section, if it is not already.
 *
 * Clicking the name TOGGLES, so calling it twice closes the card again and
 * the add-buttons vanish with it. Checking first makes this safe to call from
 * every check rather than only from the first one.
 */
/*
 * Leave no dialog open behind you.
 *
 * These checks run in order against one page, so a dialog one check forgets
 * to close is a scrim the next one cannot click through. The failure reads as
 * "the button is not there", which sends you looking in the wrong place.
 */
async function closeAnyDialog() {
  for (let i = 0; i < 4 && (await page.locator('.tg-modal').count()) > 0; i += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
}

async function expandFirstSection() {
  await closeAnyDialog();
  if ((await page.locator('.ed-add').count()) === 0) {
    await page.locator('.ed-sec-name').first().click();
    await page.waitForTimeout(200);
  }
}

async function openBlockPicker() {
  await expandFirstSection();
  await page.locator('.ed-add').first().click();
  await page.waitForSelector('.tg-modal', { timeout: 5000 });
}

/*
 * Open a collapsible section of the properties pane by its title, if it is not
 * already open. Blocks group their settings into sections now, all but the first
 * shut, so a control that used to be in a flat list may sit behind a closed
 * section (an image's border, say). Toggling only when shut keeps it from being
 * clicked closed again.
 */
async function openPaneGroup(title) {
  await page.evaluate((wanted) => {
    for (const group of document.querySelectorAll('.ed-props .ed-group')) {
      const button = group.querySelector('.ed-group__head button');
      if (button && button.textContent.includes(wanted) && group.getAttribute('data-open') !== 'true') {
        button.click();
      }
    }
  }, title);
  await page.waitForTimeout(150);
}

await check('Escape closes a dialog', async () => {
  await openBlockPicker();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  return (await page.locator('.tg-modal').count()) === 0 ? true : 'still open';
});

await check('clicking the scrim closes a dialog', async () => {
  await openBlockPicker();
  // Left edge, halfway down: clear of the dialog AND clear of the standalone
  // build's own notice bar, which is fixed across the top at a higher z-index
  // and was quietly swallowing a click aimed at the scrim.
  await page.mouse.click(12, 450);
  await page.waitForTimeout(200);
  return (await page.locator('.tg-modal').count()) === 0 ? true : 'still open';
});

await check('Tab cannot leave an open dialog', async () => {
  await openBlockPicker();

  // Round the whole thing twice. Without a trap this walks out into the page
  // behind, and the modal is still covering everything.
  for (let i = 0; i < 40; i += 1) await page.keyboard.press('Tab');

  const inside = await page.evaluate(() =>
    document.querySelector('.tg-modal')?.contains(document.activeElement) ?? false);

  await page.keyboard.press('Escape');
  return inside === true ? true : 'focus escaped the dialog';
});

await check('closing a dialog gives focus back to what opened it', async () => {
  await closeAnyDialog();
  await expandFirstSection();

  const opener = page.locator('.ed-add').first();
  await opener.click();
  await page.waitForSelector('.tg-modal');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);

  const restored = await page.evaluate(() =>
    document.activeElement?.classList.contains('ed-add') ?? false);
  return restored === true ? true : 'focus was dropped on the body';
});


// ---------------------------------------------------------------------------
// The site theme
// ---------------------------------------------------------------------------

/*
 * Measured in a real browser, not asserted in Node.
 *
 * tests/theme.test.ts already proves the arithmetic. What it cannot prove is
 * that the numbers reach the page: that custom properties on the page element
 * beat the :root fallbacks, that the cascade carries them into a section that
 * declares its own, and that a button ends up painted the colour the
 * derivation chose. Those are questions about the cascade, and only a browser
 * answers them.
 *
 * The brand used here is PALE GOLD, which is the colour that catches a naive
 * derivation. Anything that assumes a brand colour is dark puts white text on
 * it and produces an unreadable button, so if the theme were wrong these
 * checks go red rather than merely looking odd.
 */

const GOLD = '#f5d76e';

/** getComputedStyle gives rgb(); the tests think in hex. */
const toHex = (rgb) => {
  const m = String(rgb).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return `#${[1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('')}`;
};

/** WCAG contrast, computed here so the check does not trust the app's own maths. */
const ratio = (a, b) => {
  const lum = (hex) => {
    const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const c = v.map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

await check('a theme reaches the rendered page', async () => {
  await closeAnyDialog();
  await page.evaluate((brand) => window.__TG_SET_THEME__({ brand, accent: '#0f766e' }), GOLD);
  await page.waitForTimeout(200);

  const applied = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.tgs-page')).getPropertyValue('--tgs-primary').trim());

  return applied.toLowerCase() === GOLD ? true : `--tgs-primary is "${applied}"`;
});

await check('a themed button is painted the brand colour', async () => {
  const background = await page.evaluate(() => {
    const button = document.querySelector('.tgs-button[data-variant="primary"]');
    return button ? getComputedStyle(button).backgroundColor : null;
  });

  const hex = toHex(background);
  // The first primary button in the seed page sits in a dark-tone section, so
  // it is the brand colour itself rather than an inverted one.
  return hex === GOLD ? true : `button background is ${hex ?? background}`;
});

await check('a button label on a pale brand is dark, not white', async () => {
  const measured = await page.evaluate(() => {
    const button = document.querySelector('.tgs-button[data-variant="primary"]');
    const style = getComputedStyle(button);
    return { colour: style.color, background: style.backgroundColor };
  });

  const label = toHex(measured.colour);
  const background = toHex(measured.background);
  const contrast = ratio(label, background);

  // The whole point. A derivation that assumed dark brands would put #ffffff
  // here, which on pale gold is about 1.7:1 and unreadable.
  return contrast >= 3
    ? true
    : `${label} on ${background} is only ${contrast.toFixed(1)}:1`;
});

/*
 * A section tone has to actually paint.
 *
 * This check exists because the first version of the two below passed while
 * every tone in the product was invisible. They read the section's computed
 * backgroundColor, got rgba(0, 0, 0, 0) for transparent, and the hex converter
 * turned that into #000000. White heading on "black" measured 21:1 and went
 * green, on a section that was rendering as bare white page.
 *
 * So the colour is asserted to be OPAQUE first, separately, and by its alpha
 * rather than by what it looks like once converted.
 */
const bandBackground = async (tone) =>
  page.evaluate((t) => {
    const section = document.querySelector(`.tgs-section[data-tone="${t}"]`);
    const style = getComputedStyle(section);
    return {
      background: style.backgroundColor,
      image: style.backgroundImage,
      heading: getComputedStyle(section.querySelector('.tgs-heading')).color,
      muted: style.getPropertyValue('--tgs-text-muted').trim(),
    };
  }, tone);

await check('a section tone actually paints', async () => {
  const dark = await bandBackground('dark');
  const accent = await bandBackground('accent');

  const transparent = (colour) => /rgba\([^)]*,\s*0\s*\)/.test(String(colour));

  if (transparent(dark.background)) return `dark tone is ${dark.background}`;
  if (transparent(accent.background)) return `accent tone is ${accent.background}`;
  return true;
});

await check('the dark band stays dark enough for its text', async () => {
  const dark = await bandBackground('dark');
  const contrast = ratio(toHex(dark.heading), toHex(dark.background));
  return contrast >= 4.5
    ? true
    : `heading on the dark band is only ${contrast.toFixed(1)}:1`;
});

await check('muted text on the brand band still reads', async () => {
  const accent = await bandBackground('accent');
  const background = toHex(accent.background);
  const muted = accent.muted.startsWith('#') ? accent.muted : toHex(accent.muted);
  const measured = ratio(muted, background);

  return measured >= 4.5
    ? true
    : `muted ${muted} on the brand band is only ${measured.toFixed(1)}:1`;
});

await check('a ghost button label reads on the dark band', async () => {
  // Found by screenshot, not by a unit test: a teal accent on a gold brand's
  // dark band vanished. The accent is text here, so it gets measured.
  const measured = await page.evaluate(() => {
    const section = document.querySelector('.tgs-section[data-tone="dark"]');
    const ghost = section.querySelector('.tgs-button[data-variant="ghost"]');
    return {
      colour: getComputedStyle(ghost).color,
      background: getComputedStyle(section).backgroundColor,
    };
  });

  const contrast = ratio(toHex(measured.colour), toHex(measured.background));
  return contrast >= 4.5
    ? true
    : `ghost label is only ${contrast.toFixed(1)}:1 on the dark band`;
});

await check('corner style reaches the rendered page', async () => {
  await page.evaluate(() => window.__TG_SET_THEME__({ corners: 'sharp' }));
  await page.waitForTimeout(150);
  const sharp = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.tgs-page')).getPropertyValue('--tgs-radius-md').trim());

  await page.evaluate(() => window.__TG_SET_THEME__({ corners: 'round' }));
  await page.waitForTimeout(150);
  const round = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.tgs-page')).getPropertyValue('--tgs-radius-md').trim());

  return sharp === '0px' && round === '18px' ? true : `sharp ${sharp}, round ${round}`;
});

await check('a hostile theme value cannot escape the style attribute', async () => {
  await page.evaluate(() =>
    window.__TG_SET_THEME__({ brand: 'red; } body { display: none } .x {' }));
  await page.waitForTimeout(150);

  // The page is still visible, and the brand fell back to a valid colour.
  const state = await page.evaluate(() => ({
    bodyDisplay: getComputedStyle(document.body).display,
    brand: getComputedStyle(document.querySelector('.tgs-page'))
      .getPropertyValue('--tgs-primary').trim(),
  }));

  if (state.bodyDisplay === 'none') return 'the injection worked';
  return /^#[0-9a-f]{6}$/i.test(state.brand) ? true : `brand is "${state.brand}"`;
});

// Back to the default, so anything added after this is not looking at gold.
await page.evaluate(() => window.__TG_SET_THEME__({}));


// ---------------------------------------------------------------------------
// Version history
// ---------------------------------------------------------------------------

/*
 * The rollback path, driven for real against the doubles.
 *
 * Two properties matter more than the rest and neither is expressible as a claim
 * about a function: that the NEWEST entry offers no restore button, because
 * restoring what is already live is a no-op dressed up as a rescue, and that a
 * restore lands in the editor rather than just closing the dialog.
 */

await check('version history opens from the More actions menu', async () => {
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.waitForTimeout(200);
  await page.getByRole('menuitem', { name: 'Version history' }).click();
  await page.waitForSelector('.ph-list', { timeout: 3000 });
  return (await page.locator('.ph-item').count()) === 2
    ? true
    : `${await page.locator('.ph-item').count()} entries`;
});

await check('the newest entry is labelled live, not offered as a restore', async () => {
  const first = page.locator('.ph-item').first();
  const live = await first.locator('.ph-item__live').count();
  const buttons = await first.locator('button').count();
  return live === 1 && buttons === 0 ? true : `${live} live labels, ${buttons} buttons`;
});

await check('an older entry offers one', async () => {
  const second = page.locator('.ph-item').nth(1);
  const label = await second.locator('button').innerText();
  return label === 'Put this back' ? true : `it says "${label}"`;
});

await check('each entry is dated in full rather than "3 days ago"', async () => {
  // Relative time makes somebody count backwards on their fingers to answer
  // "put it back to how it was on Tuesday".
  const when = await page.locator('.ph-item__when').first().innerText();
  return /\d{4}/.test(when) && /\d{2}:\d{2}/.test(when) ? true : `it says "${when}"`;
});

await check('your own publishes are marked and other people\'s are not', async () => {
  const mine = await page.locator('.ph-item__when').first().innerText();
  const theirs = await page.locator('.ph-item__when').nth(1).innerText();
  return mine.includes('by you') && !theirs.includes('by you')
    ? true
    : `"${mine}" then "${theirs}"`;
});

await check('a long title truncates instead of pushing the button off the dialog', async () => {
  const overflow = await page.locator('.ph-item__title').first().evaluate((el) => ({
    overflow: getComputedStyle(el).textOverflow,
    parentMin: getComputedStyle(el.parentElement).minWidth,
  }));
  return overflow.overflow === 'ellipsis' && overflow.parentMin === '0px'
    ? true
    : JSON.stringify(overflow);
});

/*
 * Captured rather than hardcoded, so the undo check compares against what was
 * really there. Written the other way first, asserting the title went back to the
 * double's 'Demo page', and it failed: the editor's page comes from the entry
 * fixture, so the real title was 'Greece, planned properly'. Undo was working the
 * whole time and the expectation was wrong.
 */
let titleBeforeRestore = '';

await check('putting a version back changes the page and closes the dialog', async () => {
  /*
   * Read from the title INPUT, which is where the page's title actually lives.
   * The first version of this check read the outline pane, found the static word
   * "Page" in its heading, and reported a failure that was entirely its own.
   */
  const before = await page.locator('.ed-title-input').inputValue();
  titleBeforeRestore = before;

  await page.locator('.ph-item').nth(1).locator('button').click();
  await page.waitForTimeout(500);

  if ((await page.locator('.ph-list').count()) !== 0) return 'the dialog is still open';

  const after = await page.locator('.ed-title-input').inputValue();
  return after === 'The version before that'
    ? true
    : `the title went from "${before}" to "${after}"`;
});

/*
 * A restore goes through the editor's commit, so it joins the undo stack. That is
 * the reason there is no confirm dialog in front of it, which makes this check the
 * evidence for that decision rather than a nice extra.
 */
await check('and a restore can be undone', async () => {
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  const after = await page.locator('.ed-title-input').inputValue();
  return after === titleBeforeRestore
    ? true
    : `the title is "${after}" after undo, was "${titleBeforeRestore}" before the restore`;
});

// ---------------------------------------------------------------------------
// The image bank
// ---------------------------------------------------------------------------

/*
 * Driven here because it cannot be driven anywhere else.
 *
 * Both services behind the picker are refused by this environment's egress policy:
 * blob.vercel-storage.com and api.pexels.com. So a real upload and a real search
 * are impossible to run, and without these checks the only evidence for the whole
 * dialog would be that it compiles. The doubles in standalone/demo-media-actions.ts
 * type-check against the real actions, so what is exercised below is the real
 * component tree talking to the real signatures.
 *
 * What is still NOT covered, and is named in the handover rather than counted:
 * the browser-to-store upload, a live Pexels response, and the token route.
 */

/** Select an image block, so the properties pane shows an image field. */
async function selectAnImageBlock() {
  await closeAnyDialog();
  await openBlockPicker();
  await page.locator('.ed-block-card', { hasText: 'Image' }).first().click();
  await page.waitForTimeout(300);
}

await check('an image block offers a picker, not a URL box', async () => {
  await selectAnImageBlock();
  const choose = await page.locator('.mp-choose').count();
  return choose === 1 ? true : `${choose} choose buttons`;
});

await check('the web address box is still there, just out of the way', async () => {
  const toggle = page.locator('.mp-url__toggle');
  if ((await toggle.count()) !== 1) return 'no toggle';
  if ((await page.locator('.mp-url .ed-input').count()) !== 0) return 'shown by default';
  await toggle.click();
  await page.waitForTimeout(150);
  return (await page.locator('.mp-url .ed-input').count()) === 1 ? true : 'did not open';
});

/*
 * Open the picker from whichever control the field is currently showing.
 *
 * An empty field shows "Choose an image"; a filled one shows Replace and Remove. The
 * first version of this only knew about the empty case, so once a picture had been
 * chosen it fell through to selectAnImageBlock and quietly ADDED A SECOND BLOCK,
 * then made assertions about that one. The check that caught it reported "0 tiles
 * marked as in use", which points at the grid rather than at the helper.
 */
async function openPicker() {
  await closeAnyDialog();
  if ((await page.locator('.mp-choose, .mp-chosen').count()) === 0) await selectAnImageBlock();

  const choose = page.locator('.mp-choose').first();
  if (await choose.count()) await choose.click();
  else await page.locator('.mp-chosen__actions button', { hasText: 'Replace' }).first().click();

  await page.waitForSelector('.mp-root', { timeout: 5000 });
  await page.waitForTimeout(250);
}

await check('the picker opens on the images already there', async () => {
  await openPicker();
  const selected = await page.locator('.mp-tab[aria-selected="true"]').innerText();
  return selected.includes('Your images') ? true : `opened on "${selected}"`;
});

await check('the bank lists what the site has', async () => {
  const tiles = await page.locator('.mp-tile').count();
  return tiles === 4 ? true : `${tiles} tiles`;
});

/*
 * An image with no alt text is called out, not hidden. This grid is the only screen
 * where somebody sees all their images at once, so it is the only place the ones
 * nobody described can realistically be fixed.
 */
await check('an image with no description says so', async () => {
  const warned = await page.locator('.mp-tile__warn').count();
  return warned === 1 ? true : `${warned} warnings for 1 undescribed image`;
});

await check('a photo from the library carries its credit', async () => {
  const credit = await page.locator('.mp-tile__credit').first().innerText();
  return credit.includes('Pexels') ? true : `credit reads "${credit}"`;
});

await check('the delete button is hidden until a tile is hovered', async () => {
  const before = await page.locator('.mp-tile__remove').first().evaluate(
    (el) => getComputedStyle(el).opacity);
  await page.locator('.mp-tile').first().hover();
  await page.waitForTimeout(250);
  const after = await page.locator('.mp-tile__remove').first().evaluate(
    (el) => getComputedStyle(el).opacity);
  return before === '0' && after === '1' ? true : `opacity ${before} then ${after}`;
});

await check('removing an image asks first', async () => {
  await page.locator('.mp-tile').first().hover();
  await page.locator('.mp-tile__remove').first().click();
  await page.waitForTimeout(250);
  const dialogs = await page.locator('.tg-modal').count();
  const asked = await page.locator('.tg-modal__title').last().innerText();
  // Two dialogs: the picker, and the confirmation on top of it.
  return dialogs === 2 && /^Remove /.test(asked) ? true : `${dialogs} dialogs, asked "${asked}"`;
});

await check('cancelling the removal keeps the image', async () => {
  await page.locator('.tg-modal', { hasText: 'Remove ' }).locator('button', { hasText: 'Cancel' })
    .first().click();
  await page.waitForTimeout(250);
  const tiles = await page.locator('.mp-tile').count();
  return tiles === 4 ? true : `${tiles} tiles after cancelling`;
});

await check('choosing an image fills the block and closes the dialog', async () => {
  await page.locator('.mp-tile__pick').first().click();
  await page.waitForTimeout(300);

  if ((await page.locator('.mp-root').count()) !== 0) return 'the dialog stayed open';
  const thumb = await page.locator('.mp-chosen__thumb').count();
  return thumb === 1 ? true : 'no thumbnail in the field';
});

/*
 * The reason onPatch exists. Choosing a described picture has to fill the alt field
 * BESIDE it, in the same commit, or every image on every client site ends up with
 * an empty alt attribute because the person placing it had already described it
 * three times.
 */
await check('choosing a described image fills the alt text beside it', async () => {
  const alt = await page.locator('.ed-field', { hasText: 'Alt text' })
    .locator('input').inputValue();
  return alt.length > 0 ? true : 'alt text was left empty';
});

/*
 * Typed in rather than picked, and that is deliberate.
 *
 * The demo doubles hand back data: URIs so the offline review copy shows real
 * pictures, and safeUrl refuses data: URIs on purpose, so a picked demo image
 * renders as the placeholder. Rather than weaken either side, this drives the same
 * pipeline with an address the product accepts.
 */
await check('an address reaches the rendered page', async () => {
  const box = page.locator('.mp-url .ed-input').first();
  if ((await box.count()) === 0) await page.locator('.mp-url__toggle').first().click();
  await page.locator('.mp-url .ed-input').first().fill('https://images.example.test/hero.jpg');
  await page.waitForTimeout(300);

  const src = await page.locator('.ed-canvas-frame .tgs-image__frame img').first()
    .getAttribute('src');
  return src === `https://${EXPECTED_TO_FAIL}/hero.jpg` ? true : `src is "${src}"`;
});

/*
 * The gap this closed. An address the renderer will not accept used to leave a
 * thumbnail in the properties pane, because a browser loads it happily, and
 * "Choose an image" on the page. Anybody would read that as the picture being
 * broken rather than the address.
 */
await check('an address the renderer refuses is explained, not ignored', async () => {
  await page.locator('.mp-url .ed-input').first().fill('data:image/svg+xml,%3Csvg%3E%3C/svg%3E');
  await page.waitForTimeout(250);
  const warned = await page.locator('.mp-url__warn').count();
  if (warned !== 1) return `${warned} warnings`;

  await page.locator('.mp-url .ed-input').first().fill(`https://${EXPECTED_TO_FAIL}/hero.jpg`);
  await page.waitForTimeout(200);
  return (await page.locator('.mp-url__warn').count()) === 0 ? true : 'the warning stuck';
});

/*
 * THE FRAME: CUSTOM CORNERS AND A BORDER, added 4 Aug 2026. The block above has
 * an address on it, so its frame is on the canvas to measure. An inline radius
 * has to beat the named preset, and a border has to appear only once it has a
 * width, both of which these read straight off the rendered frame.
 */
await check('an image offers a custom-corners control and a border', async () => {
  // The image's border and corners live in the Border section now, shut by
  // default like every section but the first, so open it before looking.
  await openPaneGroup('Border');
  const corners = await page.locator('.ed-props .ed-corners').count();
  const border = await page.locator('.ed-props .ed-field', { hasText: 'Border width' }).count();
  return corners === 1 && border >= 1 ? true : `corners ${corners}, border field ${border}`;
});

await check('a custom corner rounds the picture on the page', async () => {
  await openPaneGroup('Border');
  // Linked by default, so setting one sets all four; enough to prove it reaches
  // the frame as an inline radius that overrides the preset class.
  const tl = page.locator('.ed-props .ed-corners input[aria-label="Corner top left"]');
  await tl.fill('24');
  await tl.blur();
  await page.waitForTimeout(300);
  const radius = await page.locator('.ed-canvas-frame .tgs-image__frame').first().evaluate((el) =>
    getComputedStyle(el).borderTopLeftRadius);
  return radius === '24px' ? true : `the corner is "${radius}"`;
});

await check('a border width draws a border on the page', async () => {
  await openPaneGroup('Border');
  const width = page.locator('.ed-props .ed-field', { hasText: 'Border width' })
    .locator('input[type="number"]');
  await width.fill('6');
  await width.blur();
  await page.waitForTimeout(300);
  const drawn = await page.locator('.ed-canvas-frame .tgs-image__frame').first().evaluate((el) => {
    const s = getComputedStyle(el);
    return { w: s.borderTopWidth, style: s.borderTopStyle };
  });
  return drawn.w === '6px' && drawn.style === 'solid' ? true : `border ${drawn.w} ${drawn.style}`;
});

await check('the picture that is in use is marked in the grid', async () => {
  // Put a real bank image on the block first, by picking it, so there is something
  // for the grid to recognise.
  await openPicker();
  await page.locator('.mp-tile__pick').nth(1).click();
  await page.waitForTimeout(300);

  await openPicker();
  const marked = await page.locator('.mp-tile[data-current="true"]').count();
  return marked === 1 ? true : `${marked} tiles marked as in use`;
});

await check('the upload tab explains what it accepts', async () => {
  await page.locator('.mp-tab', { hasText: 'Upload' }).click();
  await page.waitForTimeout(200);
  const text = await page.locator('.mp-drop').innerText();
  return text.includes('15MB') && text.includes('2400px') ? true : 'the limits are not stated';
});

/*
 * A hidden file input must still be reachable by keyboard. display:none would take
 * it out of the focus order and the label with it, which is the usual way this
 * pattern gets broken.
 */
await check('the file input is hidden but still focusable', async () => {
  const state = await page.locator('.mp-drop__input').evaluate((el) => {
    const style = getComputedStyle(el);
    el.focus();
    return {
      display: style.display,
      visibility: style.visibility,
      focused: document.activeElement === el,
    };
  });
  return state.display !== 'none' && state.visibility !== 'hidden' && state.focused
    ? true
    : `display ${state.display}, visibility ${state.visibility}, focused ${state.focused}`;
});

await check('the photo library opens with photographs in it', async () => {
  await page.locator('.mp-tab', { hasText: 'Photo library' }).click();
  await page.waitForTimeout(400);
  const tiles = await page.locator('.mp-grid .mp-tile').count();
  return tiles === 12 ? true : `${tiles} photographs before anybody typed`;
});

/*
 * Measured, because the alternative was believing it looked right.
 *
 * This field rendered about eight pixels wide for a while and every other check in
 * this file passed. "The control exists" and "the control is usable" are different
 * claims and only one of them was being made.
 */
await check('the search box is actually wide enough to type in', async () => {
  const width = await page.locator('.mp-search .ed-input').first()
    .evaluate((el) => el.getBoundingClientRect().width);
  return width > 200 ? true : `${Math.round(width)}px wide`;
});

await check('every library photograph names its photographer', async () => {
  const tiles = await page.locator('.mp-grid .mp-tile').count();
  const credits = await page.locator('.mp-tile__credit').count();
  return credits === tiles ? true : `${credits} credits for ${tiles} photographs`;
});

await check('a photograph already added is marked as added', async () => {
  const badges = await page.locator('.mp-tile__badge', { hasText: 'Added' }).count();
  return badges === 1 ? true : `${badges} badges for 1 already-imported photo`;
});

await check('the average colour is painted behind a loading thumbnail', async () => {
  const wash = await page.locator('.mp-tile__wash').first().evaluate(
    (el) => getComputedStyle(el).backgroundColor);
  return /^rgb\(/.test(wash) && wash !== 'rgba(0, 0, 0, 0)' ? true : `wash is "${wash}"`;
});

await check('a search with no matches says so plainly', async () => {
  await page.locator('.mp-search input').fill('nothing');
  await page.locator('.mp-search button[type="submit"]').click();
  await page.waitForTimeout(400);
  const text = await page.locator('.mp-quiet').innerText();
  return text.includes('Nothing matched') ? true : `it said "${text}"`;
});

await check('adding a photograph puts it in the bank', async () => {
  await page.locator('.mp-search input').fill('');
  await page.locator('.mp-search button[type="submit"]').click();
  await page.waitForTimeout(400);
  await page.locator('.mp-grid .mp-tile__pick').first().click();
  await page.waitForTimeout(400);

  // It switches back to the bank, because that is where the new image now is.
  const selected = await page.locator('.mp-tab[aria-selected="true"]').innerText();
  const tiles = await page.locator('.mp-tile').count();
  return selected.includes('Your images') && tiles === 5
    ? true
    : `on "${selected}" with ${tiles} tiles`;
});

await check('the picker traps focus like every other dialog', async () => {
  for (let i = 0; i < 40; i += 1) await page.keyboard.press('Tab');
  const inside = await page.evaluate(() =>
    document.querySelector('.tg-modal')?.contains(document.activeElement) ?? false);
  return inside === true ? true : 'focus escaped the picker';
});

await check('the picker survives a round trip with no console errors', async () => {
  await closeAnyDialog();
  return (await page.locator('.mp-root').count()) === 0 ? true : 'it would not close';
});

/*
 * The grid must not push the dialog wider than the screen. A long filename in a
 * fixed-width tile is the usual cause, and it shows up as the whole page scrolling
 * sideways rather than as anything obviously wrong with the grid.
 */
await check('the picker does not scroll the page sideways', async () => {
  await openPicker();
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await closeAnyDialog();
  return overflow <= 0 ? true : `${overflow}px of horizontal overflow`;
});


// ---------------------------------------------------------------------------
// The image editor: the focus point and the adjustments
// ---------------------------------------------------------------------------

/*
 * Andy, 3 Aug 2026: "select the exact focus point of the image by clicking on
 * it and then saving", and editing tools for each image.
 *
 * The picker's demo doubles hand back a 400x300 data: URI, which actually loads,
 * so the editor frame has a real size to click inside. That lets this drive the
 * whole gesture end to end: place a picture, click a point on it, nudge an
 * adjustment, save, and then read the object-position and the filter that
 * reached the rendered page. The one seam is that the page refuses a data: URI,
 * so the last step swaps the src for an address it accepts WITHOUT touching the
 * five numbers the editor saved, the same trick the picker checks above use.
 */

/** A placed image that really loads, so the editor frame has dimensions. */
async function placeALoadableImage() {
  await closeAnyDialog();
  if ((await page.locator('.mp-choose, .mp-chosen').count()) === 0) await selectAnImageBlock();
  await openPicker();
  await page.locator('.mp-tile__pick').first().click();
  await page.waitForTimeout(300);
}

// The focus point the click set, in per cent, captured so the render check can
// assert the SAME numbers reached the page rather than a guess at them.
let editedFocus = { x: 50, y: 50 };

await check('a placed image offers an Edit tool beside Replace', async () => {
  await placeALoadableImage();
  const edit = await page.locator('.mp-chosen__actions button', { hasText: 'Edit' }).count();
  return edit === 1 ? true : `${edit} Edit buttons`;
});

await check('Edit opens the image editor on the picture', async () => {
  await page.locator('.mp-chosen__actions button', { hasText: 'Edit' }).first().click();
  await page.waitForSelector('.ed-imgedit', { timeout: 5000 });
  const title = await page.locator('.tg-modal__title').last().innerText();
  return title === 'Edit image' ? true : `the dialog is titled "${title}"`;
});

await check('clicking the picture sets the focus point where you click', async () => {
  const frame = page.locator('.ed-imgedit__frame');
  const box = await frame.boundingBox();
  if (!box || box.width < 20 || box.height < 20) {
    return `the frame is ${Math.round(box?.width ?? 0)}x${Math.round(box?.height ?? 0)}`;
  }
  // A quarter across and three-quarters down: off-centre on both axes, so
  // neither reading is the 50 it started at.
  await frame.click({ position: { x: box.width * 0.25, y: box.height * 0.75 } });
  await page.waitForTimeout(150);
  const dot = await page.locator('.ed-imgedit__dot').evaluate((el) => ({
    left: parseFloat(el.style.left),
    top: parseFloat(el.style.top),
  }));
  editedFocus = { x: Math.round(dot.left), y: Math.round(dot.top) };
  return Math.abs(dot.left - 25) <= 5 && Math.abs(dot.top - 75) <= 5
    ? true
    : `the marker sits at ${dot.left}% ${dot.top}%`;
});

await check('an adjustment previews live on the picture', async () => {
  const range = page
    .locator('.ed-imgedit__slider', { hasText: 'Brightness' })
    .locator('input[type="range"]');
  // A React-controlled range ignores a plain value set, so go through the native
  // setter and fire the input event it listens for.
  await range.evaluate((el) => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(el, '150');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(150);
  const filter = await page.locator('.ed-imgedit__frame img').evaluate((el) => el.style.filter);
  return /brightness\(150%\)/.test(filter) ? true : `the filter reads "${filter}"`;
});

await check('saving writes the focus point and the adjustment onto the page', async () => {
  await page.locator('.tg-modal__foot button', { hasText: 'Save' }).first().click();
  await page.waitForTimeout(250);
  if ((await page.locator('.ed-imgedit').count()) !== 0) return 'the editor stayed open';

  if ((await page.locator('.mp-url .ed-input').count()) === 0) {
    await page.locator('.mp-url__toggle').first().click();
  }
  await page.locator('.mp-url .ed-input').first().fill('https://images.example.test/focus.jpg');
  await page.waitForTimeout(300);

  const style =
    (await page
      .locator('.ed-canvas-frame .tgs-image__frame img')
      .first()
      .getAttribute('style')) ?? '';
  const position = new RegExp(`object-position:\\s*${editedFocus.x}% ${editedFocus.y}%`).test(style);
  const filter = /filter:\s*brightness\(150%\)/.test(style);
  return position && filter ? true : `the rendered style is "${style}"`;
});


// ---------------------------------------------------------------------------
// The floating text toolbar
// ---------------------------------------------------------------------------

/*
 * It replaced a wrapping row of buttons inside a 320px pane that used the
 * characters B, I and a bulleted dot as its icons. The interesting properties
 * are that it does not steal the selection, that what it applies survives, and
 * that it can be moved out of the way, because a toolbar over the thing you are
 * editing is worse than no toolbar.
 */

/**
 * Click a paragraph on the canvas and select every word in it.
 *
 * ON THE CANVAS, not in the properties pane, and that is the whole point. This
 * helper used to click into the pane's rich text field, because that is where
 * the words were edited. The toolbar formats the canvas selection now, so a
 * helper that drove the pane would be setting up a state the product no longer
 * has and asserting against a field the toolbar does not touch.
 */
async function selectOnCanvas() {
  for (const block of await page.locator('.tgs-block').all()) {
    const text = await block.innerText().catch(() => '');
    if (text.trim().length > 60) {
      await block.click();
      await page.waitForTimeout(400);
      break;
    }
  }
  const host = page.locator('[data-rt-host]:not([data-rt-oneline])').first();
  if (!(await host.count())) return null;

  await page.evaluate(() => {
    const el = document.querySelector('[data-rt-host]:not([data-rt-oneline])');
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.waitForTimeout(150);
  return host;
}

/*
 * ONE CLICK ON THE CANVAS, and nothing else. This is the check that was missing.
 *
 * The first version of this file selected a block and then clicked into the
 * rich text field in the properties pane before looking for the toolbar, which
 * is exactly what the toolbar used to require and exactly why Andy could not
 * find it: that field is a box on the right-hand side, only the `text` block
 * type has one, and selecting a block does not focus it. Nine checks passed
 * over a feature nobody could reach.
 *
 * A check that performs the workaround cannot see the bug.
 */
await check('one click on a text block raises the toolbar', async () => {
  let clicked = false;
  for (const block of await page.locator('.tgs-block').all()) {
    const text = await block.innerText().catch(() => '');
    if (text.trim().length > 60) { await block.click(); clicked = true; break; }
  }
  if (!clicked) return 'no text block on the canvas to click';
  await page.waitForTimeout(500);

  const bars = await page.locator('.ed-tt').count();
  return bars === 1 ? true : `${bars} toolbars after a single canvas click`;
});

await check('and it sits above the words rather than beside the pane', async () => {
  const bar = await page.locator('.ed-tt').boundingBox();
  const block = await page.locator('[data-path].is-selected').boundingBox();
  if (!bar || !block) return 'no toolbar or no selected block';

  // Above the block, and horizontally over the canvas rather than parked on the
  // properties pane, which is where it used to appear.
  const above = bar.y + bar.height <= block.y + 8;
  const nearBlock = Math.abs(bar.x - block.x) < 40;

  return above && nearBlock
    ? true
    : `toolbar at ${Math.round(bar.x)},${Math.round(bar.y)} against block at ${Math.round(block.x)},${Math.round(block.y)}`;
});

await check('editing text raises a floating toolbar', async () => {
  if (!(await selectOnCanvas())) return 'no editable paragraph on the canvas';

  const bars = await page.locator('.ed-tt').count();
  const fixed = await page.locator('.ed-tt').evaluate((el) => getComputedStyle(el).position);

  // Fixed, not absolute: it is dragged in viewport coordinates and would
  // otherwise be clipped by the properties pane's own overflow.
  return bars === 1 && fixed === 'fixed' ? true : `${bars} toolbars, position ${fixed}`;
});

await check('it carries drawn icons rather than the letters B and I', async () => {
  // The old one used characters as functional icons, which render differently
  // on every platform and are invisible to a screen reader. Icon.tsx says so at
  // the top of itself, and this toolbar was the last place still doing it.
  const svgs = await page.locator('.ed-tt__btn svg').count();
  const labelled = await page.locator('.ed-tt__btn[aria-label]').count();
  const buttons = await page.locator('.ed-tt__btn').count();
  return svgs === buttons && labelled === buttons
    ? true
    : `${buttons} buttons, ${svgs} with an icon, ${labelled} with a label`;
});

await check('bold applies to the selection and lights up', async () => {
  const host = await selectOnCanvas();
  if (!host) return 'no editable paragraph on the canvas';

  await page.locator('.ed-tt__btn[aria-label="Bold"]').click();
  await page.waitForTimeout(300);

  const html = await host.innerHTML();
  const pressed = await page.locator('.ed-tt__btn[aria-label="Bold"]').getAttribute('aria-pressed');

  // <b> or <strong>, either is kept by the sanitiser.
  return /<(b|strong)[ >]/i.test(html) && pressed === 'true'
    ? true
    : `pressed ${pressed}, html "${html.slice(0, 80)}"`;
});

/*
 * THE ONE THAT MAKES THE REST POSSIBLE. Every button refuses mousedown, so the
 * caret and the selection stay in the field behind it. Without that, clicking
 * Bold blurs the editable, the selection collapses, and the command applies to
 * nothing at all.
 */
await check('clicking a button does not take the selection away', async () => {
  const stillThere = await page.evaluate(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    return !selection.getRangeAt(0).collapsed;
  });
  return stillThere ? true : 'the selection collapsed';
});

await check('a web address becomes a link', async () => {
  const host = await selectOnCanvas();
  if (!host) return 'no editable paragraph on the canvas';

  await page.locator('.ed-tt__btn[aria-label="Add a link"]').click();
  await page.waitForTimeout(250);
  await page.locator('.ed-tt__url').fill('https://travelgenix.io');
  await page.locator('.ed-tt__btn[aria-label="Apply the link"]').click();
  await page.waitForTimeout(300);

  const html = await host.innerHTML();
  const wraps = await host.locator('a').first().innerText().catch(() => '');

  /*
   * The anchor must WRAP the words, not just exist. A link applied to a
   * collapsed selection produces an empty anchor, which is the failure this is
   * really guarding: the URL input takes the selection away when it is typed
   * into.
   */
  return /<a[^>]+href="https:\/\/travelgenix\.io/i.test(html) && wraps.trim().length > 0
    ? true
    : `wraps "${wraps.slice(0, 30)}", html "${html.slice(0, 80)}"`;
});

/*
 * createLink will happily insert javascript:alert(1). The sanitiser strips it on
 * save, so this is the second of two gates, and it is the one that stops the
 * editor showing a working link in the preview that vanishes on publish.
 */
await check('a javascript URL is refused rather than inserted', async () => {
  const host = await selectOnCanvas();
  if (!host) return 'no editable paragraph on the canvas';

  await page.locator('.ed-tt__btn[aria-label="Add a link"]').click();
  await page.waitForTimeout(200);
  await page.locator('.ed-tt__url').fill('javascript:alert(1)');
  await page.locator('.ed-tt__btn[aria-label="Apply the link"]').click();
  await page.waitForTimeout(300);

  const html = await host.innerHTML();
  return !/javascript:/i.test(html) ? true : `html is "${html.slice(0, 100)}"`;
});

/*
 * AND IT SAYS SO, rather than emptying the box and doing nothing.
 *
 * The refusal used to clear the field and return, which reads as a button that
 * eats what you typed. Worth catching for its own sake, and it also stopped the
 * next check from finding an Apply button: the panel stayed open, so the click
 * meant to open it toggled it shut.
 */
await check('a refused address is explained rather than silently swallowed', async () => {
  const note = page.locator('.ed-tt__refused');
  if (!(await note.count())) return 'nothing was said about the refused address';

  const said = await note.innerText();
  const kept = await page.locator('.ed-tt__url').inputValue();

  // Still in the box, so it can be corrected rather than retyped.
  return said.trim().length > 10 && kept.includes('javascript:')
    ? true
    : `said "${said.trim()}", box holds "${kept}"`;
});

await check('and the complaint goes as soon as the address is being changed', async () => {
  await page.locator('.ed-tt__url').fill('https://travelgenix.io');
  await page.waitForTimeout(200);
  return (await page.locator('.ed-tt__refused').count()) === 0
    ? true
    : 'the complaint is still up over a valid address';
});

await check('it can be dragged out of the way and stays where it is put', async () => {
  const before = await page.locator('.ed-tt').boundingBox();
  const grip = await page.locator('.ed-tt__grip').boundingBox();

  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + 160, grip.y + 120, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const after = await page.locator('.ed-tt').boundingBox();
  /*
   * Distance, not a signed direction. The drag asks for a position and the
   * clamp has the last word, so a toolbar dragged towards an edge legitimately
   * ends up somewhere other than where the pointer let go. Written as
   * `moved > 100` first and it failed on a perfectly correct leftward clamp.
   */
  const moved = Math.round(Math.hypot(after.x - before.x, after.y - before.y));

  // And remembered, so it does not spring back to the next block being edited.
  const stored = await page.evaluate(() => window.localStorage.getItem('tg-sites:text-toolbar'));

  return moved > 100 && stored ? true : `moved ${moved}px, stored ${stored}`;
});

/*
 * The link panel adds an input and two buttons, about 250px. A toolbar near the
 * right edge grew straight off the screen and took its Apply button with it,
 * which is a link nobody can finish making.
 */
await check('opening the link panel keeps it on screen', async () => {
  await selectOnCanvas();

  // Opened only if it is not open already. The button is a toggle and the panel
  // survives re-selecting the same paragraph, so an unconditional click here
  // shut the panel this check is about and then timed out looking for it.
  if (!(await page.locator('.ed-tt__url').count())) {
    await page.locator('.ed-tt__btn[aria-label="Add a link"]').click();
    await page.waitForTimeout(400);
  }

  const box = await page.locator('.ed-tt').boundingBox();
  const apply = await page.locator('.ed-tt__btn[aria-label="Apply the link"]').boundingBox();
  const width = page.viewportSize().width;

  return box.x + box.width <= width && apply.x + apply.width <= width
    ? true
    : `right edge ${Math.round(box.x + box.width)}, apply ends ${Math.round(apply.x + apply.width)}, viewport ${width}`;
});

/*
 * IT BELONGS TO THE SELECTED BLOCK, NOT TO FOCUS, and that is the fix rather
 * than a side effect of it.
 *
 * This check used to click the top bar and require the toolbar to vanish,
 * because the toolbar closed whenever focus left the pane's text field. That
 * rule is precisely what Andy hit: dragging across the words moves focus, so
 * the toolbar went away at the exact moment he had something to format.
 *
 * The rule now is that the toolbar is up for as long as a paragraph is
 * selected. Clicking elsewhere in the chrome does not deselect, so it stays,
 * which is right: you can reach for the toolbar, the pane and back again
 * without losing your place. Selecting something that is not text puts it away.
 */
// ---------------------------------------------------------------------------
// Colour, size, font and alignment
// ---------------------------------------------------------------------------

/*
 * These were left out of the first toolbar because the sanitiser dropped every
 * `style` attribute, so they would have looked like they worked and lost the
 * formatting on save. Andy, 30 Jul 2026: "we need to overcome the problem you
 * raised with losing on saving and get a much better text toolbar".
 *
 * So the check that matters most here is not "does it apply" but "does it still
 * apply after the sanitiser has seen it". That is what deselecting the block
 * does: the renderer sanitises stored HTML on the way to the screen, so a style
 * that survives a deselect is a style that survives a save.
 */

await check('a colour applies to the selected words', async () => {
  const host = await selectOnCanvas();
  if (!host) return 'no editable paragraph';

  await page.locator('.ed-tt__btn[aria-label="Text colour"]').click();
  await page.waitForTimeout(300);
  await page.locator('.ed-tt__swatch[aria-label="Accent"]').click();
  await page.waitForTimeout(350);

  const html = await host.innerHTML();
  return /style="[^"]*color:/i.test(html) ? true : `html is "${html.slice(0, 120)}"`;
});

/*
 * A TOKEN, NOT THE HEX IT RESOLVES TO, and this is the whole reason the toolbar
 * does not use execCommand for colour.
 *
 * The browser resolves a colour before storing it, so asking it for the brand
 * would store whatever the brand happened to be that day. A client who later
 * changed their brand on the Theme screen would find these words stayed behind,
 * and nobody would ever connect the two.
 */
await check('and it stores the theme token, so the words follow the theme', async () => {
  const html = await page.locator('[data-rt-host]:not([data-rt-oneline])').first().innerHTML();
  return /var\(--tgs-accent\)/.test(html)
    ? true
    : `stored "${(html.match(/style="[^"]*"/) ?? ['nothing'])[0]}"`;
});

/*
 * THE ONE ANDY'S COMPLAINT IS ABOUT. Deselecting re-renders the block through
 * sanitiseHtml, which is the same gate a save goes through.
 */
await check('and it survives the sanitiser rather than vanishing', async () => {
  const before = await page.locator('[data-rt-host]:not([data-rt-oneline])').first().innerHTML();
  if (!/var\(--tgs-accent\)/.test(before)) return 'the colour was not there to begin with';

  // Select a block with no words of its own, so the paragraph stops being an
  // editing host and goes back through the renderer, which sanitises stored HTML
  // on the way to the screen. Same gate a save goes through.
  for (const block of await page.locator('.tgs-block').all()) {
    if (await block.locator('.tgs-buttons, .tgs-image, .tgs-media').count()) {
      await block.click();
      break;
    }
  }
  await page.waitForTimeout(400);
  if (await page.locator('[data-rt-host]').count()) return 'the paragraph is still being edited';

  const rendered = await page.locator('.tgs-text').first().innerHTML();
  return /var\(--tgs-accent\)/.test(rendered)
    ? true
    : `after rendering: "${rendered.slice(0, 140)}"`;
});

/**
 * Select PART of a paragraph, by dragging across a bit of the first line.
 *
 * Different from selectOnCanvas, which takes the whole block. A whole-block
 * selection is styled by setting the declaration on the paragraph itself, so it
 * produces no span at all: correct, and useless for checking what a span does.
 * A part-selection is also the ordinary case, because people colour a phrase.
 */
async function selectPartOnCanvas() {
  const host = await editParagraph();
  if (!host) return null;
  const box = await host.boundingBox();
  await page.mouse.move(box.x + 6, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 12, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  return host;
}

await check('a size applies, and it is a real size rather than an attribute nothing reads', async () => {
  const host = await selectPartOnCanvas();
  if (!host) return 'no editable paragraph';

  await page.locator('select[aria-label="Size"]').selectOption('2rem');
  await page.waitForTimeout(350);

  // Measured, not read off the attribute. An attribute no rule picks up is the
  // same as no attribute, and the point of these controls is that what you set
  // is what you get.
  const sizes = await page.evaluate(() => {
    const span = document.querySelector('[data-rt-host] span[style*="font-size"]');
    const para = document.querySelector('[data-rt-host] p');
    if (!span || !para) return null;
    return {
      span: parseFloat(getComputedStyle(span).fontSize),
      around: parseFloat(getComputedStyle(para).fontSize),
    };
  });

  if (!sizes) return 'no sized span on the canvas';
  return sizes.span > sizes.around + 4
    ? true
    : `the span is ${sizes.span}px against ${sizes.around}px around it`;
});

/*
 * AND THE SIZE MAKES THE ROUND TRIP, which the check above cannot tell you.
 *
 * While a block is being edited, the canvas DOM is written straight by the
 * editor and never passes through the sanitiser. So a check that only measures
 * the canvas proves the toolbar applied something, and says nothing at all about
 * whether it would survive a save. Deleting the sanitiser's font-size rule left
 * that check passing, which is how this gap was found.
 *
 * Deselecting sends the block back through the renderer, which sanitises stored
 * HTML on the way to the screen: the same gate a save goes through.
 */
await check('and the size survives the sanitiser, not just the canvas', async () => {
  const before = await page.locator('[data-rt-host]:not([data-rt-oneline])').first().innerHTML();
  if (!/font-size/i.test(before)) return 'no size on the canvas to begin with';

  for (const block of await page.locator('.tgs-block').all()) {
    if (await block.locator('.tgs-buttons, .tgs-image, .tgs-media').count()) {
      await block.click();
      break;
    }
  }
  await page.waitForTimeout(400);
  if (await page.locator('[data-rt-host]').count()) return 'the paragraph is still being edited';

  const rendered = await page.locator('.tgs-text').first().innerHTML();
  return /font-size:\s*2rem/i.test(rendered)
    ? true
    : `after rendering: "${rendered.slice(0, 160)}"`;
});

/*
 * A SIZE OF YOUR OWN, in pixels, which the dropdown could not do before.
 *
 * Andy asked for this on 3 Aug 2026: the Size control offered a scale and the
 * theme's own sizes, and nothing between them, so a phrase that wanted 41px had
 * no way to say so. The dropdown now has a "Custom, in pixels" entry that opens
 * a box, and this drives it the way a person would: pick the entry, type a
 * number, apply it. The unit tests own whether the number survives a save; this
 * owns whether the box is wired to the words at all.
 */
await check('a size of your own applies, in the pixels you typed', async () => {
  const host = await selectPartOnCanvas();
  if (!host) return 'no editable paragraph';

  await page.locator('select[aria-label="Size"]').selectOption('__custom_px__');
  await page.waitForTimeout(200);
  await page.locator('.ed-tt__size-box').fill('72');
  await page.locator('.ed-tt__btn[aria-label="Use this size"]').click();
  await page.waitForTimeout(350);

  const html = await host.innerHTML();
  return /font-size:\s*72px/i.test(html) ? true : `html is "${html.slice(0, 160)}"`;
});

/*
 * PAST THE TOP OF THE RANGE BECOMES THE TOP, rather than nothing.
 *
 * The box clamps to 6..200, the same two numbers the sanitiser refuses outside
 * of. Clamping rather than refusing is the kinder half of that pair: type 500
 * and the words become the largest allowed, which is a result you can see and
 * correct, not a button that quietly did nothing. If this ever came back as no
 * change, the clamp had been lost and the sanitiser was silently eating the value.
 */
await check('a size of your own past the top of the range is clamped to it', async () => {
  // The WHOLE block, selected by a JS range rather than a drag. The check above
  // leaves a 72px letter at the start of the paragraph, which makes it tall
  // enough that a part-drag at a fixed y no longer lands on any text. A whole
  // selection is geometry-free, and clamping shows either on the paragraph or a
  // span the same, which is all this is asking.
  const host = await selectOnCanvas();
  if (!host) return 'no editable paragraph';

  await page.locator('select[aria-label="Size"]').selectOption('__custom_px__');
  await page.waitForTimeout(200);
  await page.locator('.ed-tt__size-box').fill('500');
  await page.locator('.ed-tt__btn[aria-label="Use this size"]').click();
  await page.waitForTimeout(350);

  const html = await host.innerHTML();
  return /font-size:\s*200px/i.test(html) ? true : `html is "${html.slice(0, 160)}"`;
});

/*
 * A whole-block selection is a different shape, and the right one.
 *
 * Wrapping a whole paragraph in a span gives `<span><p>…</p></span>`, an inline
 * element around a block one. Browsers render it, so the first version of this
 * looked right and was invalid, stacked another layer every time the block was
 * restyled, and made the paragraph report the span's font size as its own.
 */
await check('styling a whole paragraph sets it on the paragraph, not in a span around it', async () => {
  const host = await selectOnCanvas();
  if (!host) return 'no editable paragraph';

  await page.locator('select[aria-label="Size"]').selectOption('1.25rem');
  await page.waitForTimeout(350);

  const html = await host.innerHTML();
  const onParagraph = /<p style="[^"]*font-size/i.test(html);
  const spanAroundBlock = /<span[^>]*>\s*<p[\s>]/i.test(html);

  return onParagraph && !spanAroundBlock
    ? true
    : `on the p: ${onParagraph}, span around it: ${spanAroundBlock}, html "${html.slice(0, 120)}"`;
});

await check('a font applies, as one of the site’s own rather than a raw family', async () => {
  const host = await selectOnCanvas();
  if (!host) return 'no editable paragraph';

  await page.locator('select[aria-label="Font"]').selectOption('var(--tgs-font-display)');
  await page.waitForTimeout(350);

  const html = await host.innerHTML();
  return /font-family:\s*var\(--tgs-font-display\)/.test(html)
    ? true
    : `html is "${html.slice(0, 140)}"`;
});

await check('a colour of your own is taken as a hex', async () => {
  const host = await selectOnCanvas();
  if (!host) return 'no editable paragraph';

  await page.locator('.ed-tt__btn[aria-label="Text colour"]').click();
  await page.waitForTimeout(250);
  await page.locator('.ed-tt__tray .ed-tt__url').fill('#ff8800');
  await page.locator('.ed-tt__btn[aria-label="Use this colour"]').click();
  await page.waitForTimeout(350);

  /*
   * Either spelling. Setting a hex through the CSS object model and reading it
   * back gives rgb(), because that is the browser's normal form for a colour and
   * nothing we do changes that. The sanitiser turns it back into a hex on save,
   * which the unit tests cover; here the question is only whether the colour that
   * was asked for is the colour that landed.
   */
  const html = await host.innerHTML();
  return /color:\s*(#ff8800|rgb\(255,\s*136,\s*0\))/i.test(html)
    ? true
    : `html is "${html.slice(0, 140)}"`;
});

/*
 * A NAMED COLOUR, not something malformed, and the difference matters.
 *
 * This first typed `red; position: fixed`, which the browser's own style object
 * rejects as invalid before anything of ours is involved. So the check passed
 * with the toolbar's guard deleted: it was reading the browser's refusal, not
 * ours. A check that passes for somebody else's reason is not a check.
 *
 * `red` is a real CSS colour, so the browser takes it happily. The sanitiser
 * does not, because named colours are not in the closed set. Without the guard
 * in the toolbar it would therefore land on the canvas, look right, and be gone
 * after a save, which is precisely the complaint all of this exists to fix.
 */
await check('and one that is not a colour we keep is refused rather than half applied', async () => {
  const host = await selectOnCanvas();
  if (!host) return 'no editable paragraph';
  const before = await host.innerHTML();

  await page.locator('.ed-tt__btn[aria-label="Text colour"]').click();
  await page.waitForTimeout(250);
  await page.locator('.ed-tt__tray .ed-tt__url').fill('red');
  await page.locator('.ed-tt__btn[aria-label="Use this colour"]').click();
  await page.waitForTimeout(350);

  const after = await host.innerHTML();
  return after === before ? true : `the words changed to "${after.slice(0, 140)}"`;
});

await check('and so is something that is not a colour at all', async () => {
  const host = page.locator('[data-rt-host]:not([data-rt-oneline])').first();
  const before = await host.innerHTML();

  await page.locator('.ed-tt__tray .ed-tt__url').fill('red; position: fixed');
  await page.locator('.ed-tt__btn[aria-label="Use this colour"]').click();
  await page.waitForTimeout(350);

  const after = await host.innerHTML();
  return after === before ? true : `the words changed to "${after.slice(0, 140)}"`;
});

/*
 * ALIGNMENT IS THE BLOCK'S OWN FIELD, not a style on the selection.
 *
 * A paragraph with an inline text-align AND a block alignment has two sources of
 * truth for one thing, and which one you see depends on which you touched last.
 * So the toolbar drives the same field the pane shows, and this checks they
 * agree rather than merely that something happened.
 */
await check('alignment drives the block, and the properties pane agrees', async () => {
  const host = await selectOnCanvas();
  if (!host) return 'no editable paragraph';

  await page.locator('.ed-tt__btn[aria-label="Align centre"]').click();
  await page.waitForTimeout(350);

  // Alignment sits in the Layout section now, shut by default, so open it before
  // asking whether the pane agrees with the toolbar.
  await openPaneGroup('Layout');
  const pane = await page
    .locator('.ed-segmented button', { hasText: 'Centre' })
    .first()
    .getAttribute('aria-pressed');
  const drawn = await page.evaluate(() => {
    const block = document.querySelector('[data-rt-host]')?.closest('.tgs-block');
    return block ? getComputedStyle(block).textAlign : null;
  });
  const lit = await page
    .locator('.ed-tt__btn[aria-label="Align centre"]')
    .getAttribute('aria-pressed');

  return pane === 'true' && lit === 'true' && drawn === 'center'
    ? true
    : `pane ${pane}, toolbar ${lit}, drawn ${drawn}`;
});

/*
 * The toolbar grew from nine controls to nineteen, and both of these broke.
 *
 * It wrapped to two rows, which made it taller than the 44px it anchors itself
 * above, so it settled over the first line of the paragraph being edited. Which
 * is the thing Andy asked for it to be draggable to avoid.
 */
/**
 * A toolbar as somebody would meet it: never dragged, nothing open on it.
 *
 * Needed because the checks above deliberately drag it and leave the link panel
 * up, and both are remembered. Measuring the position of a toolbar somebody just
 * put somewhere tells you where they put it, not where it opens.
 */
async function freshToolbar() {
  await page.evaluate(() => window.localStorage.removeItem('tg-sites:text-toolbar'));
  // Away from any text, so the toolbar unmounts and loses its open panels, then
  // back to a paragraph so it mounts again and re-reads where to sit.
  await page.locator('.ed-topbar').click({ position: { x: 5, y: 5 } });
  for (const block of await page.locator('.tgs-block').all()) {
    if (await block.locator('.tgs-buttons, .tgs-image, .tgs-media').count()) {
      await block.click();
      break;
    }
  }
  await page.waitForTimeout(300);
  return selectOnCanvas();
}

/*
 * MEASURED WHILE THE TOOLBAR IS TALL, which is the only time it can go wrong.
 *
 * At its usual size it is one row of about 40px, under the 44px it guesses
 * before it has measured itself, so it clears the words whether or not it
 * re-anchors. This check passed with the re-anchor deleted, reading a guess that
 * happened to be generous enough rather than the rule it was meant to be about.
 *
 * Opening the link panel makes it wrap for real, which is an ordinary thing to
 * do rather than a contrivance, and it is what the ResizeObserver and the
 * re-anchor exist for. Narrowing the window instead would have been the obvious
 * move and does not work: below about 1024px the editor folds down to one pane
 * at a time and the canvas is not on screen to measure against.
 */
await check('the toolbar keeps clear of the words even when it grows', async () => {
  await freshToolbar();

  const row = await page.locator('.ed-tt__btn').first().boundingBox();
  await page.locator('.ed-tt__btn[aria-label="Add a link"]').click();
  await page.waitForTimeout(400);

  const bar = await page.locator('.ed-tt').boundingBox();
  const block = await page.locator('[data-path].is-selected').boundingBox();
  if (!bar || !block) return 'no toolbar or no selected block';

  // If it did not grow, this check is not exercising what it claims to.
  if (bar.height < row.height * 1.5) {
    return `the toolbar is only ${Math.round(bar.height)}px tall, so it did not wrap`;
  }

  const gap = Math.round(block.y - (bar.y + bar.height));
  return gap >= 0 ? true : `the toolbar overlaps the block by ${-gap}px`;
});

await check('and fits on one row on an ordinary screen', async () => {
  // Its own fresh toolbar, because the check above deliberately grows one and
  // the link panel it opens stays open. Measuring that would be measuring the
  // previous check's setup.
  await freshToolbar();

  const bar = await page.locator('.ed-tt').boundingBox();
  const row = await page.locator('.ed-tt__btn').first().boundingBox();
  // One row of 32px buttons in 4px of padding is about 40px. Two would be 74.
  return bar.height < row.height * 2
    ? true
    : `the toolbar is ${Math.round(bar.height)}px tall, so it has wrapped`;
});

await check('the toolbar survives a click on the chrome, because the block is still selected', async () => {
  await selectOnCanvas();
  await page.locator('.ed-topbar').click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(400);
  return (await page.locator('.ed-tt').count()) === 1
    ? true
    : 'the toolbar went away when nothing had been deselected';
});

await check('and is put away by selecting something that is not text', async () => {
  let picked = false;
  for (const block of await page.locator('.tgs-block').all()) {
    // A button group, an image, anything with no words of its own to format.
    if (await block.locator('.tgs-buttons, .tgs-image, .tgs-media').count()) {
      await block.click();
      picked = true;
      break;
    }
  }
  if (!picked) return 'no non-text block on the seeded page to select';
  await page.waitForTimeout(400);

  const bars = await page.locator('.ed-tt').count();
  const hosts = await page.locator('[data-rt-host]').count();
  return bars === 0 && hosts === 0 ? true : `${bars} toolbars, ${hosts} editable hosts`;
});

// ---------------------------------------------------------------------------
// Editing the words where they are
// ---------------------------------------------------------------------------

/*
 * ANDY'S EXACT COMPLAINT, 30 Jul 2026:
 *
 *   "when you click on text box, it appears, but if you then go to select the
 *    text you want to style, the toolbar disappears, so you can't apply any
 *    formatting"
 *
 * The words were rendered on the canvas but edited in a field in the pane. The
 * toolbar hung off that field's focus, so selecting the words you could see
 * moved focus out of it and took the toolbar with it. Even if it had stayed,
 * Bold would have applied to whatever was selected in the pane rather than to
 * the highlighted words.
 *
 * So the block itself is the editable now. The checks that matter are that a
 * REAL DRAG across the words keeps the toolbar, that the caret survives the
 * commit that every keystroke causes, and that what is typed reaches state
 * rather than only the DOM.
 */

/** Click a paragraph on the canvas and return its editable host. */
async function editParagraph() {
  for (const block of await page.locator('.tgs-block').all()) {
    const text = await block.innerText().catch(() => '');
    if (text.trim().length > 60) {
      await block.click();
      await page.waitForTimeout(400);
      const host = page.locator('[data-rt-host]:not([data-rt-oneline])').first();
      return (await host.count()) ? host : null;
    }
  }
  return null;
}

await check('one click makes the words themselves editable', async () => {
  const host = await editParagraph();
  if (!host) return 'no paragraph became an editable host';
  const on = await host.getAttribute('contenteditable');
  return on === 'true' ? true : `contenteditable is ${on}`;
});

/*
 * THE CARET TEST.
 *
 * Every keystroke commits and every commit re-renders. If React still owned the
 * children of this element it would rewrite them and drop the caret at the
 * start, so typing "ONE" at the end would come out somewhere near the beginning
 * and probably backwards. Fourteen characters is enough to make that obvious.
 *
 * The caret is placed with a Range rather than by clicking and pressing End,
 * because End goes to the end of the wrapped LINE that was clicked, which had me
 * reading a passing feature as a broken one.
 */
await check('typing lands where the caret is, not at the start', async () => {
  const host = await editParagraph();
  if (!host) return 'no editable paragraph';

  await page.evaluate(() => {
    const el = document.querySelector('[data-rt-host]:not([data-rt-oneline])');
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.type(' ONE TWO THREE', { delay: 30 });
  await page.waitForTimeout(350);

  const text = (await host.innerText()).trim();
  return text.endsWith('ONE TWO THREE') ? true : `ends "${text.slice(-40)}"`;
});

await check('and mid-paragraph, not just at the end', async () => {
  const host = page.locator('[data-rt-host]:not([data-rt-oneline])').first();
  const before = (await host.innerText()).trim().slice(0, 12);

  await page.evaluate(() => {
    const el = document.querySelector('[data-rt-host]:not([data-rt-oneline])');
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const node = walk.nextNode();
    const range = document.createRange();
    range.setStart(node, 0);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.type('MID', { delay: 30 });
  await page.waitForTimeout(350);

  const after = (await host.innerText()).trim();
  return after.startsWith(`MID${before}`) ? true : `starts "${after.slice(0, 20)}"`;
});

await check('what is typed on the canvas reaches the page, not just the DOM', async () => {
  // The properties pane reads from state, so it seeing the edit is proof the
  // edit was committed rather than left sitting in the browser's own DOM.
  const pane = await page.locator('.ed-rt').first().innerText();
  return pane.includes('MID') && pane.includes('ONE TWO THREE')
    ? true
    : `the pane says "${pane.slice(0, 60)}"`;
});

/*
 * THE ONE ANDY HIT. Drag the mouse across the words and the toolbar must stay.
 *
 * A real drag, not a Range: the whole failure was about what a mouse does to
 * focus, and a programmatic selection moves no focus at all, so it could never
 * have reproduced this.
 */
await check('selecting the words with the mouse keeps the toolbar', async () => {
  const host = await editParagraph();
  if (!host) return 'no editable paragraph';
  if (!(await page.locator('.ed-tt').count())) return 'no toolbar to begin with';

  const box = await host.boundingBox();
  await page.mouse.move(box.x + 6, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 12, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const selected = await page.evaluate(() => String(window.getSelection()));
  if (selected.trim().length < 4) return `the drag selected "${selected}"`;

  const bars = await page.locator('.ed-tt').count();
  return bars === 1 ? true : `${bars} toolbars after selecting "${selected.trim()}"`;
});

await check('and Bold then applies to those words', async () => {
  const host = page.locator('[data-rt-host]:not([data-rt-oneline])').first();
  await page.locator('.ed-tt__btn[aria-label="Bold"]').click();
  await page.waitForTimeout(350);

  const html = await host.innerHTML();
  const onCanvas = /<(b|strong)[ >]/i.test(html);
  // And in state, so it survives the save rather than looking right until reload.
  const inState = /<(b|strong)[ >]/i.test(await page.locator('.ed-rt').first().innerHTML());

  return onCanvas && inState ? true : `canvas ${onCanvas}, state ${inState}`;
});

// ---------------------------------------------------------------------------
// The writing assistant
//
// Driven against standalone/demo-ai-actions.ts, which answers with real-shaped
// copy rather than a stub. That is what makes these worth running: the claims
// below are about where the answer LANDS, and a double returning "ok" could not
// tell you whether two paragraphs replaced the highlighted words or were added
// after them.
// ---------------------------------------------------------------------------

/** Select some words in the first paragraph, so the toolbar is up and armed. */
async function selectSomeWords() {
  const host = page.locator('[data-rt-host]:not([data-rt-oneline])').first();
  if (!(await host.count())) return null;
  const box = await host.boundingBox();
  await page.mouse.move(box.x + 6, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 12, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  return host;
}

/**
 * A caret in the paragraph and NOTHING highlighted.
 *
 * Its own helper because the checks below care about the difference, and because
 * the check before this block leaves a drag-selection behind. The first version
 * of these inherited it and reported "it says it will replace them" when it was
 * meant to be testing the empty case, which looked like a bug in the panel and
 * was a bug in the setup.
 */
async function placeCaret() {
  const host = page.locator('[data-rt-host]:not([data-rt-oneline])').first();
  if (!(await host.count())) return null;
  const box = await host.boundingBox();
  await page.mouse.click(box.x + 20, box.y + 12);
  await page.waitForTimeout(250);
  return host;
}

/** Shut the writing panel if a check left it open, so the next toggle opens it. */
async function closeAskPanel() {
  if (await page.locator('.ed-tt__ask').count()) {
    await page.locator('.ed-tt__btn[aria-label="Ask for some writing"]').click();
    await page.waitForTimeout(200);
  }
}

await check('the toolbar carries a button for the writing assistant', async () => {
  const button = page.locator('.ed-tt__btn[aria-label="Ask for some writing"]');
  return (await button.count()) === 1 ? true : `${await button.count()} of them`;
});

await check('and it is marked out from the twenty buttons beside it', async () => {
  /*
   * THE POINTER MOVED AWAY FIRST, and that is not fussiness.
   *
   * Playwright leaves the mouse wherever the last click put it, and .is-ai:hover
   * is a different colour again. With the pointer resting on the sparkle this
   * compared a hover colour against a resting one and passed whatever the
   * resting rule said, which the mutation probe caught by renaming that rule and
   * watching the check pass anyway.
   */
  await page.mouse.move(0, 0);
  await page.waitForTimeout(150);

  // Not just a class name: the class has to resolve to a rule, which is the gap
  // nothing else in this suite covers.
  const [ai, plain] = await page.evaluate(() => {
    const read = (selector) => {
      const el = document.querySelector(selector);
      return el ? getComputedStyle(el).color : '';
    };
    return [
      read('.ed-tt__btn[aria-label="Ask for some writing"]'),
      read('.ed-tt__btn[aria-label="Bold"]'),
    ];
  });
  return ai && plain && ai !== plain ? true : `assistant ${ai}, bold ${plain}`;
});

await check('clicking it asks what you want written', async () => {
  await closeAskPanel();
  // Caret only. The checks that follow are about the nothing-highlighted case.
  if (!(await placeCaret())) return 'no paragraph to put a caret in';

  await page.locator('.ed-tt__btn[aria-label="Ask for some writing"]').click();
  await page.waitForTimeout(250);
  const panel = page.locator('.ed-tt__ask');
  if (!(await panel.count())) return 'no panel opened';
  const title = await panel.locator('.ed-tt__ask-title').innerText();
  return /what would you like written/i.test(title) ? true : `it says "${title}"`;
});

/*
 * A measurement, because a panel is only useful if it is on the screen. The link
 * panel had exactly this bug: it opened past the right edge with its Apply button
 * unreachable, and it took a browser check to see it.
 */
await check('the panel opens inside the window, not off the edge of it', async () => {
  const box = await page.locator('.ed-tt__ask').boundingBox();
  const width = page.viewportSize().width;
  if (!box) return 'no box';
  return box.x >= 0 && box.x + box.width <= width + 1
    ? true
    : `x ${Math.round(box.x)}, width ${Math.round(box.width)}, viewport ${width}`;
});

await check('it says the copy will land where the cursor is, with nothing highlighted', async () => {
  const note = await page.locator('.ed-tt__ask-note').innerText();
  return /where the cursor is/i.test(note) ? true : `it says "${note}"`;
});

/*
 * The quick edits are absent rather than disabled with nothing selected. "Make
 * this shorter" has no honest answer when there is no this.
 */
await check('and the quick edits are not offered yet, because there is no this', async () =>
  (await page.locator('.ed-tt__ask-chip').count()) === 0
    ? true
    : `${await page.locator('.ed-tt__ask-chip').count()} chips with nothing selected`);

await check('an empty request is refused rather than sent', async () => {
  await page.locator('.ed-tt__ask-go').click();
  await page.waitForTimeout(300);
  const error = await page.locator('.ed-tt__ask-error').count();
  return error === 1 ? true : 'it went ahead with an empty request';
});

await check('asking for copy puts it in the paragraph', async () => {
  const host = page.locator('[data-rt-host]:not([data-rt-oneline])').first();
  const before = await host.innerText();

  await page.locator('.ed-tt__ask-box').fill('A paragraph about our trips to Greece');
  await page.locator('.ed-tt__ask-go').click();
  await page.waitForTimeout(600);

  const after = await host.innerText();
  return after.length > before.length && /tailor-made/i.test(after)
    ? true
    : `before ${before.length} chars, after ${after.length}`;
});

/*
 * IN STATE, not only on the canvas. The whole point of routing the answer through
 * the same door as typing is that it commits like typing does, so it survives a
 * save and can be undone. On the canvas only would mean copy that vanishes on
 * reload, which is the failure mode this codebase has hit before.
 */
await check('and the copy is in the page state, not only on the canvas', async () => {
  const state = await page.locator('.ed-rt').first().innerText();
  return /tailor-made/i.test(state) ? true : `state has "${state.slice(0, 60)}"`;
});

await check('the panel closes once the copy has landed', async () =>
  (await page.locator('.ed-tt__ask').count()) === 0 ? true : 'it stayed open');

await check('and one undo takes it back out again', async () => {
  const host = page.locator('[data-rt-host]:not([data-rt-oneline])').first();
  await host.click();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  const state = await page.locator('.ed-rt').first().innerText();
  return !/tailor-made/i.test(state) ? true : 'the copy survived an undo';
});

await check('with words highlighted, the quick edits appear', async () => {
  await closeAskPanel();
  if (!(await selectSomeWords())) return 'could not select anything';
  await page.locator('.ed-tt__btn[aria-label="Ask for some writing"]').click();
  await page.waitForTimeout(250);
  const chips = await page.locator('.ed-tt__ask-chip').allInnerTexts();
  return chips.length === 3 ? true : JSON.stringify(chips);
});

await check('and the panel says it will replace them', async () => {
  const note = await page.locator('.ed-tt__ask-note').innerText();
  return /replace/i.test(note) ? true : `it says "${note}"`;
});

/*
 * REPLACES rather than appends, which is the claim every quick edit rests on.
 *
 * NOT CHECKED BY LENGTH, and the first version of this was. It selected about
 * seventeen characters, asked for shorter, and asserted the paragraph got
 * shorter. It grew, and the growth was correct: a seventeen-character run
 * replaced by a seventy-character sentence is a longer paragraph and a working
 * feature. A check that reads "shorter" as "the block shrinks" is measuring the
 * wrong thing.
 *
 * What matters is that the highlighted run is GONE. If the copy had been
 * appended, those words would still be sitting there in front of it.
 */
await check('making it shorter replaces the words rather than adding to them', async () => {
  const host = page.locator('[data-rt-host]:not([data-rt-oneline])').first();

  /*
   * ITS OWN SELECTION, and the highlighted words READ BEFORE the panel opens.
   *
   * Opening the panel puts the cursor in its box, which is what you want when
   * you are about to type a request, and it collapses the document's selection
   * as a side effect. The toolbar keeps its own copy from before that happened,
   * which is why the feature works; a check reading window.getSelection() after
   * the panel is up reads an empty string and reports "only "" was
   * highlighted", which looks like the selection never took.
   */
  await closeAskPanel();
  if (!(await selectSomeWords())) return 'could not select anything';
  const highlighted = (await page.evaluate(() => String(window.getSelection()))).trim();
  if (highlighted.length < 6) return `only "${highlighted}" was highlighted`;

  await page.locator('.ed-tt__btn[aria-label="Ask for some writing"]').click();
  await page.waitForTimeout(250);

  await page.locator('.ed-tt__ask-chip', { hasText: 'Make it shorter' }).click();
  await page.waitForTimeout(600);

  const after = await host.innerText();
  const stillThere = after.includes(highlighted);
  const arrived = /Tailor-made trips to Greece/i.test(after);

  return !stillThere && arrived
    ? true
    : `the highlighted run is ${stillThere ? 'still there' : 'gone'}, the new copy ${arrived ? 'arrived' : 'did not'}`;
});

/*
 * The failure path, visible rather than silent. The double refuses anything with
 * "fail" in it, which is the shape a spent allowance or an unreachable model
 * produces.
 */
await check('a refusal is shown in the panel rather than swallowed', async () => {
  await closeAskPanel();
  await placeCaret();
  await page.locator('.ed-tt__btn[aria-label="Ask for some writing"]').click();
  await page.waitForTimeout(250);
  await page.locator('.ed-tt__ask-box').fill('please fail');
  await page.locator('.ed-tt__ask-go').click();
  await page.waitForTimeout(500);

  const error = page.locator('.ed-tt__ask-error');
  if (!(await error.count())) return 'nothing was said';
  const text = await error.innerText();
  const stillOpen = (await page.locator('.ed-tt__ask').count()) === 1;
  return /busy/i.test(text) && stillOpen ? true : `"${text}", panel open ${stillOpen}`;
});

await check('and the panel stays open so the request can be corrected', async () => {
  const value = await page.locator('.ed-tt__ask-box').inputValue();
  return value === 'please fail' ? true : `the box now holds "${value}"`;
});

await check('escape closes it', async () => {
  await page.locator('.ed-tt__ask-box').press('Escape');
  await page.waitForTimeout(250);
  return (await page.locator('.ed-tt__ask').count()) === 0 ? true : 'it stayed open';
});

/*
 * LEAVE THE PAGE AS IT WAS FOUND.
 *
 * These checks put copy into the first paragraph and rewrite it shorter, and the
 * undo above only takes back the one insert it was checking. The checks further
 * down count blocks and read the first paragraph, and they started failing on a
 * page this block had quietly rewritten, which reads as the breadcrumb being
 * broken rather than as this block not tidying up.
 *
 * A reload rather than a stack of undos, because the number of steps to undo is
 * a thing that changes every time a check is added here.
 */
await page.reload();
await page.waitForSelector('.ed-root');
await showPanels();

/*
 * HEADINGS TOO, because the seeded page is four headings to two paragraphs and a
 * heading that does nothing when clicked reads as the whole feature being broken.
 *
 * A HEADING HOLDS MARKUP SINCE 31 JUL 2026, which reversed the rule these checks
 * used to enforce. Andy: "the text toolbar only appears on paragraph text, it
 * needs to work on every style of text."
 *
 * It used to store a plain string the renderer escaped, so it was marked as a
 * different kind of host, read back as textContent, and deliberately given no
 * toolbar: bold inside one could not have survived a save. Now it stores html
 * like a paragraph and gets the toolbar.
 *
 * The attribute that survived is data-rt-oneline, and it means only what it
 * says: a heading is ONE LINE. Enter is still refused, and the toolbar hides the
 * commands that would put a block element inside an h2.
 */
async function editHeading() {
  for (const block of await page.locator('.tgs-block').all()) {
    if (await block.locator('.tgs-heading').count()) {
      await block.click();
      await page.waitForTimeout(400);
      const host = page.locator('[data-rt-host][data-rt-oneline]').first();
      return (await host.count()) ? host : null;
    }
  }
  return null;
}

await check('a heading is typed in place as well', async () => {
  const host = await editHeading();
  if (!host) return 'no heading became an editable host';

  await page.evaluate(() => {
    const el = document.querySelector('[data-rt-host][data-rt-oneline]');
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.type(' NOW', { delay: 30 });
  await page.waitForTimeout(350);

  const text = (await host.innerText()).trim();
  // .ed-rt, not .ed-input. A heading's pane field is a rich text field now that
  // the block holds markup, which is the same change that gave it the toolbar.
  const inState = (await page.locator('.ed-rt').first().innerText()).trim();
  return text.endsWith('NOW') && inState.endsWith('NOW')
    ? true
    : `canvas "${text.slice(-20)}", state "${inState.slice(-20)}"`;
});

/*
 * THE THING ANDY ASKED FOR, and its opposite used to be a check in this file:
 * "no formatting toolbar on a heading, because none of it would survive". It
 * survives now.
 */
await check('a heading gets the formatting toolbar too', async () => {
  const bars = await page.locator('.ed-tt').count();
  return bars === 1 ? true : `${bars} toolbars over a heading`;
});

/*
 * The commands that would nest a BLOCK inside an h2 are absent, and this is the
 * check that keeps the feature honest rather than merely present. A p or a ul
 * inside a heading is invalid HTML that no browser refuses: they hoist the block
 * out, so the back half of the heading falls out of the heading with it.
 */
await check('but not the commands that would put a block inside a heading', async () => {
  const style = await page.locator('.ed-tt select[aria-label="Text style"]').count();
  const lists = await page.locator('.ed-tt__btn[aria-label="Bulleted list"]').count();
  return style === 0 && lists === 0
    ? true
    : `${style} style dropdowns, ${lists} list buttons over a heading`;
});

await check('and the inline ones are all there, which is the point', async () => {
  const wanted = ['Bold', 'Italic', 'Underline', 'Add a link', 'Text colour', 'Align centre'];
  const missing = [];
  for (const label of wanted) {
    if ((await page.locator(`.ed-tt__btn[aria-label="${label}"]`).count()) === 0) {
      missing.push(label);
    }
  }
  // Size and font are selects rather than buttons, and they carry the styling a
  // heading is most likely to want.
  const size = await page.locator('.ed-tt select[aria-label="Size"]').count();
  return missing.length === 0 && size === 1
    ? true
    : `missing ${JSON.stringify(missing)}, ${size} size pickers`;
});

/*
 * FORMATTING IN A HEADING, ALL THE WAY THROUGH. The claim the old design could
 * not make: it has to reach the canvas AND the page state, because state is what
 * a save writes. On the canvas only would be the "appears to work" failure this
 * codebase has a rule about, in the exact place that rule was written for.
 *
 * NOT ASSERTED AS <strong>, and the first version of this was. A heading is
 * ALREADY BOLD, so execCommand('bold') toggles it off, and Chromium expresses
 * "less bold" the only way it can: a span with font-weight normal. The check
 * failed reading "canvas false, state false" on a feature that was working
 * perfectly. What matters is that markup appeared and that the heading
 * allowlist keeps it, not which tag the browser reached for.
 */
await check('formatting a heading reaches the page state, so it survives a save', async () => {
  const host = page.locator('[data-rt-host][data-rt-oneline]').first();
  if (!(await host.count())) return 'no heading host';

  const before = await host.innerHTML();
  const box = await host.boundingBox();
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + Math.min(90, box.width - 4), box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(250);

  const selected = (await page.evaluate(() => String(window.getSelection()))).trim();
  if (selected.length < 3) return `only "${selected}" was selected`;

  await page.locator('.ed-tt__btn[aria-label="Bold"]').click();
  await page.waitForTimeout(400);

  const after = await host.innerHTML();
  const inState = await page.locator('.ed-rt').first().innerHTML();

  // Some element appeared where there was none, and the same one is in state.
  const marked = /<(b|strong|span)[ >]/i.test(after);
  return marked && after !== before && inState === after
    ? true
    : `before ${JSON.stringify(before.slice(0, 40))}, after ${JSON.stringify(after.slice(0, 60))}, state matches ${inState === after}`;
});

/*
 * AND IT IS AN INLINE ELEMENT, not a block one hoisted out of the heading.
 * The nesting rule, checked on real markup the editor produced rather than on a
 * string handed to the sanitiser in a unit test.
 */
await check('and what it produced is inline, so the heading stays whole', async () => {
  const html = await page.locator('[data-rt-host][data-rt-oneline]').first().innerHTML();
  return !/<(p|div|ul|ol|li|blockquote|h[1-6])\b/i.test(html)
    ? true
    : `the heading now contains ${JSON.stringify(html.slice(0, 80))}`;
});

/*
 * Enter inside a heading does nothing. Left to the browser it inserts a div or a
 * br, and reading textContent back out welds the two lines into one word with no
 * space, which looks like the editor eating a keystroke.
 */
/*
 * THE PANE FIELD IS STILL THE SECOND WAY IN, and it must not go stale.
 *
 * It seeded itself once on mount and never again, which was fine while it was
 * the only editor. With the canvas editing the same words, that field sat
 * showing the content as it was BEFORE the canvas edit, and the next keystroke
 * in it would commit what it was showing, wiping everything typed on the canvas.
 *
 * So it catches up whenever it is not the thing being typed into. That
 * condition is the whole design: writing into a focused contentEditable is the
 * caret fight this field has always existed to avoid.
 */
await check('the pane field catches up with what was typed on the canvas', async () => {
  const host = await editParagraph();
  if (!host) return 'no editable paragraph';

  await page.evaluate(() => {
    const el = document.querySelector('[data-rt-host]:not([data-rt-oneline])');
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.type(' CAUGHTUP', { delay: 30 });
  await page.waitForTimeout(400);

  const pane = await page.locator('.ed-rt').first().innerText();
  return pane.includes('CAUGHTUP') ? true : `the pane says "${pane.slice(-40)}"`;
});

await check('and typing in the pane still reaches the canvas', async () => {
  const field = page.locator('.ed-rt').first();
  await field.click();
  await page.waitForTimeout(200);
  await page.keyboard.press('End');
  await page.keyboard.type(' FROMPANE', { delay: 30 });
  await page.waitForTimeout(400);

  const canvas = await page.locator('[data-rt-host]:not([data-rt-oneline])').first().innerText();
  return canvas.includes('FROMPANE') ? true : `the canvas says "${canvas.slice(-40)}"`;
});

await check('Enter in a heading is refused rather than silently mangled', async () => {
  // Selects its own heading rather than inheriting one from the check above,
  // so the checks in between can move without quietly breaking this one.
  const host = await editHeading();
  if (!host) return 'no heading became an editable host';

  await page.keyboard.press('Enter');
  await page.keyboard.type('X');
  await page.waitForTimeout(300);

  const html = await host.innerHTML();
  return !/<(div|br|p)[ >/]/i.test(html) ? true : `heading contains "${html.slice(0, 60)}"`;
});

// ---------------------------------------------------------------------------
// The way back up out of a block
// ---------------------------------------------------------------------------

/*
 * ANDY, TWICE, ON 30 Jul 2026. First: "when i add text (or anything) to a
 * column, it stops being a column... you can't 'style' the column". Then, after
 * the first fix and a passing check: "it still collapses, so you can't get to
 * any of the column settings".
 *
 * The first fix put a label on the column that appeared on hover and could be
 * clicked, and a check clicked it and passed. Measured afterwards: 60 by 19
 * pixels, hover only, styled exactly like the badges that merely name what is
 * selected. The mechanism worked and nobody could find it, which is why the
 * check was green while the feature was unusable.
 *
 * A CHECK THAT PERFORMS THE WORKAROUND CANNOT SEE THE BUG. The one below does
 * what Andy does: click the words, then look for a way to the column.
 */
/** The field labels currently showing in the properties pane. */
const paneLabels = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.ed-props .ed-label')].map((label) => label.textContent?.trim()));

await check('clicking inside a full column selects the block, as it should', async () => {
  await page.locator('.tgs-block').filter({ hasText: 'Talk to someone' }).first().click();
  await page.waitForTimeout(400);
  const labels = await paneLabels();
  return labels.includes('Content')
    ? true
    : `the pane shows ${JSON.stringify(labels)}`;
});

await check('and the breadcrumb shows the whole way up', async () => {
  const steps = await page.locator('.ed-crumbs__step').allInnerTexts();
  const expected = ['Section 1', 'Row 1', 'Column 1', 'Text'];
  return JSON.stringify(steps) === JSON.stringify(expected)
    ? true
    : `the trail reads ${JSON.stringify(steps)}`;
});

/*
 * THE ONE THAT MATTERS. Reaching the column's settings from a block, without
 * hovering anything and without a bare patch of column to aim at.
 */
await check('so the column settings are reachable from a block', async () => {
  await page.locator('.ed-crumbs__step', { hasText: 'Column' }).first().click();
  await page.waitForTimeout(400);

  const labels = await paneLabels();
  const wanted = ['Width', 'Padding (inner spacing)', 'Background colour'];
  const missing = wanted.filter((label) => !labels.includes(label));
  return missing.length === 0 ? true : `missing ${JSON.stringify(missing)}`;
});

await check('and the row and the section too', async () => {
  await page.locator('.ed-crumbs__step', { hasText: 'Row 1' }).first().click();
  await page.waitForTimeout(350);
  const row = await paneLabels();

  await page.locator('.ed-crumbs__step', { hasText: 'Section 1' }).first().click();
  await page.waitForTimeout(350);
  const section = await paneLabels();

  return row.length > 0 && section.length > 0
    ? true
    : `row ${JSON.stringify(row)}, section ${JSON.stringify(section)}`;
});

/*
 * ONE CONTEXTUAL TOOLBAR, AND IT GOES WHEN YOU CLICK AWAY.
 *
 * The pill was keyed on the selected path, so React remounted it on every
 * selection and, because a keyed child that changes key while it stays present
 * among conditional siblings is the pattern React mis-reconciles, left the old
 * one behind. They stacked up, one per item clicked, four deep on Andy's screen
 * (3 Aug 2026), and none went away. It is one instance now, and clicking the
 * empty canvas clears the selection and the pill with it.
 *
 * The height is grown for the click-away so there is canvas below the page to
 * aim at, then put back so the checks after this see the viewport they expect.
 */
await check('the contextual toolbar is one, and clears on a click away', async () => {
  const bars = () => page.locator('.ed-bar').count();
  const saved = page.viewportSize();

  await page.locator('.ed-canvas-frame h1, .ed-canvas-frame h2').first().click();
  await page.waitForTimeout(250);
  const afterFirst = await bars();

  await page.locator('.ed-canvas-frame p').first().click();
  await page.waitForTimeout(250);
  const afterSecond = await bars();

  await page.setViewportSize({ width: saved.width, height: 1900 });
  await page.waitForTimeout(200);
  const wrap = await page.locator('.ed-canvas-wrap').boundingBox();
  const last = await page.locator('.tgs-section').last().boundingBox();
  const y = Math.min(wrap.y + wrap.height - 8, last.y + last.height + 40);
  await page.mouse.click(wrap.x + wrap.width / 2, y);
  await page.waitForTimeout(250);
  const afterAway = await bars();

  await page.setViewportSize(saved);

  if (afterFirst !== 1) return `a single selection drew ${afterFirst} toolbars`;
  if (afterSecond !== 1) return `a second selection stacked to ${afterSecond}`;
  if (afterAway !== 0) return `clicking the empty canvas left ${afterAway}`;
  return true;
});

/*
 * Every step is a real button at a real size. The chip this replaced was 19px
 * tall, which is under half the 44px rule, and that was part of why it went
 * unnoticed.
 */
await check('every step of the trail meets the 44px rule', async () => {
  await page.locator('.tgs-block').filter({ hasText: 'Talk to someone' }).first().click();
  await page.waitForTimeout(400);

  const bad = await page.evaluate(() => {
    const out = [];
    for (const step of document.querySelectorAll('.ed-crumbs__step')) {
      const box = step.getBoundingClientRect();
      const after = getComputedStyle(step, '::after');
      // The target is grown with a pseudo-element, so measure that when present.
      const grow = parseFloat(after.getPropertyValue('inset-block-start')) || 0;
      const height = box.height + Math.abs(grow) * 2;
      if (height < 44) out.push(`${step.textContent}: ${Math.round(height)}px`);
    }
    return out;
  });

  return bad.length === 0 ? true : `too small: ${bad.join(', ')}`;
});

// ---------------------------------------------------------------------------
// Moving a column, and which way things sit
// ---------------------------------------------------------------------------

/*
 * Andy, 31 Jul 2026: "on the columns can you add the ability to move left and
 * right / on the sections can you add a setting so the columns inside can be
 * stacked vertically and horizontally / and then the same for the content in
 * columns."
 *
 * All three reached through the breadcrumb, which is the point of it: a column
 * with content in it has nothing left to click, so every one of these controls
 * would have been unreachable without it.
 */

/*
 * A WIDER WINDOW FOR THIS WHOLE SECTION, and it is not a contrivance.
 *
 * The canvas is a container query context, so what the preview shows depends on
 * the CANVAS width and not the browser's. At the 1440px this file otherwise
 * uses, the outline and the properties pane leave the canvas 752px, which is
 * under the 767px phone breakpoint: everything is already stacked, so "make
 * this stacked" changes nothing and a check for it passes or fails for reasons
 * that have nothing to do with the setting. Measured: 752px at 1440, 1012px at
 * 1700.
 */
const NARROW = page.viewportSize();
await page.setViewportSize({ width: 1700, height: 900 });
await page.waitForTimeout(300);

/** Select the column that holds a given block, via the breadcrumb. */
async function selectColumnOf(text) {
  await page.locator('.tgs-block').filter({ hasText: text }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.ed-crumbs__step', { hasText: 'Column' }).first().click();
  await page.waitForTimeout(400);
}

await check('a column can be moved left and right', async () => {
  await selectColumnOf('Talk to someone');

  const before = await page.locator('.tgs-col').evaluateAll((cols) =>
    cols.map((col) => col.textContent?.slice(0, 20)));

  const right = page.locator('.ed-btn', { hasText: 'Move right' }).first();
  if ((await right.count()) === 0) return 'no Move right button on a column';
  await right.click();
  await page.waitForTimeout(400);

  const after = await page.locator('.tgs-col').evaluateAll((cols) =>
    cols.map((col) => col.textContent?.slice(0, 20)));

  return before[0] === after[1] && before[1] === after[0]
    ? true
    : `before ${JSON.stringify(before.slice(0, 2))}, after ${JSON.stringify(after.slice(0, 2))}`;
});

/*
 * THE WIDTH TRAVELS WITH IT. A 55/45 row whose wide column moves right becomes
 * 45/55. The other reading, where the contents swap and the widths stay put,
 * makes moving a hero picture across change its size, which is not a move.
 */
await check('and its width goes with it', async () => {
  const widths = await page.locator('.tgs-col').evaluateAll((cols) =>
    cols.slice(0, 2).map((col) => Math.round(col.getBoundingClientRect().width)));

  // Undo, measure, redo: the pair should come back swapped rather than equal.
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  const before = await page.locator('.tgs-col').evaluateAll((cols) =>
    cols.slice(0, 2).map((col) => Math.round(col.getBoundingClientRect().width)));
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(400);

  // Within a couple of pixels: the gap between columns is not part of either.
  const swapped = Math.abs(widths[0] - before[1]) <= 2 && Math.abs(widths[1] - before[0]) <= 2;
  return swapped
    ? true
    : `was ${JSON.stringify(before)}, now ${JSON.stringify(widths)}`;
});

/*
 * MEASURED AS "a short block stops being forced to the full width", not as
 * "two blocks share a line".
 *
 * The second is what side by side looks like when the content is small, and it
 * is not what it looks like here: the hero column holds a 539px-wide display
 * heading, which cannot share a 539px line with anything, so it wraps. That is
 * the designed behaviour, and a check asserting otherwise fails on working code.
 *
 * What does change, always, is that a block is laid out at its own width rather
 * than stretched to the column. Measured: the eyebrow heading goes from 539px
 * to 222px.
 */
await check('the content in a column can sit side by side', async () => {
  await selectColumnOf('Talk to someone');

  const before = await page.evaluate(() => {
    const col = document.querySelector('.tgs-col');
    const first = col?.querySelector(':scope > .tgs-block');
    return first ? Math.round(first.getBoundingClientRect().width) : null;
  });

  const side = page.locator('.ed-segmented button', { hasText: 'Side by side' }).first();
  if ((await side.count()) === 0) return 'no side by side control on a column';
  await side.click();
  await page.waitForTimeout(450);

  const after = await page.evaluate(() => {
    const col = document.querySelector('.tgs-col[data-flow="row"]');
    if (!col) return { error: 'no column marked as a row' };
    const first = col.querySelector(':scope > .tgs-block');
    const style = getComputedStyle(col);
    return {
      width: first ? Math.round(first.getBoundingClientRect().width) : null,
      display: style.display,
      wrap: style.flexWrap,
    };
  });

  if (after.error) return after.error;
  if (after.display !== 'flex' || after.wrap !== 'wrap') {
    return `the column is ${after.display} / ${after.wrap}`;
  }
  return after.width < before * 0.75
    ? true
    : `the first block was ${before}px and is now ${after.width}px`;
});

await check('and goes back to stacked when told to', async () => {
  await page.locator('.ed-segmented button', { hasText: 'Stacked' }).first().click();
  await page.waitForTimeout(400);
  return (await page.locator('.tgs-col[data-flow="row"]').count()) === 0
    ? true
    : 'the column is still marked as a row';
});

/*
 * The row's version of the same question. It is the SAME stored field as the
 * breakpoint, so the breakpoint control disappears when there is nothing left
 * for it to decide, rather than sitting there contradicting this one.
 */
await check("a row's columns can be stacked at every width", async () => {
  await page.locator('.tgs-block').filter({ hasText: 'Talk to someone' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.ed-crumbs__step', { hasText: 'Row' }).first().click();
  await page.waitForTimeout(400);

  const before = await page.locator('.tgs-col').first().boundingBox();
  await page.locator('.ed-segmented button', { hasText: 'Stacked' }).first().click();
  await page.waitForTimeout(450);
  const after = await page.locator('.tgs-col').first().boundingBox();

  // A stacked row gives its first column the whole width.
  return after.width > before.width * 1.4
    ? true
    : `the column was ${Math.round(before.width)}px and is now ${Math.round(after.width)}px`;
});

await check('and the breakpoint question goes away, because it has no answer left', async () => {
  const asking = await page.locator('.ed-label', { hasText: 'Stack into one column' }).count();
  return asking === 0
    ? true
    : 'the editor is still asking where to stack a row that is always stacked';
});

await check('putting it back side by side asks again', async () => {
  await page.locator('.ed-segmented button', { hasText: 'Side by side' }).first().click();
  await page.waitForTimeout(450);
  const asking = await page.locator('.ed-label', { hasText: 'Stack into one column' }).count();
  return asking === 1 ? true : `${asking} breakpoint controls`;
});

// Back to the width the rest of the file measures at.
await page.setViewportSize(NARROW);
await page.waitForTimeout(300);

// ---------------------------------------------------------------------------
// The plus in an empty column
// ---------------------------------------------------------------------------

/*
 * WHY THIS CHANGED, because the old behaviour was not a bug.
 *
 * The whole dashed area of an empty column used to open the block picker, which
 * was right while a column had nothing of its own to configure. Columns got
 * padding presets and the rest of the style panel earlier on 30 Jul 2026, and at
 * that point an empty column became the one thing on the canvas you could not
 * select and style. So the area selects the column and the plus adds to it.
 *
 * Placed at the very end of this file on purpose: it adds a section, and a new
 * section shifts every index the checks above depend on.
 */

/*
 * A COLUMN WITH CONTENT IS STILL A COLUMN.
 *
 * Andy: "when i add text (or anything) to a column, it stops being a column; it
 * is just a block, so you can't add anything to it, and you can't style the
 * column". Exactly right: the plus only existed while the column was empty, and
 * a block fills its column, so every click landed on the block.
 */
await check('a column with content can still be added to', async () => {
  const column = page.locator('.tgs-col').filter({ hasText: 'Talk to someone' }).first();
  if ((await column.count()) === 0) return 'no column with content on the canvas';

  await column.hover();
  await page.waitForTimeout(300);

  const append = column.locator('.ed-col-append');
  if ((await append.count()) !== 1) return `${await append.count()} append buttons`;

  await append.click();
  await page.waitForTimeout(400);
  const dialog = await page.locator('[role="dialog"]').count();
  await closeAnyDialog();

  return dialog === 1 ? true : 'the block picker did not open';
});

await check('and can still be selected, so it can be styled', async () => {
  const column = page.locator('.tgs-col').filter({ hasText: 'Talk to someone' }).first();
  await column.hover();
  await page.waitForTimeout(300);

  // The chip carries no data-add, so the click falls through to the column's
  // own data-path. That is the whole trick, and it is why it is a span.
  await column.locator('.ed-col-chip').click();
  await page.waitForTimeout(400);

  const labels = await page.evaluate(() =>
    [...document.querySelectorAll('.ed-props .ed-label')].map((l) => l.textContent?.trim()));

  return labels.includes('Vertical alignment') && labels.includes('Padding (inner spacing)')
    ? true
    : `the pane shows ${JSON.stringify(labels.slice(0, 6))}`;
});

await check('neither is on screen until the column is hovered', async () => {
  /*
   * The pointer has to be moved AWAY first. Written without this and it failed
   * reporting opacity 1, because the check before it had just hovered the
   * column and left the mouse there.
   */
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);

  // display:none, not opacity:0. An invisible button is still tabbable and
  // still fails the 44px check as unreachable; a display:none one has no box.
  const shown = await page.locator('.ed-col-chip').evaluateAll((els) =>
    els.filter((el) => getComputedStyle(el).display !== 'none').length);

  // One column still counts: whichever holds the current selection shows its
  // chip on purpose, so a tablet with no hover can still reach it.
  return shown <= 1 ? true : `${shown} chips on screen with nothing hovered`;
});

await check('an empty column offers a plus rather than a whole clickable area', async () => {
  await page.locator('[data-insert]').first().click();
  await page.waitForTimeout(400);
  const twoCol = page.locator('button', { hasText: 'Two columns' }).first();
  if ((await twoCol.count()) === 0) return 'the layout picker did not open';
  await twoCol.click();
  await page.waitForTimeout(600);

  const areas = await page.locator('.ed-empty-col').count();
  const buttons = await page.locator('.ed-empty-col__add').count();

  // The area must no longer carry the add hook itself. If it does, a click
  // anywhere in the column still adds and the column cannot be selected.
  const areaAdds = await page.locator('.ed-empty-col[data-add]').count();

  return areas === 2 && buttons === 2 && areaAdds === 0
    ? true
    : `${areas} areas, ${buttons} buttons, ${areaAdds} areas still carrying data-add`;
});

await check('it is a real button, so it can be reached by keyboard', async () => {
  const tag = await page.locator('.ed-empty-col__add').first().evaluate((el) => ({
    tag: el.tagName,
    label: el.getAttribute('aria-label'),
    // A div with a click handler is invisible to a keyboard and to a screen
    // reader, which is what the icon set's own header warns about.
    focusable: el.tabIndex >= 0,
  }));
  return tag.tag === 'BUTTON' && tag.focusable && tag.label
    ? true
    : JSON.stringify(tag);
});

await check('clicking the plus opens the block picker', async () => {
  await page.locator('.ed-empty-col__add').first().click();
  await page.waitForTimeout(400);

  const open = await page.locator('[role="dialog"]').count();
  const text = open ? await page.locator('[role="dialog"]').innerText() : '';
  await closeAnyDialog();

  return open === 1 && /heading|text|image/i.test(text)
    ? true
    : `${open} dialogs, saying "${text.slice(0, 60)}"`;
});

/*
 * THE POINT OF THE WHOLE CHANGE. A click on the column that is not on the plus
 * has to select the column, or an empty column is the one thing on the canvas
 * that cannot be styled.
 */
await check('clicking the column itself selects it for styling', async () => {
  const area = await page.locator('.ed-empty-col').first().boundingBox();
  if (!area) return 'no empty column on screen';

  // Deliberately off-centre, well clear of the 40px button in the middle.
  await page.mouse.click(area.x + 24, area.y + 16);
  await page.waitForTimeout(350);

  const labels = await page.evaluate(() =>
    [...document.querySelectorAll('.ed-props .ed-label')].map((l) => l.textContent?.trim()));

  // A column pane, not a section pane and not a block pane.
  return labels.includes('Vertical alignment') && labels.includes('Padding (inner spacing)')
    ? true
    : `the pane shows ${JSON.stringify(labels.slice(0, 6))}`;
});

await check('and the padding presets are right there on it', async () => {
  // Which is what makes selecting an empty column worth doing at all.
  return (await page.locator('.ed-pad__presets button').count()) === 5
    ? true
    : `${await page.locator('.ed-pad__presets button').count()} presets`;
});


// ---------------------------------------------------------------------------
// Folding the side panels away
// ---------------------------------------------------------------------------

/*
 * LAST IN THE FILE ON PURPOSE. These fold panels away, and a folded outline is
 * a missing .ed-outline for everything above.
 *
 * Andy, 31 Jul 2026: "the desktop button should force a wider canvas. best way
 * to achieve this is to make the l[e]ft and [right] areas collapsible".
 *
 * The preview is a container query context, so it follows the CANVAS width and
 * not the window's. At the 1440px this file runs at, the two 320px panels leave
 * the canvas 752px, under the 767px phone breakpoint, so Desktop was showing the
 * phone layout. That is exactly the width this check runs at, which is what
 * makes it worth measuring here.
 */

/*
 * THE ROOM, not the frame. The frame is drawn at the width somebody chose,
 * whether or not it fits, so measuring it would answer the wrong question:
 * it reads 1200 with both panels open and 1200 with both folded. What folding
 * changes is how much of that 1200 can be seen without scrolling.
 */
const canvasRoom = async () =>
  page.locator('.ed-canvas-wrap').evaluate((wrap) => wrap.clientWidth);

/*
 * THE WIDTH EACH PREVIEW IS DRAWN AT.
 *
 * Andy, 31 Jul 2026: "settings for the screen size the user wants to build to
 * for each of the three break points... desktop default should be about 1200
 * but they should be able to select bigger or smaller".
 *
 * Desktop used to be '100%', which is not a screen size: it is an accident of
 * the window and of which panels happen to be open.
 */
await check('each preview is drawn at a real width, desktop included', async () => {
  await page.evaluate(() => window.localStorage.removeItem('tg-sites:viewports:v1'));
  await page.reload();
  await page.waitForSelector('.ed-root');
  await page.waitForTimeout(400);

  const seen = {};
  for (const [label, expected] of [['Desktop', 1200], ['Tablet', 834], ['Phone', 390]]) {
    await page.locator('.ed-btn', { hasText: label }).click();
    await page.waitForTimeout(350);
    const shown = Number(await page.locator('.ed-vw__num').inputValue());
    const drawn = Math.round((await page.locator('.ed-canvas-frame').boundingBox()).width);
    seen[label] = { shown, drawn, expected };
  }

  const wrong = Object.entries(seen).filter(
    ([, v]) => v.shown !== v.expected || Math.abs(v.drawn - v.expected) > 2,
  );
  return wrong.length === 0 ? true : JSON.stringify(Object.fromEntries(wrong));
});

/*
 * THE WIDTH IS A CEILING, NOT A DEMAND, and these two checks are the record of
 * that decision.
 *
 * They used to assert the opposite: type 1600, expect exactly 1600 drawn. That
 * was the first attempt at this feature on 31 Jul 2026 and it was wrong. A
 * 1600px preview in 1392px of room overflowed the canvas, and 424px of the page
 * ran off the right where nobody could reach it. Zooming to fit was tried next
 * and shrank the editor's own chrome to unclickable sizes.
 *
 * What shipped is `width: 100%; max-width: <the number>`. The preview is as wide
 * as you asked for OR as wide as the room, whichever is smaller, and a badge says
 * which you got. So the honest claim is not "1600 is drawn" but "1600 is
 * remembered, never exceeded, and the difference is admitted to".
 */
await check('and a bigger one can be typed in, up to the room there is', async () => {
  await page.locator('.ed-btn', { hasText: 'Desktop' }).click();
  await page.waitForTimeout(300);
  await page.locator('.ed-vw__num').fill('1600');
  await page.locator('.ed-vw__num').blur();
  await page.waitForTimeout(400);

  const kept = Number(await page.locator('.ed-vw__num').inputValue());
  const drawn = Math.round((await page.locator('.ed-canvas-frame').boundingBox()).width);
  /*
   * The room INSIDE the scroller, not its border box. The wrap carries padding,
   * so its bounding box is about 48px wider than anything can be drawn in, and
   * comparing against that reported a correct 1392px preview as 48px short.
   */
  const room = await page.locator('.ed-canvas-wrap').evaluate((el) => {
    const style = getComputedStyle(el);
    return Math.round(
      el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
    );
  });

  if (kept !== 1600) return `the box now says ${kept}`;
  if (drawn > room + 1) return `the preview is ${drawn}px in ${room}px of room`;
  return Math.abs(drawn - Math.min(1600, room)) <= 2
    ? true
    : `${drawn}px drawn, ${Math.min(1600, room)}px of room`;
});

/*
 * And it SAYS SO. A preview quietly drawn at 1392 when the box says 1600 is a
 * preview lying about what it is showing you, which is worse than the overflow
 * it replaced: the overflow was at least visible. The badge is the whole reason
 * the ceiling is an acceptable answer.
 */
await check('and it says what it is actually showing when it cannot have it all', async () => {
  const drawn = Math.round((await page.locator('.ed-canvas-frame').boundingBox()).width);
  const asked = Number(await page.locator('.ed-vw__num').inputValue());
  const badge = page.locator('.ed-vw__actual');

  if (drawn >= asked - 1) {
    // Nothing to admit to. Then the badge must NOT be there, or it would be
    // telling you about a shortfall that does not exist.
    return (await badge.count()) === 0
      ? true
      : `it is drawn at ${drawn} of ${asked} and still says "${await badge.innerText()}"`;
  }

  if (!(await badge.count())) return `drawn at ${drawn} of ${asked} and says nothing`;
  const text = await badge.innerText();
  return text.includes(String(drawn))
    ? true
    : `drawn at ${drawn} but the badge says "${text}"`;
});

await check('a width is refused if it is not one, and clamped if it is silly', async () => {
  await page.locator('.ed-vw__num').fill('40000');
  await page.locator('.ed-vw__num').blur();
  await page.waitForTimeout(350);
  const huge = Number(await page.locator('.ed-vw__num').inputValue());

  await page.locator('.ed-vw__num').fill('12');
  await page.locator('.ed-vw__num').blur();
  await page.waitForTimeout(350);
  const tiny = Number(await page.locator('.ed-vw__num').inputValue());

  return huge === 2560 && tiny === 320 ? true : `40000 became ${huge}, 12 became ${tiny}`;
});

await check('the common widths are offered as well as typed', async () => {
  await page.locator('.ed-vw .ed-btn').first().click();
  await page.waitForTimeout(300);
  const labels = await page.locator('[role="menu"] [role="menuitemradio"], [role="menu"] button').allInnerTexts();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  const hasStandard = labels.some((label) => label.includes('1200'));
  const hasWider = labels.some((label) => label.includes('1680') || label.includes('1920'));
  return hasStandard && hasWider ? true : `the menu offers ${JSON.stringify(labels)}`;
});

/*
 * NO ROW IN ANY MENU WRAPS. Andy, 31 Jul 2026: "I think you can do better with
 * the drop down, so it doesnt wrap for any option etc".
 *
 * The preset labels read "Small laptop · 1024px" as one string in a menu with a
 * fixed 184px width, so half of them broke over two lines and the numbers ended
 * up in a ragged column nobody could compare. The name and the size are two
 * columns now, and the menu sizes itself to its longest row.
 *
 * Written against EVERY menu rather than this one, because the fix is in the
 * shared component and the next long label should not have to rediscover it.
 */
await check('no row in a menu wraps to a second line', async () => {
  const wrapped = [];

  for (const trigger of await page.locator('.ed-topbar [aria-haspopup="menu"]').all()) {
    await trigger.click();
    await page.waitForTimeout(250);
    wrapped.push(
      ...(await page.locator('.ed-menu button').evaluateAll((rows) =>
        rows
          .filter((row) => {
            const label = row.querySelector('.ed-menu__label') ?? row;
            // One line at this font size is about 20px. Two is over 30.
            return label.getBoundingClientRect().height > 28;
          })
          .map((row) => row.innerText.replace(/\n/g, ' ')))),
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }

  return wrapped.length === 0 ? true : `these wrap: ${JSON.stringify(wrapped)}`;
});

await check('and the sizes line up in their own column', async () => {
  await page.locator('.ed-vw .ed-btn').first().click();
  await page.waitForTimeout(300);

  const rights = await page.locator('.ed-menu__hint').evaluateAll((hints) =>
    hints.map((hint) => Math.round(hint.getBoundingClientRect().right)));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  if (rights.length < 3) return `only ${rights.length} sizes shown`;
  const spread = Math.max(...rights) - Math.min(...rights);
  return spread <= 1 ? true : `their right edges vary by ${spread}px`;
});

/*
 * A SOLID PANEL, NOT SEE-THROUGH WORDS.
 *
 * The menu's background, border and shadow are theme variables that live on
 * .ed-root. When the panel was first lifted out of the outline's scroll box it
 * was painted into the bare body, outside that scope, so every one of them
 * resolved to nothing and the items floated as plain text over the page (Andy,
 * 7 Aug 2026). The geometry checks above passed straight through it, because
 * text and positions were fine and only the surface was gone. So this reads the
 * surface: an opaque background and a real shadow, which only hold while the
 * panel is painted somewhere the tokens reach.
 */
await check('an open menu has a solid panel behind it, not see-through', async () => {
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.waitForTimeout(250);
  const look = await page.locator('.ed-menu').first().evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, shadow: s.boxShadow };
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  if (/rgba\(0, 0, 0, 0\)|transparent/.test(look.bg)) return `the panel background is ${look.bg}`;
  return look.shadow && look.shadow !== 'none' ? true : 'the panel has no shadow';
});

await check('and the chosen widths are remembered', async () => {
  await page.locator('.ed-vw__num').fill('1440');
  await page.locator('.ed-vw__num').blur();
  await page.waitForTimeout(350);

  await page.reload();
  await page.waitForSelector('.ed-root');
  await page.waitForTimeout(500);

  const shown = Number(await page.locator('.ed-vw__num').inputValue());
  return shown === 1440 ? true : `after reloading it says ${shown}px`;
});

await check('the preview really is too narrow to be a desktop, before folding', async () => {
  // Back to the defaults, because the width checks above deliberately leave a
  // custom one behind and the folding maths below is about the standard 1200.
  await page.evaluate(() => {
    window.localStorage.removeItem('tg-sites:viewports:v1');
    window.localStorage.removeItem('tg-sites:panels:v1');
  });
  await page.reload();
  await page.waitForSelector('.ed-root');
  await page.waitForTimeout(400);

  // If this stops being true the checks below prove nothing, so it is asserted
  // rather than assumed.
  const room = await canvasRoom();
  return room < 1200
    ? true
    : `there is already ${room}px of room for a 1200px preview, so folding changes nothing`;
});

await check('folding the page panel gives the room to the preview', async () => {
  const before = await canvasRoom();
  await page.locator('.ed-btn[aria-label="Hide the page panel"]').click();
  await page.waitForTimeout(400);
  const after = await canvasRoom();

  return after >= before + 300
    ? true
    : `the room went from ${before}px to ${after}px`;
});

await check('folding the settings panel too gives the rest', async () => {
  const before = await canvasRoom();
  await page.locator('.ed-btn[aria-label="Hide the settings panel"]').click();
  await page.waitForTimeout(400);
  const after = await canvasRoom();

  return after >= before + 300 ? true : `the room went from ${before}px to ${after}px`;
});

/*
 * WHAT FOLDING IS FOR, now that the preview has a width of its own: seeing all
 * of it at once instead of scrolling sideways to find the right-hand column.
 */
await check('and the whole preview fits without scrolling sideways', async () => {
  const fits = await page.evaluate(() => {
    const wrap = document.querySelector('.ed-canvas-wrap');
    const frame = document.querySelector('.ed-canvas-frame');
    return {
      room: wrap.clientWidth,
      preview: Math.round(frame.getBoundingClientRect().width),
    };
  });
  return fits.room >= fits.preview
    ? true
    : `a ${fits.preview}px preview in ${fits.room}px of room`;
});

/*
 * The way back has to be somewhere that does not depend on the panel being open,
 * which is why both live in the top bar rather than on the panels themselves.
 */
await check('both can be brought back from the top bar', async () => {
  await page.locator('.ed-btn[aria-label="Show the page panel"]').click();
  await page.locator('.ed-btn[aria-label="Show the settings panel"]').click();
  await page.waitForTimeout(400);

  const outline = await page.locator('.ed-outline').isVisible();
  const props = await page.locator('.ed-props').isVisible();
  return outline && props ? true : `outline ${outline}, settings ${props}`;
});

await check('which way they are folded is remembered', async () => {
  await page.locator('.ed-btn[aria-label="Hide the page panel"]').click();
  await page.waitForTimeout(300);

  await page.reload();
  await page.waitForSelector('.ed-root');
  await page.waitForTimeout(500);

  const outline = await page.locator('.ed-outline').isVisible();
  const props = await page.locator('.ed-props').isVisible();
  return outline === false && props === true
    ? true
    : `after reloading: outline ${outline}, settings ${props}`;
});

/*
 * THE ONE ANDY ASKED FOR. Desktop makes room for itself.
 */
await check('Desktop folds the panels when the preview is too narrow to be one', async () => {
  await page.evaluate(() => window.localStorage.removeItem('tg-sites:panels:v1'));
  await page.reload();
  await page.waitForSelector('.ed-root');
  await page.waitForTimeout(500);

  const before = await canvasRoom();
  if (before >= 1200) return `there is already ${before}px of room, so there is nothing to make`;

  await page.locator('.ed-btn', { hasText: 'Tablet' }).click();
  await page.waitForTimeout(300);
  await page.locator('.ed-btn', { hasText: 'Desktop' }).click();
  await page.waitForTimeout(500);

  const after = await canvasRoom();
  return after >= 1200
    ? true
    : `there is ${after}px of room after pressing Desktop, up from ${before}px`;
});

await check('and only folds, never reopens one somebody closed', async () => {
  // Both are folded from the check above. Pressing Desktop again must leave
  // them alone rather than treating "wide enough" as "put them back".
  await page.locator('.ed-btn', { hasText: 'Phone' }).click();
  await page.waitForTimeout(300);
  await page.locator('.ed-btn', { hasText: 'Desktop' }).click();
  await page.waitForTimeout(400);

  const outline = await page.locator('.ed-outline').isVisible();
  const props = await page.locator('.ed-props').isVisible();
  return outline === false && props === false
    ? true
    : `outline ${outline}, settings ${props}`;
});

await check('the fold controls meet the 44px rule', async () => {
  const small = await page.evaluate(() => {
    const out = [];
    for (const button of document.querySelectorAll('.ed-topbar .ed-btn[aria-label*="panel"]')) {
      const box = button.getBoundingClientRect();
      if (box.height < 44 || box.width < 44) {
        out.push(`${button.getAttribute('aria-label')}: ${Math.round(box.width)}x${Math.round(box.height)}`);
      }
    }
    return out;
  });
  return small.length === 0 ? true : `too small: ${small.join(', ')}`;
});

// ---------------------------------------------------------------------------
// The widget blocks
//
// THE CLAIM WORTH CHECKING IN A BROWSER IS A NEGATIVE ONE: the editor must not
// run anybody's widget. Not ours, because re-initialising a widget on every
// keystroke would thrash the canvas and hammer the config API, and not a third
// party's, because their analytics should not count an editing session as
// traffic on the client's site.
//
// That is a claim about what is ABSENT from the document, which no unit test can
// make. What the published page renders is covered in tests/content.test.ts,
// where the sandbox tokens and the script URL construction live.
// ---------------------------------------------------------------------------

await page.reload();
await page.waitForSelector('.ed-root');
await showPanels();

/** Add a block by its name in the picker, into the first section. */
async function addBlock(name) {
  await openBlockPicker();
  await page.locator('.ed-block-card', { hasText: name }).first().click();
  await page.waitForTimeout(500);
}

/*
 * SCOPED TO THE BLOCK THAT WAS JUST ADDED, via .is-selected.
 *
 * The first version used .tgs-placeholder last(), which found the seed page's
 * own image placeholder and reported 'it says "Choose an image"'. Adding a block
 * selects it, so the selection is the reliable handle, and it also means the
 * check above cannot pass on placeholders that were already there.
 */
const added = () => page.locator('.ed-canvas-frame [data-path].is-selected');

await check('a Travelgenix widget starts by asking which widget', async () => {
  await addBlock('Travelgenix widget');
  const here = added();
  if ((await here.count()) !== 1) return `${await here.count()} blocks selected after adding`;
  // No default kind now, so it says "Choose a widget" rather than silently
  // building an Opening Hours one, which is the bug this replaces.
  const text = await here.locator('.tgs-placeholder').first().innerText().catch(() => '');
  return /choose a widget/i.test(text) ? true : `it says "${text}"`;
});

await check('picking a widget and an ID renders it live in a frame', async () => {
  await page.locator('.ed-props select').first().selectOption('hours');
  await page.locator('.ed-props input.ed-input').last().fill('tgw_verify123');
  await page.waitForTimeout(500);
  const frame = added().locator('.tgs-widget-frame iframe');
  if ((await frame.count()) !== 1) return `${await frame.count()} widget frames on the canvas`;
  const doc = (await frame.getAttribute('srcdoc')) ?? '';
  if (!/data-tg-widget="hours"/.test(doc)) return 'the chosen widget is not in the frame';
  if (!/tgw_verify123/.test(doc)) return 'the id is not in the frame';
  return /widget-hours\.js/.test(doc) ? true : 'the widget script is not in the frame';
});

/*
 * THE ONE THAT MATTERS, INVERTED. The widget is live on the canvas now, but it
 * runs in ITS OWN document. So the editor page itself must still load no widget
 * script and draw no widget container: that isolation is the whole reason a
 * widget can be live on the canvas without thrashing the editor on every redraw.
 */
await check("and the widget's script stays in the frame, off the editor page", async () => {
  const leaked = await page.evaluate(() => ({
    scripts: [...document.querySelectorAll('script[src]')]
      .map((s) => s.getAttribute('src'))
      .filter((src) => /travelify|widget-/.test(src ?? '')),
    containers: document.querySelectorAll('[data-tg-widget]').length,
  }));
  if (leaked.scripts.length) return `the editor page loaded ${JSON.stringify(leaked.scripts)}`;
  return leaked.containers === 0 ? true : `${leaked.containers} live containers on the editor page`;
});

await check("somebody else's widget can be put on a page too", async () => {
  await addBlock('Embedded widget');
  const text = await added().locator('.tgs-placeholder').first().innerText().catch(() => '');
  return /paste the code/i.test(text) ? true : `it says "${text}"`;
});

/*
 * It renders live on the canvas now, but SEALED. The code runs in a sandboxed
 * frame at an opaque origin, so it can draw in its own box and nothing more:
 * reaching for the editor's window throws, and the flag it tries to set on the
 * parent never appears.
 */
await check('and a sealed embed renders on the canvas without reaching the editor', async () => {
  const field = page.locator('.ed-props textarea').last();
  await field.fill('<script>try{window.parent.__TG_EMBED_RAN__=true}catch(e){}</script><p>hello</p>');
  await page.waitForTimeout(600);
  const frames = await added().locator('.tgs-embed-widget iframe').count();
  const reached = await page.evaluate(() => Boolean(window.__TG_EMBED_RAN__));
  if (frames < 1) return 'the sealed widget did not render on the canvas';
  return !reached ? true : 'the sealed code reached the editor window';
});

/*
 * A FIELD LABEL NAMES AND FOCUSES ITS CONTROL.
 *
 * The properties pane drew a bare <label> beside each field, tied to nothing, so
 * a click focused nothing and a screen reader read the box as unlabelled
 * (Fields.tsx, the Wrapper). Every field renderer is associated now: a single box
 * by htmlFor, so the label focuses it; a grouped control (a colour, an image
 * chooser) by role=group and aria-labelledby on the field, so it names itself.
 * The image block carries one of each in its content, the alt box and the picker.
 */
await check('a properties field label names and focuses its control', async () => {
  await addBlock('Image');
  await page.waitForTimeout(200);

  // The single box: its label points at exactly one real control, and clicking
  // the label moves focus there.
  const label = page.locator('.ed-props label.ed-label[for]').first();
  if ((await label.count()) === 0) return 'no field label is tied to a control';
  const forId = await label.getAttribute('for');
  const control = page.locator(`.ed-props [id="${forId}"]`);
  if ((await control.count()) !== 1) return `the label points at "${forId}", not one control`;
  const tag = await control.evaluate((el) => el.tagName.toLowerCase());
  if (!['input', 'select', 'textarea'].includes(tag)) return `the label points at a <${tag}>`;
  await label.click();
  if (!(await control.evaluate((el) => el === document.activeElement)))
    return 'clicking the label did not focus its control';

  // The grouped control: the image field is a group that names itself by its own
  // label. Found VIA THAT LABEL, not via any [role=group], so the slides
  // repeater's own group cannot stand in for it and let this pass while the image
  // field's group is gone. The probe caught exactly that when this read the first
  // group it could find.
  const glabel = page.locator('.ed-props label.ed-label', { hasText: /^Image$/ }).first();
  if ((await glabel.count()) === 0) return 'the image field label is not in the pane';
  const gfield = glabel.locator('..');
  if ((await gfield.getAttribute('role')) !== 'group') return 'the image field is not a labelled group';
  const labelId = await glabel.getAttribute('id');
  const by = await gfield.getAttribute('aria-labelledby');
  return labelId && by === labelId ? true : `the group names "${by}", the label is "${labelId}"`;
});


// ---------------------------------------------------------------------------
// The inner container
//
// A CLAIM ONLY A BROWSER CAN SETTLE: that a container draws its two inner
// columns as real, empty drop targets, that a block added through an inner
// column's + lands INSIDE that column rather than the outer one, and that the
// picker refuses to offer a container inside a container. The tree maths is in
// tests/inner-container.test.ts; this is the wiring, end to end. Native HTML5
// drag is not scriptable in Playwright, so the click-to-add path stands in for
// the drag, which shares addBlockAt with it.
// ---------------------------------------------------------------------------

await page.reload();
await page.waitForSelector('.ed-root');
await showPanels();

await check('an inner container draws its two inner columns', async () => {
  await addBlock('Inner container');
  const here = added();
  if ((await here.count()) !== 1) return `${await here.count()} blocks selected after adding`;
  const cols = await here.locator('.tgs-inner-row > .tgs-col').count();
  return cols === 2 ? true : `${cols} inner columns drawn`;
});

await check('each inner column is an empty drop target with a +', async () => {
  const adders = await added().locator('.tgs-inner-row .ed-empty-col__add').count();
  return adders === 2 ? true : `${adders} add buttons across the inner columns`;
});

await check('the inner + refuses a container inside a container', async () => {
  await added().locator('.tgs-inner-row .ed-empty-col__add').first().click();
  await page.waitForSelector('.tg-modal', { timeout: 5000 });
  const offered = await page.locator('.ed-block-card', { hasText: 'Inner container' }).count();
  return offered === 0 ? true : 'the picker offered a container inside a container';
});

await check('and picking a block there lands it inside the inner column', async () => {
  // Quote, because its name is unambiguous in the card list. The block lands at
  // an …k0i0 path: the first inner column's first block.
  await page.locator('.ed-block-card', { hasText: 'Quote' }).first().click();
  await page.waitForTimeout(400);
  const inner = await page.locator('.ed-canvas-frame [data-path$="k0i0"]').count();
  return inner > 0 ? true : 'no block landed at an inner-column path';
});

// --- slice 2: the inner nodes are first-class ------------------------------

await check('the block added inside a container selects itself, not the container', async () => {
  // addBlockAt selects the new inner block, so its pane opens as it would for a
  // block added to any column.
  const sel = await page.locator('.ed-canvas-frame [data-path$="k0i0"].is-selected').count();
  return sel === 1 ? true : `${sel} inner blocks selected`;
});

await check('its contextual toolbar names it by what it is', async () => {
  const label = await page.locator('.ed-bar__label').first().innerText();
  return /quote/i.test(label) ? true : `the toolbar says "${label}"`;
});

await check('and deleting it through that toolbar empties the inner column', async () => {
  await page.locator('.ed-bar__btn[aria-label="Delete"]').first().click();
  await page.waitForTimeout(300);
  const still = await page.locator('.ed-canvas-frame [data-path$="k0i0"]').count();
  return still === 0 ? true : 'the inner block is still there';
});

await check('a text block inside a container is typed into in place', async () => {
  // A fresh container, a Text into its first inner column, and the block that
  // lands is taken over as the editing host, contentEditable, exactly as a text
  // block in an ordinary column is.
  await page.reload();
  await page.waitForSelector('.ed-root');
  await showPanels();
  await addBlock('Inner container');
  await added().locator('.tgs-inner-row .ed-empty-col__add').first().click();
  await page.waitForSelector('.tg-modal', { timeout: 5000 });
  await page.locator('.ed-block-card', { hasText: 'Text' }).first().click();
  await page.waitForTimeout(500);
  const editable = await page
    .locator('.ed-canvas-frame [data-path$="k0i0"] [data-rt-host]')
    .first()
    .getAttribute('contenteditable');
  return editable === 'true' ? true : `contenteditable is ${editable}`;
});

// --- slice 3: resize, manage columns, and the outline ----------------------

await check('a container shows a resize handle between its inner columns', async () => {
  await page.reload();
  await page.waitForSelector('.ed-root');
  await showPanels();
  await addBlock('Inner container');
  // Two columns, one boundary, one handle (the last column has none).
  const handles = await added().locator('.tgs-inner-row > .tgs-col .ed-resize').count();
  return handles === 1 ? true : `${handles} inner resize handles`;
});

await check('the pane adds a third inner column and can even them', async () => {
  // The container is selected, so its pane carries the inner-column control.
  await page.locator('.ed-props button', { hasText: '+ Column' }).first().click();
  await page.waitForTimeout(300);
  const cols = await added().locator('.tgs-inner-row > .tgs-col').count();
  return cols === 3 ? true : `${cols} inner columns after adding`;
});

await check('the outline lists a container’s inner blocks', async () => {
  // Drop a block into the container, then find it nested in the outline. The
  // section auto-opens because selecting the inner block reveals it.
  await added().locator('.tgs-inner-row .ed-empty-col__add').first().click();
  await page.waitForSelector('.tg-modal', { timeout: 5000 });
  await page.locator('.ed-block-card', { hasText: 'Quote' }).first().click();
  await page.waitForTimeout(400);
  const nested = await page.locator('.ed-outline .ed-subitem').count();
  return nested > 0 ? true : 'no nested inner block in the outline';
});


// ---------------------------------------------------------------------------
// The location map
//
// The claim a browser settles: that a map draws from an address on the CANVAS,
// not only when published (Andy asked to see it while building, 7 Aug 2026), and
// that the canvas frame is inert so a click still selects the block. The address
// commits on Enter, blur or a picked match, never per keystroke, which is what
// keeps the frame from reloading on every letter. The URL safety is in
// tests/map.test.ts, the search parsing in tests/geocode.test.ts.
// ---------------------------------------------------------------------------

await page.reload();
await page.waitForSelector('.ed-root');
await showPanels();

await check('a map starts by asking for an address', async () => {
  await addBlock('Map');
  const here = added();
  if ((await here.count()) !== 1) return `${await here.count()} blocks selected after adding`;
  const text = await here.locator('.tgs-placeholder').first().innerText().catch(() => '');
  return /address/i.test(text) ? true : `it says "${text}"`;
});

await check('an address draws a real map frame on the canvas', async () => {
  const input = page.locator('.ed-props .ed-place input.ed-input').first();
  await input.fill('10 Downing Street, London');
  // Enter commits the address; the field does not commit on every keystroke.
  await input.press('Enter');
  await page.waitForTimeout(600);
  const frame = added().locator('.tgs-map__frame iframe');
  if ((await frame.count()) !== 1) return `${await frame.count()} map frames on the canvas`;
  const src = (await frame.getAttribute('src')) ?? '';
  if (!/google\.[^/]*\/maps/.test(src)) return `the frame is not a Google map: "${src}"`;
  return /downing/i.test(src) ? true : `the address is not in the frame src: "${src}"`;
});

await check('and that canvas frame is inert, so a click still selects the block', async () => {
  const events = await added()
    .locator('.tgs-map__frame iframe')
    .first()
    .evaluate((el) => getComputedStyle(el).pointerEvents);
  return events === 'none' ? true : `pointer-events is "${events}"`;
});


// ---------------------------------------------------------------------------
// Before and after
//
// A pure-CSS reveal: the after picture is the base, the before sits over it in a
// resizable box, and the before image is sized to the whole frame so it clips
// rather than squashes. The URL safety rides on the image field (proven above);
// what a browser settles here is that both pictures land, the box opens at the
// start position, and the before image really is frame-wide inside its box.
// ---------------------------------------------------------------------------

await page.reload();
await page.waitForSelector('.ed-root');
await showPanels();

await check('before and after starts by asking for both photos', async () => {
  await addBlock('Before & After');
  const text = await added().locator('.tgs-placeholder').first().innerText().catch(() => '');
  return /before and an after/i.test(text) ? true : `it says "${text}"`;
});

await check('both photos land, the before revealing over the after at the halfway start', async () => {
  // Two image fields, before then after. Each hides its web-address box behind a
  // toggle, so open every toggle in the pane, then fill the first two boxes.
  const toggles = page.locator('.ed-props .mp-url__toggle');
  const toggleCount = await toggles.count();
  for (let i = 0; i < toggleCount; i += 1) await toggles.nth(i).click();
  const boxes = page.locator('.ed-props .mp-url .ed-input');
  await boxes.nth(0).fill('https://images.example.test/before.jpg');
  await boxes.nth(1).fill('https://images.example.test/after.jpg');
  await page.waitForTimeout(400);

  const imgs = added().locator('.tgs-ba .tgs-ba__img');
  if ((await imgs.count()) !== 2) return `${await imgs.count()} images on the canvas`;
  if ((await added().locator('.tgs-ba__reveal .tgs-ba__img--before').count()) !== 1) {
    return 'the before picture is not in the reveal box';
  }

  // The reveal opens at the halfway start: about half the frame wide.
  const ratio = await added().locator('.tgs-ba').first().evaluate((frame) => {
    const reveal = frame.querySelector('.tgs-ba__reveal');
    return reveal.getBoundingClientRect().width / frame.getBoundingClientRect().width;
  });
  return Math.abs(ratio - 0.5) < 0.08 ? true : `the reveal is ${(ratio * 100).toFixed(0)}% wide`;
});

await check('the before image is sized to the whole frame, not the narrow box', async () => {
  // 100cqw: the before picture is as wide as the frame though its box is half
  // that, which is what stops it squashing. So it is wider than the box clipping it.
  const info = await added().locator('.tgs-ba').first().evaluate((frame) => {
    const box = frame.querySelector('.tgs-ba__reveal');
    const img = frame.querySelector('.tgs-ba__img--before');
    return { box: box.getBoundingClientRect().width, img: img.getBoundingClientRect().width };
  });
  return info.img > info.box * 1.5 ? true : `image ${Math.round(info.img)}px vs box ${Math.round(info.box)}px`;
});


// ---------------------------------------------------------------------------
// The testimonial slider
//
// A pure-CSS scroll-snap rail, the same the slider uses, and stars that are
// drawn rather than typed. A browser settles two things: the block arrives with
// example reviews and a full five stars, and the cards sit on a scrolling rail
// rather than stacking. The registry is pinned in tests/testimonials.test.ts.
// ---------------------------------------------------------------------------

await page.reload();
await page.waitForSelector('.ed-root');
await showPanels();

await check('a testimonial slider arrives with example reviews on a rail', async () => {
  await addBlock('Testimonial slider');
  const count = await added().locator('.tgs-tsl__card').count();
  if (count !== 3) return `${count} testimonial cards`;
  const stars = await added().locator('.tgs-tsl__card').first().locator('.tgs-tsl__star[data-on="true"]').count();
  return stars === 5 ? true : `${stars} filled stars on the first card`;
});

await check('the testimonial slider offers a text colour and a card colour', async () => {
  // The gap Andy hit: a text-bearing block with no way to recolour the words or
  // the cards. Both are colour fields now, in the Colours section.
  await openPaneGroup('Colours');
  const labels = (await page.locator('.ed-props .ed-label').allInnerTexts()).map((label) => label.trim().toLowerCase());
  return labels.includes('text colour') && labels.includes('card colour')
    ? true
    : `Colours offers: ${labels.join(', ')}`;
});

await check('the testimonials sit on a scrolling rail, not stacked', async () => {
  const overflow = await added().locator('.tgs-tsl__track').first().evaluate((el) => getComputedStyle(el).overflowX);
  if (!/auto|scroll/.test(overflow)) return `overflow-x is "${overflow}"`;
  // The first two cards share a row and run left to right.
  const laid = await added().locator('.tgs-tsl__card').evaluateAll((cards) => {
    const a = cards[0].getBoundingClientRect();
    const b = cards[1].getBoundingClientRect();
    return { sameRow: Math.abs(a.top - b.top) < 2, inOrder: b.left > a.left };
  });
  return laid.sameRow && laid.inOrder ? true : `sameRow ${laid.sameRow}, inOrder ${laid.inOrder}`;
});


// ---------------------------------------------------------------------------
// Audio
//
// The browser's own <audio controls>, no script. A browser settles that a link
// becomes a native player and that it does not preload, so neither the editor
// redrawing nor a visitor loading the page fetches the file until play.
// ---------------------------------------------------------------------------

await page.reload();
await page.waitForSelector('.ed-root');
await showPanels();

await check('audio starts by asking for a link', async () => {
  await addBlock('Audio');
  const text = await added().locator('.tgs-placeholder').first().innerText().catch(() => '');
  return /link to your audio/i.test(text) ? true : `it says "${text}"`;
});

await check('a link becomes a native player that does not preload', async () => {
  await page.locator('.ed-props input.ed-input').first().fill('https://audio.example.test/welcome.mp3');
  await page.waitForTimeout(300);
  const player = added().locator('audio.tgs-audio__player');
  if ((await player.count()) !== 1) return `${await player.count()} players on the canvas`;
  const info = await player.first().evaluate((el) => ({
    controls: el.hasAttribute('controls'),
    preload: el.getAttribute('preload'),
    src: el.getAttribute('src') || '',
  }));
  if (!info.controls) return 'the player has no controls';
  if (info.preload !== 'none') return `preload is "${info.preload}"`;
  return /welcome\.mp3/.test(info.src) ? true : `src is "${info.src}"`;
});


// ---------------------------------------------------------------------------
// Text colour on the content blocks (the fan-out)
//
// Andy's rule that any text element can be recoloured, carried to the blocks
// that were missing it. The field wiring is in tests/text-colour.test.ts; a
// browser settles that the control actually reaches the pane. Cards stands in
// for the four (cards, accordion, tabs, table) since they share the wiring.
// ---------------------------------------------------------------------------

await page.reload();
await page.waitForSelector('.ed-root');
await showPanels();

await check('a cards block offers a text colour', async () => {
  await addBlock('Cards');
  await openPaneGroup('Colours');
  const labels = (await page.locator('.ed-props .ed-label').allInnerTexts()).map((label) => label.trim().toLowerCase());
  return labels.includes('text colour') ? true : `Colours offers: ${labels.join(', ')}`;
});


// ---------------------------------------------------------------------------
// The menu, the header and the footer
//
// TWO CLAIMS THAT ONLY A BROWSER CAN SETTLE.
//
// The first is that the phone menu needs no JavaScript. It is a `details` and a
// `summary`, and the whole argument for that over a scripted burger is that the
// BROWSER opens it. Asserting on the markup in Node would prove the elements are
// there and prove nothing about whether clicking one does anything, which is the
// only part anybody cares about.
//
// The second is that the editor really does edit a header with the page's own
// controls minus the ones a header has no use for. That is a claim about which
// controls are ABSENT from a rendered screen, which no unit test can make.
//
// ONE TRAP, AND IT CAUGHT THE FIRST VERSION OF THIS SECTION. The canvas is the
// container query context, not the window, so "desktop" with both side panels
// open leaves it about 750px and the PHONE rules apply. Three checks reported
// the burger showing on a desktop and were reading a 750px canvas. The panels
// have to be folded to ask a question about a wide screen.
// ---------------------------------------------------------------------------

await page.reload();
await page.waitForSelector('.ed-root');
await showPanels();

/** Fold both side panels, so the canvas is as wide as the window allows. */
async function foldPanels() {
  for (const label of ['Hide the page panel', 'Hide the settings panel']) {
    const button = page.locator(`[aria-label="${label}"]`);
    if (await button.count()) {
      await button.click();
      await page.waitForTimeout(150);
    }
  }
}

await check('the menu is in the block picker', async () => {
  await openBlockPicker();
  const found = await page.locator('.ed-block-card', { hasText: 'Menu' }).count();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  return found >= 1 ? true : 'no Menu card';
});

await check('a menu draws its links straight away', async () => {
  await addBlock('Menu');
  const links = added().locator('.tgs-nav__link');
  const count = await links.count();
  // Four defaults, and they appear twice in the markup: once for a wide screen
  // and once inside the phone menu. Both come from the same array.
  return count === 8 ? true : `${count} links, expected 8`;
});

/*
 * textContent, not innerText. The narrow copy sits inside a closed `details`,
 * so it is not rendered and innerText correctly reports nothing for it. The
 * first version of this check read innerText and compared four labels against
 * four empty strings, which said nothing about the markup.
 */
await check('the two copies of the menu say the same thing', async () => {
  const [wide, narrow] = await added().evaluate((root) => {
    const text = (selector) =>
      [...root.querySelectorAll(selector)].map((node) => node.textContent.trim());
    return [
      text('.tgs-nav__list:not(.tgs-nav__list--stacked) .tgs-nav__link'),
      text('.tgs-nav__list--stacked .tgs-nav__link'),
    ];
  });

  return JSON.stringify(wide) === JSON.stringify(narrow) && wide.length === 4
    ? true
    : `${JSON.stringify(wide)} vs ${JSON.stringify(narrow)}`;
});

/*
 * ONE COPY IS ALWAYS HIDDEN, which is what makes the duplicate free.
 * `display: none` is not read out by a screen reader, so the links are
 * announced once however wide the screen is.
 */
await check('only one copy of the menu is showing at a time', async () => {
  await foldPanels();
  await page.waitForTimeout(300);
  const visible = await added().locator('.tgs-nav__link:visible').count();
  return visible === 4 ? true : `${visible} links visible, expected 4`;
});

await check('the menu button is hidden on a wide canvas', async () => {
  const shown = await added().locator('.tgs-nav__burger').isVisible();
  return shown === false ? true : 'the burger is showing on a desktop';
});

await check('and appears at a phone width', async () => {
  await page.getByRole('button', { name: 'Phone' }).click();
  await page.waitForTimeout(400);
  const burger = added().locator('.tgs-nav__burger');
  return (await burger.isVisible()) ? true : 'no menu button on a phone';
});

await check('the wide row gives way to it rather than both showing', async () => {
  const wide = added().locator('.tgs-nav__list[data-collapse="true"]');
  return (await wide.isVisible()) === false ? true : 'the row is still across the phone';
});

/*
 * THE ONE THIS SECTION EXISTS FOR. No handler was attached by anything: the
 * click goes to a `summary`, and the browser opens the `details` itself.
 */
await check('the menu button opens with no JavaScript behind it', async () => {
  const disclosure = added().locator('.tgs-nav__disclosure');
  const before = await disclosure.evaluate((el) => el.open);
  await added().locator('.tgs-nav__burger').click();
  await page.waitForTimeout(250);
  const after = await disclosure.evaluate((el) => el.open);
  const links = await added().locator('.tgs-nav__list--stacked .tgs-nav__link:visible').count();
  return before === false && after === true && links === 4
    ? true
    : `open ${before} -> ${after}, ${links} links showing`;
});

await check('and closes again on a second click', async () => {
  await added().locator('.tgs-nav__burger').click();
  await page.waitForTimeout(250);
  const open = await added().locator('.tgs-nav__disclosure').evaluate((el) => el.open);
  return open === false ? true : 'it stayed open';
});

await check('the menu button is reachable by keyboard', async () => {
  const disclosure = added().locator('.tgs-nav__disclosure');
  await added().locator('.tgs-nav__burger').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  const open = await disclosure.evaluate((el) => el.open);
  if (open) await page.keyboard.press('Enter');
  return open === true ? true : 'Enter did not open it';
});

// Back to a desktop width, panels open, for the region checks below.
await page.getByRole('button', { name: 'Desktop' }).click();
await page.waitForTimeout(300);
await showPanels();

// --- The header ------------------------------------------------------------
//
// A tenant that has never touched its header has no header, so this starts on
// an EMPTY one. That is the state a real client meets first, and it is also the
// only state in which the canvas root is easy to click, so the settings checks
// come before anything is added to it.

await check('the editor can be pointed at the header', async () => {
  await closeAnyDialog();
  await page.evaluate(() => window.__TG_SET_REGION__('header'));
  await page.waitForTimeout(600);
  await showPanels();
  const title = await page.locator('.ed-title-fixed').innerText();
  return title === 'Header' ? true : `the top bar says "${title}"`;
});

/*
 * NOT A DISABLED FIELD, GONE. pageAsRegion throws a title away, so a box holding
 * the word "Header" would take typing and lose it on the next reload with
 * nothing to explain why.
 */
await check('and there is no page title box to type into', async () =>
  (await page.locator('.ed-title-input').count()) === 0
    ? true
    : 'the page title box is still there');

await check('an empty header says what to put in it', async () => {
  const text = await page.locator('.ed-canvas-frame .tgs-placeholder').first().innerText();
  return /header is empty|logo and menu/i.test(text) ? true : `it says "${text}"`;
});

await check('its root offers the header settings instead of a page address', async () => {
  // The empty canvas IS the page root, so clicking it selects that.
  await page.locator('.ed-canvas-frame [data-path="page"]').click({ position: { x: 20, y: 20 } });
  await page.waitForTimeout(400);
  const pane = await page.locator('.ed-props').innerText();
  const wanted = /Stay on screen while scrolling/.test(pane)
    && /Sit over the first section/.test(pane);
  const unwanted = /Search description/.test(pane) || /Slug/.test(pane);
  return wanted && !unwanted ? true : `wanted ${wanted}, page fields present ${unwanted}`;
});

await check('turning on sticky is a change worth saving', async () => {
  await page.locator('.ed-props input[type="checkbox"]').first().check();
  await page.waitForTimeout(1500);
  const state = await page.locator('.ed-save').getAttribute('data-state');
  const failure = await page.locator('.ed-savefail').count();
  // The double validates through the real parseRegion, so "saved" means the
  // tree it was handed really was a region the database would have taken.
  return state === 'saved' && failure === 0 ? true : `save state "${state}"`;
});

await check('version history is not offered for a header', async () => {
  await closeAnyDialog();
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.waitForTimeout(300);
  const items = (await page.locator('.ed-menu').innerText()).replace(/\n/g, ' | ');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  return /Version history/.test(items) === false
    ? true
    : 'it offers a history a region does not keep';
});

await check('publishing a header says it will reach every page', async () => {
  const title = await page.locator('.ed-btn[data-variant="primary"]').getAttribute('title');
  return /every page/i.test(title ?? '') ? true : `it says "${title}"`;
});

/*
 * AN EMPTY SHAPE STILL WORKS ON A HEADER, which is the point of this one: a
 * region is sections and rows like anything else, so nothing about the header
 * screen should take the Layouts tab away.
 *
 * The tab is clicked explicitly since 1 Aug 2026, and that is not the check
 * working around a bug. The picker now OPENS on Designed for a header, because
 * a client is on that screen once, at the start, and an empty two-column row is
 * not what they came for. Layouts is still there, one click away, and this
 * proves it.
 */
await check('a section can be added to a header like any other', async () => {
  await page.locator('.ed-outline-foot .ed-btn').click();
  await page.waitForTimeout(400);
  await page.locator('.ed-tab', { hasText: 'Layouts' }).click();
  await page.waitForTimeout(300);
  await page.locator('.ed-layout-card').first().click();
  await page.waitForTimeout(500);
  return (await page.locator('.ed-canvas-frame .tgs-section').count()) === 1
    ? true
    : 'no section appeared';
});

await check('the header offers the same blocks a page does', async () => {
  await openBlockPicker();
  const count = await page.locator('.ed-block-card').count();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  // The whole library, because a header is sections and rows like anything else.
  // The same 31 the page picker offers a staff user, the three new media included.
  return count === 31 ? true : `${count} blocks in the header picker`;
});

await check('a menu in a header saves through the region actions', async () => {
  await addBlock('Menu');
  await page.waitForTimeout(1500);
  const state = await page.locator('.ed-save').getAttribute('data-state');
  const failure = await page.locator('.ed-savefail').count();
  return state === 'saved' && failure === 0 ? true : `save state "${state}"`;
});

// --- The footer ------------------------------------------------------------

await check('the editor can be pointed at the footer', async () => {
  await closeAnyDialog();
  await page.evaluate(() => window.__TG_SET_REGION__('footer'));
  await page.waitForTimeout(600);
  await showPanels();
  const title = await page.locator('.ed-title-fixed').innerText();
  return title === 'Footer' ? true : `the top bar says "${title}"`;
});

/*
 * Sticky and overlay are both about a bar at the top of the screen. A footer
 * pinned to the top of the window is not a footer, so the toggles are not there
 * to be ticked rather than there and ignored.
 */
await check('a footer is not offered the two header settings', async () => {
  await page.locator('.ed-canvas-frame [data-path="page"]').click({ position: { x: 20, y: 20 } });
  await page.waitForTimeout(400);
  const pane = await page.locator('.ed-props').innerText();
  return /Stay on screen|Sit over the first/.test(pane) === false
    ? true
    : 'a footer is offered a header setting';
});

await check('going back to a page brings the title box back', async () => {
  await page.evaluate(() => window.__TG_SET_REGION__(null));
  await page.waitForTimeout(600);
  const boxes = await page.locator('.ed-title-input').count();
  const fixed = await page.locator('.ed-title-fixed').count();
  return boxes === 1 && fixed === 0 ? true : `${boxes} boxes, ${fixed} labels`;
});


// ---------------------------------------------------------------------------
// Cards
//
// THE CLAIM THIS BLOCK MAKES IS A MEASUREMENT, which is why it belongs here
// rather than in Node. A grid promises that the cards line up: same height, same
// picture shape, however different their words are. That is a fact about laid-out
// pixels and there is no way to assert it without a browser doing the laying out.
//
// The other claim is that the whole card is clickable while still being ONE link.
// Node can read the markup and the CSS; only a browser can say what is actually
// under the pointer at the corner of a card.
// ---------------------------------------------------------------------------

await page.reload();
await page.waitForSelector('.ed-root');
await showPanels();

await check('Cards is in the block picker', async () => {
  await openBlockPicker();
  const found = await page.locator('.ed-block-card', { hasText: 'Cards' }).count();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  return found >= 1 ? true : 'no Cards card';
});

await check('a card grid arrives with real cards in it', async () => {
  await addBlock('Cards');
  const cards = await added().locator('.tgs-card').count();
  // Three, with words in them. An empty grid of grey rectangles would leave
  // somebody guessing what the block is for.
  const titles = await added().locator('.tgs-card__title').allInnerTexts();
  return cards === 3 && titles.every((t) => t.trim().length > 0)
    ? true
    : `${cards} cards, titles ${JSON.stringify(titles)}`;
});

await check('each card holds exactly one link', async () => {
  const perCard = await added().evaluate((root) =>
    [...root.querySelectorAll('.tgs-card')].map((card) => card.querySelectorAll('a').length));
  // Zero here, because the default cards have link text and no address yet, and
  // a link with nowhere to go is not rendered. Never two, which is the failure
  // that wrapping the card in an anchor would produce.
  return perCard.every((count) => count <= 1)
    ? true
    : `anchors per card: ${JSON.stringify(perCard)}`;
});

/*
 * THE GRID'S CENTRAL PROMISE, MEASURED. The three default cards carry text of
 * three different lengths. If a card sized itself to its own words, this is the
 * check that catches it.
 */
await check('cards in a row are all the same height', async () => {
  await foldPanels();
  await page.waitForTimeout(300);

  const heights = await added().evaluate((root) =>
    [...root.querySelectorAll('.tgs-card')].map((card) => Math.round(card.getBoundingClientRect().height)));

  const spread = Math.max(...heights) - Math.min(...heights);
  return spread === 0 ? true : `heights ${JSON.stringify(heights)}, spread ${spread}px`;
});

await check('and their pictures are all the same shape', async () => {
  const frames = await added().evaluate((root) =>
    [...root.querySelectorAll('.tgs-card__frame')].map((frame) => {
      const box = frame.getBoundingClientRect();
      return Math.round((box.width / box.height) * 100) / 100;
    }));

  const spread = Math.max(...frames) - Math.min(...frames);
  // 4:3 by default, and all of them, because a grid whose pictures differ is
  // the exact mess this block exists to prevent.
  return spread < 0.02 && Math.abs(frames[0] - 4 / 3) < 0.05
    ? true
    : `ratios ${JSON.stringify(frames)}`;
});

/*
 * THE WHOLE CARD IS CLICKABLE, asked of the browser rather than of the CSS.
 * elementFromPoint at the corner of a card returns whatever would receive the
 * click there, and with the covering pseudo-element that is the anchor.
 */
await check('the whole card takes the click, through one link', async () => {
  // Give the first card somewhere to go, since a link with no address is not
  // rendered at all.
  await added().locator('.tgs-card').first().click();
  await page.waitForTimeout(300);
  await showPanels();
  const address = page.locator('.ed-props input').filter({ hasNot: page.locator('[type=checkbox]') });
  const href = page.locator('.ed-props input[placeholder*="greece" i]').first();
  await href.fill('/greece');
  await page.waitForTimeout(700);
  void address;

  const hit = await page.locator('.ed-canvas-frame .tgs-card').first().evaluate((card) => {
    const box = card.getBoundingClientRect();
    // Ten pixels in from the top-left, which is picture, not link text.
    const el = document.elementFromPoint(box.left + 10, box.top + 10);
    return el ? el.className || el.tagName : 'nothing';
  });

  return /tgs-card__link/.test(String(hit))
    ? true
    : `the corner of the card belongs to "${hit}"`;
});

await check('turning that off gives the corner back to the picture', async () => {
  const toggle = page.locator('.ed-props input[type="checkbox"]').last();
  await toggle.uncheck();
  await page.waitForTimeout(700);

  const hit = await page.locator('.ed-canvas-frame .tgs-card').first().evaluate((card) => {
    const box = card.getBoundingClientRect();
    const el = document.elementFromPoint(box.left + 10, box.top + 10);
    return el ? el.className || el.tagName : 'nothing';
  });

  const back = !/tgs-card__link/.test(String(hit));
  await toggle.check();
  await page.waitForTimeout(500);
  return back ? true : `still the link: "${hit}"`;
});

await check('nothing inside a card is wider than the card', async () => {
  // The open bug on images (task #61) is that one can render wider than the
  // thing holding it. A card grid must not be able to join in.
  const overflow = await added().evaluate((root) =>
    [...root.querySelectorAll('.tgs-card')].flatMap((card) => {
      const outer = card.getBoundingClientRect();
      return [...card.querySelectorAll('*')]
        .map((child) => Math.round(child.getBoundingClientRect().right - outer.right))
        .filter((over) => over > 1);
    }));

  return overflow.length === 0 ? true : `${overflow.length} things stick out, by ${overflow}px`;
});

/*
 * NOT A `select`, AND THE FIRST VERSION OF THIS CHECK ASSUMED IT WAS. A select
 * field with four or fewer options renders as segmented buttons (see Fields.tsx),
 * so `.ed-props select` found the six-option gap field instead, selectOption('4')
 * threw, and a `.catch(() => {})` swallowed it. The check then reported "3 across,
 * then 3" and read as a CSS failure. There is no catch here now: if the control
 * moves, this fails loudly and says so.
 */
await check('four across becomes fewer on a tablet', async () => {
  // The control needs the pane open; the measurement needs it shut. The canvas
  // is the query container, so a "desktop" with both panels showing is about
  // 750px and answers to the PHONE rules. Reading `wide` before folding is how
  // the first run of this reported "1 across, then 1".
  await showPanels();
  // "Across" is in the Layout section now, shut by default; open it first.
  await openPaneGroup('Layout');
  await page.locator('[role="group"][aria-label="Across"] button', { hasText: 'Four' }).click();
  await page.waitForTimeout(400);

  await page.getByRole('button', { name: 'Desktop' }).click();
  await foldPanels();
  await page.waitForTimeout(400);

  const wide = await added().evaluate((root) =>
    getComputedStyle(root.querySelector('.tgs-cards')).gridTemplateColumns.split(' ').length);

  // 834px, which sits between the two container breakpoints on purpose.
  await page.getByRole('button', { name: 'Tablet' }).click();
  await page.waitForTimeout(500);

  const narrow = await added().evaluate((root) =>
    getComputedStyle(root.querySelector('.tgs-cards')).gridTemplateColumns.split(' ').length);

  return wide === 4 && narrow === 2 ? true : `${wide} across, then ${narrow}`;
});

await check('and one across on a phone', async () => {
  await page.getByRole('button', { name: 'Phone' }).click();
  await page.waitForTimeout(500);

  const columns = await added().evaluate((root) =>
    getComputedStyle(root.querySelector('.tgs-cards')).gridTemplateColumns.split(' ').length);

  return columns === 1 ? true : `${columns} across on a phone`;
});

// Back to a desktop width, panels open, for anything that follows.
await page.getByRole('button', { name: 'Desktop' }).click();
await page.waitForTimeout(300);
await showPanels();



// ---------------------------------------------------------------------------
// Accordion and Tabs
//
// BOTH CLAIM THE BROWSER DOES THE OPENING, and a claim about what a browser does
// can only be settled by a browser. Node can read a `name` attribute off a
// details element; it cannot tell you the second panel shut when the third was
// clicked, which is the entire behaviour anybody is buying.
// ---------------------------------------------------------------------------

await page.reload();
await page.waitForSelector('.ed-root');
await showPanels();

await check('both are in the block picker', async () => {
  await openBlockPicker();
  const cards = (await page.locator('.ed-block-card').allInnerTexts()).join(' | ');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const accordion = /Accordion/.test(cards);
  const tabs = /Tabs/.test(cards);
  return accordion && tabs ? true : `accordion ${accordion}, tabs ${tabs}`;
});

// --- Accordion -------------------------------------------------------------

await check('an accordion arrives with sections in it, all shut', async () => {
  await addBlock('Accordion');
  const items = await added().locator('.tgs-accordion__item').count();
  const open = await added().locator('.tgs-accordion__item[open]').count();
  return items === 3 && open === 0 ? true : `${items} sections, ${open} open`;
});

await check('the words under a shut section are not on the screen', async () => {
  const visible = await added().locator('.tgs-accordion__body:visible').count();
  return visible === 0 ? true : `${visible} bodies showing`;
});

/*
 * THE ONE THIS SECTION EXISTS FOR. Nothing attached a handler: the click goes to
 * a summary and the browser opens the details itself.
 */
await check('clicking a heading opens it, with no JavaScript behind it', async () => {
  await added().locator('.tgs-accordion__head').first().click();
  await page.waitForTimeout(300);

  const open = await added().locator('.tgs-accordion__item[open]').count();
  const words = await added().locator('.tgs-accordion__body:visible').count();
  return open === 1 && words === 1 ? true : `${open} open, ${words} bodies showing`;
});

/*
 * AND THE BROWSER CLOSES THE LAST ONE, because of the `name` attribute and
 * nothing else. This is the check that would catch that attribute being dropped
 * in a tidy-up, which is otherwise completely silent.
 */
await check('opening a second one closes the first, which is what the name does', async () => {
  await added().locator('.tgs-accordion__head').nth(1).click();
  await page.waitForTimeout(300);

  const open = await added().evaluate((root) =>
    [...root.querySelectorAll('.tgs-accordion__item')].map((item) => item.open));

  return JSON.stringify(open) === JSON.stringify([false, true, false])
    ? true
    : `open states ${JSON.stringify(open)}`;
});

await check('a heading is reachable by keyboard and opens on Enter', async () => {
  const third = added().locator('.tgs-accordion__head').nth(2);
  await third.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);

  const open = await added().locator('.tgs-accordion__item').nth(2).evaluate((el) => el.open);
  return open ? true : 'Enter did not open it';
});

await check('there is one control per heading, not a triangle beside a chevron', async () => {
  const marker = await added().locator('.tgs-accordion__head').first().evaluate((el) =>
    getComputedStyle(el).listStyleType);
  const chevrons = await added().locator('.tgs-accordion__mark').count();
  return marker === 'none' && chevrons === 3 ? true : `marker "${marker}", ${chevrons} chevrons`;
});

// --- Tabs ------------------------------------------------------------------

await check('tabs arrive with the first one open and the rest shut', async () => {
  await showPanels();
  await addBlock('Tabs');
  await foldPanels();
  await page.waitForTimeout(300);

  const headings = await added().locator('.tgs-tabs__tab').count();
  const panels = await added().locator('.tgs-tabs__panel:visible').count();
  return headings === 3 && panels === 1 ? true : `${headings} headings, ${panels} panels showing`;
});

/*
 * THE PAIRING, MEASURED. The first version of this stylesheet used
 * :nth-of-type, which counts by element type: the headings list is a div too,
 * so every panel sat one place along from the rule that was meant to show it and
 * the first tab opened nothing. This is the check that would have caught it.
 */
await check('the panel showing is the one belonging to the open heading', async () => {
  const shown = await added().evaluate((root) => {
    const panel = [...root.querySelectorAll('.tgs-tabs__panel')]
      .find((node) => getComputedStyle(node).display !== 'none');
    return panel ? panel.getAttribute('data-index') : 'none showing';
  });
  return shown === '0' ? true : `panel ${shown} is the one showing`;
});

await check('clicking a heading swaps the panel, and only one is ever up', async () => {
  await added().locator('.tgs-tabs__tab').nth(2).click();
  await page.waitForTimeout(300);

  const state = await added().evaluate((root) => ({
    showing: [...root.querySelectorAll('.tgs-tabs__panel')]
      .filter((node) => getComputedStyle(node).display !== 'none')
      .map((node) => node.getAttribute('data-index')),
    words: [...root.querySelectorAll('.tgs-tabs__panel')]
      .filter((node) => getComputedStyle(node).display !== 'none')
      .map((node) => node.textContent.trim().slice(0, 20)),
  }));

  return state.showing.length === 1 && state.showing[0] === '2'
    ? true
    : `showing ${JSON.stringify(state.showing)} (${JSON.stringify(state.words)})`;
});

/*
 * The chosen heading is painted differently from the others. Written as "the
 * clicked one differs from the other two, and those two match each other",
 * because the first attempt at this had an `|| index === 2` in its filter and
 * would have passed with every heading identical.
 */
await check('the heading that is open is the one marked as open', async () => {
  const paint = await added().evaluate((root) =>
    [...root.querySelectorAll('.tgs-tabs__tab')].map((tab) => {
      const style = getComputedStyle(tab);
      return `${style.color}|${style.borderBottomColor}|${style.backgroundColor}`;
    }));

  const chosen = paint[2];
  const rest = [paint[0], paint[1]];
  return chosen !== rest[0] && rest[0] === rest[1]
    ? true
    : `chosen "${chosen}", others ${JSON.stringify(rest)}`;
});

/*
 * THE KEYBOARD, which is the reason for radios rather than buttons. Arrow keys
 * moving through a radio group is behaviour the browser already has, and it is
 * exactly what somebody expects of a row of tabs.
 */
await check('arrow keys move between tabs, because they are a radio group', async () => {
  await added().locator('.tgs-tabs__radio').nth(2).focus();
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(300);

  const shown = await added().evaluate((root) => {
    const panel = [...root.querySelectorAll('.tgs-tabs__panel')]
      .find((node) => getComputedStyle(node).display !== 'none');
    return panel ? panel.getAttribute('data-index') : 'none showing';
  });
  return shown === '1' ? true : `after ArrowLeft, panel ${shown}`;
});

await check('and the focus ring lands on the heading, not on the hidden radio', async () => {
  const outline = await added().locator('.tgs-tabs__tab').nth(1).evaluate((tab) =>
    getComputedStyle(tab).outlineWidth);
  return outline !== '0px' ? true : 'the heading has no focus ring';
});

// Back to a desktop with panels open for anything that follows.
await page.getByRole('button', { name: 'Desktop' }).click();
await page.waitForTimeout(300);
await showPanels();



// ---------------------------------------------------------------------------
// What sits behind a section, and what a link can point at
//
// The scrim strength and the anchor are both settings whose whole existence is
// an attribute on the rendered element, so the check is "does what I typed in
// the pane reach the page". The video is checked for the opposite: that it does
// NOT reach the canvas, which is a claim about absence and needs a real DOM.
// ---------------------------------------------------------------------------

await page.reload();
await page.waitForSelector('.ed-root');
await showPanels();

/** Select the first section on the canvas and open a named group in the pane. */
async function openSectionGroup(title) {
  await page.locator('.ed-canvas-frame .tgs-section').first().click({ position: { x: 8, y: 8 } });
  await page.waitForTimeout(400);
  const head = page.locator('.ed-group__head button', { hasText: title });
  if ((await head.count()) && (await head.first().getAttribute('aria-expanded')) === 'false') {
    await head.first().click();
    await page.waitForTimeout(250);
  }
}

await check('a section offers a background video and an overlay', async () => {
  await openSectionGroup('Background image');
  const pane = await page.locator('.ed-props').innerText();
  const video = /Background video/.test(pane);
  const overlay = /Overlay/.test(pane);
  return video && overlay ? true : `video ${video}, overlay ${overlay}`;
});

await check('the overlay reaches the section as a number it can use', async () => {
  const box = page.locator('.ed-props input[type="number"]').last();
  await box.fill('25');
  await box.blur();
  await page.waitForTimeout(400);

  const value = await page.locator('.ed-canvas-frame .tgs-section').first().evaluate((el) =>
    getComputedStyle(el).getPropertyValue('--tgs-scrim').trim());

  return value === '25' ? true : `the section says "${value}"`;
});

await check('and it is held inside 0 to 100 rather than taken as typed', async () => {
  const box = page.locator('.ed-props input[type="number"]').last();
  await box.fill('900');
  await box.blur();
  await page.waitForTimeout(400);

  const value = await page.locator('.ed-canvas-frame .tgs-section').first().evaluate((el) =>
    getComputedStyle(el).getPropertyValue('--tgs-scrim').trim());

  return value === '100' ? true : `900 became "${value}"`;
});

await check('the overlay can be given a colour, not just a darkness', async () => {
  await openSectionGroup('Background image');
  // The colour field only exists while there is a scrim, and the overlay is at
  // 100 from the check above, so it is here.
  const box = page.locator('#c-overlay-colour');
  if ((await box.count()) === 0) return 'no overlay colour field with a scrim set';
  await box.fill('#3355aa');
  await box.blur();
  await page.waitForTimeout(300);

  const colour = await page.locator('.ed-canvas-frame .tgs-section').first().evaluate((el) =>
    getComputedStyle(el).getPropertyValue('--tgs-scrim-colour').trim());
  return colour === '#3355aa' ? true : `the section says "${colour}"`;
});

/*
 * THE FOCUS EDITOR ON THE BACKGROUND, added 4 Aug 2026. The same tool the image
 * block has, on the field a hero actually uses. The picker's demo images are
 * data: URIs that load, so the editor frame has a size to click inside; the page
 * then refuses a data: URI, so the last step swaps in an address it accepts
 * without touching the numbers the editor saved, exactly as the image block
 * check does.
 */
await check('the section background offers the focus editor once a picture is set', async () => {
  await openSectionGroup('Background image');
  const field = page.locator('.ed-props');
  const choose = field.locator('.mp-choose');
  if (await choose.count()) await choose.first().click();
  else await field.locator('.mp-chosen__actions button', { hasText: 'Replace' }).first().click();
  await page.waitForSelector('.mp-root', { timeout: 5000 });
  await page.waitForTimeout(250);
  await page.locator('.mp-tile__pick').first().click();
  await page.waitForTimeout(300);

  const edit = await field.locator('.mp-chosen__actions button', { hasText: 'Edit' }).count();
  return edit === 1 ? true : `${edit} Edit buttons on the background field`;
});

await check('editing the background sets its focus point and adjustment on the page', async () => {
  const field = page.locator('.ed-props');
  await field.locator('.mp-chosen__actions button', { hasText: 'Edit' }).first().click();
  await page.waitForSelector('.ed-imgedit', { timeout: 5000 });

  const frame = page.locator('.ed-imgedit__frame');
  const box = await frame.boundingBox();
  if (!box || box.width < 20 || box.height < 20) {
    return `the frame is ${Math.round(box?.width ?? 0)}x${Math.round(box?.height ?? 0)}`;
  }
  await frame.click({ position: { x: box.width * 0.3, y: box.height * 0.7 } });
  await page.waitForTimeout(150);
  const dot = await page.locator('.ed-imgedit__dot').evaluate((el) => ({
    x: Math.round(parseFloat(el.style.left)),
    y: Math.round(parseFloat(el.style.top)),
  }));

  const range = page
    .locator('.ed-imgedit__slider', { hasText: 'Brightness' })
    .locator('input[type="range"]');
  await range.evaluate((el) => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(el, '130');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(100);

  await page.locator('.tg-modal__foot button', { hasText: 'Save' }).first().click();
  await page.waitForTimeout(250);

  if ((await field.locator('.mp-url .ed-input').count()) === 0) {
    await field.locator('.mp-url__toggle').first().click();
  }
  await field.locator('.mp-url .ed-input').first().fill('https://images.example.test/bg.jpg');
  await page.waitForTimeout(300);

  const style =
    (await page
      .locator('.ed-canvas-frame .tgs-section')
      .first()
      .locator('.tgs-section__bg')
      .first()
      .getAttribute('style')) ?? '';
  const position = new RegExp(`object-position:\\s*${dot.x}% ${dot.y}%`).test(style);
  const filter = /filter:\s*brightness\(130%\)/.test(style);
  return position && filter ? true : `the background style is "${style}"`;
});

await check('a section can be given a name a link can point at', async () => {
  await openSectionGroup('Link to this section');
  const name = page.locator('.ed-props input[placeholder="prices"]');
  await name.fill('Our Prices');
  await page.waitForTimeout(500);

  const id = await page.locator('.ed-canvas-frame .tgs-section').first().getAttribute('id');
  // Slugified rather than refused: somebody typing "Our Prices" means this.
  return id === 'our-prices' ? true : `the section's id is "${id}"`;
});

await check('the pane says what to point at it', async () => {
  const pane = await page.locator('.ed-props').innerText();
  return /#our-prices/.test(pane) ? true : 'it does not say what the address is';
});

await check('a name with nothing usable in it leaves no id behind', async () => {
  const name = page.locator('.ed-props input[placeholder="prices"]');
  await name.fill('!!!');
  await page.waitForTimeout(500);

  const id = await page.locator('.ed-canvas-frame .tgs-section').first().getAttribute('id');
  // Not `id=""`, which is markup nobody meant and a selector that matches.
  return id === null ? true : `it left id="${id}"`;
});

await check('a section that lands under a link leaves room for a sticky header', async () => {
  await page.locator('.ed-props input[placeholder="prices"]').fill('prices');
  await page.waitForTimeout(500);

  const margin = await page.locator('.ed-canvas-frame .tgs-section[id]').first().evaluate((el) =>
    getComputedStyle(el).scrollMarginTop);

  return margin !== '0px' ? true : 'no scroll margin, so a sticky header would cover it';
});

/*
 * NO FILM ON THE CANVAS. It would restart and re-download on every keystroke,
 * which is a distraction while somebody works and a bill for nothing.
 */
await check('a background video does not play while you are editing', async () => {
  await openSectionGroup('Background image');
  const url = page.locator('.ed-props input[placeholder="https://.../hero.mp4"]');
  await url.fill('https://cdn.example.com/hero.mp4');
  await page.waitForTimeout(600);

  const videos = await page.locator('.ed-canvas-frame video').count();
  return videos === 0 ? true : `${videos} videos on the canvas`;
});



// ---------------------------------------------------------------------------
// The slider
//
// EVERY CLAIM HERE IS A MEASUREMENT. A rail either overflows its box or it does
// not, either snaps or does not, and either scrolls when a key is pressed or
// does not. None of that can be settled by reading a stylesheet, and the block
// has no arrows precisely because it leans on what the browser already does.
// ---------------------------------------------------------------------------

await page.reload();
await page.waitForSelector('.ed-root');
await showPanels();

await check('the Slider is in the block picker', async () => {
  await openBlockPicker();
  const found = await page.locator('.ed-block-card', { hasText: 'Slider' }).count();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  return found >= 1 ? true : 'no Slider card';
});

await check('a slider arrives with more slides than fit, which is the point', async () => {
  await addBlock('Slider');
  await foldPanels();
  await page.waitForTimeout(400);

  const slides = await added().locator('.tgs-card').count();
  const overflows = await added().locator('.tgs-slider').evaluate((rail) =>
    rail.scrollWidth > rail.clientWidth + 8);

  return slides >= 5 && overflows ? true : `${slides} slides, overflows ${overflows}`;
});

await check('the slides are on one line rather than wrapped into rows', async () => {
  const tops = await added().evaluate((root) =>
    [...root.querySelectorAll('.tgs-card')].map((card) => Math.round(card.getBoundingClientRect().top)));
  const spread = Math.max(...tops) - Math.min(...tops);
  return spread === 0 ? true : `tops ${JSON.stringify(tops)}`;
});

await check('the next one peeks in, so it is obvious there is more', async () => {
  const peek = await added().locator('.tgs-slider').evaluate((rail) => {
    const cards = [...rail.querySelectorAll('.tgs-card')];
    const edge = rail.getBoundingClientRect().right;
    // A card that starts before the right edge and ends after it is the peek.
    return cards.some((card) => {
      const box = card.getBoundingClientRect();
      return box.left < edge - 20 && box.right > edge + 20;
    });
  });
  return peek ? true : 'every slide ends on or before the edge, so nothing hints at more';
});

/*
 * IT SCROLLS, AND IT SNAPS. Both are the browser's own behaviour, which is the
 * entire argument for having no arrow buttons.
 */
await check('the rail scrolls sideways', async () => {
  const moved = await added().locator('.tgs-slider').evaluate(async (rail) => {
    const before = rail.scrollLeft;
    rail.scrollLeft = 400;
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { before, after: rail.scrollLeft };
  });
  return moved.after > moved.before ? true : `scrollLeft ${moved.before} -> ${moved.after}`;
});

await check('and the page behind it does not', async () => {
  // The rendered page must never scroll sideways. A rail that could drag the
  // whole page with it would break that for every site using one.
  const sideways = await page.evaluate(() => {
    const page_ = document.querySelector('.ed-canvas-frame .tgs-page');
    return page_ ? page_.scrollWidth > page_.clientWidth + 1 : false;
  });
  return sideways === false ? true : 'the page itself scrolls sideways';
});

await check('a slide comes to rest at the edge rather than half shown', async () => {
  const snap = await added().locator('.tgs-card').first().evaluate((card) =>
    getComputedStyle(card).scrollSnapAlign);
  const rail = await added().locator('.tgs-slider').evaluate((el) =>
    getComputedStyle(el).scrollSnapType);
  return snap.includes('start') && rail.includes('x')
    ? true
    : `align "${snap}", type "${rail}"`;
});

/*
 * REACHED BY THE KEYBOARD, not by calling focus() on it.
 *
 * `:focus-visible` deliberately does not match focus a script moved, which is
 * the whole reason to prefer it over `:focus`: a mouse click on the rail should
 * not draw a ring. So the first version of this check focused the rail from
 * Playwright, found no outline, and reported a bug that was not there.
 *
 * Shift+Tab then Tab lands back on the same element by a real key press, which
 * is what a person does and what the selector is for.
 */
await check('the rail can be reached by a keyboard, and shows that it has been', async () => {
  await added().locator('.tgs-slider').focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(250);

  const focused = await added().locator('.tgs-slider').evaluate((rail) => ({
    isFocused: document.activeElement === rail,
    visible: rail.matches(':focus-visible'),
    outline: getComputedStyle(rail).outlineWidth,
    label: rail.getAttribute('aria-label'),
  }));

  return focused.isFocused && focused.visible && focused.outline !== '0px' && focused.label
    ? true
    : `focused ${focused.isFocused}, focus-visible ${focused.visible}, outline ${focused.outline}`;
});

await check('and arrow keys then move it, which is why there are no arrow buttons', async () => {
  const rail = added().locator('.tgs-slider');
  const before = await rail.evaluate((el) => el.scrollLeft);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  const after = await rail.evaluate((el) => el.scrollLeft);
  return after !== before ? true : `scrollLeft stayed at ${before}`;
});

/*
 * A RAIL STAYS A RAIL ON A PHONE. The grid comes down to one column there, and a
 * slider that did the same would stop being a slider on the one device where
 * swiping is the natural way to use it.
 */
await check('it is still a rail at a phone width', async () => {
  await page.getByRole('button', { name: 'Phone' }).click();
  await page.waitForTimeout(500);

  const tops = await added().evaluate((root) =>
    [...root.querySelectorAll('.tgs-card')].map((card) => Math.round(card.getBoundingClientRect().top)));
  const overflows = await added().locator('.tgs-slider').evaluate((rail) =>
    rail.scrollWidth > rail.clientWidth + 8);

  const oneLine = Math.max(...tops) - Math.min(...tops) === 0;
  return oneLine && overflows ? true : `one line ${oneLine}, overflows ${overflows}`;
});

await check('and the page still does not scroll sideways on a phone', async () => {
  const sideways = await page.evaluate(() => {
    const page_ = document.querySelector('.ed-canvas-frame .tgs-page');
    return page_ ? page_.scrollWidth > page_.clientWidth + 1 : false;
  });
  return sideways === false ? true : 'the phone preview scrolls sideways';
});

await page.getByRole('button', { name: 'Desktop' }).click();
await page.waitForTimeout(300);
await showPanels();



// ---------------------------------------------------------------------------
// The table
//
// The parser is covered in Node, where it belongs. What only a browser can
// settle is whether a table too wide for the space scrolls INSIDE ITS OWN BOX
// rather than dragging the page sideways with it, which is the rule the whole
// rendered page is held to.
// ---------------------------------------------------------------------------

await page.reload();
await page.waitForSelector('.ed-root');
await showPanels();

await check('the Table is in the block picker', async () => {
  await openBlockPicker();
  const found = await page.locator('.ed-block-card', { hasText: 'Table' }).count();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  return found >= 1 ? true : 'no Table card';
});

await check('a table arrives drawn, not as an empty grid', async () => {
  await addBlock('Table');
  const rows = await added().locator('.tgs-table tbody tr').count();
  const headings = await added().locator('.tgs-table thead th').count();
  return rows === 3 && headings === 4 ? true : `${rows} rows, ${headings} headings`;
});

/*
 * THE PART THAT MAKES IT READABLE TO A SCREEN READER, checked on the rendered
 * DOM rather than in the source. Every heading has to say which way it points.
 */
await check('every heading says whether it is a column or a row', async () => {
  const scopes = await added().evaluate((root) =>
    [...root.querySelectorAll('th')].map((th) => th.getAttribute('scope')));

  const columns = scopes.filter((scope) => scope === 'col').length;
  const rowHeads = scopes.filter((scope) => scope === 'row').length;
  const missing = scopes.filter((scope) => scope !== 'col' && scope !== 'row').length;

  return columns === 4 && rowHeads === 3 && missing === 0
    ? true
    : `${columns} col, ${rowHeads} row, ${missing} with none`;
});

await check('pasting a spreadsheet range makes a table of it', async () => {
  const box = page.locator('.ed-props textarea').first();
  // Tab separated, which is exactly what a spreadsheet puts on the clipboard.
  await box.fill('Airport\tFlight time\nManchester\t3h 40m\nGatwick\t3h 15m\nEdinburgh\t4h 05m');
  await page.waitForTimeout(700);

  const shape = await added().evaluate((root) => ({
    headings: [...root.querySelectorAll('thead th')].map((th) => th.textContent.trim()),
    rows: [...root.querySelectorAll('tbody tr')].length,
    firstCell: root.querySelector('tbody td')?.textContent.trim(),
  }));

  return shape.headings.length === 2 && shape.rows === 3 && shape.firstCell === '3h 40m'
    ? true
    : `${JSON.stringify(shape)}`;
});

await check('a short line is padded rather than leaving a hole', async () => {
  const box = page.locator('.ed-props textarea').first();
  await box.fill('a\tb\tc\nd');
  await page.waitForTimeout(700);

  const cells = await added().evaluate((root) =>
    [...root.querySelectorAll('tbody tr')].map((tr) => tr.children.length));
  return JSON.stringify(cells) === '[3]' ? true : `cells per row ${JSON.stringify(cells)}`;
});

/*
 * THE RULE THE WHOLE RENDERED PAGE IS HELD TO. A six-column table cannot be made
 * to fit a phone, so it has to scroll, and it has to scroll inside its own box.
 */
await check('a table too wide for a phone scrolls inside its own box', async () => {
  const wide = ['a\tb\tc\td\te\tf\tg\th'];
  for (let i = 0; i < 4; i += 1) wide.push('a fairly long cell\t2\t3\t4\t5\t6\t7\t8');
  await page.locator('.ed-props textarea').first().fill(wide.join('\n'));
  await page.waitForTimeout(700);

  await page.getByRole('button', { name: 'Phone' }).click();
  await page.waitForTimeout(500);

  const state = await page.evaluate(() => {
    const box = document.querySelector('.ed-canvas-frame .tgs-table__scroll');
    const page_ = document.querySelector('.ed-canvas-frame .tgs-page');
    return {
      boxScrolls: box ? box.scrollWidth > box.clientWidth + 4 : false,
      pageScrolls: page_ ? page_.scrollWidth > page_.clientWidth + 1 : false,
    };
  });

  return state.boxScrolls && !state.pageScrolls
    ? true
    : `box scrolls ${state.boxScrolls}, page scrolls ${state.pageScrolls}`;
});

await check('and that box can be reached by a keyboard, since it scrolls', async () => {
  const box = page.locator('.ed-canvas-frame .tgs-table__scroll');
  await box.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(250);

  const state = await box.evaluate((el) => ({
    focused: document.activeElement === el,
    outline: getComputedStyle(el).outlineWidth,
    label: el.getAttribute('aria-label'),
  }));

  return state.focused && state.outline !== '0px' && state.label
    ? true
    : `focused ${state.focused}, outline ${state.outline}, label "${state.label}"`;
});

/*
 * THE BUG THE TABLE EXPOSED, WHICH WAS NOT THE TABLE'S, kept as a check of its
 * own because any wide block can do it.
 *
 * A row set to reverse when it stacks becomes a COLUMN flex container on a
 * phone, and the vertical alignment it already carried then meant "do not
 * stretch across", so every column sized itself to its widest CONTENT. An image
 * is the everyday case: a 1600px photograph made its column 1600px wide, and
 * `max-width: 100%` on the image resolved against that, so the picture rendered
 * at full size and hung out of the section. Worth remembering next to the open
 * report about images rendering wider than their column.
 */
await check('a wide picture in a reversed row stays inside its column', async () => {
  await page.getByRole('button', { name: 'Phone' }).click();
  await page.waitForTimeout(500);

  const overflow = await page.evaluate(() => {
    const cols = [...document.querySelectorAll('.ed-canvas-frame .tgs-col')];
    const row = document.querySelector('.ed-canvas-frame .tgs-row');
    if (!row) return 'no row';
    const limit = row.getBoundingClientRect().width + 1;
    const over = cols
      .map((col) => Math.round(col.getBoundingClientRect().width))
      .filter((width) => width > limit);
    return over.length === 0 ? null : `columns wider than their row: ${over}`;
  });

  return overflow === null ? true : overflow;
});

await check('and nothing on the phone preview reaches past the page', async () => {
  const wide = await page.evaluate(() => {
    const page_ = document.querySelector('.ed-canvas-frame .tgs-page');
    if (!page_) return 'no page';
    const limit = page_.getBoundingClientRect().right + 1;
    const over = [...page_.querySelectorAll('.tgs-section, .tgs-row, .tgs-col, .tgs-block')]
      .filter((node) => node.getBoundingClientRect().right > limit).length;
    return over === 0 ? null : `${over} things reach past the page`;
  });
  return wide === null ? true : wide;
});

await page.getByRole('button', { name: 'Desktop' }).click();
await page.waitForTimeout(300);
await showPanels();


// ---------------------------------------------------------------------------
// Cards fed from a collection: the blog
// ---------------------------------------------------------------------------

/*
 * WHAT CAN AND CANNOT BE CHECKED HERE.
 *
 * A collection-backed grid is filled on the SERVER, before anything renders, so
 * in this file there is no collection to read: the canvas re-renders on every
 * keystroke and there is nothing on the other side of it. That is the arrangement
 * being verified. What must hold in the editor is that the block SAYS what will
 * appear rather than going blank or drawing three fake cards that will never be
 * there, and that switching the source does not throw the typed-in cards away.
 *
 * A RELOAD FIRST, the same way the table section starts, and it is not optional.
 * The checks above finish on the phone viewport, and clicking Desktop is not
 * enough on its own: the outline stays hidden, so `.ed-add` is in the document
 * and not visible, and the first click here waited thirty seconds for an element
 * that was never going to appear. Reload, then showPanels, which also puts back
 * a panel somebody folded, since that is remembered in localStorage.
 */
await page.reload();
await page.waitForSelector('.ed-root');
await showPanels();

await check('a card grid can be fed from a collection instead of typed in', async () => {
  await addBlock('Cards');
  await showPanels();
  await page.waitForTimeout(300);

  const group = page.locator('.ed-props [role=group][aria-label="Where the cards come from"]');
  const labels = await group.locator('button').allInnerTexts();
  return labels.length === 2 && labels.join('|').includes('From a collection')
    ? true
    : `offered ${JSON.stringify(labels)}`;
});

await check('and until one is named it says so rather than going blank', async () => {
  await page.locator('.ed-props [role=group][aria-label="Where the cards come from"] button')
    .filter({ hasText: 'From a collection' })
    .click();
  await page.waitForTimeout(600);

  const text = (await added().innerText()).trim();
  const cards = await added().locator('.tgs-card').count();
  return cards === 0 && /which collection/i.test(text)
    ? true
    : `${cards} cards, said "${text}"`;
});

/*
 * The placeholder names the collection AND the count, because those are the two
 * things somebody has just set and the only way to see whether they took.
 */
await check('naming one says which posts will appear, and how many', async () => {
  await page.locator('.ed-props input[placeholder="blog"]').first().fill('blog');
  await page.waitForTimeout(600);

  const text = (await added().innerText()).trim();
  return text.includes('"blog"') && /\b6\b/.test(text) ? true : `said "${text}"`;
});

/*
 * FOUND BY LABEL, not by "the last number input in the pane". A block's box and
 * spacing controls are number inputs too, so .last() picks up whichever control
 * happens to be rendered furthest down and would keep passing while testing
 * something else entirely.
 */
const howMany = () =>
  page.locator('.ed-props .ed-field').filter({ hasText: 'How many' }).locator('input[type=number]');

await check('changing how many changes what it promises', async () => {
  const count = howMany();
  await count.fill('3');
  await count.blur();
  await page.waitForTimeout(600);

  const text = (await added().innerText()).trim();
  return /\b3\b/.test(text) ? true : `said "${text}"`;
});

/*
 * min and max on a number input are advisory: the browser marks the field
 * invalid and hands the value over anyway. The clamp is in the control, so
 * a pasted 900 has to come back as 60 rather than reaching a LIMIT.
 */
await check('a count far outside the range is pulled back rather than passed on', async () => {
  const count = howMany();
  await count.fill('900');
  await count.blur();
  await page.waitForTimeout(600);

  const shown = await count.inputValue();
  const text = (await added().innerText()).trim();
  return shown === '60' && text.includes('60') ? true : `field "${shown}", said "${text}"`;
});

/*
 * THE ONE THAT WOULD HURT. Switching source is a choice somebody makes to look
 * at it, and switching back has to bring the typed-in cards with it. Throwing
 * them away on the way out would be silent, and undone only by an undo nobody
 * knows to press.
 */
await check('switching back brings the typed-in cards with it', async () => {
  await page.locator('.ed-props [role=group][aria-label="Where the cards come from"] button')
    .filter({ hasText: 'Typed in here' })
    .click();
  await page.waitForTimeout(600);

  const cards = await added().locator('.tgs-card').count();
  const titles = await added().locator('.tgs-card__title').allInnerTexts();
  return cards === 3 && titles.every((title) => title.trim().length > 0)
    ? true
    : `${cards} cards, titles ${JSON.stringify(titles)}`;
});

// ---------------------------------------------------------------------------
// Designed sections: ten page categories, plus headers and footers
//
// The library went from 24 designs in two categories to 81 in twelve on 1 Aug
// 2026. What Node can check is the data: every block type real, every select
// value one of its own options, every header row centre aligned. What only a
// browser can settle is the three things below.
//
//   1. That the picker offers the right categories for the screen you are on.
//      A header preset and a page section are the same shape, so this is the
//      only thing stopping a four-column footer landing in an About page.
//   2. That the thumbnails tell a picture from a paragraph. Twelve categories
//      of identical grey bars is a picker nobody can use.
//   3. That a header lays out like a header, on a desktop AND on a phone,
//      which is a fact about pixels.
// ---------------------------------------------------------------------------

await page.reload();
await page.waitForSelector('.ed-root');
await showPanels();

await check('a page is offered the ten page categories and neither region', async () => {
  await openBlockPicker();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  await page.locator('.ed-insert__btn').first().click();
  await page.waitForSelector('.tg-modal');
  await page.locator('.ed-tab', { hasText: 'Designed' }).click();
  await page.waitForTimeout(300);

  const names = (await page.locator('.ed-designed__cat').allInnerTexts())
    .map((text) => text.split('\n')[0]);

  const ok = names.length === 10 && !names.includes('Header') && !names.includes('Footer');
  return ok ? true : `offered ${JSON.stringify(names)}`;
});

await check('every category says how many are in it, and none is empty', async () => {
  const counts = (await page.locator('.ed-designed__count').allInnerTexts()).map(Number);
  return counts.length === 10 && counts.every((n) => n >= 4)
    ? true
    : `counts ${JSON.stringify(counts)}`;
});

/*
 * The wireframe has to tell a photograph from a paragraph, or the whole
 * draw-it-from-the-data arrangement buys nothing at thumbnail size.
 */
await check('a picture draws as a block, not as another line of text', async () => {
  await page.locator('.ed-designed__cat', { hasText: 'Gallery' }).click();
  await page.waitForTimeout(300);
  const frames = await page.locator(".ed-preset-card .ed-thumb--preset rect[data-tone='frame']").count();
  return frames > 0 ? true : 'no picture-toned bars in the Gallery thumbnails';
});

await check('and no thumbnail is drawn past the bottom of its box', async () => {
  const over = await page.evaluate(() => {
    const bad = [];
    for (const svg of document.querySelectorAll('.ed-preset-card .ed-thumb--preset')) {
      for (const rect of svg.querySelectorAll('rect')) {
        const y = Number(rect.getAttribute('y')) + Number(rect.getAttribute('height'));
        if (y > 68.5) bad.push(Math.round(y));
      }
    }
    return bad;
  });
  return over.length === 0 ? true : `bars reaching to ${over.join(', ')} in a 68 tall box`;
});

/*
 * Two categories and fifteen designs fitted on a screen. Ten categories and
 * eighty do not, so scrolling to the bottom of one used to take the category
 * list with it and changing your mind meant scrolling all the way back.
 */
await check('the category list stays put while the designs scroll', async () => {
  const sticky = await page.locator('.ed-designed__cats').evaluate((el) =>
    getComputedStyle(el).position);
  return sticky === 'sticky' ? true : `position is ${sticky}`;
});

await check('a pricing design really arrives with prices in it', async () => {
  await page.locator('.ed-designed__cat', { hasText: 'Pricing' }).click();
  await page.waitForTimeout(300);
  await page.locator('.ed-preset-card', { hasText: 'Three panels' }).first().click();
  await page.waitForTimeout(800);

  const text = await added().innerText();
  const cols = await added().locator('.tgs-row').last().locator('> .tgs-col').count();
  return cols === 3 && /£\d/.test(text) ? true : `${cols} columns, text ${JSON.stringify(text.slice(0, 60))}`;
});

/*
 * THE ALIGNMENT THAT WAS BEING IGNORED. Four designed sections set
 * `align: 'centre'` on an icon item before the block had the prop at all: it
 * was carried through, dropped by the renderer, and drawn centred in the
 * thumbnail. Centred means the icon sits ABOVE the words, so this measures the
 * flex direction rather than reading the attribute back.
 */
await check('a centred icon item puts its icon above the words', async () => {
  await page.locator('.ed-insert__btn').first().click();
  await page.waitForSelector('.tg-modal');
  await page.locator('.ed-tab', { hasText: 'Designed' }).click();
  await page.waitForTimeout(200);
  await page.locator('.ed-designed__cat', { hasText: 'Features' }).click();
  await page.waitForTimeout(300);
  await page.locator('.ed-preset-card', { hasText: 'Three points with icons' }).first().click();
  await page.waitForTimeout(800);

  const state = await added().locator('.tgs-icon-item').first().evaluate((el) => ({
    align: el.getAttribute('data-align'),
    direction: getComputedStyle(el).flexDirection,
    text: getComputedStyle(el).textAlign,
  }));

  return state.align === 'centre' && state.direction === 'column' && state.text === 'center'
    ? true
    : JSON.stringify(state);
});

// --- Headers ----------------------------------------------------------------

await check('the header screen offers headers, and opens on them', async () => {
  await closeAnyDialog();
  await page.evaluate(() => window.__TG_SET_REGION__('header'));
  await page.waitForTimeout(700);
  await showPanels();

  await page.locator('.ed-insert__btn').first().click();
  await page.waitForSelector('.tg-modal');

  const tab = await page.locator('.ed-tab[aria-selected=true]').innerText();
  const names = (await page.locator('.ed-designed__cat').allInnerTexts())
    .map((text) => text.split('\n')[0]);

  return tab === 'Designed' && names.length === 1 && names[0] === 'Header'
    ? true
    : `tab ${tab}, categories ${JSON.stringify(names)}`;
});

/*
 * The canvas renders a header through the same PageRenderer a page uses, so
 * until 1 Aug 2026 it drew a bare .tgs-page and every rule keyed on a region
 * missed it. The footer's hairline was invisible in the editor from the day it
 * shipped, which is how a preview quietly stops being a preview.
 */
await check('and the canvas marks itself as a header, so header styling applies', async () => {
  await page.locator('.ed-preset-card', { hasText: 'Logo left, menu right' }).first().click();
  await page.waitForTimeout(800);

  const wrapper = await page.locator('.ed-canvas-frame .tgs-page').evaluate((el) => ({
    classes: el.className,
    region: el.getAttribute('data-region'),
  }));

  return wrapper.classes.includes('tgs-region') && wrapper.region === 'header'
    ? true
    : JSON.stringify(wrapper);
});

await check('a header arrives with a logo and a menu, side by side', async () => {
  await foldPanels();
  await page.waitForTimeout(400);

  const state = await page.evaluate(() => {
    const row = document.querySelector('.ed-canvas-frame .tgs-row');
    const cols = [...row.querySelectorAll(':scope > .tgs-col')];
    const boxes = cols.map((c) => c.getBoundingClientRect());
    return {
      columns: cols.length,
      sideBySide: boxes.length === 2 && boxes[1].left > boxes[0].right - 1,
      hasMenu: !!row.querySelector('.tgs-nav'),
    };
  });

  return state.columns === 2 && state.sideBySide && state.hasMenu
    ? true
    : JSON.stringify(state);
});

/*
 * THE ONE ROW ON A PHONE THAT STAYS A ROW. Everything else stacks below 767px
 * because two columns sharing 390px is two columns nobody can read. A header
 * bar is the exception: its menu has already collapsed to a burger by that
 * width, and stacking turns a 60px bar into a 120px one on the smallest screen
 * there is.
 */
await check('and it stays a bar on a phone rather than stacking', async () => {
  await page.getByRole('button', { name: 'Phone' }).click();
  await page.waitForTimeout(600);

  const state = await page.evaluate(() => {
    const row = document.querySelector('.ed-canvas-frame .tgs-row');
    const boxes = [...row.querySelectorAll(':scope > .tgs-col')].map((c) => c.getBoundingClientRect());
    return {
      sideBySide: boxes.length === 2 && boxes[1].left > boxes[0].right - 1,
      burgerAtTheRightEnd:
        Math.round(row.getBoundingClientRect().right - boxes[1].right) <= 2,
    };
  });

  return state.sideBySide && state.burgerAtTheRightEnd ? true : JSON.stringify(state);
});

await check('nothing in the header reaches past the phone screen', async () => {
  const over = await page.evaluate(() => {
    const page_ = document.querySelector('.ed-canvas-frame .tgs-page');
    const limit = page_.getBoundingClientRect().right + 1;
    return [...page_.querySelectorAll('.tgs-section, .tgs-row, .tgs-col, .tgs-block')]
      .filter((n) => n.getBoundingClientRect().right > limit).length;
  });
  return over === 0 ? true : `${over} things reach past the page`;
});

// --- Footers ----------------------------------------------------------------

await check('the footer screen offers footers', async () => {
  await page.getByRole('button', { name: 'Desktop' }).click();
  await page.waitForTimeout(300);
  await showPanels();

  await page.evaluate(() => window.__TG_SET_REGION__('footer'));
  await page.waitForTimeout(700);
  await showPanels();

  await page.locator('.ed-insert__btn').first().click();
  await page.waitForSelector('.tg-modal');
  const names = (await page.locator('.ed-designed__cat').allInnerTexts())
    .map((text) => text.split('\n')[0]);

  return names.length === 1 && names[0] === 'Footer' ? true : `categories ${JSON.stringify(names)}`;
});

/*
 * A FOOTER MENU MUST NOT COLLAPSE. The Menu block turns into a burger below the
 * breakpoint, which is right at the top of a page and wrong at the bottom: it
 * would hide the links somebody scrolled all the way down to find.
 */
await check('a footer keeps its links visible on a phone rather than hiding them', async () => {
  await page.locator('.ed-preset-card', { hasText: 'Four columns' }).first().click();
  await page.waitForTimeout(800);
  await foldPanels();

  await page.getByRole('button', { name: 'Phone' }).click();
  await page.waitForTimeout(600);

  const state = await page.evaluate(() => {
    const frame = document.querySelector('.ed-canvas-frame');
    const burgers = [...frame.querySelectorAll('.tgs-nav__burger')]
      .filter((b) => b.getBoundingClientRect().height > 0).length;
    const links = [...frame.querySelectorAll('.tgs-nav__link')]
      .filter((a) => a.getBoundingClientRect().height > 0).length;
    return { burgers, links };
  });

  return state.burgers === 0 && state.links >= 8 ? true : JSON.stringify(state);
});

await check('and the footer draws its hairline in the editor, as it does on the site', async () => {
  const shadow = await page.locator('.ed-canvas-frame .tgs-page').evaluate((el) =>
    getComputedStyle(el).boxShadow);
  return shadow !== 'none' ? true : 'no hairline above the footer';
});

// Back to a page and a desktop, so anything after this starts where it expects.
await page.getByRole('button', { name: 'Desktop' }).click();
await page.waitForTimeout(300);
await page.evaluate(() => window.__TG_SET_REGION__(null));
await page.waitForTimeout(600);
await showPanels();


// ---------------------------------------------------------------------------
// Social links, Steps, and shaped section edges
//
// Three additions from 1 Aug 2026. What Node already checks is the data: the
// closed lists, the reductions, the field kinds that drive sanitising. What
// only a browser can settle is below, and it is the same three things every
// time: does it draw, is it reachable, and does it survive a phone.
// ---------------------------------------------------------------------------

await page.reload();
await page.waitForSelector('.ed-root');
await showPanels();

await check('Social links and Steps are both in the block picker', async () => {
  await openBlockPicker();
  const cards = (await page.locator('.ed-block-card').allInnerTexts()).join(' | ');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  return /Social links/.test(cards) && /Steps/.test(cards)
    ? true
    : 'one of them is missing from the picker';
});

// --- Social links -----------------------------------------------------------

/*
 * A ROW OF ICON-ONLY LINKS HAS NO TEXT CONTENT AT ALL: every anchor's child is
 * an SVG, which a screen reader announces as nothing. The name has to come from
 * an aria-label, and this is the check that it actually does.
 */
await check('a social row arrives asking for the addresses', async () => {
  await addBlock('Social links');
  const text = await added().innerText();
  return /addresses of your accounts/i.test(text) ? true : `it says "${text}"`;
});

await check('and draws a link once one is filled in', async () => {
  await showPanels();
  const first = page.locator('.ed-props input[placeholder*="facebook" i]').first();
  await first.fill('https://facebook.com/someshop');
  await page.waitForTimeout(700);

  const state = await added().evaluate((root) => {
    const link = root.querySelector('.tgs-social__link');
    return link
      ? {
          href: link.getAttribute('href'),
          label: link.getAttribute('aria-label'),
          rel: link.getAttribute('rel'),
          target: link.getAttribute('target'),
          svgs: link.querySelectorAll('svg').length,
        }
      : null;
  });

  return state
    && state.href === 'https://facebook.com/someshop'
    && state.label === 'Facebook'
    && /noopener/.test(state.rel ?? '')
    && /noreferrer/.test(state.rel ?? '')
    && state.target === '_blank'
    && state.svgs === 1
    ? true
    : JSON.stringify(state);
});

/*
 * 44px is the minimum comfortable touch target, and it is the LINK that has to
 * carry it rather than the 20px icon inside it. A row of social icons is the
 * classic place this gets missed.
 */
await check('and the tap target is big enough for a thumb', async () => {
  const box = await added().locator('.tgs-social__link').first().boundingBox();
  return box && box.width >= 44 && box.height >= 44
    ? true
    : `link is ${Math.round(box?.width ?? 0)}x${Math.round(box?.height ?? 0)}`;
});

await check('a made-up address is refused rather than rendered', async () => {
  const first = page.locator('.ed-props input[placeholder*="facebook" i]').first();
  await first.fill('javascript:alert(1)');
  await first.blur();
  await page.waitForTimeout(800);

  const hrefs = await added().evaluate((root) =>
    [...root.querySelectorAll('a')].map((a) => a.getAttribute('href')));

  return hrefs.every((href) => !/^javascript:/i.test(href ?? ''))
    ? true
    : `rendered ${JSON.stringify(hrefs)}`;
});

// --- Steps ------------------------------------------------------------------

/*
 * THE NUMBERS ARE A CSS COUNTER, so the markup carries no digits at all and
 * there is nothing in the DOM to read them from.
 *
 * AND getComputedStyle WILL NOT RESOLVE THEM EITHER: asking for the content of
 * ::before returns the literal string "counter(tgs-step)", not "1". That is
 * what this check did first and it failed with exactly that, three times over.
 *
 * So what a browser can honestly settle is that each marker DRAWS something of
 * a sensible size, which is the part CSS could get wrong. That the something is
 * 1, 2, 3 rather than 1, 1, 1 is carried by tests/steps-dividers.test.ts, which
 * asserts counter-increment sits on the step and the content is the counter.
 */
await check('every step draws its own number', async () => {
  await addBlock('Steps');
  const widths = await added().evaluate((root) =>
    [...root.querySelectorAll('.tgs-steps__marker')]
      .map((m) => parseFloat(getComputedStyle(m, '::before').width) || 0));

  return widths.length === 3 && widths.every((w) => w > 3)
    ? true
    : `marker widths ${JSON.stringify(widths)}`;
});

await check('and is an ordered list, so it reads as a sequence', async () => {
  const tag = await added().locator('.tgs-steps').evaluate((el) => el.tagName);
  return tag === 'OL' ? true : `it is a ${tag}`;
});

/*
 * The line joins one step to the next, so the last one must not trail one off
 * the end of the sequence.
 */
await check('the joining line stops at the last step', async () => {
  const drawn = await added().evaluate((root) =>
    [...root.querySelectorAll('.tgs-steps__step')]
      .map((s) => getComputedStyle(s, '::before').content !== 'none'));

  return JSON.stringify(drawn) === '[true,true,false]' ? true : JSON.stringify(drawn);
});

await check('steps stack on a phone rather than squeezing four across', async () => {
  await page.getByRole('button', { name: 'Phone' }).click();
  await page.waitForTimeout(600);

  const stacked = await added().evaluate((root) => {
    const boxes = [...root.querySelectorAll('.tgs-steps__step')].map((s) => s.getBoundingClientRect());
    return boxes.length >= 2 && boxes[1].top >= boxes[0].bottom - 1;
  });

  await page.getByRole('button', { name: 'Desktop' }).click();
  await page.waitForTimeout(400);
  return stacked ? true : 'the steps are still side by side on a phone';
});

// --- Shaped section edges ---------------------------------------------------

/*
 * THE PART THAT TOOK TWO GOES. The shape is drawn INSIDE the section that owns
 * it, in the colour of the section on the other side, so it occupies its own
 * padding and can never cover the neighbour's content. Drawn the other way
 * round, a 56px divider ate the whole 48px default padding of the section below
 * it and sat on the heading.
 */
await check('a section can be given a shaped edge', async () => {
  await showPanels();
  await page.locator('.ed-canvas-frame [data-path="s0"]').click({ position: { x: 20, y: 8 } });
  await page.waitForTimeout(400);

  // The group is shut by default: most sections have straight edges and
  // always will, so it stays out of the way until somebody wants it.
  const head = page.locator('.ed-group__head button', { hasText: 'Shaped edges' });
  if ((await head.count()) === 0) return 'no Shaped edges group in the pane';
  await head.first().click();
  await page.waitForTimeout(300);

  // A dropdown rather than a segmented track: six options is more than four,
  // which is the line Fields.tsx draws for every other select in the product.
  await page.locator('.ed-props select[aria-label="Bottom edge"]').selectOption('curve');
  await page.waitForTimeout(700);

  const count = await page.locator(".ed-canvas-frame .tgs-section__divider[data-edge='bottom']").count();
  return count === 1 ? true : `${count} bottom dividers`;
});

await check('and it is drawn in the colour of the section next to it', async () => {
  const colour = await page
    .locator(".ed-canvas-frame .tgs-section__divider[data-edge='bottom']")
    .first()
    .evaluate((el) => getComputedStyle(el).color);

  // Anything but transparent. The first version painted every divider
  // rgba(0,0,0,0), because boxStyle emits --tgs-bg on every section whether a
  // colour was set or not and a rule keyed on it matched them all.
  return colour !== 'rgba(0, 0, 0, 0)' ? true : 'the divider is transparent';
});

/*
 * It sits above the section's background and BELOW .tgs-section__inner, so
 * even a divider set deeper than the padding cannot end up over the words.
 */
await check('and it sits under the words, not over them', async () => {
  const layered = await page.evaluate(() => {
    const d = document.querySelector(".ed-canvas-frame .tgs-section__divider[data-edge='bottom']");
    const inner = d?.closest('.tgs-section')?.querySelector('.tgs-section__inner');
    if (!d || !inner) return null;
    return {
      divider: Number(getComputedStyle(d).zIndex),
      inner: Number(getComputedStyle(inner).zIndex),
    };
  });

  return layered && layered.inner > layered.divider ? true : JSON.stringify(layered);
});

/*
 * BLEND is the edge that is a fade rather than a shape: the neighbour's colour
 * to transparent, drawn as a gradient div with no path. The panel is still open
 * on the same section, so this just switches the edge and reads what it became.
 */
await check('the blend edge is a gradient, not a shape', async () => {
  await page.locator('.ed-props select[aria-label="Bottom edge"]').selectOption('blend');
  await page.waitForTimeout(600);

  const divider = page
    .locator(".ed-canvas-frame .tgs-section__divider[data-edge='bottom']")
    .first();
  if ((await divider.count()) === 0) return 'no bottom divider after choosing blend';

  const info = await divider.evaluate((el) => ({
    blend: el.classList.contains('tgs-section__divider--blend'),
    background: getComputedStyle(el).backgroundImage,
    hasSvg: !!el.querySelector('svg'),
  }));

  if (!info.blend) return 'the divider is missing the blend class';
  if (info.hasSvg) return 'blend still drew an SVG shape';
  return /gradient/.test(info.background) ? true : `background is ${info.background}`;
});

await check('a shaped edge never makes the page scroll sideways', async () => {
  await page.getByRole('button', { name: 'Phone' }).click();
  await page.waitForTimeout(600);

  const over = await page.evaluate(() => {
    const page_ = document.querySelector('.ed-canvas-frame .tgs-page');
    return page_ ? page_.scrollWidth > page_.clientWidth + 1 : false;
  });

  await page.getByRole('button', { name: 'Desktop' }).click();
  await page.waitForTimeout(400);
  return over === false ? true : 'the page scrolls sideways with a divider on it';
});

// --- Key numbers ------------------------------------------------------------

/*
 * The block exists because two designed sections were faking it with Icon and
 * text, where the "figure" was a star and a heart set at title size. So the one
 * thing a browser has to settle is that the figure really is the loudest thing
 * in the block: everything else here is layout that the unit tests already pin.
 */
await check('a key number is set far larger than its own label', async () => {
  // The divider checks above end on a viewport button, and the note at the top
  // of this file is explicit: anything reading the outline or the properties
  // pane after one of those has to put the panels back first. Without it
  // .ed-add is in the DOM but inside a hidden outline, so the click waits out
  // its full timeout on an element that will never be visible.
  await showPanels();
  await addBlock('Key numbers');

  const sizes = await added().evaluate((root) => {
    const figure = root.querySelector('.tgs-stats__figure');
    const label = root.querySelector('.tgs-stats__label');
    return figure && label
      ? {
          figure: parseFloat(getComputedStyle(figure).fontSize),
          label: parseFloat(getComputedStyle(label).fontSize),
        }
      : null;
  });

  return sizes && sizes.figure >= sizes.label * 2
    ? true
    : JSON.stringify(sizes);
});

/*
 * The affixes are separate elements ONLY so they can be set smaller. A £ or a
 * /5 at the full size of the figure is the single thing that makes a stats row
 * look homemade, and it is not something a client can fix by typing.
 */
await check('and a suffix is set smaller than the figure it hangs off', async () => {
  // The affix, then the figure it belongs to. Not the FIRST figure: the block
  // arrives with a plain "20" in slot one, which has no affix at all, so
  // reaching for figure-then-affix finds nothing and says so.
  const smaller = await added().evaluate((root) => {
    const affix = root.querySelector('.tgs-stats__affix');
    const figure = affix?.closest('.tgs-stats__figure');
    if (!affix || !figure) return null;
    return parseFloat(getComputedStyle(affix).fontSize) < parseFloat(getComputedStyle(figure).fontSize);
  });

  return smaller === true ? true : `affix comparison came back ${smaller}`;
});

/*
 * The input of a named field in the LAST row of a repeater.
 *
 * SCOPED TO .ed-repeat-item, and that is the whole point. An .ed-field NESTS:
 * the repeater's own wrapper is one, and it contains every row's labels, so a
 * plain `.ed-field` filtered by label matches the wrapper as well as the field.
 * Asking that set for `.locator('input').last()` then hands back the last input
 * of the WHOLE repeater rather than the named one, which is how a fill meant
 * for the last Figure landed in the last Detail and this check reported three
 * stats twice over.
 */
const lastRowField = (label) =>
  page.locator('.ed-props .ed-repeat-item').last()
    .locator('.ed-field')
    .filter({ has: page.locator('.ed-label', { hasText: new RegExp(`^${label}$`) }) })
    .locator('input');

/*
 * Two across on a phone rather than one. A stats row is the one grid in this
 * stylesheet that survives being halved, because the figures are short: four of
 * them in a single column is a screen and a half of scrolling for four words.
 */
await check('four numbers become two rows of two on a phone, not four rows of one', async () => {
  await showPanels();
  // "Across" is in the Layout section now, shut by default; open it first.
  await openPaneGroup('Layout');

  // Three options, so this is a segmented row rather than a dropdown: the line
  // Fields.tsx draws at four.
  await page.getByRole('group', { name: 'Across' }).getByRole('button', { name: 'Four' }).click();
  await page.waitForTimeout(400);

  // The block ships with three numbers, so a fourth has to exist before the
  // column setting means anything. Without this the check measures a
  // three-item grid and calls a 2-plus-1 wrap a pass.
  const addNumber = page.locator('.ed-props button', { hasText: 'Add number' });
  if ((await addNumber.count()) === 0) return 'no Add number button in the pane';
  await addNumber.first().click();
  await page.waitForTimeout(600);

  /*
   * AND IT HAS TO BE GIVEN A FIGURE, because an entry with neither a figure nor
   * a label draws nothing: it would be an empty column pushing the others out
   * of true. So a freshly added row is invisible on the canvas until something
   * is typed into it, exactly as a freshly added social link is.
   */
  await lastRowField('Figure').fill('60');
  await page.waitForTimeout(700);

  await page.getByRole('button', { name: 'Phone' }).click();
  await page.waitForTimeout(700);

  const laid = await added().evaluate((root) => {
    const tops = [...root.querySelectorAll('.tgs-stats__item')].map((el) =>
      Math.round(el.getBoundingClientRect().top));
    return { count: tops.length, rows: new Set(tops).size };
  });

  await page.getByRole('button', { name: 'Desktop' }).click();
  await page.waitForTimeout(400);

  return laid.count === 4 && laid.rows === 2 ? true : JSON.stringify(laid);
});

// --- The logo strip ---------------------------------------------------------

/*
 * WHAT THIS HARNESS CAN AND CANNOT SETTLE ABOUT LOGOS.
 *
 * The block's claim is "one height, each keeps its own width", and proving the
 * second half needs two pictures of different shapes that actually LOAD. This
 * harness has none: the demo bank hands back data: URIs, which safeUrl refuses
 * on purpose, and the only address the product accepts here points at a host
 * that does not exist. Same limitation the image block checks already carry,
 * and the reason they type an address rather than pick one.
 *
 * So the browser settles that the rules really are applied to a real element in
 * a real layout, and that changing the setting changes the height. That the
 * rules ADD UP to contained scaling is arithmetic on object-fit and a fixed
 * height, pinned in tests/stats-logos.test.ts.
 */
await check('a logo takes the height it is given, not its own', async () => {
  // Same again: the check above finishes on the Desktop button.
  await showPanels();
  await addBlock('Logo strip');

  const addLogo = page.locator('.ed-props button', { hasText: 'Add logo' });
  if ((await addLogo.count()) === 0) return 'no Add logo button in the pane';
  await addLogo.first().click();
  await page.waitForTimeout(500);

  /*
   * NO MODAL. "Or use a web address" is a control of the image FIELD, sitting
   * in the properties pane next to the Choose button, not something inside the
   * picker dialog. Opening the picker first put its own scrim over the very
   * toggle this needs, which is what the second attempt at this check hit.
   *
   * An address rather than a picked image, for the reason the image block
   * checks already give: the demo bank hands back data: URIs and safeUrl
   * refuses those on purpose, so a picked demo picture would never render.
   */
  const row = page.locator('.ed-props .ed-repeat-item').last();
  if ((await row.locator('.mp-url .ed-input').count()) === 0) {
    await row.locator('.mp-url__toggle').click();
    await page.waitForTimeout(300);
  }
  await row.locator('.mp-url .ed-input').first().fill(`https://${EXPECTED_TO_FAIL}/abta.svg`);
  await page.waitForTimeout(900);

  const drawn = await added().evaluate((root) => {
    const img = root.querySelector('.tgs-logos__img');
    if (!img) return null;
    const style = getComputedStyle(img);
    return { fit: style.objectFit, height: Math.round(parseFloat(style.height)) };
  });

  // 40px is the Medium setting, which is what a new strip arrives on.
  return drawn && drawn.fit === 'contain' && drawn.height === 40
    ? true
    : JSON.stringify(drawn);
});

await check('and the height setting really moves it', async () => {
  /*
   * SMALL, NOT LARGE, and the reason is worth writing down because it cost a
   * run to find: THE EDITOR CANVAS IS ONLY ~752px WIDE. A 1440px window less a
   * 260px outline and a properties pane leaves less than the 767px breakpoint,
   * so the canvas is inside the phone container query even on the Desktop
   * setting. Large is capped at 40px there, which is exactly Medium, so
   * checking Large could only ever compare a number with itself.
   *
   * Small is 28px at every width, so it is the one setting that proves the
   * control moves the height wherever this check happens to run.
   */
  // "Height" is in the Layout section now, shut by default; open it first.
  await openPaneGroup('Layout');
  await page.getByRole('group', { name: 'Height' }).getByRole('button', { name: 'Small' }).click();
  await page.waitForTimeout(700);

  const state = await added().evaluate((root) => {
    const img = root.querySelector('.tgs-logos__img');
    const page_ = root.closest('.tgs-page');
    return {
      height: img ? Math.round(parseFloat(getComputedStyle(img).height)) : null,
      canvas: page_ ? Math.round(page_.getBoundingClientRect().width) : null,
    };
  });

  return state.height === 28
    ? true
    : `small came out at ${state.height}px on a ${state.canvas}px canvas`;
});

/*
 * A LINK NEEDS A NAME. An anchor whose only child is an image with no alt text
 * has no accessible name at all: a screen reader reaches it and announces
 * "link", or reads out the file name. So the renderer refuses that combination
 * and draws the plain logo instead, and this is the check that stops somebody
 * "tidying" the condition down to just the address.
 */
await check('a logo with an address but no name is not made into a link', async () => {
  await lastRowField('Link').fill('https://abta.com');
  await page.waitForTimeout(700);

  const links = await added().evaluate((root) => root.querySelectorAll('.tgs-logos a').length);
  return links === 0 ? true : `${links} unnamed links drawn`;
});

await check('and it becomes a link the moment it is named', async () => {
  await lastRowField('Name').fill('ABTA');
  await page.waitForTimeout(800);

  const state = await added().evaluate((root) => {
    const a = root.querySelector('.tgs-logos a');
    return a
      ? { href: a.getAttribute('href'), rel: a.getAttribute('rel'), alt: a.querySelector('img')?.getAttribute('alt') }
      : null;
  });

  return state && state.alt === 'ABTA' && state.href === 'https://abta.com' && /noopener/.test(state.rel ?? '')
    ? true
    : JSON.stringify(state);
});

// --- The icon library -------------------------------------------------------

/*
 * THE GAP THIS CLOSED. Until 1 Aug 2026 the only icon a client could put on a
 * page was a character typed into a text box, and the designed sections shipped
 * a tick, a star and a heart as theirs. That is the exact practice the note at
 * the top of components/editor/Icon.tsx bans in our own interface, left in the
 * client's content.
 */
await check('an icon item offers the library rather than a box to type a character in', async () => {
  await showPanels();
  await addBlock('Icon and text');

  const choose = page.locator('.ed-props .if-choose');
  if ((await choose.count()) === 0) return 'no Choose an icon button in the pane';

  // It arrives on a real icon now, not a typed star, so the canvas draws an
  // SVG before anybody touches anything.
  const drawn = await added().evaluate((root) => ({
    kind: root.querySelector('.tgs-icon-item__icon')?.getAttribute('data-kind'),
    svgs: root.querySelectorAll('.tgs-icon-item__icon svg').length,
  }));

  return drawn.kind === 'icon' && drawn.svgs === 1 ? true : JSON.stringify(drawn);
});

await check('the picker finds an icon for a word a travel agent would type', async () => {
  await page.locator('.ed-props .if-choose').click();
  await page.waitForSelector('.ip-grid, .ip-empty', { timeout: 5000 });

  // The set ships no tags at all, so without the synonym map in
  // lib/content/icons.ts the most obvious word in the trade finds nothing.
  await page.locator('.tg-modal input[aria-label="Search icons"]').fill('holiday');
  await page.waitForTimeout(400);

  const names = await page.evaluate(() =>
    [...document.querySelectorAll('.ip-tile__name')].slice(0, 6).map((el) => el.textContent));

  return names.length > 0 ? true : 'nothing found for "holiday"';
});

await check('and every result draws a picture rather than an empty box', async () => {
  const drawn = await page.evaluate(() => {
    const tiles = [...document.querySelectorAll('.ip-tile')].slice(0, 12);
    return {
      tiles: tiles.length,
      // A shape inside the svg, not merely an svg element: an icon whose body
      // failed to parse would still leave the empty svg behind.
      withShapes: tiles.filter((t) => (t.querySelector('svg')?.children.length ?? 0) > 0).length,
    };
  });

  return drawn.tiles > 0 && drawn.withShapes === drawn.tiles ? true : JSON.stringify(drawn);
});

await check('choosing one puts it on the page', async () => {
  const first = page.locator('.ip-tile').first();
  const chosen = await first.locator('.ip-tile__name').textContent();
  await first.click();
  await page.waitForTimeout(700);

  const state = await added().evaluate((root) => {
    const svg = root.querySelector('.tgs-icon-item__icon svg');
    return {
      open: document.querySelectorAll('.ip-grid').length,
      shapes: svg ? svg.children.length : 0,
      // Decorative on purpose: the title beside it says the same thing in
      // words, so announcing the picture would read the point twice.
      hidden: svg?.getAttribute('aria-hidden'),
    };
  });

  return state.open === 0 && state.shapes > 0 && state.hidden === 'true'
    ? true
    : `${chosen}: ${JSON.stringify(state)}`;
});

/*
 * THE PATH THAT KEEPS OLD PAGES WORKING. Every icon on every page built before
 * the library existed is a character somebody typed, and the value is still a
 * plain string, so the renderer looks it up and prints it when it names nothing.
 * Without this a client's site would lose every icon on it the day the library
 * shipped.
 */
await check('a typed emoji is still drawn as a typed emoji', async () => {
  const typed = page.locator('.ed-props input[aria-label="Icon name or a character"]');
  await typed.fill('🏖️');
  await typed.blur();
  await page.waitForTimeout(700);

  const state = await added().evaluate((root) => {
    const span = root.querySelector('.tgs-icon-item__icon');
    return { kind: span?.getAttribute('data-kind'), text: span?.textContent, svgs: span?.querySelectorAll('svg').length };
  });

  return state.kind === 'character' && state.text === '🏖️' && state.svgs === 0
    ? true
    : JSON.stringify(state);
});

/*
 * An icon takes the colour of the words around it. Every path in the set is
 * stroked with currentColor, which is what lets one icon sit on a light section
 * and a dark one without a client choosing a colour for each.
 */
await check('an icon takes the colour of the text around it', async () => {
  const typed = page.locator('.ed-props input[aria-label="Icon name or a character"]');
  await typed.fill('plane-takeoff');
  await typed.blur();
  await page.waitForTimeout(700);

  const same = await added().evaluate((root) => {
    const svg = root.querySelector('.tgs-icon-item__icon svg');
    const path = svg?.querySelector('path');
    if (!svg || !path) return null;
    return getComputedStyle(path).stroke === getComputedStyle(svg).color;
  });

  return same === true ? true : `stroke and colour comparison came back ${same}`;
});

// ---------------------------------------------------------------------------
// A gallery tile carries a focus point too
// ---------------------------------------------------------------------------

/*
 * Andy, 4 Aug 2026, after the image block and the section background: the focus
 * point on gallery tiles as well. A tile is cropped to a square, so which part
 * of a landscape or a portrait it keeps is the whole choice the focus makes.
 * The repeater has to hand each tile field its own row for the editor to read a
 * saved point back, which is the wiring these two checks prove in a browser.
 */
await check('a gallery tile offers the focus editor once it has a picture', async () => {
  await showPanels();
  await addBlock('Gallery');
  const add = page.locator('.ed-props button', { hasText: 'Add image' });
  if ((await add.count()) === 0) return 'no Add image button in the pane';
  await add.first().click();
  await page.waitForTimeout(400);

  // A loadable demo picture on the tile, so the editor frame has a size to click.
  const row = page.locator('.ed-props .ed-repeat-item').last();
  const choose = row.locator('.mp-choose');
  if (await choose.count()) await choose.first().click();
  else await row.locator('.mp-chosen__actions button', { hasText: 'Replace' }).first().click();
  await page.waitForSelector('.mp-root', { timeout: 5000 });
  await page.waitForTimeout(250);
  await page.locator('.mp-tile__pick').first().click();
  await page.waitForTimeout(300);

  const edit = await row.locator('.mp-chosen__actions button', { hasText: 'Edit' }).count();
  return edit === 1 ? true : `${edit} Edit buttons on the tile`;
});

await check('editing a tile sets its focus point on the gallery', async () => {
  const row = page.locator('.ed-props .ed-repeat-item').last();
  await row.locator('.mp-chosen__actions button', { hasText: 'Edit' }).first().click();
  await page.waitForSelector('.ed-imgedit', { timeout: 5000 });

  const frame = page.locator('.ed-imgedit__frame');
  const box = await frame.boundingBox();
  if (!box || box.width < 20 || box.height < 20) {
    return `the frame is ${Math.round(box?.width ?? 0)}x${Math.round(box?.height ?? 0)}`;
  }
  await frame.click({ position: { x: box.width * 0.2, y: box.height * 0.8 } });
  await page.waitForTimeout(150);
  const dot = await page.locator('.ed-imgedit__dot').evaluate((el) => ({
    x: Math.round(parseFloat(el.style.left)),
    y: Math.round(parseFloat(el.style.top)),
  }));
  await page.locator('.tg-modal__foot button', { hasText: 'Save' }).first().click();
  await page.waitForTimeout(250);

  // The demo picture is a data: URI, which the page refuses, so give the tile an
  // address it accepts; that sets only the src and leaves the point just saved.
  if ((await row.locator('.mp-url .ed-input').count()) === 0) {
    await row.locator('.mp-url__toggle').first().click();
  }
  await row.locator('.mp-url .ed-input').first().fill('https://images.example.test/tile.jpg');
  await page.waitForTimeout(300);

  const style =
    (await page.locator('.ed-canvas-frame .tgs-gallery img').first().getAttribute('style')) ?? '';
  return new RegExp(`object-position:\\s*${dot.x}% ${dot.y}%`).test(style)
    ? true
    : `the tile style is "${style}"`;
});

// ---------------------------------------------------------------------------
// The crop, presets and freeform
// ---------------------------------------------------------------------------

/*
 * THE CROP, added 4 Aug 2026, and last because it adds a fresh block: kept away
 * from the checks above so its state cannot bleed into theirs. The editor's Crop
 * tab, a 16:9 preset, then the crop on the page. The frame is given the crop's
 * own shape, so the aspect-ratio the render writes is read straight off the
 * frame rather than measured from a box a border or a column could skew.
 */
await check('an image can be cropped to a preset shape', async () => {
  await selectAnImageBlock();
  await openPicker();
  await page.locator('.mp-tile__pick').first().click();
  await page.waitForTimeout(300);

  await page.locator('.mp-chosen__actions button', { hasText: 'Edit' }).first().click();
  await page.waitForSelector('.ed-imgedit', { timeout: 5000 });
  await page.locator('.ed-imgedit__tab', { hasText: 'Crop' }).click();
  // The shape is measured off the frame, so wait for it to have a real size
  // before a preset is chosen (the demo pictures are SVGs with no naturalWidth,
  // so the frame's own box is what tells us it has laid out).
  await page
    .waitForFunction(
      () => {
        const f = document.querySelector('.ed-imgedit__frame--crop');
        return !!f && f.getBoundingClientRect().width > 10 && f.getBoundingClientRect().height > 10;
      },
      { timeout: 5000 },
    )
    .catch(() => {});
  await page.waitForTimeout(150);
  await page.locator('.ed-crop__aspect', { hasText: '16:9' }).click();
  await page.waitForTimeout(150);
  if ((await page.locator('.ed-crop__box').count()) !== 1) return 'no crop box after a preset';

  await page.locator('.tg-modal__foot button', { hasText: 'Save' }).first().click();
  await page.waitForTimeout(250);

  if ((await page.locator('.ed-props .mp-url .ed-input').count()) === 0) {
    await page.locator('.ed-props .mp-url__toggle').first().click();
  }
  await page.locator('.ed-props .mp-url .ed-input').first().fill('https://images.example.test/crop.jpg');
  await page.waitForTimeout(300);

  const frame = page.locator('.ed-canvas-frame .tgs-image__frame--crop').first();
  if ((await frame.count()) === 0) return 'no cropped frame on the canvas';
  const info = await frame.evaluate((el) => ({
    aspect: getComputedStyle(el).aspectRatio,
    hasImg: !!el.querySelector('img'),
  }));
  // aspect-ratio comes back as "1.77778" or "16 / 9"; read the number it means.
  const parts = info.aspect.split('/').map((p) => parseFloat(p));
  const ratio = parts.length === 2 ? parts[0] / parts[1] : parts[0];
  return info.hasImg && Math.abs(ratio - 16 / 9) < 0.06
    ? true
    : `the frame aspect is "${info.aspect}"`;
});

// ---------------------------------------------------------------------------
// The image slideshow
// ---------------------------------------------------------------------------

/*
 * Andy, 4 Aug 2026: more images turn the block into a slider. Last, again,
 * because it adds a fresh block. The images want addresses the page accepts so
 * the slideshow actually draws (a data: URI would filter out), and the check
 * reads the DOM it makes plus the animation-name the stylesheet binds, which is
 * how it proves the pure-CSS auto-play is wired rather than trying to watch it
 * move in a headless run.
 */
await check('more than one image becomes an auto-playing slideshow', async () => {
  await selectAnImageBlock();

  const main = page.locator('.ed-props .mp-url').first();
  if ((await main.locator('.ed-input').count()) === 0) {
    await main.locator('.mp-url__toggle').click();
  }
  await main.locator('.ed-input').first().fill('https://images.example.test/a.jpg');
  await page.waitForTimeout(200);

  const add = page.locator('.ed-props button', { hasText: 'Add slide' });
  if ((await add.count()) === 0) return 'no Add slide button in the pane';
  await add.first().click();
  await page.waitForTimeout(300);

  const slide = page.locator('.ed-props .ed-repeat-item').last();
  if ((await slide.locator('.mp-url .ed-input').count()) === 0) {
    await slide.locator('.mp-url__toggle').first().click();
  }
  await slide.locator('.mp-url .ed-input').first().fill('https://images.example.test/b.jpg');
  await page.waitForTimeout(400);

  const info = await page
    .locator('.ed-canvas-frame .tgs-slideshow')
    .first()
    .evaluate((el) => {
      const slides = el.querySelectorAll('.tgs-slideshow__slide');
      const first = slides[0];
      return {
        count: el.getAttribute('data-count'),
        slides: slides.length,
        dots: el.querySelectorAll('.tgs-slideshow__dot').length,
        anim: first ? getComputedStyle(first).animationName : 'none',
      };
    })
    .catch(() => null);
  if (!info) return 'no slideshow on the canvas';
  return info.slides === 2 && info.dots === 2 && info.count === '2' && info.anim !== 'none'
    ? true
    : `slides ${info.slides}, dots ${info.dots}, count ${info.count}, anim ${info.anim}`;
});

// --- Heading shadow, and that a paragraph never takes one -------------------

/*
 * A shadow behind a heading so it clears a photograph, headings only. Probed by
 * injecting the markup into the live document rather than driving the pane,
 * because what has to hold is the BUNDLED stylesheet: a heading takes the
 * shadow, and a paragraph in a shadowed Text block does not.
 */
await check('a heading takes a shadow, a paragraph never does', async () => {
  const shadows = await page.evaluate(() => {
    const host = document.createElement('div');
    host.innerHTML =
      '<h2 class="tgs-heading" data-style="h1" data-shadow="strong">H</h2>' +
      '<div class="tgs-text" data-heading-shadow="strong"><h3>Heading</h3><p>Body</p></div>';
    document.body.appendChild(host);
    const shadowOf = (sel) => {
      const el = host.querySelector(sel);
      return el ? getComputedStyle(el).textShadow : 'missing';
    };
    const out = {
      heading: shadowOf('.tgs-heading'),
      innerHeading: shadowOf('.tgs-text h3'),
      paragraph: shadowOf('.tgs-text p'),
    };
    host.remove();
    return out;
  });

  const drawn = (value) => value && value !== 'none' && value !== 'missing';
  if (!drawn(shadows.heading)) return `the heading has no shadow: ${shadows.heading}`;
  if (!drawn(shadows.innerHeading)) return `a heading in the text block has none: ${shadows.innerHeading}`;
  return shadows.paragraph === 'none' ? true : `the paragraph took a shadow: ${shadows.paragraph}`;
});

// --- Drag a block off the picker onto the canvas ----------------------------

/*
 * Drive a dnd-kit drag with a real pointer. dnd-kit ignores native HTML5 drag
 * events and listens on pointerdown/move/up, so the synthetic DragEvent the old
 * native version was tested with never starts it. We press on the source, nudge
 * past the 5px activation distance so the drag begins, then step to the target so
 * onDragMove fires and the drop hook tracks the pointer. `mid` runs while the
 * button is still down, for the reads that must catch the live drag (the floating
 * slot, the body flag) before the drop clears them.
 */
const dndPointerDrag = async (from, to, mid) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 8, from.y + 8, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 14 });
  await page.mouse.move(to.x, to.y); // a settling move so the last point sticks
  const read = mid ? await mid() : undefined;
  await page.mouse.up();
  return read;
};

/* The source card and a target canvas column, each as a viewport point the
 * pointer can travel between, plus the column path and its current block count.
 * Computed in the page so the coordinates are the ones the pointer will use.
 *
 * A pointer drag can only aim at a point that is on screen, unlike the old
 * synthetic drag which fired straight at the element wherever it sat. Blocks
 * added by earlier checks can leave the column taller than the viewport or
 * scrolled off it, so bring it into view and aim at the middle of its VISIBLE
 * band, which is inside both the column and the screen. The source card lives in
 * a fixed pane or modal, so scrolling the canvas never moves it. */
const planDragToColumn = (cardSel) =>
  page.evaluate((sel) => {
    const cards = [...document.querySelectorAll(sel)];
    const card = cards.find((c) => /divider/i.test(c.textContent || '')) || cards[0];
    const col = [...document.querySelectorAll('.ed-canvas-frame [data-path]')].find((el) =>
      /^s\d+r\d+c\d+$/.test(el.getAttribute('data-path') || ''),
    );
    if (!card || !col) return null;
    // Both ends must be on screen for a pointer drag. The source card can be
    // below the fold of a tall palette list or modal, and the column below the
    // fold of the canvas; each lives in its own scroll container, so scroll both.
    card.scrollIntoView({ block: 'center', inline: 'nearest' });
    col.scrollIntoView({ block: 'center', inline: 'nearest' });
    const path = col.getAttribute('data-path');
    const c = card.getBoundingClientRect();
    const r = col.getBoundingClientRect();
    const top = Math.max(r.top, 8);
    const bottom = Math.min(r.bottom, window.innerHeight - 8);
    return {
      path,
      before: document.querySelectorAll(`.ed-canvas-frame [data-path^="${path}b"]`).length,
      from: { x: Math.round(c.left + c.width / 2), y: Math.round(c.top + c.height / 2) },
      to: {
        x: Math.round(Math.min(Math.max(r.left + r.width / 2, 8), window.innerWidth - 8)),
        y: Math.round((top + bottom) / 2),
      },
    };
  }, cardSel);

/*
 * A new block dragged from the + picker lands where it is dropped, not where the
 * picker was opened. A real pointer drag now, so this also proves the ghost is
 * click-through: were it not, elementFromPoint would return the ghost and the
 * slot would never show. Left near last, it adds a block to the seed page.
 */
await check('a block dragged from the picker is added where it is dropped', async () => {
  await openBlockPicker();

  const plan = await planDragToColumn('.ed-block-card');
  if (!plan) return 'missing a card or a column';

  const live = await dndPointerDrag(plan.from, plan.to, () =>
    page.evaluate(() => ({
      zoneShown: document.querySelector('.ed-drop-slot')?.style.display === 'block',
      flagSet: document.body.dataset.tgDragging === 'block',
    })),
  );
  if (!live.zoneShown) return 'no drop zone appeared while dragging over the column';
  if (!live.flagSet) return 'the modal-fade flag was not set during the drag';

  await page.waitForTimeout(400);
  if ((await page.locator('.tg-modal').count()) !== 0) return 'the picker did not close after the drop';
  const zoneAfter = await page.evaluate(() => document.querySelector('.ed-drop-slot')?.style.display);
  if (zoneAfter !== 'none') return 'the drop zone was not hidden after the drop';
  const flagLeft = await page.evaluate(() => Boolean(document.body.dataset.tgDragging));
  if (flagLeft) return 'the dragging flag was left on the body';
  const after = await page.locator(`.ed-canvas-frame [data-path^="${plan.path}b"]`).count();
  return after > plan.before ? true : `column ${plan.path} blocks ${plan.before} -> ${after}`;
});

/*
 * Escape mid-drag cancels it: dnd-kit fires onDragCancel, which clears the
 * modal-fade flag and adds nothing. Driven from the always-on palette, NOT the +
 * picker: a modal has its own Escape-to-close that races the drag's cancel (the
 * modal shuts, the drag finishes on release and drops a block), so the picker is
 * the wrong place to test the gesture. The palette has no modal, so Escape means
 * only cancel. This is the flag's whole safety story now the drag lives in one
 * DndContext up in the shell: end and cancel are the two ways a drag stops, and
 * both clear the flag, so it can never stick and hide the next open of the picker
 * (the 5 Aug 2026 bug). The flag is checked the instant Escape lands, before the
 * release, so it proves the cancel cleared it and not the release.
 */
await check('escape mid-drag cancels it and clears the flag', async () => {
  await page.locator('.ed-lefttab', { hasText: 'Elements' }).click();
  await page.waitForSelector('.ed-palette-card', { timeout: 3000 });

  const plan = await planDragToColumn('.ed-palette-card');
  if (!plan) return 'missing a palette card or a column';

  await page.mouse.move(plan.from.x, plan.from.y);
  await page.mouse.down();
  await page.mouse.move(plan.from.x + 8, plan.from.y + 8, { steps: 3 });
  await page.mouse.move(plan.to.x, plan.to.y, { steps: 10 });
  await page.keyboard.press('Escape');
  const flagOnCancel = await page.evaluate(() => Boolean(document.body.dataset.tgDragging));
  await page.mouse.up();
  await page.waitForTimeout(250);

  if (flagOnCancel) return 'the drag flag was still set the instant Escape landed';
  const flagLeft = await page.evaluate(() => Boolean(document.body.dataset.tgDragging));
  if (flagLeft) return 'the drag flag was left set after a cancel';
  const after = await page.locator(`.ed-canvas-frame [data-path^="${plan.path}b"]`).count();
  return after === plan.before ? true : `a cancelled drag still added: ${plan.before} -> ${after}`;
});

// --- The persistent elements palette in the left pane -----------------------

/*
 * The Elementor-style panel you drag elements from. It shares the one DndContext
 * and the same drop hook with the + picker, so the same pointer drag proves it.
 * Switching the left pane to Elements is all that is new. Left near the end,
 * since it changes the page and the left pane.
 */
await check('an element dragged from the left palette lands on the canvas', async () => {
  await page.locator('.ed-lefttab', { hasText: 'Elements' }).click();
  await page.waitForSelector('.ed-palette-card', { timeout: 3000 });

  // Same pointer drag as the picker, the same one DndContext behind it: the
  // side panel is just a second source, with no modal over the canvas to fade.
  const plan = await planDragToColumn('.ed-palette-card');
  if (!plan) return 'missing a palette card or a column';

  await dndPointerDrag(plan.from, plan.to);
  await page.waitForTimeout(300);
  const after = await page.locator(`.ed-canvas-frame [data-path^="${plan.path}b"]`).count();
  return after > plan.before ? true : `column ${plan.path} blocks ${plan.before} -> ${after}`;
});

await check('clicking a palette element adds it to the selected column', async () => {
  const path = await page.evaluate(() => {
    const col = [...document.querySelectorAll('.ed-canvas-frame [data-path]')].find((el) =>
      /^s\d+r\d+c\d+$/.test(el.getAttribute('data-path') || ''),
    );
    if (!col) return null;
    col.click();
    return col.getAttribute('data-path');
  });
  if (!path) return 'no column to select';
  await page.waitForTimeout(150);
  const before = await page.locator(`.ed-canvas-frame [data-path^="${path}b"]`).count();
  await page.locator('.ed-palette-card').first().click();
  await page.waitForTimeout(300);
  const after = await page.locator(`.ed-canvas-frame [data-path^="${path}b"]`).count();
  return after > before ? true : `clicked-add in ${path}: ${before} -> ${after}`;
});

// --- Move a placed block by dragging its gutter handle ----------------------

/*
 * Andy, 10 Aug 2026: EVERY block must move by dragging, text and headings too.
 * The move handle sits in the gutter to the block's LEFT now, clear of the
 * formatting toolbar above and the words you select, so it works for a text
 * block, which the earlier in-toolbar grip could not reach. This deliberately
 * moves the seed's FIRST block, which is a heading/text: select it, drag its
 * handle well down the column, and the shell reselects the moved block by its
 * id, so the selection's own path is where it ended up, below the b0 it started
 * at. Left near the end, since it reshuffles the seed page.
 */
await check('a placed block is moved by dragging its gutter handle', async () => {
  const plan = await page.evaluate(() => {
    const all = () => [...document.querySelectorAll('.ed-canvas-frame [data-path]')];
    const col = all().find((el) => {
      const path = el.getAttribute('data-path') || '';
      if (!/^s\d+r\d+c\d+$/.test(path)) return false;
      const direct = new RegExp(`^${path}b\\d+$`);
      return all().filter((b) => direct.test(b.getAttribute('data-path') || '')).length >= 3;
    });
    if (!col) return null;
    const path = col.getAttribute('data-path');
    const first = document.querySelector(`.ed-canvas-frame [data-path="${CSS.escape(path + 'b0')}"]`);
    if (!first) return null;
    first.scrollIntoView({ block: 'center' });
    const r = first.getBoundingClientRect();
    const cr = col.getBoundingClientRect();
    return {
      path,
      click: { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) },
      // Well below the first block but on screen, so the drop lands it lower than
      // index 1 (which the move op's remove-shift would collapse to a no-op).
      drop: {
        x: Math.round(Math.min(Math.max(cr.left + cr.width / 2, 8), window.innerWidth - 8)),
        y: Math.round(Math.max(r.bottom + 60, Math.min(cr.bottom - 8, window.innerHeight - 12))),
      },
    };
  });
  if (!plan) return 'no top-level column with three blocks to reorder';

  // Select the first block (a heading in the seed), so its handle appears.
  await page.mouse.click(plan.click.x, plan.click.y);
  await page.waitForTimeout(250);
  if ((await page.locator('.ed-drag-handle').count()) === 0) return 'no move handle on the selected block';
  const g = await page.locator('.ed-drag-handle').first().boundingBox();
  if (!g) return 'the handle has no box';

  await dndPointerDrag({ x: Math.round(g.x + g.width / 2), y: Math.round(g.y + g.height / 2) }, plan.drop);
  await page.waitForTimeout(300);

  const landed = await page.evaluate(
    () => document.querySelector('.ed-canvas-frame [data-path].is-selected')?.getAttribute('data-path') ?? null,
  );
  if (!landed) return 'nothing stayed selected after the move';
  const index = Number((landed.match(/b(\d+)$/) || [])[1] ?? -1);
  return index > 0 ? true : `the text block did not move down its column: selected ${landed}`;
});

// --- Move a whole section by dragging its handle ----------------------------

/*
 * Andy, 10 Aug 2026: sections must reorder by dragging too. The SAME gutter
 * handle serves a selected section; a sibling resolver (useSectionDrop) finds the
 * gap between sections and the shell runs moveSection. Select the first section,
 * drag its handle down onto the lower half of the next one, and the shell
 * reselects it by id, so its own path is where it ended up, below the s0 it
 * started at.
 *
 * The seed is taller than the viewport, so the next section's lower half sits
 * below the fold on first load, and a drop clamped to the screen edge lands in
 * its UPPER half instead, where the gap resolves BEFORE it and the move is a
 * no-op (s0 -> s0, the 11 Aug 2026 false failure). So scroll the canvas to bring
 * the next section fully into view first, WHILE leaving a sliver of s0 at the top
 * that keeps its handle pinned there, then drop below the next section's middle.
 */
await check('a section is moved by dragging its handle', async () => {
  const ok = await page.evaluate(() => {
    const sections = [...document.querySelectorAll('.ed-canvas-frame [data-path]')].filter((el) =>
      /^s\d+$/.test(el.getAttribute('data-path') || ''),
    );
    if (sections.length < 2) return false;
    const first = sections.find((s) => s.getAttribute('data-path') === 's0') ?? sections[0];
    first.scrollIntoView({ block: 'start' });
    first.click(); // select the section
    return true;
  });
  if (!ok) return 'need two sections to reorder';
  await page.waitForTimeout(250);

  const before = await page.evaluate(
    () => document.querySelector('.ed-canvas-frame [data-path].is-selected')?.getAttribute('data-path') ?? null,
  );
  if (!/^s\d+$/.test(before || '')) return `the section did not select: ${before}`;
  const oldIndex = Number((before.match(/^s(\d+)$/) || [])[1] ?? -1);

  // Bring the next section's lower half onto the screen, keeping s0's sliver up
  // top so its handle stays pinned there. Then aim below the next section's
  // middle, so the gap resolves AFTER it and the move is never a no-op.
  const plan = await page.evaluate(() => {
    const wrap = document.querySelector('.ed-canvas-wrap');
    const next = document.querySelector('.ed-canvas-frame [data-path="s1"]');
    if (!wrap || !next) return null;
    const w = wrap.getBoundingClientRect();
    // s1's top ~180px below the canvas top: enough of s1 shows for its lower half
    // to clear the fold, and s0's bottom sliver still overlaps the top edge.
    wrap.scrollTop += next.getBoundingClientRect().top - (w.top + 180);
    const r = next.getBoundingClientRect();
    const middle = r.top + r.height / 2;
    const y = Math.min(r.top + r.height * 0.7, window.innerHeight - 12);
    return {
      belowMiddle: y > middle,
      drop: {
        x: Math.round(Math.min(Math.max(r.left + r.width / 2, 8), window.innerWidth - 8)),
        y: Math.round(y),
      },
    };
  });
  if (!plan) return 'no next section to drop onto';
  if (!plan.belowMiddle) return 'could not aim the drop below the next section';
  await page.waitForTimeout(250);

  if ((await page.locator('.ed-drag-handle').count()) === 0) return 'no move handle on the section';
  const g = await page.locator('.ed-drag-handle').first().boundingBox();
  if (!g) return 'the handle has no box';

  await dndPointerDrag({ x: Math.round(g.x + g.width / 2), y: Math.round(g.y + g.height / 2) }, plan.drop);
  await page.waitForTimeout(300);

  const after = await page.evaluate(
    () => document.querySelector('.ed-canvas-frame [data-path].is-selected')?.getAttribute('data-path') ?? null,
  );
  if (!/^s\d+$/.test(after || '')) return `nothing section-shaped stayed selected: ${after}`;
  const newIndex = Number((after.match(/^s(\d+)$/) || [])[1] ?? -1);
  return newIndex > oldIndex ? true : `the section did not move down: ${before} -> ${after}`;
});

// --- A design box on an element, in a sectioned pane ------------------------

/*
 * Andy: every element needs a full design suite, and the right-hand pane must be
 * sections with all but the first collapsed. The review batch gives text, image,
 * cards and button a box. Selecting a text element should show grouped sections
 * with one open, and setting a shadow should draw the box on the canvas.
 */
await check('an element pane is grouped into sections, only the first open', async () => {
  const selected = await page.evaluate(() => {
    const host = document.querySelector('.ed-canvas-frame .tgs-text')?.closest('[data-path]');
    if (!host) return false;
    host.click();
    return true;
  });
  if (!selected) return 'no text element on the canvas to select';
  await page.waitForTimeout(250);
  const groups = await page.locator('.ed-props .ed-group').count();
  const open = await page.locator('.ed-props .ed-group[data-open="true"]').count();
  if (groups < 2) return `expected several sections, saw ${groups}`;
  return open === 1 ? true : `expected exactly one open section, saw ${open}`;
});

await check('setting a shadow on an element draws its box on the canvas', async () => {
  await page.evaluate(() => {
    document.querySelector('.ed-canvas-frame .tgs-text')?.closest('[data-path]')?.click();
  });
  await page.waitForTimeout(200);
  await page.locator('.ed-props .ed-group__head button', { hasText: 'Effects' }).click();
  await page.waitForTimeout(150);
  await page.locator('select[aria-label="Shadow"]').selectOption('strong');
  await page.waitForTimeout(300);
  const boxed = await page
    .locator('.ed-canvas-frame .tgs-block[data-boxed][data-shadow="strong"]')
    .count();
  return boxed > 0 ? true : 'the element did not gain a box after a shadow was set';
});

// --- Per-screen styling: spacing set on one screen, not the others ----------

/*
 * Andy, 11 Aug 2026: styling per breakpoint, so a page looks right on each
 * screen size. The engine is desktop-base plus tablet/phone overrides, rendered
 * as inline custom properties that static container queries fold in (see
 * lib/content/responsive.ts). This drives the first control on it, a section's
 * vertical spacing: select a section, switch the device to Phone, set the
 * spacing, and prove the phone value is stored and applied while the desktop base
 * is untouched. Left near the end, since it changes the seed and the viewport.
 */
await check('a section spacing set on Phone changes phone, not desktop', async () => {
  const info = await page.evaluate(() => {
    const sec = [...document.querySelectorAll('.ed-canvas-frame [data-path]')].find((el) =>
      /^s\d+$/.test(el.getAttribute('data-path') || ''),
    );
    if (!sec) return null;
    sec.scrollIntoView({ block: 'center' });
    sec.click();
    const m = (sec.getAttribute('style') || '').match(/--tgs-pad:\s*(\d+)px/);
    return { path: sec.getAttribute('data-path'), base: m ? Number(m[1]) : null };
  });
  if (!info || info.base == null) return 'no section with a base padding to work from';
  await page.waitForTimeout(200);

  // The device switcher to Phone: the pane's spacing control now edits the phone
  // size, and the canvas becomes a phone-width container.
  await page.getByRole('button', { name: 'Phone', exact: true }).click();
  await page.waitForTimeout(200);

  // A preset clearly different from the base, clicked in the now-scoped control.
  const want = info.base >= 32 ? { label: 'None', value: 0 } : { label: 'XL', value: 64 };
  const preset = page
    .locator('.ed-props .ed-screen-scope button', { hasText: new RegExp(`^${want.label}$`) });
  if ((await preset.count()) === 0) return 'the spacing control was not scoped to the screen';
  await preset.first().click();
  await page.waitForTimeout(200);

  const after = await page.evaluate((path) => {
    const sec = document.querySelector(`.ed-canvas-frame [data-path="${path}"]`);
    const style = sec?.getAttribute('style') || '';
    const phone = style.match(/--tgs-pad-phone:\s*(\d+)px/);
    const base = style.match(/--tgs-pad:\s*(\d+)px/);
    return {
      phone: phone ? Number(phone[1]) : null,
      base: base ? Number(base[1]) : null,
      padTop: parseFloat(getComputedStyle(sec).paddingTop),
    };
  }, info.path);
  if (after.phone !== want.value) return `the phone override was not stored: ${after.phone}`;
  if (after.base !== info.base) return `the desktop base changed under a phone edit: ${info.base} -> ${after.base}`;

  // The padding follows the override at phone width and the base at desktop.
  const phonePad = after.padTop;
  await page.getByRole('button', { name: 'Desktop', exact: true }).click();
  await page.waitForTimeout(200);
  const desktopPad = await page.evaluate((path) => {
    const sec = document.querySelector(`.ed-canvas-frame [data-path="${path}"]`);
    return parseFloat(getComputedStyle(sec).paddingTop);
  }, info.path);
  // Selecting Desktop deliberately folds the side panels away when the canvas
  // cannot otherwise reach a tablet's width (EditorShell.chooseViewport, a
  // shortcut Andy asked for). Reopen them so this check leaves the editor as it
  // found it, the panels-shown state the next check inherits.
  await showPanels();
  return Math.abs(desktopPad - phonePad) > 8
    ? true
    : `padding did not change per screen: phone ${phonePad}, desktop ${desktopPad}`;
});

// --- Per-screen text size: a block's size set on one screen, not the others --

/*
 * Andy, 11 Aug 2026, slice two of styling per breakpoint: text size per screen,
 * so a headline that fits on desktop can be dialled down on a phone. The same
 * engine as the spacing above, one level down: the block carries its per-screen
 * size as an inline custom property (--tgs-fs-phone) and the static container
 * queries fold it into --tgs-fs-r, which .tgs-heading reads ahead of its own size.
 * Add a heading, switch the device to Phone, pick a small size, and prove the
 * phone value renders while the block's desktop size is untouched.
 */
await page.reload();
await page.waitForSelector('.ed-root');
await showPanels();

await check('a block text size set on Phone shrinks phone, not desktop', async () => {
  await addBlock('Heading');
  const host = added();
  if ((await host.count()) !== 1) return `${await host.count()} blocks selected after adding`;
  const info = await host.evaluate((el) => {
    const text = el.matches('.tgs-heading, .tgs-text') ? el : el.querySelector('.tgs-heading, .tgs-text');
    return { path: el.getAttribute('data-path'), deskPx: text ? parseFloat(getComputedStyle(text).fontSize) : null };
  });
  if (!info || info.deskPx == null) return 'the heading did not render its text';

  // The device switcher to Phone: the Text size control now edits the phone size.
  await page.getByRole('button', { name: 'Phone', exact: true }).click();
  await page.waitForTimeout(200);

  // The Text size dropdown lives in the block pane's per-screen scope; the spacing
  // control is a section one and not shown here, so this select is unambiguous.
  const select = page.locator('.ed-props .ed-screen-scope select').first();
  if ((await select.count()) === 0) return 'the text size control was not scoped to the screen';
  await select.selectOption('0.75rem'); // Tiny, far below any heading's own size.
  await page.waitForTimeout(200);

  const after = await page.evaluate((path) => {
    const el = document.querySelector(`.ed-canvas-frame [data-path="${path}"]`);
    const text = el.matches('.tgs-heading, .tgs-text') ? el : el.querySelector('.tgs-heading, .tgs-text');
    const style = el.getAttribute('style') || '';
    const m = style.match(/--tgs-fs-phone:\s*([^;]+)/);
    return { phoneVar: m ? m[1].trim() : null, phonePx: parseFloat(getComputedStyle(text).fontSize) };
  }, info.path);
  if (after.phoneVar !== '0.75rem') return `the phone override was not stored: ${after.phoneVar}`;
  if (!(after.phonePx < info.deskPx - 2)) {
    return `phone text did not shrink: phone ${after.phonePx}, desktop ${info.deskPx}`;
  }

  // Back to Desktop: the block's own size returns, untouched by the phone edit.
  await page.getByRole('button', { name: 'Desktop', exact: true }).click();
  await page.waitForTimeout(200);
  const deskAgain = await page.evaluate((path) => {
    const el = document.querySelector(`.ed-canvas-frame [data-path="${path}"]`);
    const text = el.matches('.tgs-heading, .tgs-text') ? el : el.querySelector('.tgs-heading, .tgs-text');
    return parseFloat(getComputedStyle(text).fontSize);
  }, info.path);
  // Selecting Desktop folds the panels (see the spacing check); reopen them.
  await showPanels();
  return Math.abs(deskAgain - info.deskPx) < 0.5
    ? true
    : `the desktop size changed under a phone edit: ${info.deskPx} -> ${deskAgain}`;
});

/*
 * Andy, 11 Aug 2026, bug two: changing a font size left the line spacing holding
 * room for the bigger text. Line spacing per screen, on the same engine as the
 * size above: the block carries --tgs-lh-phone and the container queries fold it
 * into --tgs-lh-r, which .tgs-heading reads. Unitless, so it also flows into the
 * spans a heading is wrapped in. Add a heading, switch to Phone, tighten the
 * spacing, and prove the phone line-height drops while the desktop one holds.
 */
await check('a block line spacing set on Phone tightens phone, not desktop', async () => {
  await addBlock('Heading');
  const host = added();
  if ((await host.count()) !== 1) return `${await host.count()} blocks selected after adding`;
  const info = await host.evaluate((el) => {
    const text = el.matches('.tgs-heading, .tgs-text') ? el : el.querySelector('.tgs-heading, .tgs-text');
    return { path: el.getAttribute('data-path'), deskLh: text ? parseFloat(getComputedStyle(text).lineHeight) : null };
  });
  if (!info || !Number.isFinite(info.deskLh)) return 'the heading did not render its text';

  // The device switcher to Phone: the Line spacing control now edits the phone value.
  await page.getByRole('button', { name: 'Phone', exact: true }).click();
  await page.waitForTimeout(200);

  // The line-spacing select is the block pane's second per-screen scope, so target
  // it by id rather than by order to keep it apart from the text-size one beside it.
  const select = page.locator('.ed-props select[id^="ed-line-spacing"]').first();
  if ((await select.count()) === 0) return 'the line spacing control was not scoped to the screen';
  await select.selectOption('0.8'); // Very tight, well below any heading's own leading.
  await page.waitForTimeout(200);

  const after = await page.evaluate((path) => {
    const el = document.querySelector(`.ed-canvas-frame [data-path="${path}"]`);
    const text = el.matches('.tgs-heading, .tgs-text') ? el : el.querySelector('.tgs-heading, .tgs-text');
    const style = el.getAttribute('style') || '';
    const m = style.match(/--tgs-lh-phone:\s*([^;]+)/);
    return { phoneVar: m ? m[1].trim() : null, phoneLh: parseFloat(getComputedStyle(text).lineHeight) };
  }, info.path);
  if (after.phoneVar !== '0.8') return `the phone override was not stored: ${after.phoneVar}`;
  if (!(after.phoneLh < info.deskLh - 2)) {
    return `phone line height did not tighten: phone ${after.phoneLh}, desktop ${info.deskLh}`;
  }

  // Back to Desktop: the block's own line spacing returns, untouched by the phone edit.
  await page.getByRole('button', { name: 'Desktop', exact: true }).click();
  await page.waitForTimeout(200);
  const deskAgain = await page.evaluate((path) => {
    const el = document.querySelector(`.ed-canvas-frame [data-path="${path}"]`);
    const text = el.matches('.tgs-heading, .tgs-text') ? el : el.querySelector('.tgs-heading, .tgs-text');
    return parseFloat(getComputedStyle(text).lineHeight);
  }, info.path);
  await showPanels();
  return Math.abs(deskAgain - info.deskLh) < 0.5
    ? true
    : `the desktop line height changed under a phone edit: ${info.deskLh} -> ${deskAgain}`;
});

/*
 * Andy, 11 Aug 2026, bug three: an auto-resize option so text scales with the
 * screen rather than holding one size. A block marked data-fluid swaps its
 * font-size for a clamp keyed on the .tgs-page container (globals.css), so a
 * heading comes down on a phone without a size for each screen. Add a heading,
 * give it a large size, turn auto-resize on, and prove the phone size drops below
 * the desktop one while the desktop size holds.
 */
await check('auto-resize brings a heading down on a phone, not on desktop', async () => {
  await addBlock('Heading');
  const host = added();
  if ((await host.count()) !== 1) return `${await host.count()} blocks selected after adding`;
  const path = await host.evaluate((el) => el.getAttribute('data-path'));

  // A large desktop size, so the fluid clamp has room to come down on a phone.
  const sizeSelect = page.locator('.ed-props select[id^="ed-text-size"]').first();
  if ((await sizeSelect.count()) === 0) return 'the text size control was not found';
  await sizeSelect.selectOption('var(--tgs-h1-size)');
  await page.waitForTimeout(150);

  // Turn auto-resize on.
  const toggle = page.getByRole('checkbox', { name: /Auto-resize/ });
  if ((await toggle.count()) === 0) return 'the auto-resize toggle was not offered';
  await toggle.check();
  await page.waitForTimeout(150);

  const measure = (p) =>
    page.evaluate((dataPath) => {
      const el = document.querySelector(`.ed-canvas-frame [data-path="${dataPath}"]`);
      const text = el.matches('.tgs-heading, .tgs-text') ? el : el.querySelector('.tgs-heading, .tgs-text');
      return { fluid: el.hasAttribute('data-fluid'), px: parseFloat(getComputedStyle(text).fontSize) };
    }, p);

  const desk = await measure(path);
  if (!desk.fluid) return 'the block was not marked data-fluid';

  await page.getByRole('button', { name: 'Phone', exact: true }).click();
  await page.waitForTimeout(200);
  const phone = await measure(path);

  // Back to Desktop: the size returns to its ceiling, unchanged by the phone width.
  await page.getByRole('button', { name: 'Desktop', exact: true }).click();
  await page.waitForTimeout(200);
  const deskAgain = await measure(path);
  await showPanels();

  if (!(phone.px < desk.px - 3)) return `phone did not shrink: phone ${phone.px}, desktop ${desk.px}`;
  if (Math.abs(deskAgain.px - desk.px) > 1) return `desktop changed under the phone view: ${desk.px} -> ${deskAgain.px}`;
  return true;
});

/*
 * Andy, 11 Aug 2026: a one-click clean for a heading whose words are wrapped in a
 * stack of leftover size spans (his hero, eleven deep), which override the size and
 * auto-resize controls and hold the line open. Clear text sizing strips the
 * font-size off every span so the block's own size takes over. SEED_PAGE has no such
 * heading, so this drops one in with nested 120px and 100px spans and clears it.
 */
await check('clear text sizing strips the fixed sizes off a heading', async () => {
  await closeAnyDialog();
  await page.evaluate(() =>
    window.__TG_SET_PAGE__({
      id: 'clr',
      slug: 'clear',
      title: 'Clear',
      version: 1,
      sections: [
        {
          id: 's',
          width: 'contained',
          tone: 'light',
          rows: [
            {
              id: 'r',
              gap: 16,
              columns: [
                {
                  id: 'c',
                  width: 100,
                  blocks: [
                    {
                      id: 'h',
                      type: 'heading',
                      props: {
                        level: 2,
                        style: 'h2',
                        html: '<span style="font-size: 120px"><span style="font-size: 100px">Oversized heading</span></span>',
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }),
  );
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Desktop' }).click();
  await page.waitForTimeout(150);
  await showPanels();

  // The words render oversized to begin with, from the inline spans.
  const before = await page.evaluate(() => {
    const sized = document.querySelector('.ed-canvas-frame .tgs-heading [style*="font-size"]');
    return sized ? parseFloat(getComputedStyle(sized).fontSize) : null;
  });
  if (before == null || before < 90) {
    await page.evaluate(() => window.__TG_SET_PAGE__(null));
    return `the oversized heading did not render: ${before}`;
  }

  // Select the heading, then clear its sizing from the pane.
  await page.locator('.ed-canvas-frame .tgs-heading').first().click();
  await page.waitForTimeout(200);
  const clearBtn = page.getByRole('button', { name: 'Clear text sizing' });
  if ((await clearBtn.count()) === 0) {
    await page.evaluate(() => window.__TG_SET_PAGE__(null));
    return 'the clear control was not offered';
  }
  await clearBtn.click();
  await page.waitForTimeout(250);

  const after = await page.evaluate(() => {
    const heading = document.querySelector('.ed-canvas-frame .tgs-heading');
    return {
      sized: heading.querySelectorAll('[style*="font-size"]').length,
      text: (heading.textContent || '').trim(),
      px: parseFloat(getComputedStyle(heading).fontSize),
    };
  });

  await page.evaluate(() => window.__TG_SET_PAGE__(null));
  await page.waitForTimeout(250);
  await showPanels();

  if (after.sized > 0) return `a fixed size survived the clear: ${after.sized} left`;
  if (after.text !== 'Oversized heading') return `the words were lost: ${JSON.stringify(after.text)}`;
  if (!(after.px < before - 30)) return `the heading did not return to its own size: ${before} -> ${after.px}`;
  return true;
});

// --- Preview mode: the site as it will publish, full canvas -----------------

/*
 * Andy, 11 Aug 2026: a Preview button that shows the site as it will publish,
 * full width, with the side panels gone. Preview renders the canvas
 * editable=false, so the reliable tell is the published DOM: the editing hooks
 * (data-path) vanish and both side panels hide, and both come back on exit.
 * Interacting "as if live" needs no script here, since almost every control is
 * native (a details accordion, radio tabs, links), and editable=false is what
 * stops the editor swallowing them. Left last, since it changes the whole
 * layout.
 */
await check('preview shows the published page full width, then restores editing', async () => {
  // Editing to begin with: the canvas carries data-path hooks and both panels
  // are on screen.
  const before = await page.locator('.ed-canvas-frame [data-path]').count();
  if (before === 0) return 'no editing hooks to begin with';
  if (!(await page.locator('.ed-props').isVisible())) return 'the settings panel was not there to begin with';

  const preview = page.getByRole('button', { name: 'Preview', exact: true });
  if ((await preview.count()) === 0) return 'no Preview button';
  await preview.click();
  await page.waitForTimeout(250);

  // Both side panels are gone.
  if (await page.locator('.ed-outline').isVisible()) return 'the page panel was still visible in preview';
  if (await page.locator('.ed-props').isVisible()) return 'the settings panel was still visible in preview';
  // The canvas is the published DOM now: no editing hooks left on it.
  const during = await page.locator('.ed-canvas-frame [data-path]').count();
  if (during !== 0) return `preview still had ${during} editing hooks on the canvas`;

  // The way back out, and editing returns with it.
  const exit = page.getByRole('button', { name: 'Exit preview', exact: true });
  if ((await exit.count()) === 0) return 'no way back out of preview';
  await exit.click();
  await page.waitForTimeout(250);

  const after = await page.locator('.ed-canvas-frame [data-path]').count();
  if (after === 0) return 'editing did not come back after exit';
  if (!(await page.locator('.ed-props').isVisible())) return 'the settings panel did not return after exit';
  return true;
});

// --- Preview with the panels folded -----------------------------------------

/*
 * Andy, 11 Aug 2026: with both side panels folded, pressing Preview showed a
 * blank screen. The panels fold by narrowing their grid track to 0 (the media
 * block up top), and that folded rule is more specific than the preview one, so
 * in preview the columns stayed `0 1fr 0` while the areas collapsed to a single
 * `canvas` column: the canvas (.ed-canvas-wrap holds grid-area: canvas) mapped
 * to the 0px track and vanished. The guard is that folding does not apply in
 * preview.
 */
await check('preview fills the canvas even with the panels folded', async () => {
  await closeAnyDialog();
  await page.setViewportSize({ width: 1440, height: 900 });
  await foldPanels();
  await page.waitForTimeout(200);

  const preview = page.getByRole('button', { name: 'Preview', exact: true });
  if ((await preview.count()) === 0) {
    await showPanels();
    return 'no Preview button';
  }
  await preview.click();
  await page.waitForTimeout(300);

  // The canvas column is the whole width now, not a 0px sliver, and a section
  // shows in it. Before the fix .ed-canvas-wrap measured 0 and the screen was blank.
  const canvas = await page.locator('.ed-canvas-wrap').boundingBox().catch(() => null);
  const sectionShown = await page
    .locator('.ed-canvas-frame .tgs-section')
    .first()
    .isVisible()
    .catch(() => false);

  const exit = page.getByRole('button', { name: 'Exit preview', exact: true });
  if (await exit.count()) {
    await exit.click();
    await page.waitForTimeout(200);
  }
  await showPanels();

  if (!canvas || canvas.width < 800) return `the canvas collapsed in a folded preview: ${JSON.stringify(canvas)}`;
  if (!sectionShown) return 'no section showed in a folded preview';
  return true;
});

/*
 * The other half of the same report: leaving preview left the workspace with no
 * side panels at all. A wide Desktop folds them to make room, and exiting preview
 * to a toolless canvas read as the panels being eaten. Exit is an explicit "back
 * to editing", so it reopens them; a width that cannot hold both then shows a
 * narrower canvas rather than silently hiding them again.
 */
await check('leaving preview brings the side panels back', async () => {
  await closeAnyDialog();
  await page.setViewportSize({ width: 1440, height: 900 });
  await foldPanels();
  await page.waitForTimeout(200);

  const foldedOutline = !(await page.locator('.ed-outline').isVisible().catch(() => true));
  const foldedProps = !(await page.locator('.ed-props').isVisible().catch(() => true));
  if (!foldedOutline || !foldedProps) {
    await showPanels();
    return 'the panels were not folded to begin with';
  }

  const preview = page.getByRole('button', { name: 'Preview', exact: true });
  await preview.click();
  await page.waitForTimeout(250);
  const exit = page.getByRole('button', { name: 'Exit preview', exact: true });
  await exit.click();
  await page.waitForTimeout(300);

  const outlineBack = await page.locator('.ed-outline').isVisible();
  const propsBack = await page.locator('.ed-props').isVisible();
  if (!outlineBack) return 'the page panel did not come back after leaving preview';
  if (!propsBack) return 'the settings panel did not come back after leaving preview';
  return true;
});

// --- Preview keeps a widget on screen ---------------------------------------

/*
 * Andy, 11 Aug 2026: the Contact page's third section was an enquiry widget, and
 * pressing Preview blanked it. A widget draws differently in the two places it
 * lives, its own iframe on the canvas because the editor loads no widget scripts,
 * and a bare container on the published page that WidgetScripts fills. Preview
 * turns `editable` off, and keyed on that alone the widget flipped to the bare
 * container the editor never fills, so the section went empty. It has to keep its
 * own frame straight through preview. SEED_PAGE carries no widget, so this drops
 * one in through the harness handle and takes it out again after.
 */
await check('a widget keeps its frame when the page is previewed', async () => {
  await closeAnyDialog();
  await page.evaluate(() =>
    window.__TG_SET_PAGE__({
      id: 'wtest',
      slug: 'widget-preview',
      title: 'Widget preview',
      version: 1,
      sections: [
        {
          id: 'sec_w',
          width: 'contained',
          tone: 'light',
          rows: [
            {
              id: 'row_w',
              gap: 16,
              columns: [
                {
                  id: 'col_w',
                  width: 100,
                  blocks: [
                    {
                      id: 'blk_w',
                      type: 'widget',
                      props: { widget: 'enquiry', widgetId: 'tgw_previewtest_enquiry01' },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }),
  );
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Desktop' }).click();
  await page.waitForTimeout(200);
  await showPanels();

  // On the canvas to begin with, the widget hosts itself in a frame.
  const framedEditing = await page.locator('.ed-canvas-frame .tgs-widget-frame iframe').count();
  if (framedEditing === 0) {
    await page.evaluate(() => window.__TG_SET_PAGE__(null));
    return 'the widget had no frame on the canvas to begin with';
  }

  const preview = page.getByRole('button', { name: 'Preview', exact: true });
  if ((await preview.count()) === 0) {
    await page.evaluate(() => window.__TG_SET_PAGE__(null));
    return 'no Preview button';
  }
  await preview.click();
  await page.waitForTimeout(350);

  // The whole point: STILL a frame, never the bare container the editor cannot
  // fill. Before the fix, preview drew `.tgs-widget` and the section went blank.
  const framedPreview = await page.locator('.ed-canvas-frame .tgs-widget-frame iframe').count();
  const barePreview = await page.locator('.ed-canvas-frame .tgs-widget').count();
  const box = await page
    .locator('.ed-canvas-frame .tgs-widget-frame')
    .first()
    .boundingBox()
    .catch(() => null);

  // Out of preview, and back to the seed for whatever runs next.
  const exit = page.getByRole('button', { name: 'Exit preview', exact: true });
  if (await exit.count()) {
    await exit.click();
    await page.waitForTimeout(200);
  }
  await page.evaluate(() => window.__TG_SET_PAGE__(null));
  await page.waitForTimeout(300);

  if (framedPreview === 0) return 'the widget lost its frame in preview: the blank-section bug';
  if (barePreview > 0) return 'preview drew the bare .tgs-widget container the editor never fills';
  if (!box || box.width < 200) return `the widget frame collapsed in preview: ${JSON.stringify(box)}`;
  return true;
});

await browser.close();

let failed = false;
console.log('');
for (const [name, status] of checks) {
  if (!status.startsWith('PASS')) failed = true;
  console.log(`  ${status.padEnd(28)} ${name}`);
}

if (errors.length > 0) {
  failed = true;
  console.log('\n  Console errors:');
  for (const error of errors) console.log(`    ${error}`);
} else {
  console.log('\n  No console errors.');
}

console.log('');
process.exit(failed ? 1 : 0);
