/**
 * ATOL certificates (24 Sep 2026).
 *
 * Andy: "When a booking is 'ATOL Protected' and the travel company is a
 * Travelgenix client, we must attach the correct ATOL certificate to the
 * booking ... produce these exactly as they are, plus the relevant booking
 * details", then "add a toggle in My Booking that turns each ATOL receipt
 * on/off" and "an area where the client can add their ATOL details". Which
 * bookings: "every flight they sell" (his answer, 24 Sep 2026).
 *
 * Checks, in order: which bookings get which certificate; what each one says
 * (the CAA's rules on names, counts and references); the drawn PDF is the
 * CAA's own page with the SAMPLE watermark off and the booking written in; the
 * register keeps the date of issue stable and holds no names; the widget shows
 * the button only when the server says so; the email says it is attached only
 * when it is; and the editor saves the details and switches.
 *
 * Run: node test/atol-certificate-smoke.mjs   (npm run test:atol-certificate)
 */
import { readFileSync, existsSync } from 'node:fs';
import { PDFDocument, PDFName, PDFArray, PDFRef, decodePDFRawStream } from 'pdf-lib';
import { JSDOM } from 'jsdom';
import {
  ATOL_TYPES, normaliseAtolSettings, atolCertificateType, buildAtolCertificate,
  renderAtolCertificatePdf, sampleAtolBooking,
} from '../api/_lib/atol-certificate.js';
import { atolIssueDate, ukToday, ATOL_LOG_FIELDS } from '../api/_lib/atol-issue-log.js';
import { renderBookingEmail } from '../public/_booking-email-template.js';
import { flightOnly, flightAndHotel, operatorPackage, hotelOnly } from './fixtures/atol/bookings.mjs';

let passed = 0, failed = 0;
const ok = (name, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
};
const R = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const ALL_ON = { holderName: 'Exclusively Travel Limited', atolNumber: '11593', flightOnly: true, packageSingle: true };

// ─── 1. Which bookings, which certificate ──────────────────────────────────
console.log('\nWhich bookings get a certificate\n');
{
  const t = (order, s) => atolCertificateType(order, normaliseAtolSettings(s));
  ok('a flight on its own gets Flight-only', t(flightOnly(), ALL_ON).type === 'flight-only');
  ok('a flight with a hotel and car hire gets Package (Single-contract)', t(flightAndHotel(), ALL_ON).type === 'package-single');
  ok('or Package (Multi-contract) when that is the one switched on',
    t(flightAndHotel(), { ...ALL_ON, packageSingle: false, packageMulti: true }).type === 'package-multi');
  ok('a flight with car hire alone is a package too',
    t({ ...flightAndHotel(), items: [flightAndHotel().items[0], flightAndHotel().items[2]] }, ALL_ON).type === 'package-single');
  ok('nothing without the legal name', t(flightOnly(), { ...ALL_ON, holderName: '' }).reason === 'no_atol_details');
  ok('nothing without the ATOL number', t(flightOnly(), { ...ALL_ON, atolNumber: '' }).reason === 'no_atol_details');
  ok('nothing when every switch is off (the default)', t(flightOnly(), { holderName: 'A Ltd', atolNumber: '1' }).type === null);
  ok('a flight-only booking gets nothing while Flight-only is off', t(flightOnly(), { ...ALL_ON, flightOnly: false }).reason === 'flight_only_off');
  ok('a package gets nothing while both package switches are off',
    t(flightAndHotel(), { ...ALL_ON, packageSingle: false }).reason === 'package_off');
  ok('a tour operator\'s package (Jet2 Holidays) is the operator\'s to certify, not the client\'s',
    t(operatorPackage(), ALL_ON).reason === 'no_flight');
  ok('no flight, no certificate', t(hotelOnly(), ALL_ON).reason === 'no_flight');
  const cancelled = flightOnly(); cancelled.status = 'Cancelled';
  ok('a cancelled booking gets none', t(cancelled, ALL_ON).reason === 'cancelled');
  const cancelledFlight = flightAndHotel(); cancelledFlight.items[0].status = 'Cancelled';
  ok('nor does a booking whose flight was cancelled', t(cancelledFlight, ALL_ON).reason === 'no_flight');
  const s = normaliseAtolSettings({ ...ALL_ON, packageMulti: true });
  ok('both package switches on by hand reads as single-contract', s.packageSingle && !s.packageMulti);
  ok('an ATOL number is kept as a code', normaliseAtolSettings({ atolNumber: ' 11593 ' }).atolNumber === '11593'
    && normaliseAtolSettings({ atolNumber: '<b>1</b>' }).atolNumber === '');
}

