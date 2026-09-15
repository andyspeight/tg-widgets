/**
 * The booking PDF numbers its pages truthfully (15 Sep 2026).
 *
 * The footer read "Page 1 of 2" and "Page 2 of 2" on every confirmation we
 * produced, whatever the document actually ran to. It was already wrong on
 * Exclusively Travel's ET121109, which came to three pages, and a second hotel
 * later pushed it to four.
 *
 * Two things were wrong, not one:
 *
 *   THE COUNT   the numbers were typed into the template. Nothing in the
 *               document can know how many sheets it will take; only the print
 *               engine knows, and only at print time.
 *   THE PLACE   the footer is absolutely positioned inside a SECTION, so it
 *               printed once per section rather than once per sheet, and landed
 *               mid-document whenever a section ran over.
 *
 * So Chromium draws the printed footer now, into the @page bottom margin, on
 * every sheet, with its own pageNumber and totalPages. The body footer keeps
 * its place on screen, where the editor preview shows it, and hides itself
 * under print media.
 *
 * Verified by rendering the real thing and reading the text back off each page:
 * a one-hotel booking gave Page 1/2/3 of 3, a two-hotel booking 1/2/3/4 of 4,
 * one footer per sheet and no leftover "of 2" anywhere.
 *
 * Run: TGS_CHROMIUM=/opt/pw-browsers/chromium node test/booking-pdf-page-numbers-smoke.mjs
 *      (npm run test:booking-pdf-page-numbers)
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { renderPdfHtml, renderPdfFooterTemplate, PDF_HEADER_TEMPLATE } from '../public/_pdf-template.js';

const TPL = readFileSync(new URL('../public/_pdf-template.js', import.meta.url), 'utf8');
const API = readFileSync(new URL('../api/booking-pdf.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
};

const stay = (id, name, city, checkin, nights, price, room) => ({
  id, status: 'Confirmed', product: 'Accommodation', bookingReference: 'ET121109',
  price, currency: 'GBP', startDate: checkin, duration: nights,
  accommodation: {
    name, propertyType: 'Hotel', rating: 3,
    location: { address1: 'Krana', city, state: 'Rhodes', country: 'GR' },
    units: [{ name: room, roomType: room, checkin, nights, rates: [{ board: 'RoomOnly' }] }],
    pricing: { price, currency: 'GBP', isRefundable: false },
    descriptions: [{ title: 'Description', text: name + ' sits above the bay in ' + city + '.' }],
    amenities: ['Pool', 'Wi-Fi', 'Bar'],
    guests: [{ type: 'Lead', title: 'Mrs', firstname: 'Gemma', surname: 'Whitaker' }],
    media: [],
  },
});
const order = (items) => ({
  id: 64026875, status: 'Confirmed', customerTitle: 'Mrs', customerFirstname: 'Gemma',
  customerSurname: 'Whitaker', customerEmail: 'g@example.com', created: '2026-09-13',
  currency: 'GBP', items,
  summary: { totalPrice: 1158, hasAccommodation: true, travellers: [{ type: 'Lead', title: 'Mrs', firstname: 'Gemma', surname: 'Whitaker' }] },
});
const OPTS = { brandName: 'Exclusively Travel', orderRef: 'ET121109', supportEmail: 'info@exclusivelylindos.com', colors: {}, radius: 12, display: {} };

console.log('No page number is typed into the document');
{
  const html = renderPdfHtml(order([stay(1, 'Lambis Studios', 'Lindos', '2026-09-26', 6, 1158, 'Suite')]), OPTS);
  // A CSS comment explaining the old bug is allowed to name it; a reader never
  // sees a comment. What must not survive is a page count in the visible text.
  const visible = html.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
  ok('the rendered document claims no page count of its own',
    !/Page \d+ of \d+/.test(visible), (visible.match(/Page \d+ of \d+/) || [])[0]);
  ok('and the template no longer carries the hardcoded pair',
    !/Page 1 of 2|Page 2 of 2/.test(TPL.replace(/\/\*[\s\S]*?\*\//g, '')),
    'only the comment explaining the bug may mention it');
  ok('the body footer still names the booking, for the editor preview',
    /class="pdf-footer"/.test(html) && html.includes('Booking ET121109'));
  ok('but it stands aside in print, where it would land mid-document',
    /@media print \{ \.pdf-footer \{ display: none !important; \} \}/.test(TPL));
}

console.log('The print engine is asked for the real ones');
{
  const foot = renderPdfFooterTemplate({ brandName: 'Exclusively Travel', orderRef: 'ET121109', supportEmail: 'info@exclusivelylindos.com' });
  ok('the footer asks for the page number', /class="pageNumber"/.test(foot));
  ok('and for the total', /class="totalPages"/.test(foot));
  ok('it styles itself inline, since the document stylesheet does not reach it',
    /style="[^"]*font-size:\s*8px/.test(foot), 'an unstyled footer prints too small to read');
  ok('it carries the brand, the booking and the support address',
    foot.includes('Exclusively Travel') && foot.includes('Booking ET121109') && foot.includes('info@exclusivelylindos.com'));
  ok('it escapes what it is given', renderPdfFooterTemplate({ brandName: '<img src=x>' }).includes('&lt;img'));
  ok('a booking with no reference does not print a dangling separator',
    !/Booking\s*&middot;/.test(renderPdfFooterTemplate({ brandName: 'X' })));
  ok('Chromium is given an empty header, or it prints its own date',
    /display:none/.test(PDF_HEADER_TEMPLATE));

  ok('booking-pdf turns the printed footer on', /displayHeaderFooter: true/.test(API));
  ok('and hands it the template', /footerTemplate: renderPdfFooterTemplate\(\{/.test(API));
  ok('and the empty header', /headerTemplate: PDF_HEADER_TEMPLATE/.test(API));
  ok('the footer gets the same brand and support address as the document',
    /brandName: pdfBrandName/.test(API) && /supportEmail: widgetSettings\?\.support\?\.email/.test(API));
}

console.log('The real thing, rendered');
{
  const browser = await chromium.launch({
    executablePath: process.env.TGS_CHROMIUM || '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  try {
    const build = async (items) => {
      const page = await browser.newPage();
      await page.emulateMedia({ media: 'print' });
      await page.setContent(renderPdfHtml(order(items), OPTS), { waitUntil: 'networkidle' });
      const buf = await page.pdf({
        format: 'A4', printBackground: true, preferCSSPageSize: true,
        displayHeaderFooter: true, headerTemplate: PDF_HEADER_TEMPLATE,
        footerTemplate: renderPdfFooterTemplate({ brandName: 'Exclusively Travel', orderRef: 'ET121109', supportEmail: 'info@exclusivelylindos.com' }),
      });
      await page.close();
      return buf;
    };
    const countPages = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

    const one = await build([stay(1, 'Lambis Studios', 'Lindos', '2026-09-26', 6, 1158, 'Suite')]);
    const two = await build([
      stay(1, 'Lambis Studios', 'Lindos', '2026-09-26', 6, 772, 'Suite'),
      stay(2, 'Anthos Apartments', 'Pefkos', '2026-10-02', 3, 386, 'Studio'),
    ]);

    ok('a one-hotel confirmation renders', one.length > 20000, String(one.length));
    ok('a two-hotel confirmation renders', two.length > 20000, String(two.length));
    ok('the second hotel earns its extra page rather than being dropped',
      countPages(two) > countPages(one), countPages(one) + ' then ' + countPages(two));
    // The margin has to leave room, or Chromium draws the footer over the text.
    ok('the page box still reserves a bottom margin for the footer',
      /@page \{ size: A4; margin: 12mm 0 12mm 0; \}/.test(TPL));
  } finally {
    await browser.close();
  }
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
