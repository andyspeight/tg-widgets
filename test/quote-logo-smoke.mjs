/**
 * Quote PDF — the logo is readable (8 Sep 2026).
 *
 * Travel Wizards uploaded their logo and it was "so small on the PDF you
 * can't see it". Three things were behind that: a fixed 44px box that made a
 * wide wordmark a sliver on an A4 top bar; uploads kept all the empty canvas
 * around the mark, so the box showed mostly padding; and the editor showed the
 * thumbnail on white, so a dark logo on a dark bar looked fine until the PDF.
 *
 * Now: a Logo size choice (small / medium / large, medium default and bigger
 * than before) carried by the PDF, the covering email and the preview; the
 * uploader trims transparent or white padding before scaling; the thumbnail
 * sits on the real top-bar colour.
 *
 * Run: node test/quote-logo-smoke.mjs   (npm run test:quote-logo)
 */
import { readFileSync } from 'node:fs';
import { renderQuoteHTML } from '../render-quote.js';
import { renderQuoteEmail } from '../public/_quote-email-template.js';

const R = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const EDITOR = R('public/editor-quote-pdf.html');
const SENDER = R('api/quote-pdf.js');
let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

const LOGO = 'https://kxxtsfbku4di3qly.public.blob.vercel-storage.com/widget-logos/logo-x.png';
const doc = { data: { quoteDocument: { setup: { quoteTitle: 'Dubai' }, items: [{ type: 'hotels', hotelName: 'Atlantis', price: 3200, currency: 'GBP', images: [] }], total: 3200 } } };
const pdf = (logoSize) => renderQuoteHTML(doc, { brand: { name: 'Travel Wizards', logoUrl: LOGO, logoSize } });
const boxOf = (html) => { const m = /\.brand-logo\{max-height:(\d+)px;max-width:(\d+)px/.exec(html); return m ? { h: +m[1], w: +m[2] } : null; };

console.log('The PDF gives the logo a bigger box, and a size the client chose');
{
  ok('medium is the default and bigger than the old 44px', JSON.stringify(boxOf(pdf(undefined))) === JSON.stringify({ h: 60, w: 320 }));
  ok('small', JSON.stringify(boxOf(pdf('small'))) === JSON.stringify({ h: 40, w: 220 }));
  ok('large', JSON.stringify(boxOf(pdf('large'))) === JSON.stringify({ h: 84, w: 420 }));
  ok('an unknown value falls back to medium', JSON.stringify(boxOf(pdf('huge'))) === JSON.stringify({ h: 60, w: 320 }));
  ok('the logo still renders in the top bar', pdf('medium').includes('class="brand-logo"'));
}

console.log('\nThe covering email carries the same choice');
{
  const em = (logoSize) => renderQuoteEmail({ brand: { name: 'Travel Wizards', logoUrl: LOGO, logoSize }, quoteTitle: 'Dubai' }).html;
  ok('medium by default, 44px tall', /height="44" style="display:block;height:44px;max-width:280px/.test(em(undefined)));
  ok('small 30px', /height="30" style="display:block;height:30px;max-width:200px/.test(em('small')));
  ok('large 60px', /height="60" style="display:block;height:60px;max-width:340px/.test(em('large')));
}

console.log('\nThe endpoint forwards it and the editor offers it');
{
  ok('buildRenderOpts forwards logoSize', /logoSize: c\.logoSize,/.test(SENDER));
  ok('the config has a logoSize slot, medium by default', /logoUrl:'', logoSize:'medium',/.test(EDITOR));
  ok('a Small / Medium / Large control sits under the logo', /id="logosize-seg"/.test(EDITOR) && /data-size="small">Small<\/button>/.test(EDITOR) && /data-size="large">Large<\/button>/.test(EDITOR));
  ok('choosing a size updates the config and the preview', /C\.logoSize = LOGO_MOCK\[b\.dataset\.size\] \? b\.dataset\.size : 'medium';/.test(EDITOR));
  ok('the mock preview sizes the logo from the choice', /max-height:'\+LOGO_MOCK\[lsz\]\.h\+'px;max-width:'\+LOGO_MOCK\[lsz\]\.w\+'px/.test(EDITOR));
  ok('the email preview carries the choice', /logoSize: C\.logoSize \|\| 'medium',/.test(EDITOR));
  ok('the thumbnail sits on the top bar colour, and follows it', /\$\('logo-thumb'\)\.style\.background = bar;/.test(EDITOR) && /\/\^#\[0-9a-f\]\{6\}\$\/i\.test\(C\.colors\.topBar\) \? C\.colors\.topBar : DEFAULTS\.colors\.topBar/.test(EDITOR) && /if \(el\.dataset\.key === 'topBar'\) renderLogoState\(\);/.test(EDITOR));
}

console.log('\nThe uploader trims the empty canvas around the mark');
{
  const m = EDITOR.match(/function logoTrimBox\(data, w, h\) \{[\s\S]*?\n  \}/);
  ok('logoTrimBox is a pure, named function', !!m);
  const logoTrimBox = new Function(m[0] + '\nreturn logoTrimBox;')();
  // A 20x10 transparent canvas with an opaque mark at x 5..14, y 3..6.
  const mk = (w, h, fill, mark) => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; const on = x >= mark.x0 && x <= mark.x1 && y >= mark.y0 && y <= mark.y1; const px = on ? [30, 60, 140, 255] : fill; d[i] = px[0]; d[i + 1] = px[1]; d[i + 2] = px[2]; d[i + 3] = px[3]; } return d; };
  const t = logoTrimBox(mk(20, 10, [0, 0, 0, 0], { x0: 5, x1: 14, y0: 3, y1: 6 }), 20, 10);
  ok('transparent padding is trimmed to the mark (with a whisker of room)', t && t.x === 5 && t.y === 3 && t.w === 10 && t.h === 4);
  const wbox = logoTrimBox(mk(100, 100, [255, 255, 255, 255], { x0: 40, x1: 59, y0: 45, y1: 54 }), 100, 100);
  ok('white padding on an opaque image is trimmed too', wbox && wbox.x === 38 && wbox.y === 43 && wbox.w === 24 && wbox.h === 14);
  ok('a photo-like image with coloured corners is left alone', logoTrimBox(mk(20, 10, [120, 90, 60, 255], { x0: 5, x1: 14, y0: 3, y1: 6 }), 20, 10) === null);
  ok('an empty image is left alone', logoTrimBox(mk(20, 10, [0, 0, 0, 0], { x0: -1, x1: -1, y0: -1, y1: -1 }), 20, 10) === null);
  ok('the uploader draws the trimmed region, then scales it', /logoTrimBox\(wctx\.getImageData\(0, 0, ww, wh\)\.data, ww, wh\)/.test(EDITOR) && /ctx\.drawImage\(work, box\.x, box\.y, box\.w, box\.h, 0, 0, ow, oh\);/.test(EDITOR));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
