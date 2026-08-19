/**
 * Sending an email, the one place tg-sites talks to a mail provider.
 *
 * The tool has deliberately had no email until now: an invite is a link you copy
 * into whatever an agency already uses to talk (see the members screen). The
 * review-comment notification is the first thing that has to reach somebody who
 * is NOT looking at the editor, so it is the first thing that sends.
 *
 * SendGrid over the HTTPS API, the same provider and the same env vars the widget
 * suite uses (api/_lib/sendgrid.js), so there is one value in Vercel and one
 * meaning across both products. A hand-rolled fetch rather than the SDK, for the
 * cold-start reason that file gives.
 *
 * BEST EFFORT, NEVER FATAL. Every caller here is a notification, not the thing the
 * user asked for. An unset key, a provider hiccup, a bad address: each returns
 * false and the caller carries on. Nothing about a comment, a save or a build
 * depends on an email having left.
 *
 * Required environment (unset means email is simply off, not an error):
 *   SENDGRID_API_KEY, SENDGRID_FROM_EMAIL, SENDGRID_FROM_NAME_FALLBACK (optional).
 */

import 'server-only';

const ENDPOINT = 'https://api.sendgrid.com/v3/mail/send';

/** Whether a send could go out at all: the key and a verified sender are set. */
export function emailConfigured(): boolean {
  return Boolean(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL);
}

/**
 * Send one message to one or more recipients. Returns whether the provider
 * accepted it. Never throws: an unconfigured or failing send is a false, not an
 * exception, because every caller is best effort.
 */
export async function sendEmail(opts: {
  to: readonly string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /** SendGrid category, for filtering the product's sends in their dashboard. */
  categoryTag?: string;
}): Promise<boolean> {
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL;
  const fromName = process.env.SENDGRID_FROM_NAME_FALLBACK || 'Travelgenix Sites';
  if (!apiKey || !fromEmail || opts.to.length === 0) return false;

  const payload: Record<string, unknown> = {
    personalizations: [{ to: opts.to.map((email) => ({ email })) }],
    from: { email: fromEmail, name: fromName },
    subject: opts.subject,
    // SendGrid requires text/plain first when both are present.
    content: [
      { type: 'text/plain', value: opts.text },
      { type: 'text/html', value: opts.html },
    ],
  };
  if (opts.replyTo) payload.reply_to = { email: opts.replyTo };
  if (opts.categoryTag) payload.categories = [opts.categoryTag];

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    // 202 Accepted is SendGrid's success. Drain any body to free the socket.
    try {
      await res.text();
    } catch {
      // ignore
    }
    return res.status === 202;
  } catch {
    return false;
  }
}
