/**
 * GET /api/sender-identity?email=<address>
 *
 * Editor helper. Tells a signed-in client how their branded emails will be
 * sent if replies are to go to <address>:
 *
 *   ownDomain: true   the address's domain is authenticated in our SendGrid
 *                     account, so the email goes out FROM that address
 *   ownDomain: false  the email goes out from the platform sender in the
 *                     client's name, with Reply-To set to the address
 *
 * The answer is the same canSendFrom() check the Enquiry and Quote PDF
 * senders run, so what the editor tells the client is what the customer
 * receives. Answers only for the one address asked and never lists domains.
 *
 * Auth: any signed-in session (Bearer token or tg_session cookie). Rate limited
 * per user. GET only.
 */
import { requireAuth, setCors, applyRateLimit, RATE_LIMITS } from './_auth.js';
import { canSendFrom, platformSenderEmail, domainOf } from './_lib/sendgrid.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = requireAuth(req);
  if (auth.error) return res.status(auth.status || 401).json({ error: auth.error });
  const user = auth.user || {};
  const who = String(user.email || user.userId || user.id || 'session').toLowerCase();
  if (!applyRateLimit(res, `sender-identity:${who}`, RATE_LIMITS.widgetRead)) return;

  const email = String((req.query && req.query.email) || '').trim().toLowerCase().slice(0, 120);
  const domain = domainOf(email);
  if (!domain) return res.status(400).json({ error: 'Enter a full email address, like hello@yourco.com' });

  const ownDomain = await canSendFrom(email);
  const platformSender = platformSenderEmail();
  return res.status(200).json({
    ok: true,
    email,
    domain,
    ownDomain,
    from: ownDomain ? email : platformSender,
    replyTo: email,
    platformSender,
  });
}
