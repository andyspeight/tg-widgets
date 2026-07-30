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
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const file = resolve(here, '../standalone/out/tg-sites-editor.html');

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
const check = async (name, fn) => {
  try {
    const value = await fn();
    checks.push([name, value === true ? 'PASS' : `FAIL (${value})`]);
  } catch (error) {
    checks.push([name, `FAIL (${error.message})`]);
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

// Edit a heading and confirm the canvas updates.
await check('editing a field updates the preview', async () => {
  const input = page.locator('.ed-props input.ed-input').first();
  await input.fill('Feedback test heading');
  await page.waitForTimeout(300);
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

await check('block picker opens from a section', async () => {
  await page.getByRole('button', { name: 'Desktop' }).click();
  await page.waitForTimeout(200);
  await page.locator('.ed-sec-toggle').first().click();
  await page.waitForTimeout(300);
  await page.locator('.ed-add', { hasText: 'Add content' }).first().click();
  await page.waitForTimeout(300);
  return (await page.locator('.tg-modal').count()) === 1;
});

await check('block picker offers the full library', async () =>
  (await page.locator('.ed-block-card').count()) === 13);

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

await check('an insert point opens the layout picker', async () => {
  await page.locator('.ed-insert__btn').first().click();
  await page.waitForTimeout(300);
  const heading = await page.locator('.tg-modal__head').innerText();
  return heading.includes('Choose a layout') ? true : `head reads "${heading}"`;
});

await check('the picker offers the full layout set', async () =>
  (await page.locator('.ed-layout-card').count()) === 12);

await check('layout thumbnails are drawn, not described', async () =>
  (await page.locator('.ed-layout-card .ed-thumb rect').count()) > 12);

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

  const closed = page.locator('.ed-group__head button[aria-expanded="false"]');
  for (let i = await closed.count(); i > 0; i = await closed.count()) {
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
