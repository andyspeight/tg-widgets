/**
 * Emailing a stored enquiry to the address the form asked for.
 *
 * BEST EFFORT, caught whole, the same stance as the comment notifier: the
 * submission is stored the moment submit_form returns, and this runs after.
 * An unset mail key, a bad address, a provider hiccup: each is a quiet return
 * and the enquiry still sits in Enquiries. Email is the courtesy copy, the
 * table is the record.
 *
 * EVERYTHING IN THE BODY IS VISITOR OR CLIENT TEXT and is escaped for the
 * HTML part. The reply-to is the visitor's email when the form collected one,
 * so replying in a mail client just works.
 */

import 'server-only';

import { sendEmail } from '../email/send';
import { cleanNotifyEmail } from './submit';
import type { FoundForm } from './submit';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** The visitor's own address, when one of the form's email fields holds one. */
function visitorEmail(form: FoundForm, data: Record<string, string>): string {
  for (let index = 0; index < form.fields.length; index += 1) {
    if (form.fields[index].kind !== 'email') continue;
    const key = form.fields[index].label || `Field ${index + 1}`;
    const candidate = cleanNotifyEmail(data[key] ?? '');
    if (candidate) return candidate;
  }
  return '';
}

export async function notifySubmission(input: {
  host: string;
  form: FoundForm;
  pageTitle: string;
  data: Record<string, string>;
}): Promise<void> {
  try {
    const to = cleanNotifyEmail(input.form.notifyEmail);
    if (!to) return;

    const formName = input.form.name || 'Form';
    const subject = `New enquiry: ${formName} (${input.host})`;

    const lines = Object.entries(input.data).map(([key, value]) => `${key}:\n${value || '-'}`);
    const text =
      `A visitor sent the ${formName} form on ${input.pageTitle || input.host}.\n\n` +
      `${lines.join('\n\n')}\n\n` +
      'The full record is in Enquiries in your site tool.';

    const rows = Object.entries(input.data)
      .map(
        ([key, value]) =>
          `<tr><td style="padding:6px 12px 6px 0;vertical-align:top;font-weight:600;">${escapeHtml(key)}</td>` +
          `<td style="padding:6px 0;white-space:pre-wrap;">${escapeHtml(value || '-')}</td></tr>`,
      )
      .join('');
    const html =
      `<p>A visitor sent the <strong>${escapeHtml(formName)}</strong> form on ` +
      `<strong>${escapeHtml(input.pageTitle || input.host)}</strong>.</p>` +
      `<table style="border-collapse:collapse;">${rows}</table>` +
      '<p>The full record is in Enquiries in your site tool.</p>';

    await sendEmail({
      to: [to],
      subject,
      text,
      html,
      replyTo: visitorEmail(input.form, input.data) || undefined,
      categoryTag: 'tg-sites-enquiry',
    });
  } catch {
    // The enquiry is stored; the courtesy copy failing is not an event.
  }
}
