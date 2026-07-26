/**
 * Tripbuster click-out recorder
 * POST /api/tripbuster/click   { dealId, surface? }
 *
 * This is the billable event: the moment Tripbuster delivers a traveller to an
 * agent. Everything else on the platform exists to produce this.
 *
 * Public, because the caller is a traveller on either the Tripbuster site or an
 * agent's own site where the widget is embedded. Wildcard CORS is correct for the
 * same reason the deals feed has it — no auth, no PII in the response.
 *
 * Recorded, deliberately, whether or not it is billable: a repeat click inside 30
 * minutes and an obvious bot are both stored and flagged rather than dropped, so
 * odd patterns stay visible instead of vanishing.
 *
 * Returns the agent's booking URL so the caller can navigate, which means the
 * consumer-site interstitial can record the click server-side and then send the
 * traveller on, with no way to skip the recording.
 */
import { setCors } from '../_auth.js';
import { evaluatePublicRateLimit } from '../_lib/rate-limit-public.js';
import { tbConfigured, tbRpc } from '../_lib/tripbuster/db.js';
import { visitorContext } from '../_lib/tripbuster/visitor.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SURFACES = ['site', 'widget', 'directory', 'api'];

export default async function handler(req, res) {
  setCors(res);
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Bodies arrive as JSON from fetch, or as text from navigator.sendBeacon.
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};

  const dealId = typeof body.dealId === 'string' ? body.dealId.trim() : '';
  if (!UUID_RE.test(dealId)) return res.status(400).json({ error: 'A valid deal id is required' });

  const surfaceRaw = typeof body.surface === 'string' ? body.surface.trim() : '';
  const surface = SURFACES.includes(surfaceRaw) ? surfaceRaw : 'site';

  // A traveller pressing "call" is the other way Tripbuster delivers a lead.
  // Note this records an INTENT, not a proven call: the caller cannot tell us
  // whether anyone answered, so the database refuses to make it billable. Only a
  // telephony provider reporting a connected call of sufficient length can do
  // that, which is why call tracking numbers are the next step. Nothing a client
  // posts here can make an unproven call chargeable.
  const eventType = body.eventType === 'call' ? 'call' : 'click';

  const rl = await evaluatePublicRateLimit(req, res, { event: 'tb-click', widgetId: dealId });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });

  if (!tbConfigured()) return res.status(503).json({ error: 'Tracking is not configured yet' });

  try {
    const v = visitorContext(req);
    const result = await tbRpc('tb_record_click', {
      p_deal_id: dealId,
      p_surface: surface,
      p_ip_hash: v.ipHash,
      p_ua_family: v.uaFamily,
      p_referrer_host: v.referrerHost,
      p_country_code: v.countryCode,
      p_suspect_bot: v.suspectBot,
      p_event_type: eventType,
      // Deliberately not passed on from the body. Duration and whether the phone
      // was answered are facts only the telephony provider knows, and accepting
      // them from a browser would let anyone mint a billable call.
      p_call_seconds: null,
      p_call_connected: null,
      p_caller_hash: null,
    });

    // The function returns null for a deal that does not exist, so unknown ids
    // cannot be used to accumulate events.
    if (!result) return res.status(404).json({ error: 'Deal not found' });

    // `billable` is intentionally not exposed: it is our billing business, not
    // something a caller needs or should be able to probe.
    return res.status(200).json({
      recorded: true,
      clickoutUrl: result.clickoutUrl || null,
      // The number to ring, so a call CTA has somewhere to go.
      phone: result.phone || null,
    });
  } catch (e) {
    console.error('[tripbuster/click] failed', e && e.code, e && e.message);
    // A tracking failure must never block the traveller. The caller already holds
    // the destination URL, so it can navigate regardless.
    return res.status(502).json({ recorded: false });
  }
}
