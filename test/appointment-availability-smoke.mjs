/**
 * Appointment editor — working hours survive being saved (11 Sep 2026).
 *
 * A client set her meeting times, saved, and got Mon-Fri 9 to 5 back. Every
 * other setting she changed persisted, so the save and the read were both fine.
 * The editor was throwing the hours away before the save ever happened:
 *
 *     C.availability[k] = readDayRanges(block);   // k is the string "1"
 *     delete C.availability[Number(k)];           // Number("1") is 1
 *
 * An object property is always a string, so obj[1] and obj['1'] are one and the
 * same property. The second line deleted the day the first line had just
 * written. With every day wiped, the next load found no usable hours and put
 * the Mon-Fri 9 to 5 default back, which is what she saw.
 *
 * It was invisible while she worked because the time-change handler re-draws
 * the PREVIEW, not the day rows: the select still showed 10:00 while the config
 * behind it had lost Monday altogether. So this test does not trust the rows.
 * It runs the real editor in a browser, captures what the Save button actually
 * posts, and then serves that back on a reload — her whole round trip, which is
 * the only place the bug was ever visible.
 *
 * Run: TGS_CHROMIUM=/opt/pw-browsers/chromium node test/appointment-availability-smoke.mjs
 *      (npm run test:appointment-availability)
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const EDITOR = fs.readFileSync(path.join(PUBLIC, 'editor-appointment.html'), 'utf8');
// The editor carries a comment quoting the bad line, so the next person to read
// that handler knows why it looks the way it does. Guard the CODE, not the
// prose, or the explanation itself trips the guard.
const EDITOR_CODE = EDITOR.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
};

// Her scheduler as it sits in Airtable: weekdays 9 to 5.
const START = {
  heading: 'Book In For Training', subheading: 'Pick a time that suits you', company: 'Jess',
  eventTypes: [{ id: 'consult', label: 'Training', mins: 60, mode: 'video', description: '' }],
  timezone: 'Europe/London',
  availability: { 1: [['09:00', '17:00']], 2: [['09:00', '17:00']], 3: [['09:00', '17:00']], 4: [['09:00', '17:00']], 5: [['09:00', '17:00']] },
  blackoutDates: [], dateOverrides: {}, dateRangeDays: 14, minNoticeHours: 4,
  slotInterval: 0, bufferBefore: 10, bufferAfter: 45, dailyCap: 3,
  reminders: [24], smsReminders: false, emails: {}, timeFormat: '12',
  displayMode: 'inline', questions: [], buttonLabel: 'Confirm booking',
  accent: '#7D69E2', bg: '#FFFFFF', textColor: '#0F172A', radius: 16, fontFamily: 'Montserrat',
};

// The stub stands in for Airtable: it keeps whatever the editor last saved and
// serves that back, so a reload sees what a reload would really see.
let stored = JSON.parse(JSON.stringify(START));
const posts = [];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const PORT = 8137;
const BASE = 'http://localhost:' + PORT;

const server = await new Promise((res) => {
  const s = http.createServer((req, rsp) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    rsp.setHeader('Access-Control-Allow-Origin', '*');
    if (p === '/api/widget-config' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          posts.push(parsed);
          if (parsed && parsed.config) stored = parsed.config;
        } catch (e) { posts.push({ parseError: String(e) }); }
        rsp.setHeader('Content-Type', 'application/json');
        rsp.end(JSON.stringify({ ok: true, widgetId: 'tgw_smoke_availability' }));
      });
      return;
    }
    if (p === '/api/widget-config') {
      rsp.setHeader('Content-Type', 'application/json');
      return rsp.end(JSON.stringify(Object.assign({ config: stored, name: 'Training' }, stored)));
    }
    if (p.startsWith('/api/')) { rsp.statusCode = 200; rsp.setHeader('Content-Type', 'application/json'); return rsp.end('{"ok":true}'); }
    const fp = path.join(PUBLIC, p === '/' ? 'index.html' : p);
    if (!fp.startsWith(PUBLIC) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) { rsp.statusCode = 404; return rsp.end('nf'); }
    rsp.setHeader('Content-Type', MIME[path.extname(fp)] || 'application/octet-stream');
    fs.createReadStream(fp).pipe(rsp);
  });
  s.listen(PORT, () => res(s));
});

const browser = await chromium.launch({
  executablePath: process.env.TGS_CHROMIUM || '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});

/** Pick a time on a day's first range, the way the select's own handler sees it. */
const setTime = (page, day, which, value) => page.evaluate(([d, w, v]) => {
  const sel = document.querySelector('#avail-list [data-wd="' + d + '"] [data-av-f="' + w + '"]');
  if (!sel) throw new Error('no ' + w + ' select for day ' + d);
  sel.value = v;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}, [day, which, value]);

/** Press a control through its real (delegated) handler. */
const press = (page, selector) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) throw new Error('no control at ' + sel);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}, selector);