// ─── 2. What it says ───────────────────────────────────────────────────────
console.log('\nWhat each certificate says\n');
const S = normaliseAtolSettings(ALL_ON);
const fo = buildAtolCertificate(flightOnly(), S, { type: 'flight-only', orderRef: 'et122149' });
const pk = buildAtolCertificate(flightAndHotel(), S, { type: 'package-single', orderRef: 'ET122149' });
{
  ok('Flight-only names everyone, infants included (the CAA\'s rule)',
    JSON.stringify(fo.names) === JSON.stringify(['Mrs Gemma Whitaker', 'Mr Daniel Whitaker', 'Miss Isla Whitaker', 'Master Oscar Whitaker']), JSON.stringify(fo.names));
  ok('the number of passengers leaves infants out', fo.passengers === 3);
  ok('airline capitals are written the way a person would', !fo.names.some((n) => /GEMMA|MSTR/.test(n)));
  ok('each flight is listed with its day, airports and number',
    fo.protectedLines[0] === 'Outbound flight, Sat 26 Sep 2026: London Luton (LTN) to Rhodes (RHO), flight U2 2231'
    && fo.protectedLines[1] === 'Return flight, Mon 5 Oct 2026: Rhodes (RHO) to London Luton (LTN), flight U2 2232', JSON.stringify(fo.protectedLines));
  ok('the ATOL protected cost is the flights\' price', fo.cost === '£812.46' && fo.costAmount === 812.46);
  ok('who is protecting it: the legal name and ATOL number', fo.protector === 'Exclusively Travel Limited, ATOL number 11593');
  ok('the issuer is the client', fo.issuerName === 'Exclusively Travel Limited');
  ok('the package lists the hotel and car hire as well as the flights',
    pk.protectedLines.includes('Accommodation: Lambis Studios, Lindos, 6 nights from Sat 26 Sep 2026')
    && pk.protectedLines.some((l) => /^Car hire from Sat 26 Sep 2026, collected at Rhodes Airport$/.test(l)), JSON.stringify(pk.protectedLines));
  ok('the hotel\'s lead guest and the airline\'s record are the same person, named once', pk.names.length === 4 && pk.names[0] === 'Mrs Gemma Whitaker', JSON.stringify(pk.names));
  ok('a package carries no protected cost (the form has no such box)', pk.cost === '');
  ok('the reference is the booking reference plus a fingerprint', /^ET122149-[A-Z2-9]{5}$/.test(fo.reference), fo.reference);
  const again = buildAtolCertificate(flightOnly(), S, { type: 'flight-only', orderRef: 'ET122149' });
  ok('the same details give the same reference', again.reference === fo.reference);
  const changed = flightOnly(); changed.items[0].flights.travellers = changed.items[0].flights.travellers.slice(0, 2);
  ok('changed details give a new one (the CAA requires a new certificate)',
    buildAtolCertificate(changed, S, { type: 'flight-only', orderRef: 'ET122149' }).reference !== fo.reference);
  ok('Flight-only and package certificates for one booking have different references', pk.reference !== fo.reference);
}

