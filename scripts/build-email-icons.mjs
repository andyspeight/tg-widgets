/**
 * Build the PNG icons the booking email uses (24 Sep 2026).
 *
 * Andy: emoji "are not acceptable in our designs", and "there should still be
 * relevant icons, just not emojis". An email cannot carry the SVG icons the
 * booking page draws (Gmail strips inline SVG, and SVG images too), so the
 * email uses small PNGs instead, drawn from THE SAME SVG PATHS the My Booking
 * widget uses. The paths are read out of public/widget-mybooking.js's IC set
 * rather than copied here, so the page and the email cannot draw two different
 * cars. The paperclip is the one glyph the widget has no use for, so it lives
 * here.
 *
 * Two looks:
 *   chip   32px, a rounded neutral square with the glyph on it, echoing the
 *          icon chip on the page's tiles. Neutral rather than the client's
 *          accent, because a PNG cannot change colour per client and a cyan
 *          chip in a red-branded email would clash. Used by "Add to your trip".
 *   glyph  18px, the glyph alone, for inline use beside a line of text
 *          (the documents list, the booking pack note).
 *
 * Drawn at 3x for sharp screens. Output: public/email-icons/*.png, served from
 * https://widgets.travelify.io/email-icons/ and referenced by
 * public/_booking-email-template.js. Re-run after changing an icon:
 *
 *   npm run build:email-icons
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const WIDGET = readFileSync(new URL('../public/widget-mybooking.js', import.meta.url), 'utf8');
// Read inside the IC block ONLY. The widget also carries translated strings
// with the same keys ("ticket: 'Ticket'" in five languages), and the first
// build of these icons took that word for a drawing and made an empty chip.
const IC_BLOCK = (() => {
  const at = WIDGET.indexOf('const IC = {');
  const end = at === -1 ? -1 : WIDGET.indexOf('\n  };', at);
  if (at === -1 || end === -1) throw new Error('No IC block in widget-mybooking.js');
  return WIDGET.slice(at, end);
})();
export const ic = (name) => {
  const m = IC_BLOCK.match(new RegExp('^\\s+' + name + ":\\s+'([^']+)',", 'm'));
  if (!m) throw new Error('No IC.' + name + ' in widget-mybooking.js');
  // A drawing starts with a move. Anything else is not a path.
  if (!/^M[\d.]/.test(m[1])) throw new Error('IC.' + name + ' is not an SVG path: ' + m[1].slice(0, 30));
  return m[1];
};
const PAPERCLIP = 'M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48';

// name -> [look, path]
export const EMAIL_ICONS = {
  'upsell-tickets':   ['chip', ic('ticket')],
  'upsell-car':       ['chip', ic('car')],
  'upsell-transfers': ['chip', ic('van')],
  'upsell-extras':    ['chip', ic('lounge')],
  'doc-file':         ['glyph', ic('file')],
  'doc-paperclip':    ['glyph', PAPERCLIP],
};

const SCALE = 3;
const INK = '#334155';        // slate, the email's own heading colour family
const CHIP = '#E8EEF5';       // a shade under the email's #f8fafc cards
const paths = (p) => p.split(/(?=M)/).map((d) => `<path d="${d}"/>`).join('');

function markup(look, p) {
  if (look === 'chip') {
    const box = 32 * SCALE, glyph = 18 * SCALE;
    return `<div id="i" style="width:${box}px;height:${box}px;border-radius:${8 * SCALE}px;background:${CHIP};display:flex;align-items:center;justify-content:center">
      <svg viewBox="0 0 24 24" width="${glyph}" height="${glyph}" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths(p)}</svg></div>`;
  }
  const box = 18 * SCALE;
  return `<div id="i" style="width:${box}px;height:${box}px;display:flex"><svg viewBox="0 0 24 24" width="${box}" height="${box}" fill="none" stroke="#475569" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths(p)}</svg></div>`;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const browser = await chromium.launch({ executablePath: process.env.TG_CHROMIUM || '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  for (const [name, [look, p]] of Object.entries(EMAIL_ICONS)) {
    await page.setContent(`<body style="margin:0;background:transparent">${markup(look, p)}</body>`);
    await page.locator('#i').screenshot({ path: new URL('../public/email-icons/' + name + '.png', import.meta.url).pathname, omitBackground: true });
    console.log('built', name);
  }
  await browser.close();
}
