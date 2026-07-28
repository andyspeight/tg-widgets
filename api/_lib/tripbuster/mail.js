/**
 * Tripbuster email.
 *
 * A thin layer over the shared SendGrid helper, plus the four emails Tripbuster
 * actually sends. Kept separate from the Travelgenix templates because these go
 * to a different audience under a different brand, and because a change to a
 * Tripbuster email should not need anybody to think about booking confirmations.
 *
 * SENDING NEVER THROWS. Every function here resolves with { sent, error }. An
 * email is the second-best copy of something we have already stored: an enquiry
 * lives in the leads table whether or not the notification lands, and a sign-up
 * link can be reissued. Losing the underlying write because a mail API had a bad
 * minute would be the worse outcome by a distance.
 *
 * Required env (shared with the widget suite):
 *   SENDGRID_API_KEY
 *   SENDGRID_FROM_EMAIL          verified sender on a domain we control
 * Optional:
 *   TRIPBUSTER_FROM_EMAIL        once Tripbuster has its own verified domain
 *   TRIPBUSTER_ADMIN_EMAIL       where new sign-ups are sent for approval
 */
import { sendViaSendGrid, isValidEmail } from '../sendgrid.js';
import { siteOrigin } from './seo.js';

const BRAND = 'Tripbuster';

/** True when mail can actually be sent. Callers degrade rather than fail. */
export function mailConfigured() {
  return !!(process.env.SENDGRID_API_KEY
    && (process.env.TRIPBUSTER_FROM_EMAIL || process.env.SENDGRID_FROM_EMAIL));
}

export function adminEmail() {
  const raw = (process.env.TRIPBUSTER_ADMIN_EMAIL || '').trim().toLowerCase();
  return isValidEmail(raw) ? raw : '';
}

/**
 * Always our own verified sender, with Tripbuster as the display name.
 *
 * Deliberately not the agency's address even on the enquiry email. Sending as a
 * domain we do not control fails SPF and DKIM and lands in spam, which for a
 * notification about a waiting customer is the worst possible outcome. Reply-To
 * carries the address that should actually receive a reply.
 */
function from() {
  return {
    email: process.env.TRIPBUSTER_FROM_EMAIL || process.env.SENDGRID_FROM_EMAIL,
    name: BRAND,
  };
}

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/**
 * The shell every Tripbuster email sits in.
 *
 * Table-based and inline-styled on purpose. Email clients are not browsers:
 * Outlook still renders with Word, Gmail strips <style> blocks in some views,
 * and flexbox is not reliable anywhere. This is the boring layout that works.
 */