// ─── 3. The PDF ────────────────────────────────────────────────────────────
console.log('\nThe drawn certificate\n');
async function pageText(bytes) {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const c = page.node.get(PDFName.of('Contents'));
  const cv = doc.context.lookup(c);
  const refs = cv instanceof PDFArray ? cv.asArray() : [c];
  let raw = '';
  for (const r of refs) raw += Buffer.from(decodePDFRawStream(r instanceof PDFRef ? doc.context.lookup(r) : r).decode()).toString('latin1') + '\n';
  const drawn = [...raw.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)].map((m) => Buffer.from(m[1], 'hex').toString('latin1')).join('\n');
  return { doc, raw, drawn, size: page.getSize(), pages: doc.getPageCount() };
}
{
  const issuedOn = new Date('2026-06-02T00:00:00Z');
  for (const [type, model] of [['flight-only', fo], ['package-single', pk], ['package-multi', buildAtolCertificate(flightAndHotel(), S, { type: 'package-multi', orderRef: 'ET122149' })]]) {
    const bytes = await renderAtolCertificatePdf(model, { issuedOn });
    const { raw, drawn, size, pages, doc } = await pageText(bytes);
    const label = ATOL_TYPES[type].label;
    ok(label + ': one A4 page', pages === 1 && Math.round(size.width) === 595 && Math.round(size.height) === 842);
    ok(label + ': drawn on the CAA\'s own template', doc.getTitle() === 'ATOL Certificate ' + model.reference
      && raw.includes('/Im0 Do'), 'the template background image is not painted');
    ok(label + ': the SAMPLE watermark is off', !/\/Fm0\s+Do/.test(raw));
    ok(label + ': carries the reference, the ATOL number, the lead name and the issuer', [model.reference, model.atolNumber, model.names[0], 'Exclusively Travel Limited'].every((w) => drawn.includes(w)));
    ok(label + ': and the first flight', drawn.includes('London Luton (LTN) to Rhodes (RHO)'));
    // The Flight-only form prints its own slashes, so day, month and year are
    // drawn as three pieces there; the package forms get one date.
    ok(label + ': dated with the date of issue it was given',
      type === 'flight-only' ? /\n02\n06\n2026(\n|$)/.test(drawn) : drawn.includes('02/06/2026'));
    if (type === 'flight-only') ok('Flight-only: the ATOL protected cost is printed', drawn.includes('812.46'));
  }
  const sample = await renderAtolCertificatePdf(buildAtolCertificate(sampleAtolBooking('flight-only'), S, { type: 'flight-only', orderRef: 'SAMPLE' }), { sample: true });
  ok('a preview keeps the CAA\'s SAMPLE watermark, so it can never pass as a certificate', /\/Fm0\s+Do/.test((await pageText(sample)).raw));
  // Letters Helvetica cannot draw do not sink the certificate.
  const odd = flightOnly(); odd.items[0].flights.travellers = [{ type: 'Adult', title: 'Mr', firstname: 'Łukasz', surname: 'Dąbrowski' }];
  let drew = true;
  try { await renderAtolCertificatePdf(buildAtolCertificate(odd, S, { type: 'flight-only', orderRef: 'X1' }), {}); } catch (e) { drew = false; }
  ok('a name with letters outside the certificate font still draws (Łukasz becomes Lukasz)', drew);
  // A long legal name and a large party still draw (the layout shrinks and wraps).
  const big = flightOnly();
  big.items[0].flights.travellers = Array.from({ length: 12 }, (_, i) => ({ type: 'Adult', title: 'Mr', firstname: 'Alexander' + i, surname: 'Wolfeschlegelstein-Hausenberger' }));
  let drewBig = true;
  try { await renderAtolCertificatePdf(buildAtolCertificate(big, normaliseAtolSettings({ ...ALL_ON, holderName: 'The Very Long Named Independent Travel Consultancy Holdings (Northern) Limited' }), { type: 'flight-only', orderRef: 'X2' }), {}); } catch (e) { drewBig = false; }
  ok('twelve long names and a very long legal name still fit', drewBig);
}

