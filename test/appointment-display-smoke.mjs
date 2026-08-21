/**
 * Appointment display-mode smoke test (jsdom).
 * Proves the popup and bubble modes render a launcher, open/close an
 * accessible overlay, never grab the page on passive renders, and that the
 * widget's booking calls follow a window.__TG_WIDGET_API__ override to the
 * right origin (QA #4). Also checks the widget-side dateOverrides mirror.
 * Run: node test/appointment-display-smoke.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';

let JSDOM;
try { ({ JSDOM } = await import('jsdom')); }
catch { console.log('jsdom not installed — skipping (run: npm install jsdom)'); process.exit(0); }

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) passed++; else { failed++; console.error('  FAIL:', label); } };

const src = fs.readFileSync(new URL('../public/widget-appointment.js', import.meta.url), 'utf8');

function makeWindow(preEval) {
  const dom = new JSDOM('<!doctype html><html><body><div id="m" data-tg-widget="appointment"></div></body></html>', {
    url: 'https://client-site.example/contact', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  if (preEval) preEval(dom.window);
  dom.window.eval(src);
  return dom.window;
}

const baseCfg = {
  heading: 'Book a chat',
  eventTypes: [{ id: 'consult', label: 'Consultation', mins: 30, mode: 'callback' }],
  availability: { 1: [['09:00', '17:00']], 2: [['09:00', '17:00']], 3: [['09:00', '17:00']], 4: [['09:00', '17:00']], 5: [['09:00', '17:00']] },
  dateRangeDays: 14, minNoticeHours: 0, previewMode: true,
};

// ── Inline mode: unchanged shape, no launcher ──
{
  const w = makeWindow();
  const inst = new w.TGAppointmentWidget(w.document.getElementById('m'), Object.assign({}, baseCfg));
  const sh = inst.shadow;
  ok(!!sh.querySelector('.tga'), 'inline: scheduler card renders');
  ok(!sh.getElementById('tga-open') && !sh.getElementById('tga-overlay'), 'inline: no launcher, no overlay (negative control)');
}

// ── Popup mode: launcher + overlay lifecycle ──
{
  const w = makeWindow();
  const inst = new w.TGAppointmentWidget(w.document.getElementById('m'), Object.assign({}, baseCfg, { displayMode: 'popup', launcherLabel: 'Talk travel' }));
  const sh = inst.shadow;
  const opener = sh.getElementById('tga-open');
  const overlay = sh.getElementById('tga-overlay');
  ok(opener && /Talk travel/.test(opener.textContent), 'popup: launcher button renders with the configured label');
  ok(overlay && overlay.hidden === true, 'popup: overlay starts hidden');
  ok(overlay.getAttribute('role') === 'dialog' && overlay.getAttribute('aria-modal') === 'true', 'popup: overlay is an aria-modal dialog');
  opener.click();
  ok(overlay.hidden === false, 'popup: clicking the launcher opens the overlay');
  ok(w.document.documentElement.style.overflow === '', 'popup: preview mode never locks the host page scroll');
  sh.getElementById('tga-close').click();
  ok(overlay.hidden === true, 'popup: the close button closes the overlay');
  opener.click();
  overlay.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok(overlay.hidden === true, 'popup: Escape closes the overlay');
}

// ── Popup default label is localised ──
{
  const w = makeWindow();
  const inst = new w.TGAppointmentWidget(w.document.getElementById('m'), Object.assign({}, baseCfg, { displayMode: 'popup' }));
  ok(/Book a time/.test(inst.shadow.getElementById('tga-open').textContent), 'popup: default launcher label falls back to the localised string');
}

// ── previewOpen: overlay starts open, no focus stolen ──
{
  const w = makeWindow();
  const inst = new w.TGAppointmentWidget(w.document.getElementById('m'), Object.assign({}, baseCfg, { displayMode: 'popup', previewOpen: true }));
  const overlay = inst.shadow.getElementById('tga-overlay');
  ok(overlay.hidden === false, 'previewOpen: overlay starts open for the editor preview');
  ok(inst.shadow.activeElement == null, 'previewOpen: opening via render steals no focus');
}

// ── Bubble mode ──
{
  const w = makeWindow();
  const inst = new w.TGAppointmentWidget(w.document.getElementById('m'), Object.assign({}, baseCfg, { displayMode: 'bubble', bubblePosition: 'left' }));
  const b = inst.shadow.getElementById('tga-open');
  ok(b && b.classList.contains('tga-bubble') && b.classList.contains('pos-left'), 'bubble: floating button renders in the configured corner');
  ok(!!b.getAttribute('aria-label'), 'bubble: icon-only button carries an aria-label');
}

// ── Widget-side dateOverrides mirror ──
{
  const w = makeWindow();
  // Next Saturday, at least 3 days out, in the host timezone.
  let satKey = '';
  for (let i = 3; i <= 16 && !satKey; i++) {
    const k = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + i * 86400000));
    if (new Date(k + 'T12:00:00Z').getUTCDay() === 6) satKey = k;
  }
  const inst = new w.TGAppointmentWidget(w.document.getElementById('m'), Object.assign({}, baseCfg, { timezone: 'Europe/London', dateOverrides: { [satKey]: [['10:00', '12:00']] } }));
  ok(Array.isArray(inst.slotsByDate[satKey]) && inst.slotsByDate[satKey].length === 4, 'widget mirror: a date override opens a closed Saturday client-side');
  const inst2 = new w.TGAppointmentWidget(w.document.createElement('div'), Object.assign({}, baseCfg, { timezone: 'Europe/London' }));
  ok(!inst2.slotsByDate[satKey], 'widget mirror negative control: no override, no Saturday slots');
}

// ── QA #4: booking calls follow the __TG_WIDGET_API__ origin ──
{
  const seen = [];
  const w = makeWindow((win) => {
    win.__TG_WIDGET_API__ = 'https://widgets.travelify.io/api/widget-config';
    win.fetch = async (url) => { seen.push(String(url)); return { ok: false, status: 404, json: async () => ({}) }; };
  });
  const host = w.document.getElementById('m');
  host.setAttribute('data-tg-id', 'tgw_test123');
  new w.TGAppointmentWidget(host, Object.assign({}, baseCfg, { previewMode: false }));
  const availCall = seen.find(u => u.includes('/api/appointment/availability'));
  ok(!!availCall, 'backend mode asks the server for availability');
  ok(availCall && availCall.startsWith('https://widgets.travelify.io/'), 'availability call follows the API override origin, not the host page (got ' + String(availCall).slice(0, 60) + ')');
}

console.log(`\n${passed} passed, ${failed} failed`);
assert.strictEqual(failed, 0, 'display-mode smoke failures');
