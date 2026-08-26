/**
 * Payment reminder — client-authored ("admin") email copy (Andy/Lapland, Aug 2026).
 *
 * Clients write their own reminder wording per stage (interim / final) in the My
 * Booking editor, using merge tags. renderReminderEmail fills the tags, escapes
 * everything, wraps their prose in the branded shell and adds the pay button.
 * When no custom copy exists it falls back to the built-in template.
 *
 * Run: node test/reminder-email-custom-smoke.mjs   (npm run test:reminder-email-custom)
 */
import { renderReminderEmail } from '../api/_lib/payment-reminder-email.js';
import { normaliseReminderEmails } from '../api/_lib/payment-reminders.js';

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

const AGENCY = { name: 'Lapland Magic', supportPhone: '0333 207 6655', supportEmail: 'hello@lapland.example', pageUrl: 'https://lapland.example/booking' };
const CHARGE = { amount: 350, currency: 'GBP', total: 1200, paid: 850, outstanding: 350, isInstalment: false };
const PAY = 'https://lapland.example/booking#tg-pay=ST-24189';

console.log('Client copy is rendered with merge tags filled and the pay button added');
{
  const template = {
    subject: 'Your interim payment of {amount} is due',
    body: 'Hello {firstName}\nWe hope you’re looking forward to your Lapland trip!\n\nThe interim payment of {amount} for booking {bookingRef} is due on {dueDate}. You can pay online, or call us on {agencyPhone}.\n\nThank you from {agencyName}.',
  };
  const { subject, html } = renderReminderEmail({
    agency: AGENCY, customerFirstName: 'Sam', orderRef: 'ST-24189', charge: CHARGE,
    dueDateIso: '2026-11-15', payUrl: PAY, sequence: { n: 1, of: 3 }, template,
  });
  ok('subject uses the client copy with {amount} filled', subject === 'Your interim payment of £350.00 is due');
  ok('the greeting merges {firstName}', html.includes('Hello Sam'));
  ok('the amount merges into the body', html.includes('£350.00'));
  ok('the due date merges as a long date', html.includes('15 November 2026'));
  ok('the booking ref merges', html.includes('ST-24189'));
  ok('the agency phone merges', html.includes('0333 207 6655'));
  ok('the agency name merges', html.includes('Thank you from Lapland Magic'));
  ok('the pay button is added automatically', html.includes('Pay my balance') && html.includes(PAY));
  ok('the built-in cost card is NOT used (client copy replaces it)', !html.includes('Total holiday cost'));
}

console.log('The final-stage template is its own copy');
{
  const template = { subject: 'Final balance for your trip', body: 'The final balance of {amount} is due on {dueDate}.' };
  const { subject, html } = renderReminderEmail({
    agency: AGENCY, customerFirstName: 'Sam', orderRef: 'ST-1', charge: CHARGE,
    dueDateIso: '2026-12-01', payUrl: PAY, sequence: { n: 1, of: 1 }, template,
  });
  ok('final subject is the client copy', subject === 'Final balance for your trip');
  ok('final body renders', html.includes('The final balance of £350.00 is due on') && html.includes('1 December 2026'));
}

console.log('No client copy falls back to the built-in template');
{
  const { subject, html } = renderReminderEmail({
    agency: AGENCY, customerFirstName: 'Sam', orderRef: 'ST-1', charge: CHARGE,
    dueDateIso: '2026-11-15', payUrl: PAY, sequence: { n: 1, of: 3 }, template: null,
  });
  ok('falls back to the built-in subject', subject === 'Your balance of £350.00 is due');
  ok('falls back to the built-in cost card', html.includes('Balance due') || html.includes('Total holiday cost'));
}

console.log('Client copy is escaped — no HTML injection');
{
  const template = { subject: 'x', body: 'Danger <script>alert(1)</script> and {firstName}.' };
  const { html } = renderReminderEmail({
    agency: AGENCY, customerFirstName: 'A<b>B</b>', orderRef: 'ST-1', charge: CHARGE,
    dueDateIso: '2026-11-15', payUrl: PAY, sequence: { n: 1, of: 1 }, template,
  });
  ok('a script tag in the body is neutralised', html.includes('&lt;script&gt;') && !html.includes('<script>alert(1)'));
  ok('a merged value with markup is escaped', html.includes('A&lt;b&gt;B&lt;/b&gt;'));
}

console.log('An unknown merge tag is left visible (a typo is obvious, not silently blank)');
{
  const template = { subject: 'x', body: 'Hi {firstName}, ref {madeUpTag} here.' };
  const { html } = renderReminderEmail({ agency: AGENCY, customerFirstName: 'Sam', orderRef: 'ST-1', charge: CHARGE, dueDateIso: '2026-11-15', payUrl: PAY, sequence: { n: 1, of: 1 }, template });
  ok('unknown {madeUpTag} stays literal', html.includes('{madeUpTag}'));
}

console.log('normaliseReminderEmails sanitises the stored config');
{
  ok('keys interim + final, drops empty body', JSON.stringify(normaliseReminderEmails({ interim: { subject: 'S', body: 'B' }, final: { subject: 'F', body: '   ' } })) === JSON.stringify({ interim: { subject: 'S', body: 'B' } }));
  ok('accepts depositBalance/finalBalance aliases', !!normaliseReminderEmails({ depositBalance: { subject: 'S', body: 'B' } }).interim);
  ok('null when nothing usable', normaliseReminderEmails({ interim: { body: '' } }) === null);
  ok('non-object → null', normaliseReminderEmails('nope') === null);
  const long = normaliseReminderEmails({ interim: { subject: 'x'.repeat(500), body: 'y'.repeat(20000) } });
  ok('caps subject at 200 and body at 8000', long.interim.subject.length === 200 && long.interim.body.length === 8000);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