// ─── 4. The register ───────────────────────────────────────────────────────
console.log('\nThe register of issued certificates\n');
{
  const prevKey = process.env.AIRTABLE_KEY;
  process.env.AIRTABLE_KEY = 'test-key';
  const calls = [];
  const fake = (answers) => async (url, init = {}) => {
    calls.push({ url, init });
    const a = answers.shift();
    return { ok: a.ok !== false, status: a.status || 200, json: async () => a.body || {} };
  };
  const now = new Date('2026-09-24T23:30:00Z'); // 00:30 on the 25th in the UK
  ok('"today" is the UK\'s date, not UTC\'s', ukToday(now) === '2026-09-25');

  calls.length = 0;
  let r = await atolIssueDate(fo, { widgetId: 'tgw_1', clientRecordId: 'recCLIENT', orderRef: 'ET122149', now, fetchImpl: fake([{ body: { records: [{ fields: { [ATOL_LOG_FIELDS.issuedOn]: '2026-06-02' } }] } }]) });
  ok('a certificate issued before keeps the day it was first issued', r.logged === 'found' && r.issuedOn.toISOString().slice(0, 10) === '2026-06-02');
  ok('looked up by its reference and widget', decodeURIComponent(calls[0].url).includes("{Reference}='" + fo.reference + "'") && decodeURIComponent(calls[0].url).includes("{WidgetId}='tgw_1'"));

  calls.length = 0;
  r = await atolIssueDate(fo, { widgetId: 'tgw_1', clientRecordId: 'recCLIENT', orderRef: 'ET122149', now, fetchImpl: fake([{ body: { records: [] } }, { body: {} }]) });
  const posted = JSON.parse(calls[1].init.body || '{}').records[0].fields;
  ok('a new one is dated today and written to the register', r.logged === 'created' && r.issuedOn.toISOString().slice(0, 10) === '2026-09-25'
    && posted[ATOL_LOG_FIELDS.issuedOn] === '2026-09-25' && posted[ATOL_LOG_FIELDS.reference] === fo.reference);
  ok('with its type, passenger count, protected cost and ATOL number',
    posted[ATOL_LOG_FIELDS.type] === 'Flight-only' && posted[ATOL_LOG_FIELDS.passengers] === 3
    && posted[ATOL_LOG_FIELDS.protectedCost] === 812.46 && posted[ATOL_LOG_FIELDS.atolNumber] === '11593');
  ok('and no passenger\'s name', !/Whitaker|Gemma/.test(calls[1].init.body));

  r = await atolIssueDate(fo, { widgetId: 'tgw_1', now, fetchImpl: fake([{ ok: false, status: 503 }]) });
  ok('if Airtable cannot be reached the certificate is still issued, dated today', r.logged === 'unavailable' && r.issuedOn.toISOString().slice(0, 10) === '2026-09-25');
  const tricky = { ...fo, reference: "X'),{WidgetId}!='" };
  calls.length = 0;
  await atolIssueDate(tricky, { widgetId: 'tgw_1', now, fetchImpl: fake([{ body: { records: [] } }, { body: {} }]) });
  ok('a reference cannot break out of the lookup formula', decodeURIComponent(calls[0].url).includes("X\\'),{WidgetId}!=\\'"));
  process.env.AIRTABLE_KEY = prevKey || '';
  if (!prevKey) delete process.env.AIRTABLE_KEY;
  r = await atolIssueDate(fo, { widgetId: 'tgw_1', now });
  ok('with no Airtable key at all it still issues, dated today', r.logged === 'unavailable');
}

