/**
 * Drives the Tripbuster CALL journey in a real browser.
 *
 * Two things a traveller can do that an agency pays for, and one of them
 * behaves differently on a desktop and a phone, so this runs the deal page
 * twice: once as a laptop and once as a phone, using Chromium's real touch and
 * pointer emulation rather than a faked user agent.
 *
 * Covers: the call button revealing the number on desktop and dialling on
 * mobile, the event being recorded either way, the compare drawer offering the
 * right route per agency, a click-first agency showing no call button at all,
 * and the callback form including its phone-or-email rule and its bot trap.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import puppeteer from 'puppeteer-core';

const PUBLIC_DIR = path.resolve(import.meta.dirname, '..', 'public');
const SHOT_DIR = process.env.TB_SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'tb-call-'));
const APP_PORT = 8370;

process.env.TRIPBUSTER_SESSION_SECRET = 'call-drive-secret-long-enough-for-hmac-32';
process.env.RL_DISABLED = '1';

// ── the deals the pages will render ─────────────────────────
const uid = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const CALL_DEAL = uid(1);
const CLICK_DEAL = uid(2);

const base = {
  currency: 'GBP', nights: 7, board: 'All inclusive', country: 'Spain', resort: 'Benidorm',
  accommodation: 'Sol Pelicanos Ocean', starRating: 3, guestScore: 7.9, priceFrom: 329,
  wasPrice: 459, discount: 28, allAirports: ['Manchester'], facilities: ['Pool'],
  sellingPoints: ['Two minutes from the beach'], availability: 'Available', atol: '12203',
  protection: 'ATOL', image: '',
};

// A call-first agency, with a rival that takes both.
const callDeal = {
  ...base,
  id: CALL_DEAL,
  title: 'Sol Pelicanos Ocean, Benidorm, 7 nights all inclusive',
  billingMode: 'call',
  phone: '0141 555 907',
  clickoutUrl: '',
  agent: { name: 'Jetaway Travel', slug: 'jetaway-travel', town: 'Glasgow' },
  agentCount: 2,
  compare: [
    {
      dealId: CALL_DEAL, agent: 'Jetaway Travel', agentSlug: 'jetaway-travel', atol: '12203',
      price: 329, clickoutUrl: '', phone: '0141 555 907', billingMode: 'call',
    },
    {
      dealId: uid(3), agent: 'Coastline Holidays', agentSlug: 'coastline-holidays', atol: '9840',
      price: 342, clickoutUrl: 'https://coastlineholidays.co.uk/deals/cst-2001',
      phone: '01273 555 240', billingMode: 'both',
    },
  ],
};

// A click-first agency: no call button anywhere.
const clickDeal = {
  ...base,
  id: CLICK_DEAL,
  title: 'Balaia Golf Village, Albufeira, 7 nights half board',
  resort: 'Albufeira', country: 'Portugal', accommodation: 'Balaia Golf Village',
  billingMode: 'click',
  phone: '01204 555 118',
  clickoutUrl: 'https://sunseekertravel.co.uk/deals/sun-1002',
  agent: { name: 'Sunseeker Travel', slug: 'sunseeker-travel', town: 'Bolton' },
  agentCount: 1,
};

// ── opening hours ───────────────────────────────────────────
// Built relative to the moment the test runs, so "currently closed" is true
// whenever this is run rather than only on a Tuesday afternoon.
const SHUT_DEAL = uid(4);
const OPEN_DEAL = uid(5);

const londonDow = () => {
  const short = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', weekday: 'short',
  }).format(new Date());
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[short];
};

// One period, on a day three days from today. Never today, so this agency is
// always shut while the test runs.
const shutContact = {
  timeZone: 'Europe/London',
  hoursMode: 'scheduled',
  closedBehaviour: 'callback',
  hours: [{ day: (londonDow() + 3) % 7, opens: '09:00', closes: '17:30' }],
  specialDays: [],
  phones: [
    { label: 'Main number', phone: '0141 555 907', whenShown: 'always' },
    { label: 'Out of hours', phone: '07700 900123', whenShown: 'closed' },
    { label: 'Shop counter', phone: '0141 555 100', whenShown: 'open' },
  ],
};

// Every day, all day. Always open while the test runs.
const openContact = {
  timeZone: 'Europe/London',
  hoursMode: 'scheduled',
  closedBehaviour: 'callback',
  hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day: d, opens: '00:00', closes: '24:00' })),
  specialDays: [],
  phones: [{ label: 'Main number', phone: '0141 555 907', whenShown: 'always' }],
};

const shutDeal = {
  ...base,
  id: SHUT_DEAL,
  title: 'Louis Phaethon Beach, Paphos, 7 nights all inclusive',
  resort: 'Paphos', country: 'Cyprus', accommodation: 'Louis Phaethon Beach',
  billingMode: 'call',
  phone: '0141 555 907',
  clickoutUrl: '',
  contact: shutContact,
  agent: { name: 'Jetaway Travel', slug: 'jetaway-travel', town: 'Glasgow' },
  agentCount: 1,
};

const openDeal = {
  ...shutDeal,
  id: OPEN_DEAL,
  title: 'Melia Costa del Sol, Torremolinos, 7 nights half board',
  resort: 'Torremolinos', country: 'Spain', accommodation: 'Melia Costa del Sol',
  contact: openContact,
};

const DEALS = {
  [CALL_DEAL]: callDeal,
  [CLICK_DEAL]: clickDeal,
  [SHUT_DEAL]: shutDeal,
  [OPEN_DEAL]: openDeal,
};

// ── what the pages posted back to us ────────────────────────
const events = [];
const leads = [];

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };

const app = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${APP_PORT}`);
  const json = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  if (url.pathname.startsWith('/api/')) {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    await new Promise((r) => req.on('end', r));
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }

    if (url.pathname === '/api/tripbuster/deals') {
      const id = url.searchParams.get('id');
      const list = id ? [DEALS[id]].filter(Boolean) : Object.values(DEALS);
      return json(200, { total: list.length, deals: list, compare: true });
    }
    if (url.pathname === '/api/tripbuster/click') {
      events.push({ dealId: body.dealId, eventType: body.eventType || 'click', surface: body.surface });
      return json(200, { recorded: true, clickoutUrl: 'https://example.co.uk/book', phone: '0141 555 907' });
    }
    if (url.pathname === '/api/tripbuster/impressions') return json(200, { recorded: true });
    if (url.pathname === '/api/tripbuster/lead') {
      // The honeypot is the page's business, but a bot filling it in must never
      // reach the store, so the stand-in enforces it too.
      if (body.website) return json(200, { recorded: true });
      if (!body.name) return json(422, { error: 'Some details need fixing', errors: [{ field: 'name', message: 'Please tell us your name' }] });
      if (!body.phone && !body.email) {
        return json(422, {
          error: 'Some details need fixing',
          errors: [{ field: 'phone', message: 'Leave a phone number or an email address so the agency can reply' }],
        });
      }
      leads.push(body);
      return json(200, { recorded: true, agentName: 'Jetaway Travel' });
    }
    return json(404, { error: 'nope' });
  }

  const rel = url.pathname === '/tripbuster/deal' ? '/tripbuster/deal.html'
    : url.pathname === '/tripbuster/search' ? '/tripbuster/search.html'
      : url.pathname === '/tripbuster' ? '/tripbuster/index.html' : url.pathname;
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('nf'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'text/plain' });
  res.end(fs.readFileSync(file));
});

await new Promise((r) => app.listen(APP_PORT, r));

// ── drive ───────────────────────────────────────────────────
const results = [];
// Logged as it happens rather than at the end, so a hang points at the step it
// hung on instead of producing nothing at all.
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${!pass && detail ? `\n      ${detail}` : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
});

const jsErrors = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function openPage({ mobile }) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => jsErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) jsErrors.push(m.text());
  });
  if (mobile) {
    // Real touch emulation, so the page's own (hover:none) and (pointer:coarse)
    // test decides. Nothing here sniffs a user agent.
    await page.emulate({
      viewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 '
        + '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });
  } else {
    await page.setViewport({ width: 1320, height: 1000 });
  }
  return page;
}

try {
  // ── desktop: the button reveals the number ────────────────
  const desk = await openPage({ mobile: false });
  await desk.goto(`http://127.0.0.1:${APP_PORT}/tripbuster/deal?id=${CALL_DEAL}`,
    { waitUntil: 'domcontentloaded' });
  await desk.waitForSelector('.agent-row', { visible: true });

  const deskBtn = await desk.$('.ar-call');
  check('a call-first deal offers a call button on desktop', !!deskBtn);

  const isButton = await desk.$eval('.ar-call', (el) => el.tagName.toLowerCase());
  check('on desktop it is a button, with no number to hover-reveal', isButton === 'button',
    `<${isButton}>`);

  const labelBefore = await desk.$eval('.ar-call', (el) => el.innerText.trim());
  check('it says "Show number" before it is pressed', /show number/i.test(labelBefore), labelBefore);
  check('and the number is not on the page yet',
    !(await desk.evaluate(() => document.body.innerText.includes('0141 555 907'))));

  // A call-only agency has nothing to click through to.
  const bookOnCallAgency = await desk.$$eval('.agent-row',
    (rows) => rows[0].querySelectorAll('.ar-book').length);
  check('a call-only agency shows no Book button', bookOnCallAgency === 0, String(bookOnCallAgency));

  await desk.click('.ar-call');
  await wait(400);
  const revealed = await desk.evaluate(() => document.body.innerText.includes('0141 555 907'));
  check('pressing it reveals the number', revealed);
  // A number broken across three lines reads as a broken page. Counted with a
  // Range over the text, which gives one rect per line box — measuring the
  // element's height instead just measures its padding.
  const revealLines = await desk.$eval('.is-revealed', (el) => {
    const node = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
    if (!node) return -1;
    const range = document.createRange();
    range.selectNodeContents(node);
    return range.getClientRects().length;
  });
  check('the revealed number sits on one line', revealLines === 1, `line boxes: ${revealLines}`);

  const revealedTag = await desk.$eval('.is-revealed', (el) => el.tagName.toLowerCase() + '|' + el.getAttribute('href'));
  check('the revealed number is still a tel: link for softphones',
    revealedTag.startsWith('a|tel:'), revealedTag);
  check('the desktop reveal was recorded as a chargeable call',
    events.some((e) => e.dealId === CALL_DEAL && e.eventType === 'call'),
    JSON.stringify(events));

  // The rival takes both, so it offers both routes.
  const rivalRoutes = await desk.$$eval('.agent-row', (rows) => ({
    book: rows[1].querySelectorAll('.ar-book').length,
    call: rows[1].querySelectorAll('.ar-call').length,
  }));
  check('an agency on "both" offers Book and Call side by side',
    rivalRoutes.book === 1 && rivalRoutes.call === 1, JSON.stringify(rivalRoutes));

  await desk.screenshot({ path: path.join(SHOT_DIR, 'tb-call-1-desktop.png'), fullPage: true });

  // ── the callback form ─────────────────────────────────────
  const formShown = await desk.$('.cbf');
  check('a call-first deal offers a callback form', !!formShown);

  const privacy = await desk.$eval('.cbf-privacy', (el) => el.innerText);
  check('the form says who receives the details',
    /Jetaway Travel/.test(privacy) && /does not use them for anything else/.test(privacy),
    privacy.slice(0, 120));

  // Name only: refused before it ever leaves the page.
  await desk.type('.cbf [name="name"]', 'Jo Bloggs');
  await desk.click('.cbf-go');
  await wait(300);
  const errText = await desk.$eval('.cbf-err', (el) => el.innerText);
  check('a request with no phone and no email is refused',
    /phone number or an email/i.test(errText), errText);
  check('and nothing was sent', leads.length === 0, String(leads.length));

  // Email alone is enough.
  await desk.type('.cbf [name="email"]', 'jo.bloggs@example.co.uk');
  await desk.click('.cbf-go');
  await desk.waitForSelector('.cbf-done', { visible: true, timeout: 5000 });
  check('an email address alone is accepted', leads.length === 1, String(leads.length));
  check('the confirmation names the agency who will ring',
    /Jetaway Travel/.test(await desk.$eval('.cbf-done', (el) => el.innerText)));
  check('the honeypot was sent empty by a real person',
    leads[0].website === '', JSON.stringify(leads[0].website));

  await desk.screenshot({ path: path.join(SHOT_DIR, 'tb-call-2-callback.png'), fullPage: true });

  // ── a click-first deal has no call anything ───────────────
  await desk.goto(`http://127.0.0.1:${APP_PORT}/tripbuster/deal?id=${CLICK_DEAL}`,
    { waitUntil: 'domcontentloaded' });
  await desk.waitForSelector('.agent-row', { visible: true });
  const clickFirst = await desk.evaluate(() => ({
    call: document.querySelectorAll('.ar-call').length,
    form: document.querySelectorAll('.cbf').length,
    book: document.querySelectorAll('.ar-book').length,
  }));
  check('a click-first deal shows no call button and no callback form',
    clickFirst.call === 0 && clickFirst.form === 0, JSON.stringify(clickFirst));
  check('and still shows Book', clickFirst.book === 1, JSON.stringify(clickFirst));

  // ── closed: the form takes over, the number stays ─────────
  events.length = 0;
  await desk.goto(`http://127.0.0.1:${APP_PORT}/tripbuster/deal?id=${SHUT_DEAL}`,
    { waitUntil: 'domcontentloaded' });
  await desk.waitForSelector('.agent-row', { visible: true });

  const shutBtn = await desk.$eval('.ar-call', (el) => ({
    tag: el.tagName.toLowerCase(),
    shut: el.classList.contains('is-shut'),
    text: el.innerText.trim(),
    href: el.getAttribute('href'),
  }));
  check('out of hours the button becomes the number itself', shutBtn.shut, JSON.stringify(shutBtn));
  check('and it is still a tel: link, for ringing first thing tomorrow',
    shutBtn.tag === 'a' && shutBtn.href === 'tel:0141555907', JSON.stringify(shutBtn));
  check('the number is shown rather than hidden behind "Show number"',
    /0141 555 907/.test(shutBtn.text), shutBtn.text);

  const shutLabel = await desk.$eval('.ar-open', (el) => el.innerText.trim());
  check('it says when they open, not just that they are closed',
    /^Closed, opens /.test(shutLabel), shutLabel);

  // The closed state puts a number, a sentence and a labelled extra into the
  // right-hand column, and the agency's name is the only thing in the row that
  // can shrink. Held on one line those three squeezed "Jetaway Travel" down to
  // two lines of about six characters, which reads as a broken page.
  const nameLines = await desk.$eval('.ar-nm', (el) => {
    const node = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
    if (!node) return -1;
    const range = document.createRange();
    range.selectNodeContents(node);
    return range.getClientRects().length;
  });
  check('the agency name still sits on one line beside all of that',
    nameLines === 1, `line boxes: ${nameLines}`);

  const noOverflow = await desk.$eval('.book-card',
    (el) => el.scrollWidth <= el.clientWidth);
  check('and nothing spills out of the booking card sideways', noOverflow, String(noOverflow));

  const cbfPrimary = await desk.$eval('.cbf', (el) => ({
    primary: el.classList.contains('is-primary'),
    head: el.querySelector('h3').innerText.trim(),
    lead: el.querySelector('.cbf-lead').innerText,
  }));
  check('the callback form leads instead of being the alternative',
    cbfPrimary.primary && /Ask for a call back/i.test(cbfPrimary.head), JSON.stringify(cbfPrimary));
  check('and it says why, naming the agency that is shut',
    /Jetaway Travel/.test(cbfPrimary.lead) && /closed/i.test(cbfPrimary.lead),
    cbfPrimary.lead.slice(0, 120));

  // The out-of-hours mobile shows; the shop counter does not.
  const shutExtras = await desk.$$eval('.ar-more li', (els) => els.map((el) => el.innerText.trim()));
  check('the out-of-hours number is offered while they are closed',
    shutExtras.length === 1 && /Out of hours/.test(shutExtras[0]), JSON.stringify(shutExtras));
  check('and the shop counter is not, because nobody is standing at it',
    !shutExtras.some((t) => /Shop counter/.test(t)), JSON.stringify(shutExtras));

  const week = await desk.$$eval('.oh-tbl tr', (rows) => rows.map((r) => r.innerText.replace(/\s+/g, ' ').trim()));
  check('the whole week is shown, Monday first', week.length === 7 && /^Monday/.test(week[0]),
    JSON.stringify(week.slice(0, 2)));
  check('and the days they are shut say so', week.filter((r) => /Closed/.test(r)).length === 6,
    JSON.stringify(week));

  // Still reported, so the agency can see the demand it is turning away. The
  // database decides it is not chargeable; the page does not get a say.
  await desk.click('.ar-call');
  await wait(400);
  check('an out-of-hours press is still recorded, so the demand is visible',
    events.some((e) => e.dealId === SHUT_DEAL && e.eventType === 'call'), JSON.stringify(events));

  await desk.screenshot({ path: path.join(SHOT_DIR, 'tb-call-5-closed.png'), fullPage: true });

  // ── open: the ordinary button is back ─────────────────────
  await desk.goto(`http://127.0.0.1:${APP_PORT}/tripbuster/deal?id=${OPEN_DEAL}`,
    { waitUntil: 'domcontentloaded' });
  await desk.waitForSelector('.agent-row', { visible: true });

  const openBtn = await desk.$eval('.ar-call', (el) => ({
    tag: el.tagName.toLowerCase(),
    shut: el.classList.contains('is-shut'),
    text: el.innerText.trim(),
  }));
  check('while open it is a Show number button again',
    openBtn.tag === 'button' && !openBtn.shut && /show number/i.test(openBtn.text),
    JSON.stringify(openBtn));

  const openLabel = await desk.$eval('.ar-open', (el) => ({
    text: el.innerText.trim(), on: el.classList.contains('is-on'),
  }));
  check('and it says they are open now', /^Open now/.test(openLabel.text) && openLabel.on,
    JSON.stringify(openLabel));

  const openCbf = await desk.$eval('.cbf', (el) => el.classList.contains('is-primary'));
  check('the callback form goes back to being the alternative', openCbf === false, String(openCbf));

  await desk.screenshot({ path: path.join(SHOT_DIR, 'tb-call-6-open.png'), fullPage: true });

  // ── mobile: the button dials ──────────────────────────────
  events.length = 0;
  const phone = await openPage({ mobile: true });
  await phone.goto(`http://127.0.0.1:${APP_PORT}/tripbuster/deal?id=${CALL_DEAL}`,
    { waitUntil: 'domcontentloaded' });
  await phone.waitForSelector('.ar-call', { visible: true });

  const mobTag = await phone.$eval('.ar-call', (el) => el.tagName.toLowerCase());
  check('on a phone the call button is a link, so a tap dials', mobTag === 'a', `<${mobTag}>`);

  const mobHref = await phone.$eval('.ar-call', (el) => el.getAttribute('href'));
  check('it dials the agency number with the spacing stripped',
    mobHref === 'tel:0141555907', mobHref);

  const mobLabel = await phone.$eval('.ar-call', (el) => el.innerText.trim());
  check('and it says Call rather than Show number', /^call$/i.test(mobLabel), mobLabel);

  // Report the tap without letting the browser wander off to a dialler. The
  // guard goes on the document in the capture phase, so it runs before anything
  // on the anchor itself and the tel: navigation never starts. preventDefault
  // does not stop propagation, so the page's own delegated handler still fires.
  await phone.evaluate(() => {
    document.addEventListener('click', (e) => e.preventDefault(), { capture: true });
    document.querySelector('.ar-call').click();
  });
  await wait(400);
  check('the mobile tap was recorded as a chargeable call',
    events.some((e) => e.dealId === CALL_DEAL && e.eventType === 'call'),
    JSON.stringify(events));

  await phone.screenshot({ path: path.join(SHOT_DIR, 'tb-call-3-mobile.png'), fullPage: true });

  // ── the compare drawer on search ──────────────────────────
  events.length = 0;
  const results2 = await openPage({ mobile: false });
  await results2.goto(`http://127.0.0.1:${APP_PORT}/tripbuster/search`, { waitUntil: 'domcontentloaded' });
  await results2.waitForSelector('[data-compare]', { visible: true, timeout: 8000 });
  await results2.click('[data-compare]');
  await wait(400);
  const drawer = await results2.evaluate(() => {
    const rows = [...document.querySelectorAll('.prov')];
    return rows.map((r) => ({
      book: r.querySelectorAll('.prov-go:not(.btn-call)').length,
      call: r.querySelectorAll('.btn-call').length,
    }));
  });
  check('the compare drawer offers each agency its own route',
    drawer.length >= 2 && drawer[0].call === 1 && drawer[0].book === 0 && drawer[1].call === 1,
    JSON.stringify(drawer));

  await results2.click('.prov .btn-call');
  await wait(400);
  check('calling from the compare drawer is recorded too',
    events.some((e) => e.eventType === 'call'), JSON.stringify(events));

  await results2.screenshot({ path: path.join(SHOT_DIR, 'tb-call-4-compare.png'), fullPage: true });

  check('no uncaught JavaScript anywhere in the journey', jsErrors.length === 0,
    jsErrors.join(' | ').slice(0, 300));
} catch (err) {
  check('the drive completed', false, `${err.message}\n      ${(err.stack || '').split('\n').slice(1, 4).join('\n      ')}`);
} finally {
  await browser.close().catch(() => {});
  // The pages hold keep-alive sockets, and server.close() waits for every one of
  // them. Without this the run hangs after the last assertion has passed.
  app.closeAllConnections?.();
  await new Promise((r) => app.close(r));
}

const pass = results.filter((r) => r.pass).length;
console.log(`\nscreenshots: ${SHOT_DIR}`);
console.log(`${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