function shell({ heading, intro, rows, cta, footNote }) {
  const rowHtml = (rows || []).filter((r) => r && r.value).map((r) => `
      <tr>
        <td style="padding:6px 0;color:#5B7183;font-size:13px;width:130px;vertical-align:top">${esc(r.label)}</td>
        <td style="padding:6px 0;color:#123249;font-size:14px;font-weight:600">${r.raw || esc(r.value)}</td>
      </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en-GB"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F4F8FB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F8FB;padding:24px 12px">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #DCE7EF">
      <tr><td style="background:linear-gradient(135deg,#0E86C4,#35B8E0);padding:20px 26px">
        <span style="color:#ffffff;font-size:19px;font-weight:800;letter-spacing:-.02em">Trip<span style="color:#FFE3A6">buster</span></span>
      </td></tr>
      <tr><td style="padding:26px">
        <h1 style="margin:0 0 12px;font-size:20px;font-weight:800;color:#123249;letter-spacing:-.02em">${esc(heading)}</h1>
        <p style="margin:0 0 18px;font-size:14.5px;line-height:1.6;color:#3D5568">${intro}</p>
        ${rowHtml ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%"
          style="background:#F4F8FB;border-radius:10px;padding:6px 14px;margin-bottom:18px">${rowHtml}</table>` : ''}
        ${cta ? `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#FF5C39">
          <a href="${esc(cta.href)}" style="display:inline-block;padding:13px 24px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none">${esc(cta.label)}</a>
        </td></tr></table>
        <p style="margin:14px 0 0;font-size:12px;color:#7E93A4;word-break:break-all">Or paste this into your browser:<br>${esc(cta.href)}</p>` : ''}
        ${footNote ? `<p style="margin:18px 0 0;font-size:12.5px;line-height:1.55;color:#7E93A4">${footNote}</p>` : ''}
      </td></tr>
      <tr><td style="padding:16px 26px;background:#F4F8FB;border-top:1px solid #DCE7EF">
        <p style="margin:0;font-size:11.5px;line-height:1.5;color:#7E93A4">
          ${BRAND} is an advertising platform. Holidays are sold and financially
          protected by the agent, not by ${BRAND}.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/** Send, and never throw. */
async function send({ to, subject, html, replyTo, category }) {
  if (!mailConfigured()) {
    console.warn(`[tripbuster/mail] not configured, skipped "${category}"`);
    return { sent: false, error: 'not_configured' };
  }
  if (!isValidEmail(to)) {
    console.warn(`[tripbuster/mail] refusing to send "${category}" to an invalid address`);
    return { sent: false, error: 'bad_recipient' };
  }
  try {
    const out = await sendViaSendGrid({
      from: from(),
      to,
      subject,
      html,
      replyTo: isValidEmail(replyTo) ? replyTo : undefined,
      categoryTag: category,
    });
    if (out.status !== 'sent') {
      // The address itself is not logged. A bounced notification should not put
      // a traveller's or an agent's email into the log stream.
      console.warn(`[tripbuster/mail] "${category}" failed: ${out.error}`);
      return { sent: false, error: out.error };
    }
    return { sent: true, id: out.sgMessageId };
  } catch (e) {
    console.warn(`[tripbuster/mail] "${category}" threw: ${e && e.message}`);
    return { sent: false, error: (e && e.message) || 'unknown' };
  }
}

// ── the four emails ─────────────────────────────────────────────────────────

/** Prove the address. The only thing standing between a sign-up and an account. */
export function sendVerifyEmail(req, { to, agencyName, token }) {
  const href = `${siteOrigin(req)}/tripbuster/verify?token=${encodeURIComponent(token)}`;
  return send({
    to,
    subject: `Confirm your email to finish setting up ${agencyName}`,
    category: 'tb-verify',
    html: shell({
      heading: 'One click and you are in',
      intro: `Thanks for signing <b>${esc(agencyName)}</b> up to ${BRAND}. `
        + 'Confirm this is your email address and we will get your account ready.',
      cta: { href, label: 'Confirm my email' },
      footNote: 'This link works once and expires in two days. If you did not sign up '
        + 'to Tripbuster you can ignore this email and nothing will happen.',
    }),
  });
}

/**
 * Somebody tried to sign up with an address that already has an account.
 *
 * Sent so that the sign-up endpoint can answer every attempt identically without
 * leaving a real person at a dead end. Without it, someone who forgot they had
 * registered would see "check your email" and then get nothing at all, which is
 * the most confusing outcome available.
 */
export function sendAlreadyRegisteredEmail(req, { to, agencyName }) {
  const href = `${siteOrigin(req)}/tripbuster/dashboard`;
  return send({
    to,
    subject: `You already have a ${BRAND} account`,
    category: 'tb-already-registered',
    html: shell({
      heading: 'You are already signed up',
      intro: `Somebody just tried to create a ${BRAND} account with this email address, `
        + `and <b>${esc(agencyName || 'your agency')}</b> already has one. Sign in rather `
        + 'than signing up again.',
      cta: { href, label: 'Sign in' },
      footNote: 'If that was not you, nothing has changed and you can ignore this. '
        + 'Cannot remember your password? Reply to this email and we will sort it out.',
    }),
  });
}

/** Told to us by a human: you are on. */
export function sendApprovedEmail(req, { to, agencyName }) {
  const href = `${siteOrigin(req)}/tripbuster/dashboard`;
  return send({
    to,
    subject: `${agencyName} is live on ${BRAND}`,
    category: 'tb-approved',
    html: shell({
      heading: 'You are live',
      intro: `<b>${esc(agencyName)}</b> is now advertising on ${BRAND}. Sign in to add `
        + 'your first deal, set your opening hours and choose whether travellers '
        + 'click through to you or ring you.',
      cta: { href, label: 'Open my dashboard' },
      footNote: 'Not sure where to start? Add one deal and put your phone number on it. '
        + 'You can import the rest from a spreadsheet later.',
    }),
  });
}

/** Somebody signed up and is waiting on us. Goes to Tripbuster, not the agent. */
export function sendNewSignupEmail(req, { to, agencyName, agentEmail, town, website, phone, approveHref }) {
  return send({
    to,
    subject: `New Tripbuster sign-up: ${agencyName}`,
    category: 'tb-signup-admin',
    html: shell({
      heading: 'A new agency is waiting for approval',
      intro: 'They have confirmed their email address. Nothing of theirs is public '
        + 'until you approve them.',
      rows: [
        { label: 'Agency', value: agencyName },
        { label: 'Email', value: agentEmail },
        { label: 'Phone', value: phone },
        { label: 'Town', value: town },
        { label: 'Website', value: website },
      ],
      cta: { href: approveHref, label: 'Review and approve' },
      footNote: 'The link opens a page that asks you to confirm, so nothing is approved '
        + 'just because a mail scanner followed it.',
    }),
  });
}

/**
 * Somebody asked to be rung back.
 *
 * The one email in here that has to arrive quickly and be readable on a phone
 * held in one hand. Everything an agent needs to make the call is in the body,
 * so it is useful even if they never open the dashboard, and Reply-To is the
 * traveller so hitting reply just works.
 */
export function sendLeadEmail(req, lead) {
  const origin = siteOrigin(req);
  const when = lead.createdAt ? new Date(lead.createdAt) : new Date();
  const stamp = Number.isNaN(when.getTime()) ? '' : new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long',
    hour: 'numeric', minute: '2-digit', hourCycle: 'h12',
  }).format(when);

  const tel = String(lead.phone || '').replace(/[^\d+]/g, '');

  return send({
    to: lead.sendTo,
    // The name is in the subject line on purpose: an agent scanning a phone
    // notification can tell one enquiry from another without opening anything.
    subject: `${lead.name} asked ${lead.agentName} for a call back`,
    category: 'tb-lead',
    replyTo: lead.email,
    html: shell({
      heading: `${esc(lead.name)} would like a call`,
      intro: lead.dealTitle
        ? `About <b>${esc(lead.dealTitle)}</b>, advertised on ${BRAND}.`
        : `An enquiry from your deals on ${BRAND}.`,
      rows: [
        { label: 'Name', value: lead.name },
        {
          label: 'Phone',
          value: lead.phone,
          raw: tel ? `<a href="tel:${esc(tel)}" style="color:#0E86C4">${esc(lead.phone)}</a>` : '',
        },
        {
          label: 'Email',
          value: lead.email,
          raw: lead.email ? `<a href="mailto:${esc(lead.email)}" style="color:#0E86C4">${esc(lead.email)}</a>` : '',
        },
        { label: 'Best time', value: lead.preferredTime },
        { label: 'Message', value: lead.message },
        { label: 'Received', value: stamp },
      ],
      cta: { href: `${origin}/tripbuster/dashboard#leads`, label: 'Open your enquiries' },
      footNote: 'Reply to this email and it goes straight to them. '
        + 'You can turn these notifications off under Settings in your dashboard.',
    }),
  });
}
