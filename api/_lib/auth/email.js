/**
 * Email sending for auth flows. Uses SendGrid (the same service the My Booking
 * widget uses for confirmation emails — already wired up on this project).
 *
 * Required env vars (all already exist on the tg-widgets Vercel project):
 *   SENDGRID_API_KEY            — Bearer token for SendGrid v3 API
 *   SENDGRID_FROM_EMAIL         — verified sender address (e.g. noreply@travelify.io)
 *   SENDGRID_FROM_NAME_FALLBACK — default display name (we override per-email below)
 *   APP_BASE_URL                — public URL of the widget suite
 *                                 (https://widgets.travelify.io)
 *
 * Sender display name:
 *   We set the From "name" field to "Travelgenix" on every auth email so the
 *   user sees the brand they're signing into, even though the technical
 *   sending domain is travelify.io. This keeps brand consistency without
 *   needing a second verified sender.
 *
 * Templates are inline HTML. Email clients strip <style> blocks, so all
 * CSS is inline. No external images — keeps trust signal high and avoids
 * blocked-image rendering issues.
 */

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'noreply@travelify.io';
const APP_BASE_URL = (process.env.APP_BASE_URL || 'https://widgets.travelify.io').replace(/\/$/, '');

// Display name on the From field. Always "Travelgenix" for auth emails so the
// user sees the brand they're interacting with.
const FROM_NAME = 'Travelgenix';

async function sendEmail({ to, subject, html, text }) {
  if (!SENDGRID_API_KEY) {
    console.warn('[auth/email] SENDGRID_API_KEY not set — skipping send to', to);
    return { skipped: true };
  }

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: FROM_EMAIL, name: FROM_NAME },
      subject,
      content: [
        // SendGrid requires text/plain BEFORE text/html when both present
        { type: 'text/plain', value: text || '' },
        { type: 'text/html', value: html }
      ]
    })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`SendGrid ${res.status}: ${body.slice(0, 200)}`);
  }

  // SendGrid returns 202 Accepted with empty body on success
  return { ok: true, status: res.status };
}

