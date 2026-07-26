/**
 * Tripbuster agency settings
 *
 *   GET   /api/tripbuster/account  → the settings this agency can change
 *   PATCH /api/tripbuster/account  → change them
 *
 * Deliberately narrow. This is not a general profile editor: it covers how an
 * agency gets charged and the phone number a call-first deal rings, because
 * without those the billing mode would be stuck on whatever it was seeded with
 * and pay-per-call could not be switched on at all.
 *
 * Everything else on the agents row (plan, status, ATOL, slug, the Travelgenix
 * link) is deliberately NOT editable here. Those are commercial or identity
 * facts that belong to us, not to the agency, and a settings screen is exactly
 * where a plan would otherwise get quietly upgraded.
 *
 * The agency is taken from the bearer token and never from the body.
 *
 * No CORS headers deliberately: authenticated surface, same-origin only.
 */

import { requireAgent } from '../_lib/tripbuster/auth.js';
import { tbConfigured, tbSelect, tbUpdate, tbRpc } from '../_lib/tripbuster/db.js';
import { AGENT_WRITE_COLUMNS, LIVE_DEAL_LIMITS } from '../_lib/tripbuster/deal-write.js';

const BILLING_MODES = ['click', 'call', 'both'];

/**
 * Tidy a phone number without being precious about the format.
 *
 * Spacing is DELIBERATELY preserved: "0141 555 907" reads far better on a deal
 * card than "0141555907", and this number is shown to travellers.
 *
 * Returns null to clear the number, undefined when the input is not usable.
 */
function cleanPhone(value) {
  if (typeof value !== 'string') return undefined;
  const s = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
  if (!s) return null; // clearing the number is allowed
  // Starts with a digit, a plus or an opening bracket, then the digits and
  // punctuation real numbers use. Nothing else.
  return /^[+(\d][\d\s()+.-]{5,}$/.test(s) ? s : undefined;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const gate = requireAgent(req);
  if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
  if (!tbConfigured()) return res.status(503).json({ error: 'Deals service is not configured yet' });

  const agentId = gate.agent.agentId;

  try {
    if (req.method === 'GET') {
      const [rows, byMode] = await Promise.all([
        tbSelect('agents', { select: AGENT_WRITE_COLUMNS, id: `eq.${agentId}`, limit: 1 }),
        tbRpc('tb_agent_billing_counts', { p_agent_id: agentId }).catch(() => null),
      ]);
      const agent = Array.isArray(rows) && rows[0] ? rows[0] : null;
      if (!agent) return res.status(401).json({ error: 'Sign in again to continue' });

      return res.status(200).json({
        name: agent.name,
        slug: agent.slug,
        plan: agent.plan,
        liveAllowance: Object.prototype.hasOwnProperty.call(LIVE_DEAL_LIMITS, agent.plan)
          ? LIVE_DEAL_LIMITS[agent.plan] : 0,
        billingMode: agent.billing_mode || 'click',
        callMinSeconds: agent.call_min_seconds ?? 60,
        phone: agent.phone || '',
        defaultClickoutUrl: agent.default_clickout_url || '',
        protectionType: agent.protection_type || '',
        atolNumber: agent.atol_number || '',
        travelgenixClient: !!agent.tg_client_email,
        // How the agency's deals actually resolve, so the screen can say
        // "8 of your deals override this" rather than leaving it a mystery.
        dealsByMode: byMode,
      });
    }

    if (req.method !== 'PATCH') {
      res.setHeader('Allow', 'GET, PATCH');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
    const patch = {};
    const errors = [];

    if (Object.prototype.hasOwnProperty.call(body, 'billingMode')) {
      if (!BILLING_MODES.includes(body.billingMode)) {
        errors.push({ field: 'billingMode', message: 'Choose click, call, or both' });
      } else {
        patch.billing_mode = body.billingMode;
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'callMinSeconds')) {
      const n = Number(body.callMinSeconds);
      if (!Number.isFinite(n) || n < 0 || n > 600) {
        errors.push({ field: 'callMinSeconds', message: 'Set between 0 and 600 seconds' });
      } else {
        patch.call_min_seconds = Math.round(n);
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'phone')) {
      const phone = cleanPhone(body.phone);
      if (phone === undefined) {
        errors.push({ field: 'phone', message: 'That does not look like a phone number' });
      } else {
        patch.phone = phone;
      }
    }

    if (errors.length) return res.status(422).json({ error: 'Some details need fixing', errors });
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });

    // Switching to call without a number to ring would take every call-first deal
    // off the site the moment it was saved. Caught here with a sentence the agency
    // can act on, rather than leaving them to work out why their deals vanished.
    const wantsCalls = patch.billing_mode === 'call' || patch.billing_mode === 'both';
    if (wantsCalls && patch.phone === null) {
      return res.status(422).json({
        error: 'Some details need fixing',
        errors: [{ field: 'phone', message: 'Add a phone number before charging for calls' }],
      });
    }
    if (wantsCalls && patch.phone === undefined) {
      const rows = await tbSelect('agents', { select: 'phone', id: `eq.${agentId}`, limit: 1 });
      const existingPhone = Array.isArray(rows) && rows[0] ? rows[0].phone : null;
      if (!existingPhone) {
        return res.status(422).json({
          error: 'Some details need fixing',
          errors: [{ field: 'phone', message: 'Add a phone number before charging for calls' }],
        });
      }
    }

    const updated = await tbUpdate('agents', { id: `eq.${agentId}` }, patch);
    const row = Array.isArray(updated) && updated[0] ? updated[0] : null;
    if (!row) return res.status(404).json({ error: 'Account not found' });

    return res.status(200).json({
      billingMode: row.billing_mode,
      callMinSeconds: row.call_min_seconds,
      phone: row.phone || '',
    });
  } catch (e) {
    console.error('[tripbuster/account] failed', req.method, e && e.code, e && e.message);
    return res.status(502).json({ error: 'Could not save that just now. Try again.' });
  }
}
