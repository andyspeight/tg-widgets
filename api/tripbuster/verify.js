/**
 * Tripbuster email verification
 * GET /tripbuster/verify?token=...
 *
 * The link from the sign-up email. Answers with a page rather than JSON, because
 * this is somebody clicking a link in their inbox, not a script.
 *
 * The token is consumed whichever way it goes, so a link works exactly once.
 *
 * WHAT HAPPENS AFTER depends on TRIPBUSTER_AGENT_APPROVAL. On 'auto' the agency
 * is trading immediately. On anything else (the default) they are verified but
 * still pending, and this is the moment Tripbuster gets emailed to take a look.
 * Either way the page says plainly which of the two it was, because "thanks!"
 * with no indication of whether you can now do anything is a bad first
 * impression of a product somebody just signed up to.
 */
import { evaluatePublicRateLimit } from '../_lib/rate-limit-public.js';
import { tbConfigured, tbRpc } from '../_lib/tripbuster/db.js';
import { signAdminLink, authConfigured } from '../_lib/tripbuster/auth.js';
import { noticePage } from '../_lib/tripbuster/notice.js';
import { siteOrigin, esc } from '../_lib/tripbuster/seo.js';
import { sendApprovedEmail, sendNewSignupEmail, adminEmail } from '../_lib/tripbuster/mail.js';
import { tokenHash, autoActivates } from './register.js';

function html(res, status, body) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(status).send(body);
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }

  const token = typeof (req.query || {}).token === 'string' ? req.query.token.trim().slice(0, 200) : '';

  // Guessing a 32-byte token is not realistic, but a ceiling here costs nothing
  // and keeps a bored script from turning the endpoint into free database load.
  const rl = await evaluatePublicRateLimit(req, res, { event: 'tb-login', widgetId: 'verify' });
  if (!rl.allowed) {
    return html(res, 429, noticePage({
      tone: 'bad',
      title: 'Too many attempts',
      body: 'Give it a minute and try that link again.',
    }));
  }

  if (!token || !tbConfigured()) {
    return html(res, 400, noticePage({
      tone: 'bad',
      title: 'That link is not valid',
      body: 'It may have been copied incompletely. Try clicking the link in the email '
        + 'again rather than pasting it.',
      cta: { href: '/tripbuster/dashboard', label: 'Go to sign in' },
    }));
  }

  let result;
  try {
    result = await tbRpc('tb_verify_agent', {
      p_token_hash: tokenHash(token),
      p_auto_activate: autoActivates(),
    });
  } catch (e) {
    console.error('[tripbuster/verify] failed', e && e.code);
    return html(res, 502, noticePage({
      tone: 'bad',
      title: 'We could not check that link',
      body: 'Something went wrong at our end rather than yours. Please try again shortly.',
    }));
  }

  if (!result || !result.ok) {
    if (result && result.reason === 'expired') {
      return html(res, 410, noticePage({
        tone: 'bad',
        title: 'That link has expired',
        body: 'Confirmation links last two days. Sign up again with the same email '
          + 'address and we will send you a fresh one.',
        cta: { href: '/tripbuster/dashboard', label: 'Sign up again' },
      }));
    }
    return html(res, 404, noticePage({
      tone: 'bad',
      title: 'That link has already been used',
      body: 'Confirmation links work once. If you have already confirmed your address, '
        + 'just sign in.',
      cta: { href: '/tripbuster/dashboard', label: 'Go to sign in' },
    }));
  }

  const name = result.name || 'Your agency';

  if (result.active) {
    // Trading immediately. Tell them, and put the welcome in writing too, since
    // the page they are looking at is the only other place it exists.
    sendApprovedEmail(req, { to: result.email, agencyName: name }).catch(() => {});
    return html(res, 200, noticePage({
      title: 'You are all set',
      body: `<b>${esc(name)}</b> is confirmed and live on Tripbuster. Sign in to add your `
        + 'first deal.',
      cta: { href: '/tripbuster/dashboard', label: 'Open my dashboard' },
    }));
  }

  // Verified, waiting on us. Email Tripbuster with a one-click route to approve,
  // so the wait is measured in however long it takes somebody to read an email
  // rather than in how long until a developer next opens the database.
  const to = adminEmail();
  if (to && authConfigured()) {
    try {
      const { exp, sig } = signAdminLink(result.agentId);
      const approveHref = `${siteOrigin(req)}/tripbuster/approve`
        + `?agent=${encodeURIComponent(result.agentId)}`
        + `&exp=${encodeURIComponent(exp)}&sig=${encodeURIComponent(sig)}`;
      await sendNewSignupEmail(req, {
        to,
        agencyName: name,
        agentEmail: result.email,
        approveHref,
      });
    } catch (e) {
      console.error('[tripbuster/verify] could not send the approval email', e && e.message);
    }
  } else {
    // Loud, because the agency is now sitting in a queue nobody is watching.
    console.error('[tripbuster/verify] agency verified but TRIPBUSTER_ADMIN_EMAIL is not set '
      + '— nobody has been told there is an account waiting for approval');
  }

  return html(res, 200, noticePage({
    title: 'Thanks, that is confirmed',
    body: `We have your email address for <b>${esc(name)}</b>. We check every new agency `
      + 'before their deals go live, which usually takes less than a working day. '
      + 'You can sign in and get your deals ready in the meantime.',
    cta: { href: '/tripbuster/dashboard', label: 'Go to sign in' },
  }));
}
