/**
 * A dark-theme booking has to be readable (23 Sep 2026).
 *
 * Found while screenshotting the new "Add to your trip" section: on a booking
 * set to the dark theme, every heading, card title, label and input value on
 * the page was invisible. Not faint, invisible — the same colour as what was
 * behind it.
 *
 * The cause was one line, and it had nothing to do with the theme's own CSS,
 * which is correct. `_buildOverrides` writes the client's brand colours onto
 * `.tgm-root` as an INLINE style, and it always wrote `--tgm-text`, defaulting
 * to the light #0F172A. An inline declaration beats any stylesheet rule, so it
 * beat `.tgm-root[data-theme="dark"] { --tgm-text: #F8FAFC }` and the dark
 * theme's own text colour never applied. `--tgm-bg` went dark, `--tgm-text`
 * stayed dark, and the two met at #0F172A on #0F172A.
 *
 * It only bit `--tgm-text` because that is the only token the inline overrides
 * and the dark theme both set. So the rule is: a brand override is written only
 * when the client actually chose it, and otherwise the stylesheet decides,
 * because the stylesheet is the thing that knows which theme it is in.
 *
 * Static checks always run. The measurement runs when Playwright's Chromium is
 * here and skips cleanly otherwise.
 *
 * Run: node test/mybooking-dark-theme-smoke.mjs   (npm run test:mybooking-dark)
 */
import { readFileSync, existsSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (name, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
};
const SRC = readFileSync(new URL('../public/widget-mybooking.js', import.meta.url), 'utf8');

console.log('\nThe dark theme owns the text colour unless the client took it\n');
ok('the light default is named once, not typed out at each use',
  /const TEXT_DEFAULT = '#0F172A';/.test(SRC));
ok('the overrides no longer write --tgm-text unconditionally',
  !/'--tgm-text': safeColorM\(/.test(SRC));
ok('they write it only when it differs from the stylesheet default',
  /!== TEXT_DEFAULT\) overrides\['--tgm-text'\]/.test(SRC));
ok('and the dark theme still declares its own',
  /\.tgm-root\[data-theme="dark"\][^}]*--tgm-text: #F8FAFC/s.test(SRC));

let chromium = null;
try { ({ chromium } = await import('playwright')); } catch { /* not installed */ }
const exe = '/opt/pw-browsers/chromium';
if (!chromium || !existsSync(exe)) {
  console.log('\n(Playwright Chromium not available here: measurement skipped)');
} else {
  console.log('\nMeasured in Chromium');
  let browser = null;
  try { browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--disable-gpu'] }); }
  catch (e) { console.log('  (browser would not launch: ' + String(e.message).split('\n')[0] + ')'); }
  if (browser) {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await page.setContent('<!doctype html><html><body><div id="host"></div></body></html>');
    await page.addScriptTag({ content: SRC });
    const read = async (cfg) => page.evaluate((cfg) => {
      document.body.innerHTML = '<div id="h"></div>';
      const w = new window.TGMyBookingWidget(document.getElementById('h'),
        Object.assign({ support: { email: 'a@b.c' } }, cfg));
      w.state = { stage: 'found', order: { id: 'X', reference: 'X', items: [], summary: {} }, upsell: [], error: null };
      w._render();
      const root = w.shadow.querySelector('.tgm-root');
      const cs = getComputedStyle(root);
      return { text: cs.getPropertyValue('--tgm-text').trim(), bg: cs.getPropertyValue('--tgm-bg').trim() };
    }, cfg);

    const light = await read({});
    ok('light: dark text on a white page', light.text === '#0F172A' && light.bg === '#FFFFFF', JSON.stringify(light));

    const dark = await read({ theme: 'dark' });
    ok('dark: light text, not the light default', dark.text === '#F8FAFC', JSON.stringify(dark));
    ok('dark: on the dark page', dark.bg === '#0F172A', JSON.stringify(dark));
    ok('and the two are never the same colour', dark.text.toUpperCase() !== dark.bg.toUpperCase());

    // A client who picks their own text colour still gets it, in either theme.
    const chosen = await read({ theme: 'dark', colors: { text: '#FFE7A1' } });
    ok('a colour the client chose still wins over the theme', chosen.text === '#FFE7A1', JSON.stringify(chosen));

    await browser.close();
  }
}

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
