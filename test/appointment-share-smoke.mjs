/**
 * Integration test for the "send time options" confirm page.
 * Loads book-appointment.html in jsdom, stubs the config + book endpoints,
 * fills the form and confirms, and asserts the booking POST carries the right
 * widget / start / event and that success renders.
 * Run: node test/appointment-share-smoke.mjs   (skips if jsdom absent)
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert';

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) passed++; else { failed++; console.error('  FAIL:', label); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

let JSDOM;
try { ({ JSDOM } = await import('jsdom')); }
catch { console.log('jsdom not installed — skipping (run: npm install jsdom)'); process.exit(0); }

const html = readFileSync(new URL('../public/book-appointment.html', import.meta.url), 'utf8');
const startISO = new Date(Date.now() + 2 * 86400000).toISOString();

let bookPayload = null;
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'https://x.example/book-appointment?widget=W1&start=' + encodeURIComponent(startISO) + '&event=consult',
  beforeParse(window) {
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (u.includes('/api/widget-config')) {
        return { ok: true, json: async () => ({ name: 'Demo', config: { timezone: 'Europe/London', accent: '#0891B2', eventTypes: [{ id: 'consult', label: 'Travel consultation', mins: 30 }] } }) };
      }
      if (u.includes('/api/appointment/book')) {
        bookPayload = JSON.parse(opts.body);
        return { ok: true, status: 200, json: async () => ({ ok: true, ref: 'BK1', manageUrl: 'https://x.example/manage-booking?token=t1' }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };
  },
});

await sleep(60);
const doc = dom.window.document;
ok(!!doc.getElementById('f-go'), 'confirm: renders the booking form from the link params');

// Submitting empty should be blocked
doc.getElementById('f-go').click();
await sleep(10);
ok(!bookPayload, 'confirm: does not book without name/email');

doc.getElementById('f-name').value = 'Sam Tester';
doc.getElementById('f-email').value = 'sam@example.com';
doc.getElementById('f-phone').value = '07123';
doc.getElementById('f-go').click();
await sleep(50);

ok(bookPayload && bookPayload.widgetId === 'W1', 'confirm: posts the scheduler widget id');
ok(bookPayload && bookPayload.startISO === startISO, 'confirm: posts the exact proposed time');
ok(bookPayload && bookPayload.eventId === 'consult', 'confirm: posts the event id from the link');
ok(bookPayload && bookPayload.email === 'sam@example.com', 'confirm: posts the visitor email');
ok(/booked in/i.test(doc.getElementById('card').textContent), 'confirm: shows success after booking');
ok(/manage-booking/.test(doc.getElementById('card').innerHTML), 'confirm: success offers the manage link');
dom.window.close();

console.log(`\n${passed} passed, ${failed} failed`);
assert.strictEqual(failed, 0, 'share confirm smoke failures');
