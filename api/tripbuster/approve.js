/**
 * Tripbuster agency approval
 * GET  /tripbuster/approve?agent=&exp=&sig=   → a page asking you to confirm
 * POST /tripbuster/approve                    → actually approves
 *
 * The last step of sign-up: a human at Tripbuster looks at a new agency and says
 * yes. Reached from the email sent when they confirmed their address.
 *
 * ── WHY THE GET DOES NOT APPROVE ANYTHING ──────────────────────────────────
 *
 * Mail providers, security appliances and link previewers all follow links in
 * emails before a person ever sees them. If the GET approved, every new agency
 * would be approved by a scanner within seconds of the email arriving, and the
 * review step would exist only on paper. So the GET renders a page with a button
 * and the POST does the work.
 *
 * ── WHY A SIGNED LINK RATHER THAN A LOGIN ──────────────────────────────────
 *
 * There is no Tripbuster admin account to log in to yet. The link is HMAC-signed
 * with the session secret under its own purpose string and expires in a
 * fortnight, so it authorises one thing, for one agency, for a bounded time, and
 * cannot be replayed as a session. When there is a proper admin area this should
 * move behind it.
 */
import { tbConfigured, tbRpc } from '../_lib/tripbuster/db.js';
import { verifyAdminLink, authConfigured } from '../_lib/tripbuster/auth.js';
import { noticePage } from '../_lib/tripbuster/notice.js';
import { esc } from '../_lib/tripbuster/seo.js';
import { sendApprovedEmail } from '../_lib/tripbuster/mail.js';

function html(res, status, body) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // This page carries an authorising token in its URL. Referrer headers must not
  // leak it, and it must not be framed.
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  return res.status(status).send(body);
}

const NOT_VALID = {
  tone: 'bad',
  title: 'That approval link is not valid',
  body: 'It may have expired, or been altered on its way here. Approval links last '
    + 'a fortnight. Ask for a fresh one rather than editing this address.',
};

function readParams(req) {
  const q = req.query || {};
  let b = req.body;
  if (typeof b === 'string') {
    // A plain form POST arrives urlencoded rather than as JSON.
    try {
      b = Object.fromEntries(new URLSearchParams(b));
    } catch {
      b = {};
    }
  }
  if (!b || typeof b !== 'object') b = {};
  const pick = (k) => {
    const v = b[k] !== undefined ? b[k] : q[k];
    return typeof v === 'string' ? v.trim().slice(0, 200) : '';
  };
  return { agent: pick('agent'), exp: pick('exp'), sig: pick('sig') };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, POST, HEAD');
    return res.status(405).end();
  }

  const { agent, exp, sig } = readParams(req);

  if (!authConfigured() || !tbConfigured()) {
    return html(res, 503, noticePage({
      tone: 'bad',
      title: 'Approvals are not configured',
      body: 'This deployment is missing the settings needed to approve an agency.',
    }));
  }

  if (!verifyAdminLink(agent, exp, sig)) {
    return html(res, 403, noticePage(NOT_VALID));
  }

  // The confirmation step. Nothing has happened yet.
  if (req.method !== 'POST') {
    const form = `<form method="post" action="/tripbuster/approve" class="notice-form">
      <input type="hidden" name="agent" value="${esc(agent)}">
      <input type="hidden" name="exp" value="${esc(exp)}">
      <input type="hidden" name="sig" value="${esc(sig)}">
      <button class="btn btn-primary" type="submit">Approve this agency</button>
    </form>`;
    return html(res, 200, noticePage({
      title: 'Approve this agency?',
      body: 'They have confirmed their email address. Approving puts their deals live '
        + 'on Tripbuster and emails them to say so. Nothing happens until you press '
        + 'the button.',
      form,
    }));
  }

  let result;
  try {
    result = await tbRpc('tb_approve_agent', { p_agent_id: agent });
  } catch (e) {
    console.error('[tripbuster/approve] failed', e && e.code);
    return html(res, 502, noticePage({
      tone: 'bad',
      title: 'We could not approve that agency',
      body: 'Something went wrong at our end. Please try again shortly.',
    }));
  }

  if (!result || !result.ok) {
    const reason = result && result.reason;
    if (reason === 'unverified') {
      return html(res, 409, noticePage({
        tone: 'bad',
        title: 'They have not confirmed their email yet',
        body: 'An agency has to prove it owns its address before it can go live. '
          + 'Once they click the link in their sign-up email, approve them then.',
      }));
    }
    if (reason === 'not_pending') {
      return html(res, 409, noticePage({
        tone: 'bad',
        title: 'That account is not waiting for approval',
        body: `It is currently <b>${esc(result.status || 'not pending')}</b>, which somebody `
          + 'set deliberately. An old approval link will not undo that.',
      }));
    }
    return html(res, 404, noticePage({
      tone: 'bad',
      title: 'We could not find that agency',
      body: 'The account may have been removed.',
    }));
  }

  if (result.already) {
    return html(res, 200, noticePage({
      title: 'Already approved',
      body: `<b>${esc(result.name || 'That agency')}</b> is live. Nothing to do.`,
    }));
  }

  // Best effort. The agency IS live either way, so a failed welcome email must
  // not read as a failed approval.
  const mail = await sendApprovedEmail(req, {
    to: result.email,
    agencyName: result.name || 'Your agency',
  });

  return html(res, 200, noticePage({
    title: 'Approved',
    body: `<b>${esc(result.name || 'That agency')}</b> is live on Tripbuster.`
      + (mail.sent
        ? ' They have been emailed to say so.'
        : ' We could not send their welcome email, so you may want to tell them.'),
  }));
}