// ─── 5. The pieces that serve it ───────────────────────────────────────────
console.log('\nWhere it is served from\n');
{
  const pdfApi = R('api/booking-pdf.js');
  const atolAt = pdfApi.indexOf("if (body.document === 'atol')");
  ok('/api/booking-pdf answers document \'atol\' with the certificate, before Chromium is started',
    atolAt > 0 && atolAt < pdfApi.indexOf('browser = await getBrowser()'));
  ok('from the client\'s own saved settings', /normaliseAtolSettings\(widgetSettings && widgetSettings\.atol\)/.test(pdfApi));
  ok('dated by the register', /atolIssueDate\(model, \{ widgetId, clientRecordId, orderRef \}\)/.test(pdfApi));
  ok('a booking without one is a 404, not a blank certificate', /status\(404\)\.json\(\{ error: 'no_certificate' \}\)/.test(pdfApi));
  const ro = R('api/retrieve-order.js');
  ok('/api/retrieve-order says which certificate a booking has', /res\.status\(200\)\.json\(\{ order, upsell, atol \}\)/.test(ro));
  const vercel = JSON.parse(R('vercel.json'));
  ok('the templates ship with the booking PDF function, alongside Chromium',
    vercel.functions['api/booking-pdf.js'].includeFiles === '{node_modules/@sparticuz/chromium/**,api/_data/atol/*.pdf}');
  ok('and with the preview function', vercel.functions['api/atol-certificate-preview.js'].includeFiles === 'api/_data/atol/*.pdf');
  for (const f of Object.values(ATOL_TYPES)) ok('template present: ' + f.file, existsSync(new URL('../api/_data/atol/' + f.file, import.meta.url)));
  const email = R('api/booking-email.js');
  ok('the confirmation email asks for the certificate when the booking has one',
    /retrieveData\.atol\.type/.test(email) && /document: 'atol'/.test(email) && /\.\.\.\(atolAttachment \? \[atolAttachment\] : \[\]\)/.test(email));
  ok('and a failed certificate fetch is caught where it starts, so it cannot crash the send', /\.catch\(\(err\) => \(\{ error:/.test(email));
  const preview = R('api/atol-certificate-preview.js');
  ok('the editor\'s preview is signed-in only and always marked SAMPLE', /requireAuth\(req\)/.test(preview) && /sample: true/.test(preview));
}

// ─── 6. The email note ─────────────────────────────────────────────────────
console.log('\nThe confirmation email\n');
{
  const base = { order: flightAndHotel(), brand: { name: 'Exclusively Travel' }, orderRef: 'ET122149' };
  const withIt = renderBookingEmail({ ...base, atolCertificate: true });
  const without = renderBookingEmail(base);
  ok('says the ATOL Certificate is attached when it is', withIt.html.includes('Your ATOL Certificate is attached too') && withIt.text.includes('Your ATOL Certificate is attached too'));
  ok('in the certificate\'s own words', withIt.html.includes('take it with you when you travel'));
  ok('and says nothing about one when it is not', !without.html.includes('ATOL Certificate is attached') && !without.text.includes('ATOL Certificate is attached'));
}

// ─── 7. The booking page ───────────────────────────────────────────────────
console.log('\nThe booking page\n');
{
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>',
    { runScripts: 'outside-only', url: 'https://client.test/booking', pretendToBeVisual: true });
  const { window } = dom;
  window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(0), 0);
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const fetched = [];
  window.fetch = async (url, init) => { fetched.push({ url, body: init && init.body }); return { ok: true, status: 200, blob: async () => new window.Blob(['%PDF']), json: async () => ({}) }; };
  window.URL.createObjectURL = () => 'blob:x'; window.URL.revokeObjectURL = () => {};
  window.eval(R('public/widget-mybooking.js'));
  const host = window.document.getElementById('host');
  const inst = new window.TGMyBookingWidget(host, { widgetId: 'tgw_1' });
  inst.lookup = { email: 'a@b.c', date: '2026-09-26', ref: 'ET122149' };
  const show = (atol, display) => {
    if (display) inst.c.display = { ...(inst.c.display || {}), ...display };
    inst.state = { stage: 'found', order: flightOnly(), upsell: [], atol, error: null };
    inst._render();
    return host.shadowRoot;
  };
  let root = show(null);
  ok('no certificate button when the server says the booking has none', !root.querySelector('[data-tgm-atol]'));
  root = show({ type: 'flight-only', label: 'Flight-only' });
  const btn = root.querySelector('[data-tgm-atol]');
  ok('an "ATOL Certificate" button beside the PDF buttons when it has one',
    !!btn && btn.textContent.includes('ATOL Certificate') && !!btn.closest('.tgm-action-row')?.querySelector('[data-tgm-pdf-download]'));
  root = show({ type: 'flight-only', label: 'Flight-only' }, { showActions: false });
  ok('still there on its own row when the client has hidden the PDF buttons',
    !!root.querySelector('[data-tgm-atol]') && !root.querySelector('[data-tgm-pdf-download]'));
  root.querySelector('[data-tgm-atol]').click();
  await new Promise((r) => setTimeout(r, 30));
  const call = fetched.find((f) => f.body && f.body.includes('"document":"atol"'));
  ok('pressing it asks for the certificate for this booking', !!call && call.body.includes('"orderRef":"ET122149"') && call.body.includes('"widgetId":"tgw_1"'));
  ok('the title is the certificate\'s own name in every language (ATOL wording is never translated)',
    (R('public/widget-mybooking.js').match(/atolCertificate: 'ATOL Certificate',/g) || []).length === 6);
  ok('and the line under it is translated in all six', (R('public/widget-mybooking.js').match(/atolCertificateSub: '/g) || []).length === 6);
}

// ─── 8. The editor ─────────────────────────────────────────────────────────
console.log('\nThe My Booking editor\n');
{
  const html = R('public/editor-mybooking.html');
  ok('an ATOL certificates section in Settings', /data-section="atol"/.test(html) && html.indexOf('data-section="atol"') > html.indexOf('data-tab="settings"'));
  ok('asks for the ATOL Certificate Issuer by legal name, as registered with the CAA',
    html.includes('ATOL Certificate Issuer') && html.includes('legal name, exactly as it is registered with the CAA'));
  ok('and the ATOL number', /id="atol-number"/.test(html));
  ok('a switch for each certificate', ['flightOnly', 'packageSingle', 'packageMulti'].every((k) => html.includes('data-atol="' + k + '"')));
  let chromium = null;
  try { ({ chromium } = await import('playwright')); } catch { /* not installed */ }
  if (!chromium || !existsSync('/opt/pw-browsers/chromium')) {
    console.log('  (Playwright Chromium not available: the in-browser checks are skipped)');
  } else {
    const ROOT = new URL('../public/', import.meta.url).pathname;
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    let saved = null, previewBody = null;
    const stored = { atol: { holderName: 'Exclusively Travel Limited', atolNumber: '11593', flightOnly: true, packageSingle: false, packageMulti: false } };
    await page.route('**/*', async (route) => {
      const req = route.request();
      const path = req.url().replace(/^https?:\/\/[^/]+/, '');
      if (path.startsWith('/api/widget-config?id=')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'My Booking', config: stored, ...stored }) });
      if (path.startsWith('/api/atol-certificate-preview')) { previewBody = JSON.parse(req.postData() || '{}'); return route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.7' }); }
      if (req.method() === 'POST' && path.startsWith('/api/widget-config')) { saved = JSON.parse(req.postData() || '{}'); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, widgetId: 'tgw_probe' }) }); }
      if (path.startsWith('/api/auth/me')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { email: 'probe@example.com', plan: 'Ignite' } }) });
      if (path.startsWith('/api/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      let file = path.split('?')[0].replace(/^\//, '');
      if (!/\.[a-z0-9]+$/i.test(file)) file += '.html';
      try {
        const body = readFileSync(ROOT + file, 'utf8');
        return route.fulfill({ status: 200, contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html', body });
      } catch { return route.fulfill({ status: 404, body: '' }); }
    });
    await page.addInitScript(() => { try { localStorage.setItem('tg_token', 'probe'); localStorage.setItem('tg_user', JSON.stringify({ email: 'probe@example.com', plan: 'Ignite' })); } catch (e) {} });
    await page.goto('https://tg-widgets.vercel.app/editor-mybooking?id=tgw_probe', { timeout: 20000 });
    await page.waitForTimeout(2600);
    const loaded = await page.evaluate(() => ({
      holder: document.getElementById('atol-holder').value,
      number: document.getElementById('atol-number').value,
      on: [...document.querySelectorAll('[data-atol]')].filter((b) => b.classList.contains('on')).map((b) => b.dataset.atol),
    }));
    ok('a saved client\'s ATOL details come back into the editor', loaded.holder === 'Exclusively Travel Limited' && loaded.number === '11593');
    ok('with their switches as they left them', JSON.stringify(loaded.on) === '["flightOnly"]', JSON.stringify(loaded.on));
    await page.evaluate(() => { document.querySelector('[data-tab="settings"]')?.click(); });
    await page.evaluate(() => {
      document.querySelector('[data-atol="packageMulti"]').click();
      document.querySelector('[data-atol="packageSingle"]').click();
    });
    const pk = await page.evaluate(() => [...document.querySelectorAll('[data-atol]')].filter((b) => b.classList.contains('on')).map((b) => b.dataset.atol));
    ok('switching on one package certificate switches the other off', JSON.stringify(pk) === '["flightOnly","packageSingle"]', JSON.stringify(pk));
    await page.fill('#atol-number', 't7433');
    await page.evaluate(() => document.getElementById('btn-save').click());
    await page.waitForTimeout(1200);
    const a = saved && saved.config && saved.config.atol;
    ok('Save keeps the details and switches in the widget\'s config',
      !!a && a.holderName === 'Exclusively Travel Limited' && a.atolNumber === 'T7433' && a.flightOnly === true && a.packageSingle === true && a.packageMulti === false,
      JSON.stringify(a));
    await page.evaluate(() => document.querySelector('[data-atol-preview="package"]').click());
    await page.waitForTimeout(800);
    ok('Preview draws the certificate with the details as typed',
      !!previewBody && previewBody.type === 'package-single' && previewBody.atol.atolNumber === 'T7433' && previewBody.atol.holderName === 'Exclusively Travel Limited', JSON.stringify(previewBody));
    ok('no page errors in the editor', !errs.length, errs.join(' | '));
    await browser.close();
  }
}

// ─── 9. The copy ───────────────────────────────────────────────────────────
console.log('\nHouse style\n');
{
  const lines = [fo.protector, ...fo.protectedLines, ...pk.protectedLines].join(' ');
  ok('no em dash in anything the certificate prints', !/[—]/.test(lines));
  const section = R('public/editor-mybooking.html').split('data-section="atol"')[1].split('data-section="embed"')[0];
  ok('no em dash in the editor\'s ATOL section', !/[—]/.test(section));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