/** Click Save and wait for the POST to land, then hand back what it carried. */
async function save(page) {
  const before = posts.length;
  await press(page, '#btn-save');
  const until = Date.now() + 10000;
  while (posts.length === before && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
  if (posts.length === before) throw new Error('the editor never posted a save');
  return posts[posts.length - 1];
}

/** The saved hours as plain data: which days, and their times. */
const savedDays = (post) => {
  const a = (post && post.config && post.config.availability) || {};
  return Object.keys(a).filter((k) => Array.isArray(a[k]) && a[k].length).sort().join(',');
};
const savedTimes = (post, day) => {
  const a = (post && post.config && post.config.availability) || {};
  return JSON.stringify(a[day] || a[Number(day)] || null);
};

/** The day rows as she sees them. */
const readDays = (page) => page.evaluate(() =>
  [...document.querySelectorAll('#avail-list [data-wd]')].map((b) => ({
    day: b.getAttribute('data-wd'),
    on: !b.classList.contains('is-off'),
    times: [...b.querySelectorAll('.av-times')].map((r) => [...r.querySelectorAll('[data-av-f]')].map((s) => s.value)),
  })));

async function openEditor() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', (r) => r.abort());
  await page.route('https://id.travelify.io/**', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{"ok":false}' }));
  await page.addInitScript(() => {
    localStorage.setItem('tg_token', 'smoke-token');
    localStorage.setItem('tg_user', JSON.stringify({ email: 'smoke@test.local', plan: 'Bespoke' }));
  });
  await page.goto(BASE + '/editor-appointment.html?id=tgw_smoke_availability', { waitUntil: 'load', timeout: 25000 });
  // The day rows sit inside a collapsed section, so wait for them to EXIST and
  // drive them by the events their handlers listen for. That runs the real
  // handlers without the test depending on which section happens to be open.
  await page.waitForFunction(() => document.querySelectorAll('#avail-list [data-wd]').length >= 5, { timeout: 15000 });
  return { page, errors };
}

try {
  const { page, errors } = await openEditor();

  console.log('The editor loads her saved hours');
  const before = await readDays(page);
  const mon = before.find((d) => d.day === '1');
  ok('Monday loads on, 09:00 to 17:00', !!mon && mon.on && mon.times[0][0] === '09:00' && mon.times[0][1] === '17:00', JSON.stringify(mon));
  ok('five weekdays are on', before.filter((d) => d.on).length === 5, before.filter((d) => d.on).map((d) => d.day).join(','));

  console.log('She changes a start time and saves (this is the bug)');
  await setTime(page, '1', 'start', '10:00');
  const p1 = await save(page);
  ok('the save still carries all five days', savedDays(p1) === '1,2,3,4,5',
    'it carried "' + savedDays(p1) + '" — a missing day is the day the delete removed');
  ok('Monday is saved as 10:00 to 17:00', savedTimes(p1, '1') === '[["10:00","17:00"]]', savedTimes(p1, '1'));
  ok('the rest of her settings ride along untouched',
    p1.config.bufferAfter === 45 && p1.config.dailyCap === 3 && p1.config.company === 'Jess');

  console.log('An end time, and a second day, save too');
  await setTime(page, '1', 'end', '16:00');
  await setTime(page, '3', 'start', '11:00');
  const p2 = await save(page);
  ok('Monday holds 10:00 to 16:00', savedTimes(p2, '1') === '[["10:00","16:00"]]', savedTimes(p2, '1'));
  ok('Wednesday holds its 11:00 start', savedTimes(p2, '3') === '[["11:00","17:00"]]', savedTimes(p2, '3'));
  ok('all five days are still there', savedDays(p2) === '1,2,3,4,5', savedDays(p2));

  console.log('A second block of hours saves');
  await press(page, '#avail-list [data-wd="2"] [data-add-range]');
  const tueRow = (await readDays(page)).find((d) => d.day === '2');
  ok('Tuesday shows two blocks of hours', !!tueRow && tueRow.on && tueRow.times.length === 2, JSON.stringify(tueRow));
  const p3 = await save(page);
  ok('both blocks are saved', savedTimes(p3, '2') === '[["09:00","17:00"],["13:00","17:00"]]', savedTimes(p3, '2'));
  ok('and Tuesday did not vanish', savedDays(p3) === '1,2,3,4,5', savedDays(p3));

  console.log('Turning a day off still turns it off');
  await press(page, '#avail-list [data-wd="5"] [data-av-toggle]');
  const friRow = (await readDays(page)).find((d) => d.day === '5');
  ok('Friday shows as unavailable', !!friRow && !friRow.on, JSON.stringify(friRow));
  const p4 = await save(page);
  ok('Friday is gone from the save, the other four remain', savedDays(p4) === '1,2,3,4', savedDays(p4));

  ok('no script errors while she worked', errors.length === 0, errors.join(' | '));
  await page.close();

  console.log('She comes back to it later (the reset she reported)');
  const { page: page2, errors: errors2 } = await openEditor();
  const reloaded = await readDays(page2);
  const monBack = reloaded.find((d) => d.day === '1');
  const tueBack = reloaded.find((d) => d.day === '2');
  const friBack = reloaded.find((d) => d.day === '5');
  ok('Monday comes back as 10:00 to 16:00, not 09:00 to 17:00',
    !!monBack && monBack.on && monBack.times[0][0] === '10:00' && monBack.times[0][1] === '16:00',
    JSON.stringify(monBack && monBack.times) + ' — 09:00 to 17:00 here IS the reset she reported');
  ok('Tuesday still has both blocks of hours', !!tueBack && tueBack.times.length === 2, JSON.stringify(tueBack && tueBack.times));
  ok('Friday is still off', !!friBack && !friBack.on, JSON.stringify(friBack));
  ok('four days, exactly as she left them', reloaded.filter((d) => d.on).map((d) => d.day).join(',') === '1,2,3,4',
    reloaded.filter((d) => d.on).map((d) => d.day).join(','));
  ok('no script errors on the way back in', errors2.length === 0, errors2.join(' | '));
  await page2.close();

  console.log('The pattern that caused it cannot come back');
  ok('no "delete C.availability[Number(' + '...)]" remains in the editor',
    !/delete\s+C\.availability\[Number\(/.test(EDITOR_CODE));
  ok('no availability write or read uses a numeric key at all',
    !/C\.availability\[Number\(/.test(EDITOR_CODE));
  ok('the reason is written down next to the handler',
    /obj\[1\] and obj\['1'\] are one and the same/.test(EDITOR));
} finally {
  await browser.close();
  server.close();
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
