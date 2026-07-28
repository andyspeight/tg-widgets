/**
 * Tripbuster agent sign-up
 * POST /api/tripbuster/register  { name, email, password, phone?, website?, town?, agreed }
 *
 * Until this existed every agency on the platform was created by hand in SQL. A
 * self-serve advertising platform that needs a developer to add a customer is
 * not self-serve.
 *
 * ── THE RESPONSE IS ALWAYS THE SAME ────────────────────────────────────────
 *
 * Whether the address is brand new, already half-registered, or belongs to a
 * live agency, this endpoint answers "check your email" and nothing else. A
 * sign-up form that says "that email is taken" is a way to ask whether a named
 * travel agency advertises here, one address at a time, and competitor lists are
 * exactly the sort of thing people build with that.
 *
 * The difference is in which email goes out, not in what the caller is told.
 *
 * ── NOTHING IS PUBLIC UNTIL TWO THINGS HAVE HAPPENED ───────────────────────
 *
 *   1. the agent proves they own the address, by clicking the emailed link
 *   2. Tripbuster approves them, unless TRIPBUSTER_AGENT_APPROVAL=auto
 *
 * The default is manual, and deliberately so. A verified mailbox is proof of a
 * mailbox, not of a travel agency, and what gets published here is a holiday
 * advert with a phone number on it. Approval is a click in an email rather than
 * a database query, so the friction lands on us and not on the agency.
 */
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { evaluatePublicRateLimit } from '../_lib/rate-limit-public.js';
import { tbConfigured, tbRpc } from '../_lib/tripbuster/db.js';
import { visitorContext } from '../_lib/tripbuster/visitor.js';
import { validateRegistration } from '../_lib/tripbuster/register-schema.js';
import { sendVerifyEmail, sendAlreadyRegisteredEmail, mailConfigured } from '../_lib/tripbuster/mail.js';

const BCRYPT_ROUNDS = 10;
const TOKEN_TTL_MS = 48 * 60 * 60 * 1000;

// Every new agency starts on the smallest plan. One live deal is enough to set
// themselves up and prove the thing works, and it bounds what a sign-up that
// turns out to be a nuisance can put in front of a traveller.
const STARTING_PLAN = 'Spark';

/** What a caller is told, every time, whatever actually happened. */
const SAME_ANSWER = {
  ok: true,
  message: 'Check your email. We have sent a link to confirm your address.',
};

export function tokenHash(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

/** Manual unless explicitly switched off. See the note at the top. */
export function autoActivates() {
  return (process.env.TRIPBUSTER_AGENT_APPROVAL || '').trim().toLowerCase() === 'auto';
}

export default async function handler(req, res) {
  // No CORS headers. Sign-up is a first-party surface; a wildcard origin here
  // would let any site drive account creation from somebody else's browser.
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};

  // Counted per IP and per IP+email. Creating accounts is expensive for us (a
  // bcrypt hash and an outbound email each) and worthless to the person doing it
  // in bulk, so this sits close to the login ceiling rather than the click one.
  const rl = await evaluatePublicRateLimit(req, res, {
    event: 'tb-register',
    widgetId: typeof body.email === 'string' ? body.email.slice(0, 200) : '',
  });
  if (!rl.allowed) {
    return res.status(429).json({ error: 'Too many sign-up attempts. Try again shortly.' });
  }

  const { ok, agent, errors } = validateRegistration(body);
  if (!ok) return res.status(422).json({ error: 'Some details need fixing', errors });

  if (!tbConfigured()) {
    return res.status(503).json({ error: 'Sign-up is not available just now. Please try again shortly.' });
  }
  if (!mailConfigured()) {
    // Refused rather than half-done. Creating the account and failing to send
    // the link would leave somebody with an address they cannot verify and a
    // password they cannot use, and a second attempt would tell them the email
    // was already taken.
    console.error('[tripbuster/register] SendGrid is not configured; refusing to create an account');
    return res.status(503).json({ error: 'Sign-up is not available just now. Please try again shortly.' });
  }

  try {
    const token = randomBytes(32).toString('base64url');
    const passwordHash = await bcrypt.hash(agent.password, BCRYPT_ROUNDS);
    const v = visitorContext(req);

    const result = await tbRpc('tb_register_agent', {
      p_name: agent.name,
      p_email: agent.email,
      p_password_hash: passwordHash,
      // Only the hash is stored. A working sign-up link should not exist in our
      // database any more than a password should.
      p_token_hash: tokenHash(token),
      p_expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
      p_phone: agent.phone,
      p_website: agent.website,
      p_town: agent.town,
      p_ip_hash: v.ipHash,
      p_plan: STARTING_PLAN,
    });

    const reason = result && result.reason;

    if (result && result.created === false && reason === 'taken') {
      // Deliberately still a 200 with the standard message. The person who owns
      // the address gets told what happened; the person typing the form does not.
      await sendAlreadyRegisteredEmail(req, { to: agent.email, agencyName: agent.name });
      return res.status(200).json(SAME_ANSWER);
    }

    // Created, or an unverified sign-up given a fresh link. Both get the link.
    const mail = await sendVerifyEmail(req, {
      to: agent.email,
      agencyName: (result && result.name) || agent.name,
      token,
    });

    if (!mail.sent) {
      // The row exists but the link never left. Saying "check your email" here
      // would strand them, so this is the one case that admits to a problem.
      console.error('[tripbuster/register] account created but the verify email failed');
      return res.status(502).json({
        error: 'We could not send your confirmation email. Please try signing up again in a moment.',
      });
    }

    return res.status(200).json(SAME_ANSWER);
  } catch (e) {
    console.error('[tripbuster/register] failed', e && e.code, e && e.message);
    return res.status(502).json({ error: 'We could not sign you up just now. Please try again.' });
  }
}
