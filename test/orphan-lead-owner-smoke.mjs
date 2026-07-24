/**
 * Popup leads are owner-stamped so they show in the agent's inbox (audit #9).
 *
 * writeSubmission wrote the client NAME but never the Owner Email. The enquiry
 * inbox filters strictly by Owner Email, so any popup lead not also delivered to
 * an external destination became an orphan the owning agent never saw. This
 * drives the REAL writeSubmission with a mocked Airtable POST and asserts the
 * Owner Email field is written (and normalised), matching the enquiry submit path.
 *
 * Run: node test/orphan-lead-owner-smoke.mjs
 */
process.env.TG_ENQUIRIES_AIRTABLE_BASE_ID ||= 'appTEST000000000';
process.env.TG_ENQUIRIES_AIRTABLE_PAT ||= 'patTEST';

const { buildCanonicalLead } = await import('../api/_lib/routing/schema.js');
const { writeSubmission } = await import('../api/_lib/routing/log.js');

let passed = 0, failed = 0;
const ok = (c, label) => { if (c) { passed++; } else { failed++; console.error('  FAIL:', label); } };

const OWNER_EMAIL_FIELD = 'fldPP6tud7N2wwcUG'; // Submissions → Owner Email

let captured = null;
global.fetch = async (url, opts) => {
  captured = {
    url: String(url),
    method: opts && opts.method,
    body: opts && opts.body ? JSON.parse(opts.body) : null,
  };
  return { ok: true, status: 200, json: async () => ({ records: [{ id: 'recNEWSUB0001' }] }), text: async () => '' };
};

// A popup lead whose widget resolved to George's account (mixed-case email).
const lead = buildCanonicalLead({
  source: {
    widget: 'popup',
    widgetId: 'rec140e5vxhm1FOFy',
    clientName: 'Free From Travel',
    clientEmail: 'George@FreeFromTravel.com',
    sourceUrl: 'https://www.freefromtravel.com/',
  },
  contact: { email: 'visitor@example.com', firstName: 'Jo' },
  tags: ['popup'],
});

const id = await writeSubmission(lead);
ok(id === 'recNEWSUB0001', `writeSubmission returns the new record id (got ${id})`);
ok(captured && captured.method === 'POST', 'a Submissions POST was made');

const fields = (captured && captured.body && captured.body.records && captured.body.records[0] && captured.body.records[0].fields) || {};
ok(fields[OWNER_EMAIL_FIELD] === 'george@freefromtravel.com',
  `Owner Email stamped and normalised so the lead is inbox-visible (got ${JSON.stringify(fields[OWNER_EMAIL_FIELD])})`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