// ----------------------------------------------------------------------------
// HTML escape (we interpolate user-controlled values into templates)
// ----------------------------------------------------------------------------
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ----------------------------------------------------------------------------
// Shared layout
// ----------------------------------------------------------------------------
function layout({ heading, bodyHtml, ctaUrl, ctaLabel }) {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:32px 32px 0;">
          <div style="font-size:14px;font-weight:600;letter-spacing:.04em;color:#666;text-transform:uppercase;">Travelgenix</div>
        </td></tr>
        <tr><td style="padding:8px 32px 0;">
          <h1 style="margin:0;font-size:22px;color:#111;font-weight:600;letter-spacing:-.01em;">${esc(heading)}</h1>
        </td></tr>
        <tr><td style="padding:16px 32px;color:#333;font-size:15px;line-height:1.55;">
          ${bodyHtml}
        </td></tr>
        ${ctaUrl ? `
        <tr><td style="padding:8px 32px 24px;">
          <a href="${esc(ctaUrl)}" style="display:inline-block;background:#0a6cff;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:15px;">${esc(ctaLabel)}</a>
        </td></tr>
        <tr><td style="padding:0 32px 32px;color:#888;font-size:12px;line-height:1.5;word-break:break-all;">
          Or copy this link into your browser:<br>
          <span style="color:#555;">${esc(ctaUrl)}</span>
        </td></tr>` : ''}
        <tr><td style="border-top:1px solid #eee;padding:20px 32px;color:#888;font-size:12px;line-height:1.5;">
          Travelgenix · Bournemouth, UK · part of Agendas Group
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// ----------------------------------------------------------------------------
// Templates
// ----------------------------------------------------------------------------

export async function sendPasswordResetEmail({ to, resetToken, fullName }) {
  const url = `${APP_BASE_URL}/reset-password?token=${encodeURIComponent(resetToken)}`;
  const greeting = fullName ? `Hi ${fullName.split(' ')[0]},` : 'Hi,';
  const html = layout({
    heading: 'Reset your password',
    bodyHtml: `
      <p style="margin:0 0 12px;">${esc(greeting)}</p>
      <p style="margin:0 0 12px;">We got a request to reset the password on your Widget Suite account. Click the button below to choose a new one. The link works for the next hour.</p>
      <p style="margin:0 0 12px;color:#666;">If you didn't ask for this, you can safely ignore this email.</p>
    `,
    ctaUrl: url,
    ctaLabel: 'Reset password'
  });
  const text = `${greeting}\n\nReset your Widget Suite password by visiting:\n${url}\n\nThe link works for the next hour. If you didn't request this, ignore this email.\n\n— Travelgenix`;
  return sendEmail({ to, subject: 'Reset your Travelgenix password', html, text });
}

export async function sendMigrationResetEmail({ to, resetToken, fullName, clientName }) {
  const url = `${APP_BASE_URL}/reset-password?token=${encodeURIComponent(resetToken)}&migration=1`;
  const greeting = fullName ? `Hi ${fullName.split(' ')[0]},` : 'Hi there,';
  const html = layout({
    heading: "We've upgraded our security",
    bodyHtml: `
      <p style="margin:0 0 12px;">${esc(greeting)}</p>
      <p style="margin:0 0 12px;">We've just rolled out a more secure sign-in for the Travelgenix Widget Suite${clientName ? ` (${esc(clientName)})` : ''}. As part of the upgrade, everyone needs to set a new password the next time they sign in.</p>
      <p style="margin:0 0 12px;">Click below to set yours. The link works for the next 7 days.</p>
      <p style="margin:0 0 12px;color:#666;">Soon you'll also be able to sign in with Google or Microsoft, and invite colleagues to your account. We'll let you know when those land.</p>
    `,
    ctaUrl: url,
    ctaLabel: 'Set new password'
  });
  const text = `${greeting}\n\nWe've upgraded our sign-in security. Please set a new password by visiting:\n${url}\n\nThe link works for the next 7 days.\n\n— Travelgenix`;
  return sendEmail({
    to,
    subject: 'Action needed — set a new Travelgenix password',
    html,
    text
  });
}

export async function sendInviteEmail({ to, inviteToken, inviterName, clientName, role }) {
  const url = `${APP_BASE_URL}/accept-invite?token=${encodeURIComponent(inviteToken)}`;
  const html = layout({
    heading: "You've been invited",
    bodyHtml: `
      <p style="margin:0 0 12px;"><strong>${esc(inviterName || 'A colleague')}</strong> has invited you to join <strong>${esc(clientName)}</strong> on the Travelgenix Widget Suite${role ? ` as <strong>${esc(role)}</strong>` : ''}.</p>
      <p style="margin:0 0 12px;">Click below to set up your account. The link works for the next 7 days.</p>
    `,
    ctaUrl: url,
    ctaLabel: 'Accept invitation'
  });
  const text = `${inviterName || 'A colleague'} has invited you to join ${clientName} on the Travelgenix Widget Suite.\n\nAccept here:\n${url}\n\nThe link works for the next 7 days.`;
  return sendEmail({
    to,
    subject: `You've been invited to ${clientName} on Travelgenix`,
    html,
    text
  });
}

export async function sendPasswordChangedEmail({ to, fullName, ip }) {
  const greeting = fullName ? `Hi ${fullName.split(' ')[0]},` : 'Hi,';
  const html = layout({
    heading: 'Your password was changed',
    bodyHtml: `
      <p style="margin:0 0 12px;">${esc(greeting)}</p>
      <p style="margin:0 0 12px;">Your Travelgenix Widget Suite password was just changed${ip ? ` (from IP ${esc(ip)})` : ''}.</p>
      <p style="margin:0 0 12px;">If this was you, you can ignore this email. If not, please get in touch with us right away — your account may have been compromised.</p>
    `
  });
  const text = `${greeting}\n\nYour Travelgenix Widget Suite password was just changed${ip ? ` (from IP ${ip})` : ''}.\n\nIf this wasn't you, contact us immediately.\n\n— Travelgenix`;
  return sendEmail({ to, subject: 'Your Travelgenix password was changed', html, text });
}
