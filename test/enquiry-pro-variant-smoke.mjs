/**
 * Enquiry Pro stays Pro (17 Sep 2026).
 *
 * Andy asked me to look at Enquiry Pro after I flagged it as possibly refused
 * on save. That guess was wrong — it is never refused, because the enquiry
 * editor saves through /api/enquiry-form-config and never touches the plan gate
 * in /api/widget-config at all.
 *
 * The real fault was worse and quieter. The editor decides Pro mode from the
 * /editor-enquirypro path, sets state.config.variant = 'pro' and sends it on
 * every save, with a comment saying it does so "so it survives future re-edits
 * and the embed stays correct". buildEnquiryFormFields had no line for it, so
 * the whitelist dropped it every time and nothing was ever stored.
 *
 * The consequence: open a Pro form again from the dashboard — which links to
 * /editor-enquiry?id=..., with no "enquirypro" in the path — and it came back
 * as a STANDARD form, handing the client a standard embed snippet
 * (data-tg-widget="enquiry" + widget-enquiry.js) for a widget they built as
 * Pro. Nobody could tell a Pro form from a standard one afterwards, including
 * us: there is no Enquiry Pro option on the WidgetType select, so every enquiry
 * widget is stored as "Enquiry Form".
 *
 * Run: node test/enquiry-pro-variant-smoke.mjs  (npm run test:enquiry-pro-variant)
 */
import { readFileSync } from 'node:fs';

process.env.AIRTABLE_KEY = 'pat_test';
process.env.AIRTABLE_BASE_ID = 'appAYzWZxvK6qlwXK';

const { _test } = await import('../api/enquiry-form-config.js');
const { buildEnquiryFormFields, readEnquiryFormRecord, EF, VARIANTS } = _test;
const SRC = readFileSync(new URL('../api/enquiry-form-config.js', import.meta.url), 'utf8');
const EDITOR = readFileSync(new URL('../public/editor-enquiry.html', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (label, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
};

console.log('The save keeps the variant it is sent');
{
  const pro = buildEnquiryFormFields({ name: 'Pro form', variant: 'pro' }, 'a@b.com', true);
  ok('pro is written', pro[EF.variant] === 'pro', JSON.stringify(pro[EF.variant]));

  const std = buildEnquiryFormFields({ name: 'Plain', variant: 'standard' }, 'a@b.com', true);
  ok('standard is written', std[EF.variant] === 'standard');

  // Every form saved before today sends nothing, and must not be touched.
  const silent = buildEnquiryFormFields({ name: 'Untouched' }, 'a@b.com', false);
  ok('a save that does not mention it leaves the field alone',
    !(EF.variant in silent), JSON.stringify(silent[EF.variant]));

  ok('anything else falls back to standard rather than reaching Airtable',
    buildEnquiryFormFields({ variant: 'PRO' }, 'a@b.com', true)[EF.variant] === 'standard'
    && buildEnquiryFormFields({ variant: 'enterprise' }, 'a@b.com', true)[EF.variant] === 'standard'
    && buildEnquiryFormFields({ variant: 42 }, 'a@b.com', true)[EF.variant] === 'standard');
  ok('there are exactly two variants', VARIANTS.join(',') === 'standard,pro');
}

console.log('And hands it back, which is what makes the editor remember');
{
  const rec = (v) => ({ id: 'recEF0000000001', fields: v === undefined ? {} : { [EF.variant]: v } });
  ok('a pro record reads back as pro', readEnquiryFormRecord(rec('pro')).variant === 'pro');
  ok('a standard record reads back as standard', readEnquiryFormRecord(rec('standard')).variant === 'standard');
  // The important one: every form that existed before this field did.
  ok('a record saved before the field existed reads as standard',
    readEnquiryFormRecord(rec(undefined)).variant === 'standard');
}

console.log('The Widgets row says so too, so nothing has to open the forms table');
{
  // The dashboard lists the Widgets table and the Travelify My Widgets count
  // reads it. Neither should need a second lookup to find out what a row is.
  const create = SRC.slice(SRC.indexOf('// Now create the pointer record in Widgets'));
  ok('the pointer written on create carries the variant',
    /variant: efFields\[EF\.variant\] \|\| 'standard',/.test(create.slice(0, 600)));
  const patch = SRC.slice(SRC.indexOf('// Patch the pointer record'));
  ok('and the one written on every later save',
    /variant: efFields\[EF\.variant\] \|\| efRec\.fields\[EF\.variant\] \|\| 'standard',/.test(patch.slice(0, 900)));
}

console.log('The editor needed no change: it was always sending it');
{
  ok('pro mode is decided from the /editor-enquirypro path',
    /EP_IS_PRO = \(location\.pathname\.indexOf\('enquirypro'\) !== -1\)/.test(EDITOR));
  ok('and from a variant that came back from the server',
    /if \(state\.config && state\.config\.variant === 'pro'\) EP_IS_PRO = true;/.test(EDITOR));
  ok('it stamps the config so the save carries it',
    /if \(EP_IS_PRO && state\.config\) state\.config\.variant = 'pro';/.test(EDITOR));
  ok('and the save sends the whole config',
    /const cfgToSend = Object\.assign\(\{\}, state\.config\);/.test(EDITOR)
    && /config: cfgToSend/.test(EDITOR));
  ok('the embed snippet follows the variant, which is what went wrong for clients',
    /const epTag {2}= EP_IS_PRO \? 'enquirypro' : 'enquiry';/.test(EDITOR)
    && /const epFile = EP_IS_PRO \? 'widget-enquirypro\.js' : 'widget-enquiry\.js';/.test(EDITOR));
}

console.log('Enquiry Pro is a variant, not a widget type');
{
  // Worth pinning: there is no "Enquiry Pro" option on the WidgetType select,
  // and adding one would strand every form already saved as "Enquiry Form".
  ok('one WidgetType for both', /const WIDGET_TYPE = 'Enquiry Form';/.test(SRC));
  // Comments mention widget-config.js (it mirrors a helper from it); what
  // matters is that it never IMPORTS or CALLS it, so the plan gate and the
  // ALLOWED_WIDGET_TYPES list are not in this path at all.
  ok('and one save path, which is why the plan gate never sees it',
    !/^\s*import .*widget-config/m.test(SRC) && !/['"`][^'"`]*\/api\/widget-config/.test(SRC));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
