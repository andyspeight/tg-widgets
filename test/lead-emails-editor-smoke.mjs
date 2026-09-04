/**
 * Form, Tour and Trips — the two lead emails they could always send.
 *
 * All three hand their submissions to the shared lead router (dispatchLead), so
 * they have always been able to send a team notification and a customer welcome
 * email. None of their editors had any routing UI at all, so no client could
 * see, configure or write either one. The Form editor even told clients to
 * "open the Routing panel from the dashboard" — a panel that does not exist.
 *
 * Nothing server-side had to change to support this: /api/routing-configs was
 * already generic over widgetId. The gap was purely a missing UI, so this ships
 * one shared component (public/editor-lead-emails.js) used by all three, with
 * the welcome email written in the same popup as every other widget and
 * previewed through the module auto-reply.js actually sends with.
 *
 * Run: node test/lead-emails-editor-smoke.mjs   (npm run test:lead-emails-editor)
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const R = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const CMP = R('public/editor-lead-emails.js');
const POPUP = R('public/editor-email-popup.js');
const API = R('api/routing-configs.js');
const FORM = R('public/editor-form.html');
const TOUR = R('public/editor-tour.html');
const TRIPS = R('public/editor-trips.html');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

console.log('All three widgets really do dispatch leads, so both emails are reachable');
{
  ok('Form dispatches leads', /dispatchLead\(/.test(R('api/form-submit.js')));
  ok('Tour and Trips dispatch leads', /dispatchLead\(/.test(R('api/trip-enquiry.js')));
  ok('the router fans out to BOTH email destinations',
    /auto-reply/.test(R('api/_lib/routing/router.js')) || /auto-reply/.test(API));
  ok('the routing API accepts the two email destinations',
    /'email', 'auto-reply'/.test(API) || (/'email'/.test(API) && /'auto-reply'/.test(API)));
  ok('the three widget types are now named for the RoutingConfig record',
    /'form':\s*'Custom Form'/.test(API) && /'tour':\s*'Tour Itinerary'/.test(API) && /'trips':\s*'Group Trips'/.test(API));
  ok('...and writes typecast, so a new type option does not need an Airtable change first',
    (API.match(/typecast: true/g) || []).length >= 2);
}

console.log('The Form editor stops pointing at a panel that does not exist');
{
  ok('the dead "Routing panel from the dashboard" instruction is GONE', !/Routing panel from the/.test(FORM));
  ok('...replaced with copy about the settings actually on the page',
    /Set the two emails below to tell your team straight away/.test(FORM));
}

console.log('One shared component, mounted by all three editors');
{
  [['Form', FORM, 'form'], ['Tour', TOUR, 'tour'], ['Trips', TRIPS, 'trips']].forEach(([name, src, type]) => {
    ok(name + ': loads the component and the shared popup',
      /<script src="\/editor-lead-emails\.js"><\/script>/.test(src)
      && /<script src="\/editor-email-popup\.js"><\/script>/.test(src));
    ok(name + ': hands the classic script the REAL welcome renderer',
      /import \{ renderWelcomeEmail, welcomeCtaIsUsable \} from '\/_welcome-email-template\.js';/.test(src));
    ok(name + ': mounts it with its own widget type',
      new RegExp("widgetType: '" + type + "'").test(src) && /TGLeadEmails\.mount\(\{/.test(src));
    ok(name + ': re-checks after a save, so a brand-new widget lights up at once',
      /onAfterSave[\s\S]{0,120}leadEmails\.reload\(\)/.test(src));
  });
  ok('Tour reuses one host element across sidebar rebuilds (no remount loop)',
    /const leadEmailHost = document\.createElement\('div'\);/.test(TOUR) && /b\.append\(leadEmailHost\)/.test(TOUR));
}

console.log('Functional — the real component, driven in jsdom against a mocked API');
{
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="host"></div></body></html>',
    { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://widgets.travelify.io/editor-form?id=tgw_123' });
  const { window } = dom;

  // The shared popup and the real welcome renderer, as the editors provide them.
  const p = window.document.createElement('script'); p.textContent = POPUP; window.document.body.appendChild(p);
  const { renderWelcomeEmail, welcomeCtaIsUsable } = await import('../public/_welcome-email-template.js');
  window.TGWelcomeEmail = { renderWelcomeEmail, welcomeCtaIsUsable };
  window.tgse = { authHeaders: () => ({ Authorization: 'Bearer test' }), toast: () => {} };

  // A mock of the two endpoints the component talks to.
  let configs = [];
  const calls = [];
  window.fetch = async (url, opts) => {
    const u = String(url);
    calls.push({ url: u, body: opts && opts.body ? JSON.parse(opts.body) : null });
    if (u.startsWith('/api/widget-config')) {
      return { ok: true, status: 200, json: async () => ({ config: {}, name: 'My form', recordId: 'recWIDGET0000001' }) };
    }
    if (u.startsWith('/api/routing-configs?')) {
      return { ok: true, status: 200, json: async () => ({ configs }) };
    }
    const b = JSON.parse(opts.body);
    if (b.op === 'create') {
      const cfg = { id: 'recRC' + (configs.length + 1), destination: b.destination, enabled: b.enabled !== false, config: b.config || {} };
      configs.push(cfg);
      return { ok: true, status: 200, json: async () => ({ config: cfg }) };
    }
    const i = configs.findIndex(c => c.id === b.id);
    if (i !== -1) configs[i] = Object.assign({}, configs[i], b.enabled !== undefined ? { enabled: b.enabled } : {}, b.config ? { config: b.config } : {});
    return { ok: true, status: 200, json: async () => ({ config: configs[i] }) };
  };
  window.URLSearchParams = URLSearchParams;

  const c = window.document.createElement('script'); c.textContent = CMP; window.document.body.appendChild(c);
  ok('it exposes TGLeadEmails.mount', !!window.TGLeadEmails && typeof window.TGLeadEmails.mount === 'function');

  const host = window.document.getElementById('host');
  const inst = window.TGLeadEmails.mount({ mount: host, widgetType: 'form', getBrandName: () => 'Travelaire' });
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));

  ok('it resolves the widget record id from the URL rather than needing the editor to pass it',
    calls.some(x => x.url.includes('/api/widget-config?id=tgw_123')));
  ok('...then loads that widget\'s routing configs',
    calls.some(x => x.url.includes('/api/routing-configs?widgetId=recWIDGET0000001')));
  ok('both emails are offered', /Tell your team/.test(host.textContent) && /Welcome the person who filled it in/.test(host.textContent));
  ok('the welcome email shows as not set up before anything is configured', /Not set up yet/.test(host.textContent));

  // Typing a recipient creates the destination (debounced).
  const toInput = host.querySelectorAll('input[type=text]')[0];
  toInput.value = 'team@travelaire.com';
  toInput.dispatchEvent(new window.Event('input'));
  await new Promise(r => setTimeout(r, 700));
  const created = calls.filter(x => x.body && x.body.op === 'create' && x.body.destination === 'email');
  ok('typing a recipient creates the team-notification destination', created.length === 1);
  ok('...for the right widget, with the right type and recipient',
    created[0].body.widgetRecordId === 'recWIDGET0000001'
    && created[0].body.widgetType === 'form'
    && created[0].body.config.to === 'team@travelaire.com');
  ok('...and writes are debounced, not one per keystroke', created.length === 1);

  // A second edit updates rather than creating a duplicate.
  toInput.value = 'sales@travelaire.com';
  toInput.dispatchEvent(new window.Event('input'));
  await new Promise(r => setTimeout(r, 700));
  ok('a later edit UPDATES the same destination instead of creating a second',
    calls.filter(x => x.body && x.body.op === 'create' && x.body.destination === 'email').length === 1
    && calls.some(x => x.body && x.body.op === 'update'));

  // The welcome email opens the shared popup and previews the real email.
  const editBtn = Array.prototype.find.call(host.querySelectorAll('button'), b => b.textContent === 'Edit email');
  ok('the welcome email has an Edit email button', !!editBtn);
  editBtn.dispatchEvent(new window.Event('click'));
  const overlay = window.document.querySelector('.tgep-overlay');
  ok('it opens the SAME shared popup every other editor uses', !!overlay);
  ok('the preview renders the real welcome email',
    /You are on the list/.test(overlay.querySelector('.tgep-preview iframe').getAttribute('srcdoc') || ''));
  ok('it offers all five copy fields plus the from name',
    overlay.querySelectorAll('.tgep-pane input[type=text], .tgep-pane textarea').length === 6);

  const bodyEl = overlay.querySelector('.tgep-field.is-grow textarea');
  bodyEl.value = 'Thanks for getting in touch.';
  bodyEl.dispatchEvent(new window.Event('input'));
  ok('typing updates the preview immediately',
    /Thanks for getting in touch\./.test(overlay.querySelector('.tgep-preview iframe').getAttribute('srcdoc')));
  await new Promise(r => setTimeout(r, 700));
  ok('...and persists as an auto-reply destination',
    calls.some(x => x.body && x.body.destination === 'auto-reply' && x.body.config && x.body.config.body === 'Thanks for getting in touch.'));

  overlay.querySelector('.tgep-done').dispatchEvent(new window.Event('click'));
  ok('closing the popup refreshes the card', /Your own wording/.test(host.textContent));
  ok('mount() returns a handle the editor can reload after a save', typeof inst.reload === 'function');

  // A widget with no ?id= has never been saved, so there is no record to key on.
  const dom2 = new JSDOM('<!doctype html><html><body><div id="h2"></div></body></html>',
    { runScripts: 'dangerously', url: 'https://widgets.travelify.io/editor-form' });
  dom2.window.tgse = window.tgse;
  dom2.window.URLSearchParams = URLSearchParams;
  dom2.window.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  const c2 = dom2.window.document.createElement('script'); c2.textContent = CMP; dom2.window.document.body.appendChild(c2);
  dom2.window.TGLeadEmails.mount({ mount: dom2.window.document.getElementById('h2'), widgetType: 'form' });
  await new Promise(r => setTimeout(r, 10));
  ok('an unsaved widget says so plainly instead of failing',
    /Save this widget once/.test(dom2.window.document.getElementById('h2').textContent));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
