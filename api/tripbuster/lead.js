/**
 * Tripbuster callback request
 * POST /api/tripbuster/lead   { dealId, name, phone?, email?, message?, preferredTime?, surface? }
 *
 * "Ask us to ring you." The traveller leaves a name and a phone number or an
 * email address or both, and the agency advertising that deal gets an enquiry
 * they can act on.
 *
 * This is the strongest thing Tripbuster can charge for. Unlike a click-out or a
 * call button, it is provable from end to end: a real person left real contact
 * details, it works on a desktop as well as a phone, and the agency can tell us
 * afterwards what came of it. That last part is what settles arguments.
 *
 * Public, because the caller is a traveller. Unlike the other public endpoints
 * this one WRITES PERSONAL DATA, so it is deliberately stricter:
 *
 *   • the body is whitelisted by validateLead — nothing else is stored
 *   • a hidden field catches the bots that fill in everything they find
 *   • it is rate limited harder than a click, because a form is a spam target
 *   • the response never echoes back what was submitted, so this cannot be used
 *     to bounce content off our domain
 *
 * The details go to the agency named on the deal and nowhere else. The form says
 * so, because a traveller handing over a phone number deserves to know who gets
 * it.
 */
import { setCors } from '../_auth.js';
import { evaluatePublicRateLimit } from '../_lib/rate-limit-public.js';
import { tbConfigured, tbRpc } from '../_lib/tripbuster/db.js';
import { visitorContext, contactHash } from '../_lib/tripbuster/visitor.js';
import { validateLead } from '../_lib/tripbuster/lead-schema.js';
import { sendLeadEmail } from '../_lib/tripbuster/mail.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SURFACES = ['site', 'widget', 'directory', 'api'];

/**
 * Email the agency that somebody wants a call back.
 *
 * WAITED FOR RATHER THAN FIRED AND FORGOTTEN, on purpose. A serverless function
 * can be frozen the instant it responds, so work left running after res.json()
 * is work that may simply never happen. The traveller waits a few hundred
 * milliseconds longer; the agency gets told. That is the right way round for the
 * one event on this platform where a real person is expecting a phone call.
 *
 * CLAIMED BEFORE SENDING. tb_claim_lead_notification stamps notified_at and
 * hands back the details in a single statement, so two concurrent attempts
 * cannot both decide they are the one sending. If the send then fails the claim
 * is released, leaving the enquiry owed an email rather than silently marked as
 * handled.
 *
 * NOTHING HERE CAN FAIL THE ENQUIRY. It is already stored and already visible in
 * the agency's inbox. A mail outage must cost a notification, never the lead.
 */
async function notifyAgency(req, leadId) {
  if (!leadId) return;
  let claim = null;
  try {
    claim = await tbRpc('tb_claim_lead_notification', { p_lead_id: leadId });
  } catch (e) {
    console.warn('[tripbuster/lead] could not claim the notification', e && e.code);
    return;
  }
  // Null means there is nothing to do: already notified, or this agency has
  // notifications switched off.
  if (!claim || !claim.sendTo) return;

  const mail = await sendLeadEmail(req, claim);
  if (!mail.sent) {
    try {
      await tbRpc('tb_release_lead_notification', { p_lead_id: leadId });
    } catch {
      // Then it stays marked as notified. The enquiry is still in the inbox,
      // which is the thing that actually matters.
    }
  }
}

export default async function handler(req, res) {
  setCors(res);
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};

  const dealId = typeof body.dealId === 'string' ? body.dealId.trim() : '';
  if (!UUID_RE.test(dealId)) return res.status(400).json({ error: 'A valid deal id is required' });

  // A field no human sees and no human fills in. Bots that hoover up every input
  // on a page trip it. Answered with a cheerful 200 so the bot has no signal to
  // learn from and no reason to retry with the field left blank.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return res.status(200).json({ recorded: true });
  }

  const surfaceRaw = typeof body.surface === 'string' ? body.surface.trim() : '';
  const surface = SURFACES.includes(surfaceRaw) ? surfaceRaw : 'site';

  const { ok, lead, errors } = validateLead(body);
  if (!ok) return res.status(422).json({ error: 'Some details need fixing', errors });

  // Harder than a click: a form that writes personal data is worth more to abuse
  // and costs more to store.
  const rl = await evaluatePublicRateLimit(req, res, { event: 'tb-lead', widgetId: dealId });
  if (!rl.allowed) {
    return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
  }

  if (!tbConfigured()) {
    return res.status(503).json({ error: 'Enquiries are not available right now. Please ring the agency directly.' });
  }

  try {
    const v = visitorContext(req);
    const result = await tbRpc('tb_record_lead', {
      p_deal_id: dealId,
      p_name: lead.name,
      p_phone: lead.phone || null,
      p_email: lead.email || null,
      p_message: lead.message || null,
      p_preferred_time: lead.preferred_time || null,
      p_surface: surface,
      p_ip_hash: v.ipHash,
      p_ua_family: v.uaFamily,
      p_referrer_host: v.referrerHost,
      p_country_code: v.countryCode,
      p_suspect_bot: v.suspectBot,
      // Keyed on the contact detail, not the connection: one person asking from
      // home and again from work is a single enquiry, whereas a family sharing a
      // wifi connection is genuinely two.
      p_contact_hash: contactHash(lead.phone || lead.email),
    });

    if (!result) return res.status(404).json({ error: 'Deal not found' });

    // The enquiry is stored. Now tell somebody about it.
    await notifyAgency(req, result.leadId);

    // Only the agency's name goes back, so the traveller knows who will ring.
    // `billable` and the lead id are ours, not theirs.
    return res.status(200).json({
      recorded: true,
      agentName: result.agentName || null,
    });
  } catch (e) {
    console.error('[tripbuster/lead] failed', e && e.code, e && e.message);
    // Never pretend an enquiry was taken when it was not: someone is waiting for
    // a phone call that would never come.
    return res.status(502).json({
      error: 'We could not send that just now. Please try again, or ring the agency directly.',
    });
  }
}
